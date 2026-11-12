const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const SUB_DELIVERIES_FILE = path.join(DATA_DIR, "subscription_deliveries.json");
const SETTINGS_FILE = path.join(DATA_DIR, "system_settings.json");

/**
 * Backend-controlled Area Allocation Setting
 * Default: false (All approved partners can view all eligible tasks across all areas)
 */
function getAreaAllocationSetting() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
            return Boolean(data.AREA_ALLOCATION_ENABLED);
        }
    } catch {}
    return false;
}

function setAreaAllocationSetting(enabled) {
    try {
        let data = {};
        if (fs.existsSync(SETTINGS_FILE)) {
            data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
        }
        data.AREA_ALLOCATION_ENABLED = Boolean(enabled);
        data.updated_at = new Date().toISOString();
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
        return true;
    } catch (e) {
        console.warn("[SETTINGS SAVE WARN]:", e.message);
        return false;
    }
}

function loadSubDeliveriesFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(SUB_DELIVERIES_FILE)) {
            return JSON.parse(fs.readFileSync(SUB_DELIVERIES_FILE, "utf-8"));
        }
    } catch (e) {
        console.warn("[SUB DELIVERIES DISK LOAD WARN]:", e.message);
    }
    return [];
}

function saveSubDeliveriesToDisk(deliveries) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(SUB_DELIVERIES_FILE, JSON.stringify(deliveries, null, 2), "utf-8");
    } catch (e) {
        console.warn("[SUB DELIVERIES DISK SAVE WARN]:", e.message);
    }
}

// Zero fake data: No auto-seeding of mock deliveries
let MOCK_SUB_DELIVERIES = loadSubDeliveriesFromDisk();

function formatDateKey(dateInput) {
    if (!dateInput) return new Date().toISOString().split("T")[0];
    if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return new Date().toISOString().split("T")[0];
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function formatReadableDate(dateInput) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return "Today";
    const options = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
    return d.toLocaleDateString("en-IN", options);
}

/**
 * Get daily subscription deliveries for a given date from real subscriptions
 * Respects AREA_ALLOCATION_ENABLED business rule:
 * - If false: ALL approved & active partners view ALL eligible subscription tasks across all areas
 * - If true: partners only view subscription deliveries matching their assigned area
 */
async function getSubscriptionDeliveries(dateStr, partner = null) {
    const targetDate = formatDateKey(dateStr);
    const partnerId = typeof partner === "object" && partner ? partner.partner_id : (typeof partner === "string" ? partner : null);
    const partnerArea = (typeof partner === "object" && partner && partner.assigned_area) ? partner.assigned_area.trim().toLowerCase() : "";
    const areaAllocationEnabled = getAreaAllocationSetting();

    try {
        let query = "SELECT * FROM daily_subscription_deliveries WHERE delivery_date = $1";
        const params = [targetDate];

        if (areaAllocationEnabled && partnerArea) {
            query += " AND (LOWER(address) LIKE $2 OR LOWER(delivery_slot) LIKE $2)";
            params.push(`%${partnerArea}%`);
        }
        query += " ORDER BY status ASC, id ASC";

        const res = await pool.query(query, params);
        if (res.rows && res.rows.length > 0) {
            const deliveries = res.rows;
            const total = deliveries.length;
            const delivered = deliveries.filter(d => d.status === "delivered").length;
            const pending = deliveries.filter(d => d.status === "pending").length;
            const outForDelivery = deliveries.filter(d => d.status === "out_for_delivery").length;
            const failed = deliveries.filter(d => d.status === "failed").length;
            return { total, delivered, pending, outForDelivery, failed, deliveries };
        }
    } catch {
        // Fallback to disk store
    }

    // Disk store fallback (for offline or local mode)
    const diskList = loadSubDeliveriesFromDisk();
    let deliveries = diskList.filter(d => {
        const matchesDate = d.delivery_date === targetDate;
        if (!matchesDate) return false;

        if (areaAllocationEnabled && partnerArea) {
            const addr = (d.address || "").toLowerCase();
            return addr.includes(partnerArea);
        }

        return true;
    });

    const total = deliveries.length;
    const delivered = deliveries.filter(d => d.status === "delivered").length;
    const pending = deliveries.filter(d => d.status === "pending").length;
    const outForDelivery = deliveries.filter(d => d.status === "out_for_delivery").length;
    const failed = deliveries.filter(d => d.status === "failed").length;

    return { total, delivered, pending, outForDelivery, failed, deliveries };
}

