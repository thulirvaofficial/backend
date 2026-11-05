const { pool } = require("../config/database");
const { initFirebaseAdmin, admin, isFirebaseInitialized, getMessaging } = require("./firebaseAdmin");

// Initialize Firebase Admin on startup (safe, non-blocking)
initFirebaseAdmin();

// In-memory notifications fallback
const IN_APP_NOTIFICATIONS = [];

/**
 * Send and log a notification to a specific user or all admins
 */
async function sendNotification({
    userId = null,
    title,
    message,
    type = "order",
    targetId = null,
    forAdmin = false
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
    try {
        let tokens = [];
        if (forAdmin) {
            const res = await pool.query(
                "SELECT token FROM device_tokens WHERE role = 'admin' AND is_active = true"
            );
            tokens = res.rows.map(r => r.token);
        } else if (userId) {
            const res = await pool.query(
                "SELECT token FROM device_tokens WHERE user_id::text = $1::text AND is_active = true",
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

        // Deduplicate tokens
        tokens = [...new Set(tokens.filter(t => t && t.trim().length > 10))];

        const messaging = typeof getMessaging === "function" ? getMessaging() : null;
        const isReady = (typeof isFirebaseInitialized === "function" ? isFirebaseInitialized() : (admin && admin.apps && admin.apps.length > 0)) || (messaging !== null);

        if (tokens.length > 0 && messaging && isReady) {
            const targetChannelId = forAdmin ? "thulirva_admin_channel" : "thulirva_channel";
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
                        sound: "default",
                        priority: "max",
                        defaultVibrateTimings: true,
                        defaultSound: true,
                        visibility: "public"
                    }
                },
                tokens: tokens
            };

            const response = await messaging.sendEachForMulticast(fcmPayload);
            console.log(`✓ [FCM SUCCESS] Delivered: ${response.successCount}/${tokens.length} messages. Failures: ${response.failureCount}`);

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
                    try {
                        await pool.query(
                            "UPDATE device_tokens SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE token = ANY($1::text[])",
                            [badTokens]
                        );
                        console.log(`[FCM CLEANUP] Deactivated ${badTokens.length} expired device tokens.`);
                    } catch {}
                }
            }
        }
    } catch (err) {
        console.warn("[FCM DISPATCH ERROR]", err.message);
    }

    return payload;
}

/**
 * Notify customer about order status change
 */
async function notifyOrderStatusChange(order, newStatus) {
    let title = "Order Update";
    let message = `Your order #${order.id} status is now ${newStatus}.`;

    switch (newStatus.toLowerCase()) {
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
 * Notify admin about a newly placed order (IMMEDIATE ALERT)
 */
async function notifyAdminNewOrder(order) {
    const isPickup = order.delivery_type === 'pickup' || order.is_pickup;
    const typeLabel = isPickup ? "Store Pickup Order" : "Home Delivery Order";
    const amount = Number(order.total || order.total_amount || 0).toFixed(0);

    return sendNotification({
        title: "New Order Received! 🔔",
        message: `New ${typeLabel} #${order.id} received from ${order.customer_name || 'Customer'} worth ₹${amount}.`,
        type: "new_order",
        targetId: order.id,
        forAdmin: true
    });
}

/**
 * Notify customer when a subscription is activated
 */
async function notifySubscriptionActivated(subscription) {
    const userId = subscription.user_id || subscription.userId;
    const planName = subscription.product_name || subscription.plan_name || "Milk Subscription";

    return sendNotification({
        userId,
        title: "Subscription Activated! 🥛",
        message: `Your ${planName} subscription is active! Daily fresh morning deliveries start on ${subscription.start_date || 'tomorrow'}.`,
        type: "subscription",
        targetId: subscription.id,
        forAdmin: false
    });
}

/**
 * Notify customer when a subscription is renewed
 */
async function notifySubscriptionRenewed(subscription) {
    const userId = subscription.user_id || subscription.userId;
    const planName = subscription.product_name || subscription.plan_name || "Milk Subscription";

    return sendNotification({
        userId,
        title: "Subscription Renewed! 🔄",
        message: `Your ${planName} subscription has been renewed. Fresh morning milk continues uninterrupted!`,
        type: "subscription",
        targetId: subscription.id,
        forAdmin: false
    });
}

/**
 * Notify customer when a subscription is expiring within 5 days
 */
async function notifySubscriptionExpiring(subscription, daysLeft = 5) {
    const userId = subscription.user_id || subscription.userId;
    const planName = subscription.product_name || subscription.plan_name || "Milk Subscription";

    return sendNotification({
        userId,
        title: "Subscription Expiring Soon ⏳",
        message: `Your ${planName} subscription expires in ${daysLeft} days. Renew now to avoid missing morning deliveries!`,
        type: "subscription_expiry",
        targetId: subscription.id,
        forAdmin: false
    });
}

module.exports = {
    sendNotification,
    notifyOrderStatusChange,
    notifyAdminNewOrder,
    notifySubscriptionActivated,
    notifySubscriptionRenewed,
    notifySubscriptionExpiring,
    IN_APP_NOTIFICATIONS
};
