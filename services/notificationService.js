const { pool } = require("../config/database");

// In-memory notifications log fallback
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
    if (IN_APP_NOTIFICATIONS.length > 200) IN_APP_NOTIFICATIONS.pop();

    // 1. Try DB persistence
    try {
        await pool.query(
            `INSERT INTO notifications (user_id, title, message, type, target_id, is_read)
             VALUES ($1, $2, $3, $4, $5, false)`,
            [userId, title, message, type, targetId ? targetId.toString() : null]
        );
    } catch {}

    // 2. Try FCM push dispatch if tokens exist
    try {
        let tokens = [];
        if (forAdmin) {
            const res = await pool.query("SELECT token FROM device_tokens WHERE role = 'admin' AND is_active = true");
            tokens = res.rows.map(r => r.token);
        } else if (userId) {
            const res = await pool.query("SELECT token FROM device_tokens WHERE user_id = $1 AND is_active = true", [userId]);
            tokens = res.rows.map(r => r.token);
        }

        if (tokens.length > 0) {
            console.log(`[FCM DISPATCH] Sending to ${tokens.length} devices: [${title}] ${message}`);
            // If firebase-admin is configured on the host, dispatch message
            if (global.firebaseAdmin) {
                const messagePayload = {
                    notification: { title, body: message },
                    data: {
                        target_id: targetId ? targetId.toString() : "",
                        type: type || "order",
                        click_action: "FLUTTER_NOTIFICATION_CLICK"
                    },
                    tokens: tokens
                };
                await global.firebaseAdmin.messaging().sendEachForMulticast(messagePayload).catch(err => {
                    console.warn("[FCM ERROR]", err.message);
                });
            }
        }
    } catch (err) {
        console.warn("[NOTIF SERVICE]", err.message);
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
            title = "Order Confirmed";
            message = "Your Thulirva order has been confirmed! Farm fresh produce is being prepared.";
            break;
        case "preparing":
        case "packed":
            title = "Order Packed";
            message = "Your order has been packed and is ready for dispatch.";
            break;
        case "ready_for_pickup":
            title = "Ready for Pickup! 🏪";
            const store = order.pickup_location_name || "THULIRVA Store";
            message = `Your order is ready for pickup at ${store}. Please collect at your convenience.`;
            break;
        case "out_for_delivery":
            title = "Out for Delivery 🚚";
            message = "Your order is out for delivery. Get ready!";
            break;
        case "delivered":
            title = "Order Delivered ✨";
            message = "Your order has been successfully delivered. Thank you for choosing Thulirva!";
            break;
        case "collected":
            title = "Order Collected ✓";
            message = "Your order has been collected. Thank you for choosing Thulirva!";
            break;
        case "cancelled":
            title = "Order Cancelled";
            message = "Your order has been cancelled. Check your order details.";
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
 * Notify admin about a newly placed order
 */
async function notifyAdminNewOrder(order) {
    const isPickup = order.delivery_type === 'pickup' || order.is_pickup;
    const typeLabel = isPickup ? "Pickup Order" : "Home Delivery";
    const amount = Number(order.total || order.total_amount || 0).toFixed(0);

    return sendNotification({
        title: "New Order Received! 🔔",
        message: `New ${typeLabel} #${order.id} received from ${order.customer_name || 'Customer'} worth ₹${amount}.`,
        type: "new_order",
        targetId: order.id,
        forAdmin: true
    });
}

module.exports = {
    sendNotification,
    notifyOrderStatusChange,
    notifyAdminNewOrder,
    IN_APP_NOTIFICATIONS
};

