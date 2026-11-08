const express = require("express");
const { pool } = require("../config/database");
const { IN_APP_NOTIFICATIONS, sendNotification } = require("../services/notificationService");
const { DEVICE_TOKENS, addDeviceToken, getDeviceTokens } = require("../services/tokenStore");

const router = express.Router();

// Fallback in-memory stores
let REAL_NOTIFICATIONS = [];
let IN_MEMORY_ANNOUNCEMENTS = [
    {
        id: 1,
        title: "🌾 Fresh Morning Milking Dispatched Daily",
        message: "Direct from our Kanchipuram pasture farms to your doorstep every morning by 7:00 AM. 100% pure, unadulterated & chilled A2 milk.",
        badge: "Farm Update",
        target_role: "all",
        is_published: true,
        created_by: "Admin",
        created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
        id: 2,
        title: "🧈 Traditional Bilona Cow Ghee Available",
        message: "Handcrafted Bilona cow ghee prepared from curd-churned butter is now in stock. Pure aroma, golden granules & rich in vitamins.",
        badge: "Special Release",
        target_role: "all",
        is_published: true,
        created_by: "Admin",
        created_at: new Date().toISOString()
    }
];

const SENT_EXPIRY_REMINDERS = new Set();

/* GET USER NOTIFICATIONS (REAL BACKEND NOTIFICATIONS ONLY) */
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

/* GET ANNOUNCEMENTS (PUBLIC / APP HOMESCREEN / NEWS) */
router.get("/announcements", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM announcements WHERE is_published = true ORDER BY created_at DESC"
        );
        if (result.rows.length) {
            return res.json({ success: true, announcements: result.rows });
        }
    } catch {}

    res.json({
        success: true,
        announcements: IN_MEMORY_ANNOUNCEMENTS.filter(a => a.is_published)
    });
});

/* MARK NOTIFICATION AS READ */
router.put("/:id/read", async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query("UPDATE notifications SET is_read = true WHERE id = $1", [id]);
    } catch {}

    const notif = IN_APP_NOTIFICATIONS.find(n => n.id === id) || REAL_NOTIFICATIONS.find(n => n.id === id);
    if (notif) notif.is_read = true;

    res.json({ success: true, message: "Notification marked as read" });
});

/* MARK ALL AS READ FOR USER */
router.put("/user/:identifier/read-all", async (req, res) => {
    const ident = req.params.identifier.trim().toLowerCase();
    try {
        await pool.query("UPDATE notifications SET is_read = true WHERE LOWER(user_id::text) = $1", [ident]);
    } catch {}

    IN_APP_NOTIFICATIONS.forEach(n => {
        if ((n.user_id || "").toString().toLowerCase() === ident || ident === "all") {
            n.is_read = true;
        }
    });

    res.json({ success: true, message: "All notifications marked as read" });
});

/* REGISTER FCM / APNS DEVICE TOKEN */
router.post("/register-token", async (req, res) => {
    const { token, platform, user_id, role } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, message: "Token is required" });
    }

    try {
        await pool.query(
            `INSERT INTO device_tokens (token, device_type, user_id, role, is_active, updated_at)
             VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)
             ON CONFLICT (token) DO UPDATE
             SET user_id = EXCLUDED.user_id, role = EXCLUDED.role, is_active = true, updated_at = CURRENT_TIMESTAMP`,
            [token, platform || 'android', user_id || null, role || 'customer']
        );
    } catch {}

    // Synchronize to shared token store
    addDeviceToken({
        token,
        platform: platform || "android",
        user_id: user_id || null,
        role: role || "customer"
    });

    console.log(`✓ [TOKEN REGISTERED] Device push token saved for ${role || 'customer'} (user_id: ${user_id || 'guest'})`);
    res.json({ success: true, message: "Device push token registered successfully" });
});

/* ============================================================
   ADMIN NEWS & NOTIFICATION MANAGEMENT (REQUIREMENT 4)
============================================================ */

