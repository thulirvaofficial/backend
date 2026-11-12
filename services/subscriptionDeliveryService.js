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

let MOCK_SUB_DELIVERIES = loadSubDeliveriesFromDisk();

/**
 * Format date to YYYY-MM-DD
 */
function formatDateKey(d) {
    const date = d ? new Date(d) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format readable date like "Today, 11 Nov 2026" or "Yesterday, 10 Nov 2026"
 */
function formatReadableDate(d) {
    const date = d ? new Date(d) : new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    const today = new Date();
    const isToday = formatDateKey(date) === formatDateKey(today);

    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const isYesterday = formatDateKey(date) === formatDateKey(yesterday);

    if (isToday) return `Today, ${day} ${month} ${year}`;
    if (isYesterday) return `Yesterday, ${day} ${month} ${year}`;
    return `${day} ${month} ${year}`;
}

/**
 * Ensure default seed subscription deliveries exist for demonstration & reference matching
 */
function ensureSeedSubscriptionDeliveries() {
    if (MOCK_SUB_DELIVERIES.length > 0) return;

    const todayStr = formatDateKey(new Date());

    // Exact reference screen 3 seed subscribers:
    // Screen 3 shows: Total 42, Delivered 30, Pending 12
    const baseSubscribers = [
        {
            sub_id: "SUB7631",
            customer_name: "Karthik S",
            customer_phone: "9840112233",
            address: "Adyar, Chennai - 600020",
            product_name: "Milk - 1 L (Daily)",
            quantity: 1,
            status: "pending",
            delivery_slot: "06:00 AM - 07:00 AM",
            partner_id: "THU-DP-0001"
        },
        {
            sub_id: "SUB7629",
            customer_name: "Priya R",
            customer_phone: "9840223344",
            address: "Velachery, Chennai - 600042",
            product_name: "Milk - 500 ml (Daily)",
            quantity: 1,
            status: "delivered",
            delivered_at: `${todayStr} 09:10:00`,
            delivery_slot: "06:00 AM - 07:00 AM",
            partner_id: "THU-DP-0001"
        },
        {
            sub_id: "SUB7628",
            customer_name: "Vignesh M",
            customer_phone: "9840334455",
            address: "T. Nagar, Chennai - 600017",
            product_name: "Milk - 1 L (Mon - Sat)",
            quantity: 1,
            status: "pending",
            delivery_slot: "06:00 AM - 07:00 AM",
            partner_id: "THU-DP-0001"
        },
        {
            sub_id: "SUB7630",
            customer_name: "Anand Kumar",
            customer_phone: "9840445566",
            address: "Mylapore, Chennai - 600004",
            product_name: "Milk - 1 L",
            quantity: 1,
            status: "delivered",
            delivered_at: `${todayStr} 08:12:00`,
            delivery_slot: "06:00 AM - 07:00 AM",
            partner_id: "THU-DP-0001"
        },
        {
            sub_id: "SUB7632",
            customer_name: "Meena Swaminathan",
            customer_phone: "9840556677",
            address: "Alwarpet, Chennai - 600018",
            product_name: "Milk - 500 ml (Daily)",
            quantity: 1,
            status: "pending",
            delivery_slot: "06:00 AM - 07:00 AM",
            partner_id: "THU-DP-0001"
        },
        {
            sub_id: "SUB7633",
            customer_name: "Rajesh Kannan",
            customer_phone: "9840667788",
            address: "Nungambakkam, Chennai - 600034",
            product_name: "Curd - 500 g (Daily)",
            quantity: 1,
            status: "pending",
            delivery_slot: "06:00 AM - 07:00 AM",
            partner_id: "THU-DP-0001"
        }
    ];

    // Expand to match exactly 42 total (30 delivered, 12 pending)
    const areas = ["Adyar", "Velachery", "T. Nagar", "Mylapore", "Besant Nagar", "Guindy", "Saidapet", "Koyambedu", "Porur", "Anna Nagar"];
    const products = ["Milk - 1 L (Daily)", "Milk - 500 ml (Daily)", "Curd - 500 g", "Artisanal Paneer (200 g)", "Bilona Ghee (500 ml)"];
    const names = [
        "Suresh B", "Deepa V", "Ganesh R", "Lakshmi N", "Vijay K", "Saravanan P", "Radha M", "Kavitha S",
        "Ramesh T", "Divya S", "Praveen L", "Bhavani K", "Murthy G", "Aishwarya R", "Kishore N", "Geetha B",
        "Balaji M", "Revathi P", "Harish V", "Soundarya K", "Mohan D", "Shanthi R", "Arun K", "Janani S",
        "Vasanth P", "Pavithra M", "Dinesh K", "Nalini V", "Subramaniam T", "Vidya R", "Chandran G", "Preeti S",
        "Gokul R", "Swetha M", "Sridhar K", "Nithya P"
    ];

    let seedList = [...baseSubscribers];
    let subNum = 7634;

    // We have 2 delivered and 4 pending in baseSubscribers.
    // Need 28 more delivered (total 30) and 8 more pending (total 12).
    for (let i = 0; i < 28; i++) {
        const area = areas[i % areas.length];
        const prod = products[i % products.length];
        const name = names[i % names.length];
        const hour = String(6 + Math.floor(i / 10)).padStart(2, "0");
        const min = String((i * 7) % 60).padStart(2, "0");
        seedList.push({
            sub_id: `SUB${subNum++}`,
            customer_name: name,
            customer_phone: `9840${String(100000 + i).slice(1)}`,
            address: `${area}, Chennai - 6000${String(10 + (i % 80)).padStart(2, "0")}`,
            product_name: prod,
            quantity: 1,
            status: "delivered",
            delivered_at: `${todayStr} ${hour}:${min}:00`,
            delivery_slot: "06:00 AM - 07:00 AM",
            partner_id: "THU-DP-0001"
        });
    }

    for (let i = 0; i < 8; i++) {
        const area = areas[(i + 3) % areas.length];
        const prod = products[(i + 2) % products.length];
        const name = names[(i + 20) % names.length];
        seedList.push({
            sub_id: `SUB${subNum++}`,
            customer_name: name,
            customer_phone: `9840${String(200000 + i).slice(1)}`,
            address: `${area}, Chennai - 6000${String(20 + (i % 80)).padStart(2, "0")}`,
            product_name: prod,
            quantity: 1,
            status: "pending",
            delivery_slot: "06:00 AM - 07:00 AM",
            partner_id: "THU-DP-0001"
        });
    }

    // Format all with unique daily_id and delivery_date
    MOCK_SUB_DELIVERIES = seedList.map((item, index) => ({
        id: index + 1,
        daily_id: `DLY-${todayStr}-${item.sub_id}`,
        subscription_id: item.sub_id,
        delivery_date: todayStr,
        partner_id: item.partner_id || "THU-DP-0001",
        customer_name: item.customer_name,
        customer_phone: item.customer_phone,
        address: item.address,
        product_name: item.product_name,
        quantity: item.quantity || 1,
        delivery_slot: item.delivery_slot || "06:00 AM - 07:00 AM",
        status: item.status,
        delivered_at: item.delivered_at || null,
        failed_reason: null,
        notes: null,
        created_at: new Date().toISOString()
    }));

    saveSubDeliveriesToDisk(MOCK_SUB_DELIVERIES);
    console.log(`[+] Initialized ${MOCK_SUB_DELIVERIES.length} daily subscription deliveries (30 Delivered, 12 Pending).`);
}

// Run on module load
ensureSeedSubscriptionDeliveries();

/**
 * Get daily subscription deliveries for a given date
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

        // Only filter by area when area allocation is explicitly enabled
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

    // Fallback from disk store
    let deliveries = MOCK_SUB_DELIVERIES.filter(d => {
        const matchesDate = d.delivery_date === targetDate;
        if (!matchesDate) return false;

        // When area allocation is enabled, enforce area restriction
        if (areaAllocationEnabled && partnerArea) {
            const addr = (d.address || "").toLowerCase();
            return addr.includes(partnerArea);
        }

        // When area allocation is disabled: all eligible tasks visible!
        return true;
    });

    // If no deliveries found for targetDate, ensure tasks exist for active subscriptions on this date
    if (deliveries.length === 0 && MOCK_SUB_DELIVERIES.length > 0) {
        const uniqueSubs = new Map();
        for (const it of MOCK_SUB_DELIVERIES) {
            if (!uniqueSubs.has(it.subscription_id)) {
                uniqueSubs.set(it.subscription_id, it);
            }
        }
        const cloned = Array.from(uniqueSubs.values()).map((item, idx) => ({
            ...item,
            id: MOCK_SUB_DELIVERIES.length + idx + 1,
            daily_id: `DLY-${targetDate}-${item.subscription_id}`,
            delivery_date: targetDate,
            status: item.status,
            delivered_at: item.status === "delivered" ? `${targetDate} 08:30:00` : null
        }));
        MOCK_SUB_DELIVERIES.push(...cloned);
        saveSubDeliveriesToDisk(MOCK_SUB_DELIVERIES);
        deliveries = cloned.filter(d => {
            if (areaAllocationEnabled && partnerArea) {
                return (d.address || "").toLowerCase().includes(partnerArea);
            }
            return true;
        });
    }

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
    ensureSeedSubscriptionDeliveries,
    getAreaAllocationSetting,
    setAreaAllocationSetting,
    formatDateKey,
    formatReadableDate
};

