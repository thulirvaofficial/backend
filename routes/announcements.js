const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
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

// 2. GET /api/admin/announcements or GET /api/announcements/all - List all announcements for admin panel
router.get(["/all", "/admin/all"], async (req, res) => {
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
            const announcements = await getAllAnnouncements();
            return res.json({
                success: true,
                count: announcements.length,
                announcements
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
router.post(["/", "/create", "/admin/create", "/admin"], upload.single("banner_image"), async (req, res) => {
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
router.post(["/upload-banner", "/admin/upload-banner"], upload.single("banner"), (req, res) => {
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
router.all(["/:id", "/admin/:id"], upload.single("banner_image"), async (req, res) => {
    if (req.method !== "PUT" && req.method !== "POST" && req.method !== "DELETE") {
        return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }
    if (req.method === "DELETE") {
        try {
            const adminName = extractAdminName(req);
            await deleteAnnouncement(req.params.id, adminName);
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
router.all(["/:id/delete", "/admin/:id/delete"], async (req, res) => {
    try {
        const adminName = extractAdminName(req);
        await deleteAnnouncement(req.params.id, adminName);
        res.json({
            success: true,
            message: `Announcement #${req.params.id} has been deleted.`
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 7. PATCH or POST /:id/toggle - Toggle active status
router.all(["/:id/toggle", "/admin/:id/toggle"], async (req, res) => {
    try {
        const adminName = extractAdminName(req);
        const toggled = await toggleAnnouncementStatus(req.params.id, adminName);
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
router.all(["/:id/publish", "/admin/:id/publish"], async (req, res) => {
    try {
        const adminName = extractAdminName(req);
        const b = req.body || {};
        const isPublished = b.is_published === true || b.is_published === "true";
        const result = await setAnnouncementPublish(req.params.id, isPublished, adminName);
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