/* GET ALL ANNOUNCEMENTS & BROADCASTS (ADMIN) */
router.get("/admin/all", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM announcements ORDER BY created_at DESC");
        if (result.rows.length) {
            return res.json({ success: true, announcements: result.rows });
        }
    } catch {}

    res.json({ success: true, announcements: IN_MEMORY_ANNOUNCEMENTS });
});

/* PUBLISH NEW ANNOUNCEMENT / BROADCAST PUSH NOTIFICATION */
router.post("/admin/broadcast", async (req, res) => {
    const { title, message, badge, target_role, send_push } = req.body;
    if (!title || !message) {
        return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    let createdAnnouncement = null;

    try {
        const result = await pool.query(
            `INSERT INTO announcements (title, message, badge, target_role, is_published, created_by)
             VALUES ($1, $2, $3, $4, true, 'Admin')
             RETURNING *`,
            [title, message, badge || 'Announcement', target_role || 'all']
        );
        createdAnnouncement = result.rows[0];
    } catch (err) {
        const newAnn = {
            id: IN_MEMORY_ANNOUNCEMENTS.length + 1,
            title,
            message,
            badge: badge || 'Announcement',
            target_role: target_role || 'all',
            is_published: true,
            created_by: 'Admin',
            created_at: new Date().toISOString()
        };
        IN_MEMORY_ANNOUNCEMENTS.unshift(newAnn);
        createdAnnouncement = newAnn;
    }

    const role = (target_role || 'all').toLowerCase();

    // 1. Broadcast notification to customers
    if (role === 'all' || role === 'customer') {
        await sendNotification({
            userId: null,
            title: `📢 ${title}`,
            message,
            type: "announcement",
            targetId: createdAnnouncement.id,
            forAdmin: false
        }).catch(() => {});
    }

    // 2. Broadcast alert to admins
    if (role === 'all' || role === 'admin') {
        await sendNotification({
            userId: null,
            title: `📢 Admin Announcement: ${title}`,
            message,
            type: "announcement",
            targetId: createdAnnouncement.id,
            forAdmin: true
        }).catch(() => {});
    }

    res.json({
        success: true,
        message: "Announcement published and broadcast sent to registered customers",
        announcement: createdAnnouncement
    });
});

/* EDIT ANNOUNCEMENT */
router.put("/admin/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const { title, message, badge, is_published } = req.body;

    try {
        const result = await pool.query(
            `UPDATE announcements SET
                title = COALESCE($1, title),
                message = COALESCE($2, message),
                badge = COALESCE($3, badge),
                is_published = COALESCE($4, is_published),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $5
             RETURNING *`,
            [title, message, badge, is_published, id]
        );
        if (result.rows.length) {
            return res.json({ success: true, announcement: result.rows[0] });
        }
    } catch {}

    const idx = IN_MEMORY_ANNOUNCEMENTS.findIndex(a => a.id === id);
    if (idx !== -1) {
        IN_MEMORY_ANNOUNCEMENTS[idx] = { ...IN_MEMORY_ANNOUNCEMENTS[idx], ...req.body };
        return res.json({ success: true, announcement: IN_MEMORY_ANNOUNCEMENTS[idx] });
    }

    res.status(404).json({ success: false, message: "Announcement not found" });
});

/* DELETE ANNOUNCEMENT */
router.delete("/admin/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query("DELETE FROM announcements WHERE id = $1", [id]);
    } catch {}

    IN_MEMORY_ANNOUNCEMENTS = IN_MEMORY_ANNOUNCEMENTS.filter(a => a.id !== id);
    res.json({ success: true, message: "Announcement deleted" });
});