/**
 * Atomic Claiming of Subscription Delivery Task
 * Prevents race condition / duplicate claiming by multiple partners
 */
async function claimSubscriptionDelivery(deliveryId, partnerId, partnerName = "Delivery Partner") {
    const nowIso = new Date().toISOString();

    try {
        // Atomic conditional update in database
        const res = await pool.query(`
            UPDATE daily_subscription_deliveries
            SET partner_id = $1, status = 'out_for_delivery', notes = $2
            WHERE (daily_id = $3 OR id::text = $3 OR subscription_id = $3)
              AND (partner_id IS NULL OR partner_id = '' OR partner_id = $1)
              AND status != 'delivered'
            RETURNING *
        `, [partnerId, `Claimed by ${partnerName} (${partnerId}) at ${nowIso}`, deliveryId.toString()]);

        if (res.rows.length > 0) {
            return { success: true, delivery: res.rows[0] };
        }
    } catch {
        // Disk fallback
    }

    // Disk fallback atomic check
    const item = MOCK_SUB_DELIVERIES.find(d =>
        d.daily_id === deliveryId ||
        d.id?.toString() === deliveryId?.toString() ||
        d.subscription_id === deliveryId
    );

    if (!item) {
        return { success: false, message: `Subscription delivery record '${deliveryId}' not found.` };
    }

    if (item.status === "delivered") {
        return { success: false, conflict: true, message: "This delivery task has already been completed." };
    }

    if (item.claimed_by && item.claimed_by !== partnerId && item.status === "out_for_delivery") {
        return {
            success: false,
            conflict: true,
            message: `This delivery task has already been claimed by another partner (${item.claimed_by_name || item.claimed_by}).`
        };
    }

    // Atomic claim successful
    item.partner_id = partnerId;
    item.claimed_by = partnerId;
    item.claimed_by_name = partnerName;
    item.status = "out_for_delivery";
    item.claimed_at = nowIso;
    item.notes = `Claimed by ${partnerName} (${partnerId})`;

    saveSubDeliveriesToDisk(MOCK_SUB_DELIVERIES);
    return { success: true, delivery: item };
}

/**
 * Mark a subscription delivery status (delivered / failed)
 * Validates claiming ownership
 */
async function updateSubscriptionDeliveryStatus(deliveryId, status, notes = "", failedReason = null, partnerId = null) {
    const isDelivered = status === "delivered";
    const nowIso = new Date().toISOString();

    try {
        const res = await pool.query(`
            UPDATE daily_subscription_deliveries
            SET status = $1, delivered_at = $2, notes = $3, failed_reason = $4,
                partner_id = COALESCE(partner_id, $5)
            WHERE (daily_id = $6 OR id::text = $6 OR subscription_id = $6)
              AND (partner_id IS NULL OR partner_id = $5 OR $5 IS NULL)
            RETURNING *
        `, [status, isDelivered ? new Date() : null, notes, failedReason, partnerId, deliveryId.toString()]);

        if (res.rows.length > 0) {
            return { success: true, delivery: res.rows[0] };
        }
    } catch {
        // Fallback to disk store
    }

    // Disk fallback
    const item = MOCK_SUB_DELIVERIES.find(d =>
        d.daily_id === deliveryId ||
        d.id?.toString() === deliveryId?.toString() ||
        d.subscription_id === deliveryId
    );

    if (!item) {
        return { success: false, message: `Subscription delivery record '${deliveryId}' not found.` };
    }

    if (partnerId && item.claimed_by && item.claimed_by !== partnerId) {
        return {
            success: false,
            conflict: true,
            message: "You are not authorized to update this delivery task as it was claimed by another partner."
        };
    }

    item.status = status;
    item.delivered_at = isDelivered ? nowIso : null;
    item.notes = notes || item.notes;
    item.failed_reason = failedReason || item.failed_reason;
    if (partnerId) item.partner_id = partnerId;

    saveSubDeliveriesToDisk(MOCK_SUB_DELIVERIES);
    return { success: true, delivery: item };
}

module.exports = {
    getSubscriptionDeliveries,
    updateSubscriptionDeliveryStatus,
    claimSubscriptionDelivery,
    getAreaAllocationSetting,
    setAreaAllocationSetting,
    formatDateKey,
    formatReadableDate
};

