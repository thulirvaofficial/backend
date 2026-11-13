const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const { pool } = require("../../config/database");

const router = express.Router();
const path = require("path");
const fs = require("fs");
const NOTIFICATIONS_FILE = path.resolve(__dirname, "..", "..", "data", "notifications.json");

function loadNotifications() {
    try {
        if (fs.existsSync(NOTIFICATIONS_FILE)) {
            return JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function saveNotifications(notifs) {
    try {
        fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifs, null, 2), "utf-8");
    } catch (_) {}
}

/**
 * GET /api/v1/notifications/me
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.partner_id || req.user.id;
        const all = loadNotifications();
        const userNotifs = all.filter(n =>
            n.userId?.toString() === userId.toString() ||
            n.user_id?.toString() === userId.toString() ||
            (req.user.role === "admin" && n.forAdmin)
        );

        return res.json({
            success: true,
            total: userNotifs.length,
            unread_count: userNotifs.filter(n => !n.is_read && !n.isRead).length,
            notifications: userNotifs
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/v1/notifications/:id/read
 */
router.put("/:id/read", authenticateToken, async (req, res) => {
    try {
        const notifId = req.params.id;
        const all = loadNotifications();
        const item = all.find(n => n.id?.toString() === notifId.toString());
        if (item) {
            item.is_read = true;
            item.isRead = true;
            item.read_at = new Date().toISOString();
            saveNotifications(all);
        }
        return res.json({ success: true, message: "Notification marked as read." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/v1/notifications/read-all
 */
router.put("/read-all", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.partner_id || req.user.id;
        const all = loadNotifications();
        all.forEach(n => {
            if (n.userId?.toString() === userId.toString() || n.user_id?.toString() === userId.toString() || (req.user.role === "admin" && n.forAdmin)) {
                n.is_read = true;
                n.isRead = true;
                n.read_at = new Date().toISOString();
            }
        });
        saveNotifications(all);
        return res.json({ success: true, message: "All notifications marked as read." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/notifications/send (Admin/System)
 */
router.post("/send", authenticateToken, async (req, res) => {
    try {
        const { user_id, title, message, type, target_id } = req.body;
        const { sendNotification } = require("../../services/notificationService");
        const notif = await sendNotification({
            userId: user_id,
            title,
            message,
            type: type || "system",
            targetId: target_id
        });
        return res.status(201).json({ success: true, notification: notif });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
