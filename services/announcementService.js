const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const ANNOUNCEMENTS_FILE = path.join(DATA_DIR, "announcements.json");
const NOTIFICATIONS_FILE = path.join(DATA_DIR, "notifications.json");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Initial default announcements
const DEFAULT_ANNOUNCEMENTS = [
    {
        id: "ann-2026-001",
        title: "THULIRVA deliveries start from 25/11/2026!",
        description: "Farm-fresh A2 cow milk, artisanal paneer, and bilona ghee delivered right to your doorstep. Pre-book your delivery slot today!",
        image_url: "",
        start_date: "2026-11-15",
        expiry_date: "2026-12-05",
        position: "homepage_hero", // homepage_hero | top_bar | popup | bottom_banner
        badge_text: "DELIVERY LAUNCH",
        bg_color: "#1B4332",
        text_color: "#FFFFFF",
        accent_color: "#E5C97A",
        cta_text: "Shop Farm Fresh",
        cta_url: "/pages/shop.html",
        is_active: true,
        is_published: true,
        send_notification: true,
        priority: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: "Super Admin"
    },
    {
        id: "ann-2026-002",
        title: "Free Delivery on All Orders Above ₹299",
        description: "Enjoy zero delivery fees across Padur, Navalur, Siruseri, and Kelambakkam zones for orders ₹299 and above.",
        image_url: "",
        start_date: "2026-11-10",
        expiry_date: "2026-12-31",
        position: "top_bar",
        badge_text: "SPECIAL OFFER",
        bg_color: "#2D6A4F",
        text_color: "#FFFFFF",
        accent_color: "#86EFAC",
        cta_text: "Explore Products",
        cta_url: "/pages/shop.html",
        is_active: true,
        is_published: true,
        send_notification: false,
        priority: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: "Super Admin"
    }
];

function readAnnouncementsFromFile() {
    ensureDirectoryExists();
    if (!fs.existsSync(ANNOUNCEMENTS_FILE)) {
        fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(DEFAULT_ANNOUNCEMENTS, null, 2), "utf8");
        return DEFAULT_ANNOUNCEMENTS;
    }
    try {
        const raw = fs.readFileSync(ANNOUNCEMENTS_FILE, "utf8");
        return JSON.parse(raw);
    } catch (e) {
        console.error("[AnnouncementService] Error reading announcements.json:", e.message);
        return DEFAULT_ANNOUNCEMENTS;
    }
}

function writeAnnouncementsToFile(announcements) {
    ensureDirectoryExists();
    fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(announcements, null, 2), "utf8");
}

function broadcastSocket(event, payload) {
    try {
        const socketService = require("./socket");
        if (socketService && typeof socketService.getIO === "function") {
            const io = socketService.getIO();
            if (io) {
                io.emit(event, payload);
            }
        }
    } catch (_) {}
}

/**
 * Dispatch customer notification for published announcement
 */
async function dispatchAnnouncementNotification(announcement) {
    try {
        ensureDirectoryExists();
        let notifs = [];
        if (fs.existsSync(NOTIFICATIONS_FILE)) {
            try {
                notifs = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, "utf8"));
            } catch (_) {}
        }

        // Deduplication guard: check if this announcement notification was already created today
        const todayStr = new Date().toISOString().slice(0, 10);
        const existing = notifs.find(n => n.announcement_id === announcement.id && n.created_at?.startsWith(todayStr));
        if (existing) {
            return;
        }

        const targetAudience = announcement.target_audience || announcement.audience || "all";
        const newNotif = {
            id: `notif-ann-${Date.now()}`,
            announcement_id: announcement.id,
            title: announcement.title,
            message: announcement.description || announcement.title,
            type: "announcement",
            audience: targetAudience,
            image_url: announcement.image_url || null,
            priority: announcement.priority || "normal",
            created_at: new Date().toISOString(),
            read: false
        };

        notifs.unshift(newNotif);
        fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifs.slice(0, 500), null, 2), "utf8");
        broadcastSocket("notification:new", newNotif);

        // Module 12: Dispatch push & in-app notifications to Delivery Partners when audience includes partners
        try {
            const { sendNotification } = require("./notificationService");
            if (targetAudience === "delivery_partners" || targetAudience === "all" || targetAudience === "partners") {
                await sendNotification({
                    userId: announcement.target_partner_id || "delivery_partners",
                    title: `📢 ${announcement.title}`,
                    message: announcement.description || announcement.title,
                    type: "admin_announcement",
                    targetId: announcement.id
                });
            }
        } catch (_) {}
    } catch (err) {
        console.error("[AnnouncementService] Error dispatching notification:", err.message);
    }
}

