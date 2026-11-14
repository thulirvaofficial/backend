const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const LIVE_LOCATIONS_FILE = path.join(DATA_DIR, "partner_live_locations.json");
const LOCATION_HISTORY_FILE = path.join(DATA_DIR, "partner_location_history.json");
const PARTNERS_FILE = path.join(DATA_DIR, "delivery_partners.json");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadJson(file, defaultVal = []) {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, "utf-8"));
        }
    } catch (_) {}
    return defaultVal;
}

function saveJson(file, data) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    } catch (_) {}
}

/**
 * Validate geographical coordinate bounds
 */
function isValidCoordinates(lat, lng) {
    if (typeof lat !== "number" || typeof lng !== "number") return false;
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    if (lat === 0 && lng === 0) return false; // reject (0,0) null-island
    return true;
}

/**
 * Calculate distance in meters using Haversine formula
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Record a location update from delivery partner device
 */
async function recordLocationUpdate({
    partner_id,
    latitude,
    longitude,
    accuracy = 0,
    speed = 0,
    heading = 0,
    device_timestamp = null,
    active_delivery_id = null
}) {
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!partner_id) {
        throw new Error("partner_id is required.");
    }

    if (!isValidCoordinates(lat, lng)) {
        throw new Error(`Invalid GPS coordinates: lat ${latitude}, lng ${longitude}. Valid ranges: -90..90 and -180..180.`);
    }

    const now = new Date();
    const serverTimestamp = now.toISOString();
    const recordedAt = device_timestamp ? new Date(device_timestamp).toISOString() : serverTimestamp;

    // Check against previous location for anomaly detection (teleportation guard)
    const liveLocations = loadJson(LIVE_LOCATIONS_FILE, []);
    const prev = liveLocations.find(l => l.partner_id === partner_id);

    if (prev && prev.latitude && prev.longitude && prev.server_timestamp) {
        const timeDiffSec = Math.max(1, (now.getTime() - new Date(prev.server_timestamp).getTime()) / 1000);
        const distMeters = calculateDistanceMeters(prev.latitude, prev.longitude, lat, lng);
        const impliedSpeedKmh = (distMeters / timeDiffSec) * 3.6;

        // If distance jumped > 100km within 5 seconds, reject as impossible GPS glitch
        if (distMeters > 100000 && timeDiffSec < 10) {
            console.warn(`[GPS ANOMALY REJECTED] Partner ${partner_id} jumped ${distMeters}m in ${timeDiffSec}s (${impliedSpeedKmh.toFixed(1)} km/h)`);
            return prev;
        }
    }

    const liveRecord = {
        partner_id,
        latitude: lat,
        longitude: lng,
        accuracy: Number(accuracy) || 0,
        speed: Number(speed) || 0,
        heading: Number(heading) || 0,
        active_delivery_id: active_delivery_id ? active_delivery_id.toString() : null,
        device_timestamp: recordedAt,
        server_timestamp: serverTimestamp,
        is_fresh: true,
        last_seen_seconds_ago: 0
    };

    // 1. Update Live Locations store
    const idx = liveLocations.findIndex(l => l.partner_id === partner_id);
    if (idx >= 0) {
        liveLocations[idx] = liveRecord;
    } else {
        liveLocations.push(liveRecord);
    }
    saveJson(LIVE_LOCATIONS_FILE, liveLocations);

    // 2. Append to Location History store (max 500 points per partner)
    const history = loadJson(LOCATION_HISTORY_FILE, []);
    history.push({
        partner_id,
        latitude: lat,
        longitude: lng,
        speed: Number(speed) || 0,
        heading: Number(heading) || 0,
        accuracy: Number(accuracy) || 0,
        active_delivery_id: active_delivery_id ? active_delivery_id.toString() : null,
        recorded_at: serverTimestamp
    });
    // Truncate oldest entries if over 5000 items total
    if (history.length > 5000) {
        history.splice(0, history.length - 5000);
    }
    saveJson(LOCATION_HISTORY_FILE, history);

    // 3. Update Delivery Partner Record
    const partners = loadJson(PARTNERS_FILE, []);
    const partner = partners.find(p => p.partner_id === partner_id);
    if (partner) {
        partner.current_latitude = lat;
        partner.current_longitude = lng;
        partner.speed = Number(speed) || 0;
        partner.heading = Number(heading) || 0;
        partner.accuracy = Number(accuracy) || 0;
        partner.location_updated_at = serverTimestamp;
        partner.last_active_at = serverTimestamp;
        saveJson(PARTNERS_FILE, partners);
    }

    // 4. PostgreSQL Update if available
    try {
        await pool.query(`
            UPDATE delivery_partners 
            SET current_latitude = $1, current_longitude = $2, speed = $3,
                heading = $4, accuracy = $5, location_updated_at = NOW(),
                last_active_at = NOW(), is_online = true
            WHERE partner_id = $6
        `, [lat, lng, Number(speed) || 0, Number(heading) || 0, Number(accuracy) || 0, partner_id]);

        await pool.query(`
            INSERT INTO partner_location_history (partner_id, latitude, longitude, speed, heading, accuracy, recorded_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `, [partner_id, lat, lng, Number(speed) || 0, Number(heading) || 0, Number(accuracy) || 0]);
    } catch (_) {}

    // 5. Real-Time Socket Broadcast
    try {
        const { emitToAdmin, emitToOrder } = require("./socketService");
        emitToAdmin("partner:location_updated", {
            partner_id,
            latitude: lat,
            longitude: lng,
            speed: Number(speed) || 0,
            heading: Number(heading) || 0,
            accuracy: Number(accuracy) || 0,
            timestamp: serverTimestamp
        });
        emitToAdmin("delivery:location:update", {
            partnerId: partner_id,
            latitude: lat,
            longitude: lng,
            speed: Number(speed) || 0,
            heading: Number(heading) || 0,
            accuracy: Number(accuracy) || 0
        });

        if (active_delivery_id) {
            emitToOrder(active_delivery_id, "delivery:location:update", {
                partnerId: partner_id,
                latitude: lat,
                longitude: lng,
                speed: Number(speed) || 0,
                heading: Number(heading) || 0,
                accuracy: Number(accuracy) || 0
            });
        }
    } catch (_) {}

    // 6. Geofence & Proximity Detection (100m Arrival for Orders, 1km Proximity for Subscriptions)
    try {
        const { checkGeofenceTriggers } = require("./geofenceService");
        await checkGeofenceTriggers({
            partner_id,
            latitude: lat,
            longitude: lng
        });
    } catch (_) {}

    return liveRecord;
}

