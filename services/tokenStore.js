// Shared in-memory device token store for zero-downtime push notifications
const DEVICE_TOKENS = [];

function addDeviceToken({ token, platform = 'android', user_id = null, role = 'customer' }) {
    if (!token || typeof token !== 'string' || token.trim().length < 10) return;
    const cleanToken = token.trim();
    const existing = DEVICE_TOKENS.find(t => t.token === cleanToken);
    if (existing) {
        existing.user_id = user_id || existing.user_id;
        existing.role = role || existing.role;
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
}

function getDeviceTokens({ forAdmin = false, userId = null }) {
    if (forAdmin) {
        return DEVICE_TOKENS
            .filter(t => t.role === 'admin' && t.is_active)
            .map(t => t.token);
    }
    if (userId) {
        return DEVICE_TOKENS
            .filter(t => t.user_id && t.user_id.toString() === userId.toString() && t.is_active)
            .map(t => t.token);
    }
    // All active customer tokens
    return DEVICE_TOKENS
        .filter(t => t.role !== 'admin' && t.is_active)
        .map(t => t.token);
}

function deactivateToken(token) {
    const item = DEVICE_TOKENS.find(t => t.token === token);
    if (item) item.is_active = false;
}

module.exports = {
    DEVICE_TOKENS,
    addDeviceToken,
    getDeviceTokens,
    deactivateToken
};

