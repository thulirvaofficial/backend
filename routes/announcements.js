const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const {
    getAllAnnouncements,
    getActiveAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    toggleAnnouncementStatus,
    setAnnouncementPublish
} = require("../services/announcementService");

const router = express.Router();

// Multer storage for announcement banner uploads
const uploadDir = path.resolve(__dirname, "..", "public", "uploads", "announcements");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `announcement_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files (JPG, PNG, WebP) are allowed."));
        }
    }
});

/* =========================================================================
   PUBLIC / CUSTOMER & ADMIN ENDPOINTS
========================================================================= */

// 1. GET /api/announcements/active - Retrieve published, non-expired announcements
router.get(["/active", "/live"], async (req, res) => {
    try {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        const position = req.query.position || null;
        const active = await getActiveAnnouncements(position);
        res.json({
            success: true,
            count: active.length,
            announcements: active,
            banner: active.length > 0 ? active[0] : null
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 1b. GET /api/announcements/banner - Retrieve top active banner for mobile app or hero
router.get("/banner", async (req, res) => {
    try {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        const active = await getActiveAnnouncements("homepage_hero");
        const banner = active.length > 0 ? active[0] : null;
        res.json({
            success: true,
            enabled: Boolean(banner),
            banner
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 1c. GET /api/announcements/partners - Retrieve announcements for delivery partners (Module 12)
router.get("/partners", async (req, res) => {
    try {
        const all = await getActiveAnnouncements();
        const partnerAnnouncements = all.filter(a => {
            const aud = (a.target_audience || a.audience || "all").toLowerCase();
            return aud === "all" || aud === "delivery_partners" || aud === "partners";
        });
        res.json({
            success: true,
            count: partnerAnnouncements.length,
            announcements: partnerAnnouncements
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 1d. POST /api/admin/announcements/partner-alert - Dispatch urgent alert to delivery partners
router.post(["/partner-alert", "/admin/partner-alert"], authenticateToken, adminOnly, async (req, res) => {
    try {
        const { title, message, priority = "urgent", target_partner_id = null } = req.body || {};
        if (!title || !message) {
            return res.status(400).json({ success: false, message: "Title and message are required." });
        }
        const adminName = req.headers["x-admin-name"] || req.user?.admin_name || req.user?.name || "Super Admin";

        const created = await createAnnouncement({
            title,
            description: message,
            position: "bottom_banner",
            target_audience: target_partner_id ? target_partner_id : "delivery_partners",
            priority: priority === "urgent" ? 1 : 2,
            is_active: true,
            is_published: true,
            send_notification: true
        }, adminName);

        res.status(201).json({
            success: true,
            message: `Partner announcement broadcast dispatched successfully.`,
            announcement: created
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// 2. GET /api/admin/announcements or GET /api/announcements/all - List all announcements for admin panel
router.get(["/all", "/admin/all"], authenticateToken, adminOnly, async (req, res) => {
    try {
        const announcements = await getAllAnnouncements();
        res.json({
            success: true,
            count: announcements.length,
            announcements
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Root handler: dynamically check if admin route or public route
router.get("/", async (req, res) => {
    try {
        const isAdmin = req.baseUrl.includes("/admin");
        if (isAdmin) {
            return authenticateToken(req, res, () => {
                return adminOnly(req, res, async () => {
                    const announcements = await getAllAnnouncements();
                    return res.json({
                        success: true,
                        count: announcements.length,
                        announcements
                    });
                });
            });
        }

        const position = req.query.position || null;
        const active = await getActiveAnnouncements(position);
        return res.json({
            success: true,
            count: active.length,
            announcements: active,
            banner: active.length > 0 ? active[0] : null
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

function extractAdminName(req) {
    const b = req.body || {};
    return b.admin_name || req.headers["x-admin-name"] || req.user?.admin_name || req.user?.name || "Super Admin";
}

// 3. POST - Create announcement (with optional banner image)
router.post(["/", "/create", "/admin/create", "/admin"], authenticateToken, adminOnly, upload.single("banner_image"), async (req, res) => {
    try {
        const adminName = extractAdminName(req);
        const b = req.body || {};
        let imageUrl = b.image_url || "";

        if (req.file) {
            imageUrl = `/uploads/announcements/${req.file.filename}`;
        }

        const data = {
            ...b,
            image_url: imageUrl,
            is_active: b.is_active === true || b.is_active === "true",
            is_published: b.is_published === true || b.is_published === "true",
            send_notification: b.send_notification === true || b.send_notification === "true"
        };

        const created = await createAnnouncement(data, adminName);
        const io = req.app.get("io");
        if (io) {
            io.emit("announcement:updated", created);
            io.emit("announcement:sync");
        }
        res.json({
            success: true,
            message: "Announcement successfully created.",
            announcement: created
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. POST - Upload banner image only
router.post(["/upload-banner", "/admin/upload-banner"], authenticateToken, adminOnly, upload.single("banner"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No image file provided." });
        }
        const fileUrl = `/uploads/announcements/${req.file.filename}`;
        res.json({
            success: true,
            url: fileUrl,
            filename: req.file.filename
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5. PUT /:id - Update announcement
router.all(["/:id", "/admin/:id"], authenticateToken, adminOnly, upload.single("banner_image"), async (req, res) => {
    if (req.method !== "PUT" && req.method !== "POST" && req.method !== "DELETE") {
        return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }
    if (req.method === "DELETE") {
        try {
            const adminName = extractAdminName(req);
            await deleteAnnouncement(req.params.id, adminName);
            const io = req.app.get("io");
            if (io) {
                io.emit("announcement:deleted", { id: req.params.id });
                io.emit("announcement:sync");
            }
            return res.json({
                success: true,
                message: `Announcement #${req.params.id} has been deleted.`
            });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    }
    try {
        const adminName = extractAdminName(req);
        const b = req.body || {};
        let updates = { ...b };

        if (req.file) {
            updates.image_url = `/uploads/announcements/${req.file.filename}`;
        }
        if (updates.is_active !== undefined) {
            updates.is_active = updates.is_active === true || updates.is_active === "true";
        }
        if (updates.is_published !== undefined) {
            updates.is_published = updates.is_published === true || updates.is_published === "true";
        }
        if (updates.send_notification !== undefined) {
            updates.send_notification = updates.send_notification === true || updates.send_notification === "true";
        }

        const updated = await updateAnnouncement(req.params.id, updates, adminName);
        const io = req.app.get("io");
        if (io) {
            io.emit("announcement:updated", updated);
            io.emit("announcement:sync");
        }
        res.json({
            success: true,
            message: "Announcement updated successfully.",
            announcement: updated
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 6. DELETE /:id - Delete announcement
router.all(["/:id/delete", "/admin/:id/delete"], authenticateToken, adminOnly, async (req, res) => {
    try {
        const adminName = extractAdminName(req);
        await deleteAnnouncement(req.params.id, adminName);
        const io = req.app.get("io");
        if (io) {
            io.emit("announcement:deleted", { id: req.params.id });
            io.emit("announcement:sync");
        }
        res.json({
            success: true,
            message: `Announcement #${req.params.id} has been deleted.`
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 7. PATCH or POST /:id/toggle - Toggle active status
router.all(["/:id/toggle", "/admin/:id/toggle"], authenticateToken, adminOnly, async (req, res) => {
    try {
        const adminName = extractAdminName(req);
        const b = req.body || {};
        let targetState = undefined;
        if (b.is_active !== undefined) {
            targetState = b.is_active === true || b.is_active === "true";
        }
        const toggled = await toggleAnnouncementStatus(req.params.id, targetState, adminName);
        const io = req.app.get("io");
        if (io) {
            io.emit("announcement:status", toggled);
            io.emit("announcement:sync");
        }
        res.json({
            success: true,
            message: `Announcement #${req.params.id} is now ${toggled.is_active ? 'ACTIVE' : 'INACTIVE'}.`,
            announcement: toggled
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 8. PATCH or POST /:id/publish - Publish/unpublish announcement
router.all(["/:id/publish", "/admin/:id/publish"], authenticateToken, adminOnly, async (req, res) => {
    try {
        const adminName = extractAdminName(req);
        const b = req.body || {};
        const isPublished = b.is_published === true || b.is_published === "true";
        const result = await setAnnouncementPublish(req.params.id, isPublished, adminName);
        const io = req.app.get("io");
        if (io) {
            io.emit("announcement:updated", result);
            io.emit("announcement:sync");
        }
        res.json({
            success: true,
            message: `Announcement #${req.params.id} ${result.is_published ? 'published' : 'unpublished'}.`,
            announcement: result
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
