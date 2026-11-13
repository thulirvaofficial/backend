const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { initFirebaseAdmin, admin, isFirebaseInitialized, getMessaging } = require("./firebaseAdmin");
const { getDeviceTokens, deactivateToken } = require("./tokenStore");

// Initialize Firebase Admin on startup (safe, non-blocking)
initFirebaseAdmin();

const DATA_DIR = path.resolve(__dirname, "..", "data");
const NOTIFICATIONS_FILE = path.join(DATA_DIR, "notifications.json");

function loadNotificationsFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(NOTIFICATIONS_FILE)) {
            const data = fs.readFileSync(NOTIFICATIONS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.warn("[NOTIFICATIONS DISK LOAD WARN]:", e.message);
    }
    return [];
}

function saveNotificationsToDisk(notifs) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifs.slice(0, 500), null, 2), "utf-8");
    } catch (e) {
        console.warn("[NOTIFICATIONS DISK SAVE WARN]:", e.message);
    }
}

// In-memory notifications fallback initialized from disk
const IN_APP_NOTIFICATIONS = loadNotificationsFromDisk();
// Persistent in-memory diagnostic logs for admin panel & debugging
const NOTIFICATION_DISPATCH_LOGS = [];

function markNotificationAsRead(id, userId = null) {
    const notif = IN_APP_NOTIFICATIONS.find(n => n.id?.toString() === id?.toString());
    if (notif) {
        notif.is_read = true;
        saveNotificationsToDisk(IN_APP_NOTIFICATIONS);
    }
    return true;
}

function markAllNotificationsAsRead(userId = null) {
    const uid = userId ? userId.toString().toLowerCase() : null;
    IN_APP_NOTIFICATIONS.forEach(n => {
        if (!uid || (n.user_id && n.user_id.toString().toLowerCase() === uid) || n.user_id === "all" || n.user_id === "delivery_partners") {
            n.is_read = true;
        }
    });
    saveNotificationsToDisk(IN_APP_NOTIFICATIONS);
    return true;
}

/**
 * Send and log a notification to a specific user or all admins
 */