/* ============================================================
   SUBSCRIPTION EXPIRY SCHEDULER
============================================================ */
async function checkSubscriptionExpiryScheduler() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split("T")[0];

    let subscriptions = [];
    try {
        const res = await pool.query("SELECT * FROM subscriptions WHERE LOWER(status) = 'active'");
        subscriptions = res.rows || [];
    } catch (_) {}

    const subRoute = require("./subscriptions");
    const memSubs = (typeof subRoute.getSubscriptions === "function" ? subRoute.getSubscriptions() : null) || [];
    const dbIds = new Set(subscriptions.map(s => s.id.toString()));
    for (const m of memSubs) {
        if (!dbIds.has(m.id.toString())) subscriptions.push(m);
    }

    subscriptions.forEach(sub => {
        if (!sub.status || sub.status.toLowerCase() !== "active") return;

        let expiryDate = null;
        if (sub.expiry_date) {
            expiryDate = new Date(sub.expiry_date);
        } else if (sub.start_date) {
            const startDate = new Date(sub.start_date);
            const duration = sub.duration_days || (sub.time_period && sub.time_period.includes("15") ? 15 : 30);
            expiryDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000);
        }

        if (!expiryDate || isNaN(expiryDate.getTime())) return;
        expiryDate.setHours(0, 0, 0, 0);

        const diffTime = expiryDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (daysRemaining >= 0 && daysRemaining <= 5) {
            const reminderKey = `${sub.id}_${dateStr}`;
            if (!SENT_EXPIRY_REMINDERS.has(reminderKey)) {
                SENT_EXPIRY_REMINDERS.add(reminderKey);

                const expiryFormatted = expiryDate.toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric"
                });

                sendNotification({
                    userId: sub.user_id || sub.userId || 1,
                    title: "Subscription Expiring Soon",
                    message: daysRemaining === 0
                        ? `Your ${sub.product_name || "Milk"} subscription expires today! Renew now to ensure fresh morning delivery tomorrow.`
                        : `Your ${sub.product_name || "Milk"} subscription will expire in ${daysRemaining} day${daysRemaining > 1 ? "s" : ""} on ${expiryFormatted}. Tap to renew.`,
                    type: "subscription_expiry",
                    targetId: sub.id,
                    forAdmin: false
                }).catch(() => {});
            }
        }
    });
}

router.post("/run-expiry-check", (req, res) => {
    checkSubscriptionExpiryScheduler();
    res.json({
        success: true,
        message: "Subscription expiry check executed successfully"
    });
});

/* DEACTIVATE / DEREGISTER FCM DEVICE TOKEN (ON LOGOUT) */
router.post("/deactivate-token", async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, message: "Token is required" });
    }
    const { deactivateToken } = require("../services/tokenStore");
    try {
        await pool.query(
            "UPDATE device_tokens SET is_active = false, user_id = null, role = 'guest', updated_at = CURRENT_TIMESTAMP WHERE token = $1",
            [token]
        );
    } catch {}
    deactivateToken(token);
    console.log(`✓ [TOKEN DEACTIVATED] Token ${token.substring(0, 15)}... marked inactive on logout`);
    res.json({ success: true, message: "Token deactivated successfully" });
});

