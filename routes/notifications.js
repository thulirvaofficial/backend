const express = require("express");
const { pool } = require("../config/database");

const router = express.Router();

// Real notifications store (no predefined fake mock notifications)
const { IN_APP_NOTIFICATIONS } = require("../services/notificationService");
let REAL_NOTIFICATIONS = [];

// Registered FCM device push tokens
let DEVICE_TOKENS = [];

// Log of subscription expiry reminders sent today: key = `${subId}_${dateStr}`
const SENT_EXPIRY_REMINDERS = new Set();

/* GET USER NOTIFICATIONS (ONLY REAL NOTIFICATIONS) */
router.get("/user/:identifier", async (req, res) => {
    const ident = req.params.identifier.trim().toLowerCase();
    try {
        const result = await pool.query(
            "SELECT * FROM notifications WHERE LOWER(COALESCE(user_id::text, ''))=$1 OR $1='all' ORDER BY created_at DESC",
            [ident]
        );
        if (result.rows && result.rows.length) {
            return res.json({ success: true, notifications: result.rows });
        }
    } catch {}

    const source = (IN_APP_NOTIFICATIONS && IN_APP_NOTIFICATIONS.length) ? IN_APP_NOTIFICATIONS : REAL_NOTIFICATIONS;
    const userNotifs = source.filter(n => {
        if (ident === "all") return true;
        const nUid = (n.user_id || "").toString().toLowerCase().trim();
        return nUid === ident;
    });

    res.json({
        success: true,
        notifications: userNotifs
    });
});

/* MARK NOTIFICATION AS READ */
router.put("/:id/read", async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query("UPDATE notifications SET is_read = true WHERE id = $1", [id]);
    } catch {}

    const notif = MOCK_NOTIFICATIONS.find(n => n.id === id);
    if (notif) {
        notif.is_read = true;
    }

    res.json({ success: true, message: "Notification marked as read" });
});

/* MARK ALL AS READ FOR USER */
router.put("/user/:identifier/read-all", async (req, res) => {
    const ident = req.params.identifier.trim().toLowerCase();
    try {
        await pool.query("UPDATE notifications SET is_read = true WHERE LOWER(user_id) = $1", [ident]);
    } catch {}

    MOCK_NOTIFICATIONS.forEach(n => {
        if ((n.user_id || "").toString().toLowerCase() === ident || ident === "all") {
            n.is_read = true;
        }
    });

    res.json({ success: true, message: "All notifications marked as read" });
});

/* REGISTER FCM / APNS DEVICE TOKEN */
router.post("/register-token", (req, res) => {
    const { token, platform, user_id } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, message: "Token is required" });
    }

    const existing = DEVICE_TOKENS.find(t => t.token === token);
    if (existing) {
        existing.user_id = user_id || existing.user_id;
        existing.updated_at = new Date().toISOString();
    } else {
        DEVICE_TOKENS.push({
            token,
            platform: platform || "android",
            user_id: user_id || null,
            created_at: new Date().toISOString()
        });
    }

    res.json({ success: true, message: "Device push token registered successfully" });
});

/* ============================================================
   CRITICAL: SUBSCRIPTION EXPIRY SCHEDULER
   Evaluates all active subscriptions and generates reminders:
   days_remaining = expiry_date - current_date
   If 0 <= days_remaining <= 5, sends 1 notification per day.
   Stops when expired (days_remaining < 0), cancelled, or renewed.
============================================================ */
function checkSubscriptionExpiryScheduler() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split("T")[0];

    // Read subscriptions from database or in-memory
    const subRoute = require("./subscriptions");
    // Access mock subscriptions or query
    const subscriptions = (typeof subRoute.getSubscriptions === "function" ? subRoute.getSubscriptions() : null) || [];

    subscriptions.forEach(sub => {
        // Rule: Only active subscriptions receive reminders
        if (!sub.status || sub.status.toLowerCase() !== "active") {
            return;
        }

        // Calculate expiry date
        let expiryDate = null;
        if (sub.expiry_date) {
            expiryDate = new Date(sub.expiry_date);
        } else if (sub.start_date) {
            // Default 30 days subscription duration
            const startDate = new Date(sub.start_date);
            const duration = sub.duration_days || (sub.time_period && sub.time_period.includes("15") ? 15 : 30);
            expiryDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000);
        }

        if (!expiryDate || isNaN(expiryDate.getTime())) return;
        expiryDate.setHours(0, 0, 0, 0);

        const diffTime = expiryDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Rule: 0 <= days_remaining <= 5
        // If daysRemaining < 0 -> Stop reminders after expiry
        if (daysRemaining >= 0 && daysRemaining <= 5) {
            const reminderKey = `${sub.id}_${dateStr}`;
            // Rule: Maximum one expiry reminder per subscription per day (Prevent duplicates)
            if (!SENT_EXPIRY_REMINDERS.has(reminderKey)) {
                SENT_EXPIRY_REMINDERS.add(reminderKey);

                const expiryFormatted = expiryDate.toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric"
                });

                const notificationPayload = {
                    id: "NOTIF-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
                    user_id: sub.user_id || sub.userId || 1,
                    type: "subscription_expiry",
                    subscription_id: sub.id,
                    customer_id: sub.user_id || sub.userId || "1",
                    days_remaining: daysRemaining,
                    expiry_date: expiryFormatted,
                    title: "Subscription Expiring Soon",
                    message: daysRemaining === 0
                        ? `Your ${sub.product_name || "Milk"} subscription expires today! Renew now to ensure fresh morning delivery tomorrow.`
                        : `Your ${sub.product_name || "Milk"} subscription will expire in ${daysRemaining} day${daysRemaining > 1 ? "s" : ""} on ${expiryFormatted}. Tap to renew.`,
                    data: {
                        type: "subscription_expiry",
                        subscription_id: sub.id,
                        customer_id: sub.user_id || sub.userId || "1",
                        days_remaining: daysRemaining,
                        expiry_date: expiryFormatted
                    },
                    is_read: false,
                    created_at: new Date().toISOString()
                };

                // Add to notifications
                MOCK_NOTIFICATIONS.unshift(notificationPayload);
                console.log(`[SUBSCRIPTION SCHEDULER] Generated reminder for ${sub.id}: ${daysRemaining} days remaining.`);
            }
        }
    });
}

// Trigger scheduler endpoint manually or for testing
router.post("/run-expiry-check", (req, res) => {
    checkSubscriptionExpiryScheduler();
    res.json({
        success: true,
        message: "Subscription expiry check executed successfully",
        total_notifications: MOCK_NOTIFICATIONS.length
    });
});

module.exports = {
    router,
    checkSubscriptionExpiryScheduler
};