async function sendNotification({
    userId = null,
    title,
    message,
    type = "order",
    targetId = null,
    forAdmin = false,
    token = null,
    tokens: directTokens = null
}) {
    const payload = {
        id: "NOTIF-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        user_id: userId,
        title,
        message,
        type,
        target_id: targetId ? targetId.toString() : null,
        is_read: false,
        for_admin: forAdmin,
        created_at: new Date().toISOString()
    };

    IN_APP_NOTIFICATIONS.unshift(payload);
    if (IN_APP_NOTIFICATIONS.length > 300) IN_APP_NOTIFICATIONS.pop();
    saveNotificationsToDisk(IN_APP_NOTIFICATIONS);

    // 1. Persist notification to database for in-app history
    try {
        await pool.query(
            `INSERT INTO notifications (user_id, title, message, type, target_id, is_read)
             VALUES ($1, $2, $3, $4, $5, false)`,
            [userId, title, message, type, targetId ? targetId.toString() : null]
        );
    } catch (dbErr) {
        // Fallback already in memory
    }

    // 2. Fetch active device push tokens
    const logEntry = {
        id: payload.id,
        timestamp: new Date().toISOString(),
        event: type,
        title,
        message,
        target_id: targetId ? targetId.toString() : null,
        for_admin: forAdmin,
        user_id: userId,
        tokens_targeted: 0,
        success_count: 0,
        failure_count: 0,
        status: "pending",
        errors: [],
        fcm_response: null
    };

    try {
        let tokens = [];
        if (token) {
            tokens = [token];
        } else if (Array.isArray(directTokens) && directTokens.length > 0) {
            tokens = [...directTokens];
        } else {
            try {
                if (forAdmin) {
                    const res = await pool.query(
                        "SELECT token FROM device_tokens WHERE role = 'admin' AND is_active = true"
                    );
                    tokens = res.rows.map(r => r.token);
                } else if (userId) {
                    const res = await pool.query(
                        "SELECT token FROM device_tokens " +
                        "WHERE (user_id::text = $1::text " +
                        "       OR user_id IN (SELECT id FROM users WHERE phone = $1::text OR email = $1::text OR id::text = $1::text)) " +
                        "  AND is_active = true",
                        [userId.toString()]
                    );
                    tokens = res.rows.map(r => r.token);
                } else {
                    // Broadcast to all active customer devices
                    const res = await pool.query(
                        "SELECT token FROM device_tokens WHERE is_active = true AND role != 'admin' LIMIT 500"
                    );
                    tokens = res.rows.map(r => r.token);
                }
            } catch (dbErr) {
                console.warn("[NOTIFICATION SERVICE] Token query warning:", dbErr.message);
            }
            if (!tokens || tokens.length === 0) {
                tokens = getDeviceTokens({ forAdmin, userId });
            }
        }

        // Deduplicate tokens
        tokens = [...new Set(tokens.filter(t => t && t.trim().length > 10))];
        logEntry.tokens_targeted = tokens.length;

        const messaging = typeof getMessaging === "function" ? getMessaging() : null;
        const isReady = (typeof isFirebaseInitialized === "function" ? isFirebaseInitialized() : (admin && admin.apps && admin.apps.length > 0)) || (messaging !== null);

        if (tokens.length > 0 && messaging && isReady) {
            let targetChannelId;
            if (forAdmin) {
                if (type.includes("order") || type.includes("pickup")) targetChannelId = "thulirva_admin_orders_channel_v2";
                else if (type.includes("sub")) targetChannelId = "thulirva_admin_subscriptions_channel_v2";
                else if (type.includes("pay")) targetChannelId = "thulirva_admin_payments_channel_v2";
                else targetChannelId = "thulirva_admin_channel_v2";
            } else {
                if (type.includes("order")) targetChannelId = "thulirva_orders_channel_v2";
                else if (type.includes("sub")) targetChannelId = "thulirva_subscriptions_channel_v2";
                else if (type.includes("pay")) targetChannelId = "thulirva_payments_channel_v2";
                else targetChannelId = "thulirva_general_channel_v2";
            }
            console.log(`[FCM DISPATCH] Sending to ${tokens.length} devices [${forAdmin ? 'ADMIN' : 'USER'}] via channel "${targetChannelId}": "${title}" - "${message}"`);

            const fcmPayload = {
                notification: {
                    title: title,
                    body: message
                },
                data: {
                    target_id: targetId ? targetId.toString() : "",
                    type: type || "order",
                    title: title,
                    body: message,
                    click_action: "FLUTTER_NOTIFICATION_CLICK"
                },
                android: {
                    priority: "high",
                    notification: {
                        channelId: targetChannelId,
                        sound: "thulirva_notification",
                        priority: "max",
                        defaultVibrateTimings: true,
                        defaultSound: false,
                        visibility: "public"
                    }
                },
                tokens: tokens
            };

            const response = await messaging.sendEachForMulticast(fcmPayload);
            console.log(`✓ [FCM SUCCESS] Delivered: ${response.successCount}/${tokens.length} messages. Failures: ${response.failureCount}`);

            logEntry.success_count = response.successCount;
            logEntry.failure_count = response.failureCount;
            logEntry.status = response.successCount > 0 ? "delivered" : "failed";
            logEntry.fcm_response = response.responses.map(r => ({
                success: r.success,
                messageId: r.messageId || null,
                error: r.error ? { code: r.error.code, message: r.error.message } : null
            }));

            // Remove or deactivate invalid/expired tokens
            if (response.failureCount > 0) {
                const badTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const errCode = resp.error?.code || "";
                        if (
                            errCode === "messaging/registration-token-not-registered" ||
                            errCode === "messaging/invalid-registration-token" ||
                            errCode === "messaging/invalid-argument"
                        ) {
                            badTokens.push(tokens[idx]);
                        }
                    }
                });

                if (badTokens.length > 0) {
                    badTokens.forEach(t => deactivateToken(t));
                    try {
                        await pool.query(
                            "UPDATE device_tokens SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE token = ANY($1::text[])",
                            [badTokens]
                        );
                        console.log(`[FCM CLEANUP] Deactivated ${badTokens.length} expired device tokens.`);
                    } catch { }
                }
            }
        } else {
            logEntry.status = tokens.length === 0 ? "no_tokens_registered" : "firebase_not_ready";
        }
    } catch (err) {
        logEntry.status = "error";
        logEntry.errors.push({ code: err.code || "SEND_ERROR", message: err.message });
        console.warn("[FCM DISPATCH ERROR]", err.message);
    }

    NOTIFICATION_DISPATCH_LOGS.unshift(logEntry);
    if (NOTIFICATION_DISPATCH_LOGS.length > 200) NOTIFICATION_DISPATCH_LOGS.pop();

    try {
        await pool.query(
            `INSERT INTO notification_logs (event, user_id, for_admin, title, message, target_id, tokens_count, success_count, failure_count, error_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                logEntry.event,
                logEntry.user_id ? logEntry.user_id.toString() : null,
                logEntry.for_admin,
                logEntry.title,
                logEntry.message,
                logEntry.target_id,
                logEntry.tokens_targeted,
                logEntry.success_count,
                logEntry.failure_count,
                logEntry.errors.length ? JSON.stringify(logEntry.errors) : (logEntry.failure_count > 0 ? "FCM failure" : null)
            ]
        ).catch(() => { });
    } catch (_) { }

    return payload;

    return payload;
}

/**
 * Notify customer about order status change
 */
async function notifyOrderStatusChange(order, newStatus) {
    let title = "Order Update";
    let message = `Your order #${order.id} status is now ${newStatus}.`;

    switch (newStatus.toLowerCase()) {
        case "received":
            title = "Order Placed Successfully 🛍️";
            message = `We have received your order #${order.id}. Thank you for ordering pure farm goodness!`;
            break;
        case "confirmed":
        case "processing":
            title = "Order Confirmed ✓";
            message = "Your Thulirva order has been confirmed! Farm fresh produce is being prepared.";
            break;
        case "preparing":
        case "packed":
            title = "Order Packed 📦";
            message = "Your order has been safely packed with natural freshness guarantees.";
            break;
        case "ready_for_pickup":
            title = "Ready for Pickup! 🏪";
            const store = order.pickup_location_name || "THULIRVA Farm Store";
            message = `Your order is ready for pickup at ${store}. Please collect at your convenience.`;
            break;
        case "out_for_delivery":
        case "dispatched":
            title = "Out for Delivery 🚚";
            message = "Your early morning farm delivery is on the way! Freshness arriving shortly.";
            break;
        case "delivered":
            title = "Order Delivered ✨";
            message = "Your order has been successfully delivered. Thank you for choosing Thulirva!";
            break;
        case "collected":
            title = "Order Collected ✓";
            message = "Your pickup order has been collected. Thank you for choosing Thulirva!";
            break;
        case "cancelled":
            title = "Order Cancelled ❌";
            message = `Your order #${order.id} has been cancelled. If any payment was deducted, refund is being processed.`;
            break;
        case "payment_rejected":
            title = "Payment Verification Issue ⚠️";
            message = `Payment proof for order #${order.id} could not be verified: ${order.rejection_reason || 'UTR mismatch'}. Please upload valid receipt.`;
            break;
    }

    const userId = order.user_id || order.userId;
    return sendNotification({
        userId,
        title,
        message,
        type: "order_status",
        targetId: order.id,
        forAdmin: false
    });
}

/**
 * Standardized Module 8 helper: sendCustomerOrderNotification
 */
async function sendCustomerOrderNotification({ order, event, status }) {
    const s = status || event || order.order_status || "confirmed";
    return notifyOrderStatusChange(order, s);
}

/**
 * Standardized Module 8 helper: sendAdminNewOrderNotification
 */
async function sendAdminNewOrderNotification({ order }) {
    return notifyAdminNewOrder(order);
}

/**
 * Notify admin about a newly placed order (IMMEDIATE ALERT)
 */
async function notifyAdminNewOrder(order) {
    const isPickup = order.delivery_type === 'pickup' || order.is_pickup;
    const typeLabel = isPickup ? "Store Pickup Order" : "Home Delivery Order";
    const amount = Number(order.total || order.total_amount || 0).toFixed(0);

    return sendNotification({
        title: "New Order Received! 🔔",
        message: `New ${typeLabel} #${order.id} received from ${order.customer_name || 'Customer'} worth ₹${amount}.`,
        type: isPickup ? "pickup_order" : "new_order",
        targetId: order.id,
        forAdmin: true
    });
}

/**
 * Standardized Module 8 helper: sendSubscriptionNotification
 */
async function sendSubscriptionNotification({ subscription, event }) {
    const userId = subscription.user_id || subscription.userId;
    const planName = subscription.product_name || subscription.plan_name || "Milk Subscription";
    const subId = subscription.id;

    let title = "Subscription Update 🥛";
    let message = `Your subscription #${subId} has been updated.`;

    switch ((event || "").toLowerCase()) {
        case "created":
        case "activated":
            title = "Subscription Activated! 🥛";
            message = `Your ${planName} subscription is active! Daily fresh morning deliveries start on ${subscription.start_date || 'tomorrow'}.`;
            // Also notify Admin about new subscription
            sendNotification({
                title: "New Subscription Enrolled! 🥛",
                message: `New subscriber ${subscription.customer_name || 'Customer'} (${subscription.customer_phone || ''}) enrolled in ${planName}.`,
                type: "new_subscription",
                targetId: subId,
                forAdmin: true
            }).catch(() => { });
            break;
        case "paused":
            title = "Subscription Paused ⏸️";
            message = `Your ${planName} subscription has been paused. Daily deliveries are on hold until you resume.`;
            sendNotification({
                title: "Subscription Paused ⏸️",
                message: `Subscriber ${subscription.customer_name || 'Customer'} paused subscription #${subId}.`,
                type: "subscription_paused",
                targetId: subId,
                forAdmin: true
            }).catch(() => { });
            break;
        case "resumed":
            title = "Subscription Resumed! ▶️";
            message = `Your ${planName} subscription has been resumed! Daily deliveries will continue tomorrow morning.`;
            sendNotification({
                title: "Subscription Resumed ▶️",
                message: `Subscriber ${subscription.customer_name || 'Customer'} resumed subscription #${subId}.`,
                type: "subscription_resumed",
                targetId: subId,
                forAdmin: true
            }).catch(() => { });
            break;
        case "cancelled":
            title = "Subscription Cancelled ❌";
            message = `Your ${planName} subscription has been cancelled. Thank you for subscribing with Thulirva.`;
            sendNotification({
                title: "Subscription Cancelled ❌",
                message: `Subscription #${subId} (${subscription.customer_name || 'Customer'}) was cancelled.`,
                type: "subscription_cancelled",
                targetId: subId,
                forAdmin: true
            }).catch(() => { });
            break;
        case "expiring":
            title = "Subscription Expiring Soon ⏳";
            message = `Your ${planName} subscription expires in 5 days. Renew now to avoid missing morning deliveries!`;
            break;
        case "renewal":
        case "renewed":
            title = "Subscription Renewed! 🔄";
            message = `Your ${planName} subscription has been renewed. Fresh morning milk continues uninterrupted!`;
            break;
    }

    return sendNotification({
        userId,
        title,
        message,
        type: "subscription",
        targetId: subId,
        forAdmin: false
    });
}

/**
 * Standardized Module 8 helper: sendPaymentNotification
 */
async function sendPaymentNotification({ orderOrSub, status, amount, forAdmin = false, reason = "" }) {
    const id = orderOrSub?.id || "";
    const isSub = id.toString().startsWith("SUB") || orderOrSub?.plan_id;
    const itemType = isSub ? "Subscription" : "Order";
    const amt = amount || orderOrSub?.total || orderOrSub?.total_price || 0;
    const userId = orderOrSub?.user_id || orderOrSub?.userId;

    if (forAdmin) {
        if (status === "verification_required") {
            return sendNotification({
                title: "Payment Verification Required 💳",
                message: `Payment proof uploaded for ${itemType} #${id} (₹${amt}). Please verify in Admin panel.`,
                type: "payment_verification",
                targetId: id,
                forAdmin: true
            });
        } else {
            return sendNotification({
                title: "Payment Received 💰",
                message: `Payment of ₹${amt} confirmed for ${itemType} #${id}.`,
                type: "payment",
                targetId: id,
                forAdmin: true
            });
        }
    } else {
        if (status === "success" || status === "verified" || status === "paid") {
            return sendNotification({
                userId,
                title: "Payment Verified! ✓",
                message: `Your payment of ₹${amt} for ${itemType} #${id} has been verified and confirmed.`,
                type: "payment",
                targetId: id,
                forAdmin: false
            });
        } else if (status === "rejected" || status === "failed") {
            return sendNotification({
                userId,
                title: "Payment Verification Failed ❌",
                message: `Payment proof for ${itemType} #${id} could not be verified: ${reason || 'Invalid reference'}.`,
                type: "payment",
                targetId: id,
                forAdmin: false
            });
        } else {
            return sendNotification({
                userId,
                title: "Payment Pending ⏳",
                message: `Payment proof for ${itemType} #${id} is undergoing verification.`,
                type: "payment",
                targetId: id,
                forAdmin: false
            });
        }
    }
}

/**
 * Standardized Module 8 helper: sendPickupNotification
 */
async function sendPickupNotification({ order, event, forAdmin = false }) {
    const store = order.pickup_location_name || "THULIRVA Farm Store";
    const slot = order.pickup_slot || "Morning";

    if (forAdmin) {
        return sendNotification({
            title: "New Store Pickup Order 🏪",
            message: `Pickup Order #${order.id} placed for ${store} (${slot}) by ${order.customer_name || 'Customer'}.`,
            type: "pickup_order",
            targetId: order.id,
            forAdmin: true
        });
    } else {
        return sendNotification({
            userId: order.user_id || order.userId,
            title: "Pickup Order Ready! 🏪",
            message: `Your order #${order.id} is ready for collection at ${store} during slot ${slot}.`,
            type: "order_status",
            targetId: order.id,
            forAdmin: false
        });
    }
}

async function notifySubscriptionActivated(subscription) {
    return sendSubscriptionNotification({ subscription, event: "activated" });
}

async function notifySubscriptionRenewed(subscription) {
    return sendSubscriptionNotification({ subscription, event: "renewed" });
}

async function notifySubscriptionExpiring(subscription, daysLeft = 5) {
    return sendSubscriptionNotification({ subscription, event: "expiring" });
}

module.exports = {
    sendNotification,
    notifyOrderStatusChange,
    notifyAdminNewOrder,
    notifySubscriptionActivated,
    notifySubscriptionRenewed,
    notifySubscriptionExpiring,
    sendCustomerOrderNotification,
    sendAdminNewOrderNotification,
    sendSubscriptionNotification,
    sendPaymentNotification,
    sendPickupNotification,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    loadNotificationsFromDisk,
    saveNotificationsToDisk,
    IN_APP_NOTIFICATIONS,
    NOTIFICATION_DISPATCH_LOGS
};