function getTodayInKolkata() {
    try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        });
        return formatter.format(new Date()); // Outputs "YYYY-MM-DD"
    } catch (_) {
        return new Date().toISOString().slice(0, 10);
    }
}

function broadcastBannerUpdate() {
    try {
        const { getLaunchBanner } = require("./businessConfigService");
        if (typeof getLaunchBanner === "function") {
            getLaunchBanner().then(banner => {
                broadcastSocket("config:banner_updated", banner);
            }).catch(() => {});
        }
    } catch (_) {}
}

/**
 * Retrieve all announcements (admin)
 */
async function getAllAnnouncements(filter = {}) {
    try {
        if (pool) {
            const res = await pool.query("SELECT * FROM announcements ORDER BY priority ASC, created_at DESC;").catch(() => null);
            if (res && res.rows && res.rows.length > 0) {
                return res.rows;
            }
        }
    } catch (_) {}
    return readAnnouncementsFromFile();
}

/**
 * Retrieve active published announcements within valid date range (customer)
 */
async function getActiveAnnouncements(position = null) {
    const all = await getAllAnnouncements();
    const today = getTodayInKolkata();

    return all.filter(a => {
        const isActive = a.is_active === true || a.is_active === "true";
        const isPublished = a.is_published === true || a.is_published === "true";
        if (!isActive || !isPublished) return false;

        const startDate = a.start_date ? String(a.start_date).slice(0, 10) : null;
        const expiryDate = a.expiry_date ? String(a.expiry_date).slice(0, 10) : null;

        if (startDate && startDate > today) return false;
        if (expiryDate && expiryDate < today) return false;
        if (position && a.position && a.position !== position && a.position !== "all") return false;
        return true;
    }).sort((a, b) => (Number(a.priority) || 1) - (Number(b.priority) || 1));
}

/**
 * Create announcement
 */
