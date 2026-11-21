const fs = require("fs");
const path = require("path");
const { getIO } = require("../services/socketService");
const { sendNotificationToUser } = require("./notificationService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const TIPS_FILE = path.join(DATA_DIR, "partner_tips.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PARTNERS_FILE = path.join(DATA_DIR, "delivery_partners.json");

function loadJson(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
            return defaultValue;
        }
        const data = fs.readFileSync(filePath, "utf8");
        return JSON.parse(data);
    } catch (err) {
        console.error(`[TipService] Error reading ${filePath}:`, err.message);
        return defaultValue;
    }
}

function saveJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
        console.error(`[TipService] Error writing ${filePath}:`, err.message);
    }
}

/**
 * Generate unique Tip ID
 */
function generateTipId() {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `TIP-${dateStr}-${rand}`;
}

/**
 * Create a new tip for a delivered order
 */
async function createTip({
    orderId,
    customerId,
    customerName,
    tipAmount,
    paymentMethod = "UPI",
    transactionRef = null
}) {
    const amount = Number(tipAmount);
    if (isNaN(amount) || amount <= 0) {
        throw new Error("Invalid tip amount. Must be greater than 0.");
    }

    const cleanOrderId = String(orderId || "").trim();
    if (!cleanOrderId) {
        throw new Error("Order ID is required to tip.");
    }

    // 1. Fetch Order & Validate
    const orders = loadJson(ORDERS_FILE, []);
    const order = orders.find(o => 
        String(o.id) === cleanOrderId || 
        String(o.order_number) === cleanOrderId ||
        String(o.orderNumber) === cleanOrderId
    );

    if (!order) {
        throw new Error(`Order #${cleanOrderId} not found.`);
    }

    // Must be completed / delivered
    const status = String(order.order_status || order.status || "").toLowerCase();
    if (status !== "delivered" && status !== "completed") {
        throw new Error(`Tips can only be submitted for completed deliveries. Current order status: ${status}.`);
    }

    // Must have an assigned delivery partner
    const partnerId = order.partner_id || order.delivery_partner_id || order.partnerId;
    if (!partnerId) {
        throw new Error("No delivery partner was assigned to complete this order.");
    }

    // Fetch Partner details
    const partners = loadJson(PARTNERS_FILE, []);
    const partner = partners.find(p => String(p.partner_id) === String(partnerId));
    const partnerName = partner ? partner.name : (order.partner_name || "Delivery Partner");

    // 2. Idempotency & Duplicate Protection
    const tips = loadJson(TIPS_FILE, []);
    const resolvedRef = transactionRef || `TXN-TIP-${cleanOrderId}-${Date.now()}`;

    const existingTip = tips.find(t => 
        (String(t.order_id) === cleanOrderId || String(t.order_number) === cleanOrderId) &&
        t.payment_status === "COMPLETED"
    );

    if (existingTip) {
        return {
            success: true,
            isDuplicate: true,
            message: "A tip has already been processed for this delivery.",
            tip: existingTip
        };
    }

    // 3. Create Tip Record
    const tipRecord = {
        tip_id: generateTipId(),
        customer_id: customerId ? String(customerId) : (order.user_id ? String(order.user_id) : "guest"),
        customer_name: customerName || order.customer_name || "Customer",
        order_id: String(order.id || cleanOrderId),
        order_number: String(order.order_number || order.orderNumber || cleanOrderId),
        delivery_partner_id: String(partnerId),
        delivery_partner_name: partnerName,
        tip_amount: amount,
        payment_method: paymentMethod || "UPI",
        transaction_reference: resolvedRef,
        payment_status: "COMPLETED",
        settlement_status: "PENDING",
        created_at: new Date().toISOString(),
        settled_at: null,
        settled_by: null
    };

    tips.unshift(tipRecord);
    saveJson(TIPS_FILE, tips);

    // 4. Real-time Socket Dispatch
    try {
        const io = getIO();
        if (io) {
            // Send to partner channel
            io.to(`partner_${partnerId}`).emit("tip:received", tipRecord);
            // Send to admin channel
            io.to("admin_channel").emit("tip:new", tipRecord);
        }
    } catch (_) {}

    // 5. Send Notification to Delivery Partner
    try {
        await sendNotificationToUser(partnerId, {
            title: "🎉 You Received a Customer Tip!",
            body: `₹${amount} tip credited from ${tipRecord.customer_name} for Order #${tipRecord.order_number}.`,
            data: {
                type: "tip_received",
                tip_id: tipRecord.tip_id,
                order_id: tipRecord.order_id,
                amount: String(amount)
            }
        });
    } catch (_) {}

    return {
        success: true,
        message: `₹${amount} tip sent to ${partnerName}! Thank you for your appreciation.`,
        tip: tipRecord
    };
}

/**
 * Get tips and earnings summary for a Delivery Partner
 */
async function getPartnerTips(partnerId) {
    if (!partnerId) return { total_tips: 0, transactions: [] };

    const tips = loadJson(TIPS_FILE, []);
    const partnerTips = tips.filter(t => 
        String(t.delivery_partner_id) === String(partnerId) &&
        t.payment_status === "COMPLETED"
    );

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let total = 0;
    let today = 0;
    let weekly = 0;
    let monthly = 0;
    let pending = 0;
    let settled = 0;

    for (const t of partnerTips) {
        const amt = Number(t.tip_amount) || 0;
        const d = new Date(t.created_at);
        total += amt;

        if (t.created_at.startsWith(todayStr)) {
            today += amt;
        }
        if (d >= sevenDaysAgo) {
            weekly += amt;
        }
        if (d >= firstDayOfMonth) {
            monthly += amt;
        }
        if (t.settlement_status === "SETTLED") {
            settled += amt;
        } else {
            pending += amt;
        }
    }

    return {
        success: true,
        summary: {
            total_tips: total,
            today_tips: today,
            weekly_tips: weekly,
            monthly_tips: monthly,
            pending_settlement: pending,
            settled_amount: settled,
            count: partnerTips.length
        },
        transactions: partnerTips
    };
}

