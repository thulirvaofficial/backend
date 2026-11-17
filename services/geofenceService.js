const fs = require("fs");
const path = require("path");
const { sendNotification } = require("./notificationService");
const { emitToCustomer, emitToOrder, emitToAdmin } = require("./socketService");
const { getDeliveryConfig, recordGeofenceArrival } = require("./businessConfigService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const GEOFENCE_STATE_FILE = path.join(DATA_DIR, "geofence_events.json");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadGeofenceState() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(GEOFENCE_STATE_FILE)) {
            return JSON.parse(fs.readFileSync(GEOFENCE_STATE_FILE, "utf-8"));
        }
    } catch (_) {}
    return { product_arrival: {}, subscription_proximity: {} };
}

function saveGeofenceState(state) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(GEOFENCE_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (_) {}
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
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
 * Check and trigger geofence events for delivery partner's current GPS position
 */
async function checkGeofenceTriggers({ partner_id, latitude, longitude, accuracy, timestamp }) {
    if (!partner_id || latitude === undefined || longitude === undefined) return;

    const lat = Number(latitude);
    const lng = Number(longitude);

    // Reject 0,0 coordinates or non-numeric
    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    // Filter out updates with poor GPS accuracy (> 50m) to prevent false geofence triggers
    if (accuracy !== undefined && accuracy !== null && !isNaN(Number(accuracy))) {
        if (Number(accuracy) > 50) {
            console.log(`[GEOFENCE SKIP] Rejecting partner ${partner_id} GPS update: Accuracy ${accuracy}m > 50m threshold`);
            return;
        }
    }

    const bizConfig = await getDeliveryConfig();
    const geofenceRadius = Number(bizConfig.geofence_radius_meters) || 100;
    const geofenceEnabled = bizConfig.geofence_notifications_enabled !== false;

    const state = loadGeofenceState();
    let stateChanged = false;

    // =========================================================================
    // 1. PRODUCT ORDER: 100-METRE (DYNAMIC) CUSTOMER ARRIVAL GEOFENCE
    // =========================================================================
    if (geofenceEnabled) {
        try {
            const ordersFile = path.join(DATA_DIR, "orders.json");
            let orders = [];
            if (fs.existsSync(ordersFile)) {
                orders = JSON.parse(fs.readFileSync(ordersFile, "utf-8"));
            }

            const activeOrders = orders.filter(o => {
                if (!o) return false;
                const pId = (o.partner_id || o.delivery_partner_id || "").toString();
                const s = (o.order_status || o.status || "").toLowerCase().replace(/[\s\-]/g, "_");
                return pId === partner_id.toString() && (s === "out_for_delivery" || s === "in_transit");
            });

            for (const order of activeOrders) {
                const orderId = order.id ? order.id.toString() : (order.order_number || "");
                if (!orderId) continue;

                // Destination coordinates
                const destLat = Number(order.latitude || order.delivery_latitude);
                const destLng = Number(order.longitude || order.delivery_longitude);

                if (!destLat || !destLng || isNaN(destLat) || isNaN(destLng)) continue;

                const distMeters = calculateDistanceMeters(lat, lng, destLat, destLng);
                if (distMeters === null) continue;

                // Dynamic Arrival Geofence (Default 100m)
                if (distMeters <= geofenceRadius) {
                    if (!state.product_arrival[orderId]) {
                        state.product_arrival[orderId] = {
                            order_id: orderId,
                            partner_id,
                            user_id: order.user_id,
                            arrived_at: new Date().toISOString(),
                            distance_meters: Math.round(distMeters)
                        };
                        stateChanged = true;

                        const title = bizConfig.geofence_alert_title || "Your Thulirva Delivery Partner Has Arrived!";
                        const message = bizConfig.geofence_alert_message || "Your Thulirva delivery partner has arrived near your location!";

                        console.log(`[GEOFENCE ${geofenceRadius}M ARRIVAL] Order #${orderId}: Partner within ${Math.round(distMeters)}m of customer`);

                        // 1. Send Push & In-App Notification to this specific customer
                        await sendNotification({
                            userId: order.user_id,
                            title,
                            message,
                            type: "order_arrived",
                            targetId: orderId
                        }).catch(e => console.warn("[Geofence Notif Error]", e.message));

                        // 2. Real-time Socket Event to Customer and Order Rooms
                        emitToOrder(orderId, "order:geofence_arrival", {
                            order_id: orderId,
                            partner_id,
                            distance_meters: Math.round(distMeters),
                            title,
                            message,
                            timestamp: new Date().toISOString()
                        });

                        if (order.user_id) {
                            emitToCustomer(order.user_id.toString(), "customer:geofence_arrival", {
                                order_id: orderId,
                                partner_id,
                                distance_meters: Math.round(distMeters),
                                title,
                                message,
                                timestamp: new Date().toISOString()
                            });
                        }

                        emitToAdmin("admin:geofence_arrival", {
                            order_id: orderId,
                            partner_id,
                            customer_name: order.customer_name || "Customer",
                            distance_meters: Math.round(distMeters)
                        });

                        // Record arrival in database
                        recordGeofenceArrival({
                            order_id: orderId,
                            delivery_type: "order",
                            partner_id: partner_id.toString(),
                            user_id: order.user_id ? order.user_id.toString() : null,
                            distance_meters: Math.round(distMeters),
                            partner_lat: lat,
                            partner_lng: lng,
                            customer_lat: destLat,
                            customer_lng: destLng
                        }).catch(e => console.warn("[Geofence DB Error]", e.message));
                    }
                }
            }
        } catch (err) {
            console.warn("[GEOFENCE PRODUCT CHECK ERROR]", err.message);
        }
    }

    // =========================================================================
    // 2. SUBSCRIPTION DELIVERY: 1-KM PROXIMITY NOTIFICATION
    // =========================================================================
    try {
        const subsFile = path.join(DATA_DIR, "subscription_deliveries.json");
        let subs = [];
        if (fs.existsSync(subsFile)) {
            subs = JSON.parse(fs.readFileSync(subsFile, "utf-8"));
        }

        const todayDateStr = new Date().toISOString().slice(0, 10);

        const activeSubs = subs.filter(s => {
            if (!s) return false;
            const pId = (s.partner_id || "").toString();
            const status = (s.status || "").toLowerCase();
            return pId === partner_id.toString() && (status === "pending" || status === "in_progress" || status === "out_for_delivery");
        });

        for (const sub of activeSubs) {
            const subId = sub.id ? sub.id.toString() : (sub.subscription_id || "");
            const stateKey = `${subId}_${todayDateStr}`;

            const subLat = Number(sub.latitude || sub.delivery_latitude);
            const subLng = Number(sub.longitude || sub.delivery_longitude);

            if (!subLat || !subLng || isNaN(subLat) || isNaN(subLng)) continue;

            const distMeters = calculateDistanceMeters(lat, lng, subLat, subLng);
            if (distMeters === null) continue;

            // 1 Kilometer (1000m) Subscription Proximity
            if (distMeters <= 1000) {
                if (!state.subscription_proximity[stateKey]) {
                    state.subscription_proximity[stateKey] = {
                        sub_id: subId,
                        partner_id,
                        user_id: sub.user_id,
                        approached_at: new Date().toISOString(),
                        distance_meters: Math.round(distMeters)
                    };
                    stateChanged = true;

                    const title = "Your Daily Thulirva Delivery Is Approaching!";
                    const message = "Your delivery partner is within 1 km of your location. Your daily subscription delivery will arrive soon.";

                    console.log(`[SUBSCRIPTION 1KM PROXIMITY] Sub #${subId}: Partner within ${(distMeters/1000).toFixed(2)}km of subscriber`);

                    // 1. Send Push & In-App Notification to this specific subscriber
                    await sendNotification({
                        userId: sub.user_id,
                        title,
                        message,
                        type: "subscription_approaching",
                        targetId: subId
                    }).catch(e => console.warn("[Sub Proximity Notif Error]", e.message));

                    // 2. Real-time Socket Event
                    if (sub.user_id) {
                        emitToCustomer(sub.user_id.toString(), "subscription:proximity_approach", {
                            sub_id: subId,
                            partner_id,
                            distance_meters: Math.round(distMeters),
                            title,
                            message,
                            timestamp: new Date().toISOString()
                        });
                    }

                    emitToAdmin("admin:subscription_proximity", {
                        sub_id: subId,
                        partner_id,
                        customer_name: sub.customer_name || "Subscriber",
                        distance_meters: Math.round(distMeters)
                    });

                    recordGeofenceArrival({
                        order_id: subId,
                        delivery_type: "subscription",
                        partner_id: partner_id.toString(),
                        user_id: sub.user_id ? sub.user_id.toString() : null,
                        distance_meters: Math.round(distMeters),
                        partner_lat: lat,
                        partner_lng: lng,
                        customer_lat: subLat,
                        customer_lng: subLng
                    }).catch(e => console.warn("[Geofence DB Error]", e.message));
                }
            }
        }
    } catch (err) {
        console.warn("[GEOFENCE SUBSCRIPTION CHECK ERROR]", err.message);
    }

    if (stateChanged) {
        saveGeofenceState(state);
    }
}

/**
 * Reset geofence arrival state for an order (e.g. on new delivery dispatch)
 */
function resetOrderGeofence(orderId) {
    if (!orderId) return;
    const state = loadGeofenceState();
    const idKey = orderId.toString();
    if (state.product_arrival && state.product_arrival[idKey]) {
        delete state.product_arrival[idKey];
        saveGeofenceState(state);
    }
}

module.exports = {
    checkGeofenceTriggers,
    resetOrderGeofence,
    calculateDistanceMeters
};

module.exports = {
    checkGeofenceTriggers,
    resetOrderGeofence,
    calculateDistanceMeters
};

