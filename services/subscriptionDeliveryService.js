const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const SUB_DELIVERIES_FILE = path.join(DATA_DIR, "subscription_deliveries.json");

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
 */
async function getSubscriptionDeliveries(dateStr, partnerId = null) {
    const targetDate = formatDateKey(dateStr);

    try {
        let query = "SELECT * FROM daily_subscription_deliveries WHERE delivery_date = $1";
        const params = [targetDate];

        if (partnerId) {
            query += " AND (partner_id = $2 OR partner_id IS NULL)";
            params.push(partnerId);
        }
        query += " ORDER BY status ASC, id ASC";

        const res = await pool.query(query, params);
        if (res.rows && res.rows.length > 0) {
            const deliveries = res.rows;
            const total = deliveries.length;
            const delivered = deliveries.filter(d => d.status === "delivered").length;
            const pending = deliveries.filter(d => d.status === "pending").length;
            return { total, delivered, pending, deliveries };
        }
    } catch {
        // Fallback to disk store
    }

    // Fallback from disk store
    let deliveries = MOCK_SUB_DELIVERIES.filter(d => {
        const matchesDate = d.delivery_date === targetDate;
        const matchesPartner = !partnerId || d.partner_id === partnerId;
        return matchesDate && matchesPartner;
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
        deliveries = cloned.filter(d => !partnerId || d.partner_id === partnerId);
    }

    const total = deliveries.length;
    const delivered = deliveries.filter(d => d.status === "delivered").length;
    const pending = deliveries.filter(d => d.status === "pending").length;

    return { total, delivered, pending, deliveries };
}

/**
 * Mark a subscription delivery status
 */
async function updateSubscriptionDeliveryStatus(deliveryId, status, notes = "", failedReason = null) {
    const isDelivered = status === "delivered";
    const nowIso = new Date().toISOString();

    try {
        const res = await pool.query(`
            UPDATE daily_subscription_deliveries
            SET status = $1, delivered_at = $2, notes = $3, failed_reason = $4
            WHERE daily_id = $5 OR id::text = $5 OR subscription_id = $5
            RETURNING *
        `, [status, isDelivered ? new Date() : null, notes, failedReason, deliveryId.toString()]);

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

    item.status = status;
    item.delivered_at = isDelivered ? nowIso : null;
    item.notes = notes || item.notes;
    item.failed_reason = failedReason || item.failed_reason;

    saveSubDeliveriesToDisk(MOCK_SUB_DELIVERIES);
    return { success: true, delivery: item };
}

module.exports = {
    getSubscriptionDeliveries,
    updateSubscriptionDeliveryStatus,
    ensureSeedSubscriptionDeliveries,
    formatDateKey,
    formatReadableDate
};

