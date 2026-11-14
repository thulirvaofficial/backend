// Shared in-memory and disk-persisted device token store for zero-downtime push notifications
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'device_tokens.json');

function loadTokensFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(TOKENS_FILE)) {
            const data = fs.readFileSync(TOKENS_FILE, 'utf-8');
            return JSON.parse(data);
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

function addDeviceToken({ token, platform = 'android', user_id = null, role = 'customer' }) {
    if (!token || typeof token !== 'string' || token.trim().length < 10) return;
    const cleanToken = token.trim();
    const existing = DEVICE_TOKENS.find(t => t.token === cleanToken);
    if (existing) {
        existing.user_id = user_id || existing.user_id;
        existing.role = role || existing.role;
        existing.platform = platform || existing.platform;
        existing.is_active = true;
        existing.updated_at = new Date().toISOString();
    } else {
        DEVICE_TOKENS.push({
            token: cleanToken,
            platform: platform || 'android',
            user_id: user_id || null,
            role: role || 'customer',
            is_active: true,
            created_at: new Date().toISOString()
        });
    }
    saveTokensToDisk(DEVICE_TOKENS);
}

function getDeviceTokens({ forAdmin = false, userId = null, role = null }) {
    if (forAdmin) {
        return DEVICE_TOKENS
            .filter(t => t.role === 'admin' && t.is_active)
            .map(t => t.token);
    }
    if (role === 'partner' || role === 'delivery_partner') {
        return DEVICE_TOKENS
            .filter(t => (t.role === 'partner' || t.role === 'delivery_partner') && t.is_active)
            .map(t => t.token);
    }
    if (userId) {
        const uid = userId.toString().toLowerCase().trim();
        if (uid === 'all_partners' || uid === 'delivery_partners') {
            return DEVICE_TOKENS
                .filter(t => (t.role === 'partner' || t.role === 'delivery_partner') && t.is_active)
                .map(t => t.token);
        }
        return DEVICE_TOKENS
            .filter(t => t.user_id && t.user_id.toString().toLowerCase() === uid && t.is_active)
            .map(t => t.token);
    }
    // All active customer tokens
    return DEVICE_TOKENS
        .filter(t => t.role !== 'admin' && t.is_active)
        .map(t => t.token);
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
    deactivateToken
};