async function createAnnouncement(data, adminName = "Super Admin") {
    const list = readAnnouncementsFromFile();
    const newId = `ann-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const announcement = {
        id: newId,
        title: data.title || "THULIRVA Announcement",
        description: data.description || "",
        image_url: data.image_url || "",
        start_date: data.start_date || new Date().toISOString().slice(0, 10),
        expiry_date: data.expiry_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        position: data.position || "homepage_hero",
        badge_text: data.badge_text || "ANNOUNCEMENT",
        bg_color: data.bg_color || "#1B4332",
        text_color: data.text_color || "#FFFFFF",
        accent_color: data.accent_color || "#E5C97A",
        cta_text: data.cta_text || "Learn More",
        cta_url: data.cta_url || "/pages/shop.html",
        is_active: data.is_active !== false,
        is_published: data.is_published !== false,
        send_notification: Boolean(data.send_notification),
        priority: Number(data.priority) || (list.length + 1),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: adminName
    };

    list.unshift(announcement);
    writeAnnouncementsToFile(list);

    // Save to PostgreSQL if available
    try {
        if (pool) {
            await pool.query(`
                INSERT INTO announcements (id, title, description, image_url, start_date, expiry_date, position, badge_text, bg_color, text_color, accent_color, cta_text, cta_url, is_active, is_published, send_notification, priority, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW();
            `, [
                announcement.id, announcement.title, announcement.description, announcement.image_url,
                announcement.start_date, announcement.expiry_date, announcement.position, announcement.badge_text,
                announcement.bg_color, announcement.text_color, announcement.accent_color, announcement.cta_text,
                announcement.cta_url, announcement.is_active, announcement.is_published, announcement.send_notification,
                announcement.priority, announcement.created_by
            ]).catch(() => {});
        }
    } catch (_) {}

    if (announcement.is_published && announcement.send_notification) {
        dispatchAnnouncementNotification(announcement);
    }

    broadcastSocket("announcement:updated", announcement);
    broadcastSocket("announcement:sync", { action: "created", announcement });
    broadcastBannerUpdate();
    return announcement;
}

/**
 * Update announcement
 */
async function updateAnnouncement(id, updates, adminName = "Super Admin") {
    const list = readAnnouncementsFromFile();
    const idx = list.findIndex(a => a.id == id);
    if (idx === -1) {
        throw new Error(`Announcement #${id} not found.`);
    }

    if (updates.is_active !== undefined) {
        updates.is_active = updates.is_active === true || updates.is_active === "true";
    }
    if (updates.is_published !== undefined) {
        updates.is_published = updates.is_published === true || updates.is_published === "true";
    }

    const current = list[idx];
    const updated = {
        ...current,
        ...updates,
        id: current.id,
        updated_at: new Date().toISOString(),
        updated_by: adminName
    };

    list[idx] = updated;
    writeAnnouncementsToFile(list);

    // Update in DB if available
    try {
        if (pool) {
            await pool.query(`
                UPDATE announcements SET
                    title = $1, description = $2, image_url = $3, start_date = $4, expiry_date = $5,
                    position = $6, badge_text = $7, bg_color = $8, text_color = $9, accent_color = $10,
                    cta_text = $11, cta_url = $12, is_active = $13, is_published = $14, send_notification = $15,
                    priority = $16, updated_at = NOW()
                WHERE id = $17;
            `, [
                updated.title, updated.description, updated.image_url, updated.start_date, updated.expiry_date,
                updated.position, updated.badge_text, updated.bg_color, updated.text_color, updated.accent_color,
                updated.cta_text, updated.cta_url, updated.is_active, updated.is_published, updated.send_notification,
                updated.priority, updated.id
            ]).catch(() => {});
        }
    } catch (_) {}

    if (updated.is_published && updated.send_notification && !current.is_published) {
        dispatchAnnouncementNotification(updated);
    }

    broadcastSocket("announcement:updated", updated);
    broadcastSocket("announcement:status", { id: updated.id, is_active: updated.is_active, is_published: updated.is_published });
    broadcastSocket("announcement:sync", { action: "updated", announcement: updated });
    broadcastBannerUpdate();

    return updated;
}

/**
 * Delete announcement
 */
async function deleteAnnouncement(id, adminName = "Super Admin") {
    const list = readAnnouncementsFromFile();
    const filtered = list.filter(a => a.id != id);
    if (filtered.length === list.length) {
        throw new Error(`Announcement #${id} not found.`);
    }
    writeAnnouncementsToFile(filtered);

    try {
        if (pool) {
            await pool.query("DELETE FROM announcements WHERE id = $1;", [id]).catch(() => {});
        }
    } catch (_) {}

    broadcastSocket("announcement:deleted", { id });
    broadcastSocket("announcement:sync", { action: "deleted", id });
    broadcastBannerUpdate();

    return true;
}

/**
 * Toggle active status
 */
async function toggleAnnouncementStatus(id, targetState = undefined, adminName = "Super Admin") {
    const list = readAnnouncementsFromFile();
    const item = list.find(a => a.id == id);
    if (!item) throw new Error(`Announcement #${id} not found.`);

    let nextState;
    if (targetState !== undefined && targetState !== null) {
        nextState = targetState === true || targetState === "true";
    } else {
        nextState = !(item.is_active === true || item.is_active === "true");
    }

    return updateAnnouncement(id, { is_active: nextState }, adminName);
}

/**
 * Publish / Unpublish
 */
async function setAnnouncementPublish(id, isPublished, adminName = "Super Admin") {
    return updateAnnouncement(id, { is_published: Boolean(isPublished) }, adminName);
}

module.exports = {
    getAllAnnouncements,
    getActiveAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    toggleAnnouncementStatus,
    setAnnouncementPublish
};

