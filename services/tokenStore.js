// Shared in-memory and disk-persisted device token store for zero-downtime push notifications
// Strict role and app-type separation to prevent cross-app notification leaks
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'device_tokens.json');

function normalizeRoleAndAppType(role, appType, userId) {
    const r = (role || '').toString().toLowerCase().trim();
    const at = (appType || '').toString().toLowerCase().trim();
    const uid = (userId || '').toString().trim();

    if (r === 'partner' || r === 'delivery_partner' || at === 'partner' || uid.startsWith('THU-DP') || uid.startsWith('DP-')) {
        return { role: 'delivery_partner', app_type: 'partner' };
    }
    if (r === 'admin' || at === 'admin') {
        return { role: 'admin', app_type: 'admin' };
    }
    return { role: 'customer', app_type: 'customer' };
}

function loadTokensFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(TOKENS_FILE)) {
            const data = fs.readFileSync(TOKENS_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                // Migrate / normalize existing tokens
                return parsed.map(t => {
                    const norm = normalizeRoleAndAppType(t.role, t.app_type, t.user_id);
                    return {
                        token: t.token,
                        platform: t.platform || 'android',
                        user_id: t.user_id || null,
                        role: norm.role,
                        app_type: norm.app_type,
                        device_id: t.device_id || null,
                        is_active: t.is_active !== false,
                        created_at: t.created_at || new Date().toISOString(),
                        updated_at: t.updated_at || new Date().toISOString()
                    };
                });
            }
        }
    } catch (e) {
        console.warn('[TOKEN STORE DISK LOAD WARN]:', e.message);
    }
    return [];
}

function saveTokensToDisk(tokens) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens.slice(0, 1000), null, 2), 'utf-8');
    } catch (e) {
        console.warn('[TOKEN STORE DISK SAVE WARN]:', e.message);
    }
}

const DEVICE_TOKENS = loadTokensFromDisk();

function addDeviceToken({ token, platform = 'android', user_id = null, role = 'customer', app_type = null, device_id = null }) {
    if (!token || typeof token !== 'string' || token.trim().length < 10) return;
    const cleanToken = token.trim();
    const norm = normalizeRoleAndAppType(role, app_type, user_id);

    const existing = DEVICE_TOKENS.find(t => t.token === cleanToken);
    if (existing) {
        existing.user_id = user_id || existing.user_id;
        existing.role = norm.role;
        existing.app_type = norm.app_type;
        existing.platform = platform || existing.platform;
        existing.device_id = device_id || existing.device_id || null;
        existing.is_active = true;
        existing.updated_at = new Date().toISOString();
    } else {
        DEVICE_TOKENS.push({
            token: cleanToken,
            platform: platform || 'android',
            user_id: user_id || null,
            role: norm.role,
            app_type: norm.app_type,
            device_id: device_id || null,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    }
    saveTokensToDisk(DEVICE_TOKENS);
}

/**
 * Check if a token belongs to a delivery partner
 */
function isDeliveryPartnerToken(token) {
    if (!token) return false;
    const clean = token.trim();
    const item = DEVICE_TOKENS.find(t => t.token === clean);
    if (!item) return false;
    return item.role === 'delivery_partner' || item.role === 'partner' || item.app_type === 'partner';
}

/**
 * Check if a token belongs to an admin
 */
function isAdminToken(token) {
    if (!token) return false;
    const clean = token.trim();
    const item = DEVICE_TOKENS.find(t => t.token === clean);
    return item ? item.role === 'admin' : false;
}

/**
 * Strictly partitioned device token selector.
 * NEVER returns delivery partner tokens when querying for customers or admins.
 */
function getDeviceTokens({ forAdmin = false, userId = null, role = null, appType = null }) {
    // 1. Admin Tokens Only
    if (forAdmin || role === 'admin' || appType === 'admin') {
        return DEVICE_TOKENS
            .filter(t => t.role === 'admin' && t.is_active)
            .map(t => t.token);
    }

    const isPartnerQuery = role === 'partner' || role === 'delivery_partner' || appType === 'partner' ||
        (userId && (userId.toString().startsWith('THU-DP') || userId.toString().startsWith('DP-')));

    // 2. Delivery Partner Tokens Only
    if (isPartnerQuery) {
        let partners = DEVICE_TOKENS.filter(t => 
            (t.role === 'delivery_partner' || t.role === 'partner' || t.app_type === 'partner') && t.is_active
        );

        if (userId) {
            const uid = userId.toString().toLowerCase().trim();
            if (uid !== 'all' && uid !== 'all_partners' && uid !== 'delivery_partners') {
                const matchingIds = new Set([uid]);
                try {
                    const partnersFile = path.join(DATA_DIR, 'delivery_partners.json');
                    if (fs.existsSync(partnersFile)) {
                        const allPartners = JSON.parse(fs.readFileSync(partnersFile, 'utf-8'));
                        const p = allPartners.find(part =>
                            part.partner_id?.toLowerCase() === uid ||
                            part.phone === uid ||
                            part.email?.toLowerCase() === uid
                        );
                        if (p) {
                            if (p.partner_id) matchingIds.add(p.partner_id.toLowerCase());
                            if (p.phone) matchingIds.add(p.phone.toLowerCase());
                            if (p.email) matchingIds.add(p.email.toLowerCase());
                        }
                    }
                } catch (_) {}

                partners = partners.filter(t => t.user_id && matchingIds.has(t.user_id.toString().toLowerCase()));
            }
        }
        return partners.map(t => t.token);
    }

    // 3. Customer Tokens Only (STRICT: Delivery partners and admins are ALWAYS EXCLUDED)
    let customers = DEVICE_TOKENS.filter(t => 
        (t.role === 'customer' || t.app_type === 'customer') &&
        t.role !== 'delivery_partner' &&
        t.role !== 'partner' &&
        t.role !== 'admin' &&
        t.app_type !== 'partner' &&
        t.app_type !== 'admin' &&
        t.is_active
    );

    if (userId) {
        const uid = userId.toString().toLowerCase().trim();
        customers = customers.filter(t => t.user_id && t.user_id.toString().toLowerCase() === uid);
    }

    return customers.map(t => t.token);
}

function deactivateToken(token) {
    const item = DEVICE_TOKENS.find(t => t.token === token);
    if (item) {
        item.is_active = false;
        saveTokensToDisk(DEVICE_TOKENS);
    }
}

module.exports = {
    DEVICE_TOKENS,
    addDeviceToken,
    getDeviceTokens,
    deactivateToken,
    isDeliveryPartnerToken,
    isAdminToken,
    normalizeRoleAndAppType
};