/**
 * Get latest live location for a partner
 */
async function getPartnerLiveLocation(partnerId) {
    const liveLocations = loadJson(LIVE_LOCATIONS_FILE, []);
    const record = liveLocations.find(l => l.partner_id === partnerId);
    if (!record) {
        // Fallback to partner record
        const partners = loadJson(PARTNERS_FILE, []);
        const p = partners.find(x => x.partner_id === partnerId);
        if (p && p.current_latitude && p.current_longitude) {
            return {
                partner_id: partnerId,
                latitude: Number(p.current_latitude),
                longitude: Number(p.current_longitude),
                accuracy: Number(p.accuracy || 0),
                speed: Number(p.speed || 0),
                heading: Number(p.heading || 0),
                server_timestamp: p.location_updated_at || p.last_active_at || new Date().toISOString(),
                is_fresh: true
            };
        }
        return null;
    }

    const ageSec = Math.round((Date.now() - new Date(record.server_timestamp).getTime()) / 1000);
    return {
        ...record,
        last_seen_seconds_ago: ageSec,
        is_fresh: ageSec <= 300 // Fresh if within 5 minutes
    };
}

/**
 * Get all active fleet live locations
 */
async function getAllLiveLocations() {
    const partners = loadJson(PARTNERS_FILE, []);
    const liveLocations = loadJson(LIVE_LOCATIONS_FILE, []);

    return partners.map(p => {
        const live = liveLocations.find(l => l.partner_id === p.partner_id);
        const lat = live?.latitude ?? (p.current_latitude ? Number(p.current_latitude) : null);
        const lng = live?.longitude ?? (p.current_longitude ? Number(p.current_longitude) : null);
        const lastUpdated = live?.server_timestamp || p.location_updated_at || p.last_active_at || null;
        const ageSec = lastUpdated ? Math.round((Date.now() - new Date(lastUpdated).getTime()) / 1000) : 999999;

        return {
            partner_id: p.partner_id,
            name: p.name,
            phone: p.phone,
            is_online: Boolean(p.is_online),
            is_active: Boolean(p.is_active),
            assigned_area: p.assigned_area || "Chennai",
            vehicle_type: p.vehicle_type || "Electric Scooter",
            vehicle_number: p.vehicle_number || "",
            latitude: lat,
            longitude: lng,
            speed: live?.speed ?? (Number(p.speed) || 0),
            heading: live?.heading ?? (Number(p.heading) || 0),
            accuracy: live?.accuracy ?? (Number(p.accuracy) || 0),
            location_updated_at: lastUpdated,
            last_seen_seconds_ago: ageSec,
            is_fresh: ageSec <= 300,
            has_valid_location: isValidCoordinates(lat, lng)
        };
    });
}

/**
 * Get partner location breadcrumb history
 */
function getPartnerLocationHistory(partnerId, { limit = 100, since = null } = {}) {
    const history = loadJson(LOCATION_HISTORY_FILE, []);
    let filtered = history.filter(h => h.partner_id === partnerId);
    if (since) {
        const sinceTime = new Date(since).getTime();
        filtered = filtered.filter(h => new Date(h.recorded_at).getTime() >= sinceTime);
    }
    return filtered.slice(-limit);
}

module.exports = {
    isValidCoordinates,
    calculateDistanceMeters,
    recordLocationUpdate,
    getPartnerLiveLocation,
    getAllLiveLocations,
    getPartnerLocationHistory
};