/* NOTIFICATION DIAGNOSTIC ENDPOINT (REQUIREMENT 9) */
router.get("/diagnostic", async (req, res) => {
    const fs = require("fs");
    const path = require("path");
    const defaultPath = path.join(__dirname, "..", "config", "firebase-service-account.json");
    const hasDefaultKey = fs.existsSync(defaultPath);
    const customKeyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const hasCustomKey = customKeyPath ? fs.existsSync(customKeyPath) : false;
    const isJsonEnv = customKeyPath && customKeyPath.trim().startsWith("{");

    let serviceAccountDetails = null;
    if (hasDefaultKey) {
        try {
            const parsed = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
            serviceAccountDetails = { client_email: parsed.client_email, project_id: parsed.project_id, has_key: !!parsed.private_key };
        } catch (_) {}
    } else if (hasCustomKey) {
        try {
            const parsed = JSON.parse(fs.readFileSync(customKeyPath, "utf8"));
            serviceAccountDetails = { client_email: parsed.client_email, project_id: parsed.project_id, has_key: !!parsed.private_key };
        } catch (_) {}
    } else if (isJsonEnv) {
        try {
            const parsed = JSON.parse(customKeyPath);
            serviceAccountDetails = { client_email: parsed.client_email, project_id: parsed.project_id, has_key: !!parsed.private_key };
        } catch (_) {}
    }

    let tokenStats = { totalActive: 0, adminActive: 0, customerActive: 0, recentTokens: [] };
    try {
        const statsRes = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE role = 'admin' AND is_active = true) as admin_count,
                COUNT(*) FILTER (WHERE role != 'admin' AND is_active = true) as customer_count
            FROM device_tokens
        `);
        if (statsRes.rows.length) {
            tokenStats.totalActive = parseInt(statsRes.rows[0].total || 0);
            tokenStats.adminActive = parseInt(statsRes.rows[0].admin_count || 0);
            tokenStats.customerActive = parseInt(statsRes.rows[0].customer_count || 0);
        }
        const recentRes = await pool.query(`
            SELECT id, user_id, role, device_type, is_active, SUBSTRING(token, 1, 15) as token_prefix, updated_at
            FROM device_tokens ORDER BY updated_at DESC LIMIT 10
        `);
        tokenStats.recentTokens = recentRes.rows;
    } catch (err) {
        tokenStats.error = err.message;
        tokenStats.inMemoryCount = DEVICE_TOKENS.length;
        tokenStats.inMemoryAdmin = DEVICE_TOKENS.filter(t => t.role === 'admin' && t.is_active).length;
        tokenStats.inMemoryCustomer = DEVICE_TOKENS.filter(t => t.role !== 'admin' && t.is_active).length;
    }

    const { NOTIFICATION_DISPATCH_LOGS } = require("../services/notificationService");

    res.json({
        success: true,
        serverTime: new Date().toISOString(),
        firebase: {
            hasDefaultKeyFile: hasDefaultKey,
            hasCustomKeyFile: hasCustomKey,
            hasJsonInEnv: !!isJsonEnv,
            serviceAccount: serviceAccountDetails,
            projectId: process.env.FIREBASE_PROJECT_ID || "thulirva-e9697",
            googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || null
        },
        tokens: tokenStats,
        recentDispatches: (NOTIFICATION_DISPATCH_LOGS || []).slice(0, 30)
    });
});

/* GET FCM DELIVERY LOGS (ADMIN ONLY) */
router.get("/admin/logs", async (req, res) => {
    let logs = [];
    try {
        const result = await pool.query("SELECT * FROM notification_logs ORDER BY created_at DESC LIMIT 50");
        if (result.rows.length) {
            logs = result.rows;
        }
    } catch {}

    const { NOTIFICATION_DISPATCH_LOGS } = require("../services/notificationService");
    if (!logs.length) {
        logs = NOTIFICATION_DISPATCH_LOGS || [];
    }

    res.json({
        success: true,
        logs: logs
    });
});

/* TEST FCM DISPATCH ENDPOINT FOR VERIFICATION */
router.post("/test-dispatch", async (req, res) => {
    const { token, title, message, forAdmin, userId, type, targetId } = req.body;
    try {
        const result = await sendNotification({
            userId: userId || null,
            title: title || "Test Notification 🔔",
            message: message || "Testing push notification dispatch",
            type: type || "test_alert",
            targetId: targetId || "TEST-01",
            forAdmin: forAdmin === true
        });
        const { NOTIFICATION_DISPATCH_LOGS } = require("../services/notificationService");
        const latestLog = (NOTIFICATION_DISPATCH_LOGS || [])[0] || null;
        res.json({
            success: true,
            message: "Test dispatch executed",
            result,
            deliveryLog: latestLog
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/* SUBMIT CUSTOMER ENQUIRY (NOTIFIES ADMIN) */
router.post("/enquiry", async (req, res) => {
    const { name, email, phone, subject, message } = req.body;
    sendNotification({
        title: "New Customer Enquiry 📩",
        message: `${name || 'Customer'} (${phone || email || ''}): ${subject || message || 'New farm query received'}`,
        type: "customer_enquiry",
        targetId: phone || email || "",
        forAdmin: true
    }).catch(() => {});
    res.json({ success: true, message: "Enquiry submitted successfully" });
});

module.exports = {
    router,
    checkSubscriptionExpiryScheduler
};