/**
 * Get admin view of all tip transactions with filtering
 */
async function getAdminTips({
    partnerId = null,
    orderId = null,
    settlementStatus = null,
    date = null,
    page = 1,
    limit = 20
} = {}) {
    let tips = loadJson(TIPS_FILE, []);

    if (partnerId) {
        tips = tips.filter(t => String(t.delivery_partner_id) === String(partnerId));
    }
    if (orderId) {
        tips = tips.filter(t => 
            String(t.order_id).includes(String(orderId)) || 
            String(t.order_number).includes(String(orderId))
        );
    }
    if (settlementStatus) {
        tips = tips.filter(t => 
            t.settlement_status.toUpperCase() === String(settlementStatus).toUpperCase()
        );
    }
    if (date) {
        tips = tips.filter(t => t.created_at.startsWith(String(date)));
    }

    const totalCount = tips.length;
    let totalAmount = 0;
    let pendingAmount = 0;
    let settledAmount = 0;

    for (const t of tips) {
        const amt = Number(t.tip_amount) || 0;
        totalAmount += amt;
        if (t.settlement_status === "SETTLED") {
            settledAmount += amt;
        } else {
            pendingAmount += amt;
        }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedTips = tips.slice(startIndex, startIndex + limitNum);

    return {
        success: true,
        metrics: {
            total_count: totalCount,
            total_amount: totalAmount,
            pending_amount: pendingAmount,
            settled_amount: settledAmount
        },
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(totalCount / limitNum),
        tips: paginatedTips
    };
}

/**
 * Mark a tip as settled
 */
async function settleTip(tipId, adminId, adminName) {
    const tips = loadJson(TIPS_FILE, []);
    const tip = tips.find(t => String(t.tip_id) === String(tipId));

    if (!tip) {
        throw new Error(`Tip #${tipId} not found.`);
    }

    if (tip.settlement_status === "SETTLED") {
        return {
            success: true,
            message: "Tip is already marked as settled.",
            tip
        };
    }

    tip.settlement_status = "SETTLED";
    tip.settled_at = new Date().toISOString();
    tip.settled_by = adminName || `Admin #${adminId || 1}`;

    saveJson(TIPS_FILE, tips);

    return {
        success: true,
        message: `Tip #${tipId} settled successfully.`,
        tip
    };
}

/**
 * Check if an order already has a tip
 */
async function getOrderTip(orderId) {
    if (!orderId) return null;
    const clean = String(orderId).trim();
    const tips = loadJson(TIPS_FILE, []);
    const found = tips.find(t => 
        (String(t.order_id) === clean || String(t.order_number) === clean) &&
        t.payment_status === "COMPLETED"
    );
    return found || null;
}

/**
 * Record a tip chosen at checkout when the order is completed/delivered
 */
async function recordCheckoutTip({ order, partnerId, partnerName }) {
    if (!order) return null;
    const amount = Number(order.tip_amount || order.tipAmount || 0);
    if (amount <= 0) return null;

    const tips = loadJson(TIPS_FILE, []);
    const cleanOrderId = String(order.id || "");
    const cleanOrderNumber = String(order.order_number || order.orderNumber || cleanOrderId);

    const existingTip = tips.find(t => 
        (String(t.order_id) === cleanOrderId || String(t.order_number) === cleanOrderNumber) &&
        t.payment_status === "COMPLETED"
    );
    if (existingTip) return existingTip;

    const tipRecord = {
        tip_id: generateTipId(),
        customer_id: order.user_id ? String(order.user_id) : "guest",
        customer_name: order.customer_name || "Customer",
        order_id: cleanOrderId,
        order_number: cleanOrderNumber,
        delivery_partner_id: String(partnerId),
        delivery_partner_name: partnerName || "Assigned Partner",
        tip_amount: amount,
        payment_method: order.payment_method || "UPI",
        transaction_reference: order.transaction_id || `ORD-TIP-${cleanOrderId}`,
        payment_status: "COMPLETED",
        settlement_status: "PENDING",
        created_at: new Date().toISOString(),
        settled_at: null,
        settled_by: null
    };

    tips.unshift(tipRecord);
    saveJson(TIPS_FILE, tips);

    // Socket Dispatch & Notification
    try {
        const io = getIO();
        if (io) {
            io.to(`partner_${partnerId}`).emit("tip:received", tipRecord);
            io.to("admin_channel").emit("tip:new", tipRecord);
        }
    } catch (_) {}

    try {
        await sendNotificationToUser(partnerId, {
            title: "🎉 You Received a Customer Tip!",
            body: `₹${amount} tip credited from ${tipRecord.customer_name} for Order #${tipRecord.order_number}.`,
            data: {
                type: "tip_received",
                tip_id: tipRecord.tip_id,
                order_id: tipRecord.order_id,
                amount: String(amount)
            }
        });
    } catch (_) {}

    return tipRecord;
}

module.exports = {
    createTip,
    getPartnerTips,
    getAdminTips,
    settleTip,
    getOrderTip,
    recordCheckoutTip
};
