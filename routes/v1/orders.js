const express = require("express");
const path = require("path");
const fs = require("fs");
const { authenticateToken } = require("../../middleware/auth");
const { recordProductDeliveryEarning } = require("../../services/financialService");
const { getPartnerById } = require("../../services/deliveryPartnerService");
const legacyOrdersRouter = require("../orders");

const router = express.Router();
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function loadOrders() {
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function saveOrders(orders) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
    } catch (_) {}
}

async function enrichOrder(order) {
    if (!order || !order.partner_id) return order;
    try {
        const partner = await getPartnerById(order.partner_id);
        if (partner) {
            return {
                ...order,
                partner_name: partner.name,
                partner_phone: partner.phone,
                partner_photo: partner.profile_photo || null,
                partner_vehicle: `${partner.vehicle_type || 'Electric Scooter'} (${partner.vehicle_number || ''})`.trim(),
                partner_rating: Number(partner.rating) || 5.0,
                partner_latitude: partner.current_latitude ? Number(partner.current_latitude) : null,
                partner_longitude: partner.current_longitude ? Number(partner.current_longitude) : null
            };
        }
    } catch (_) {}
    return order;
}

/**
 * POST /api/v1/orders (Create Order)
 */
router.post("/", (req, res, next) => {
    legacyOrdersRouter(req, res, next);
});

/**
 * GET /api/v1/orders/:id
 */
router.get("/:id", async (req, res) => {
    try {
        const orders = loadOrders();
        const order = orders.find(o => o.id?.toString() === req.params.id.toString() || o.order_number === req.params.id);
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        const enriched = await enrichOrder(order);
        return res.json({ success: true, order: enriched });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/orders
 */
router.get("/", async (req, res) => {
    try {
        const { status, partner_id, user_id } = req.query;
        let orders = loadOrders();

        if (status) orders = orders.filter(o => o.order_status === status);
        if (partner_id) orders = orders.filter(o => o.partner_id === partner_id);
        if (user_id) orders = orders.filter(o => o.user_id?.toString() === user_id.toString());

        const enrichedList = await Promise.all(orders.map(enrichOrder));
        return res.json({ success: true, total: enrichedList.length, orders: enrichedList });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/v1/orders/:id/status
 */
router.put("/:id/status", async (req, res) => {
    try {
        const id = req.params.id;
        const { status, partner_id, notes } = req.body;
        const orders = loadOrders();
        const order = orders.find(o => o.id?.toString() === id.toString() || o.order_number === id);

        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        order.order_status = status;
        order.status = status;
        if (partner_id) order.partner_id = partner_id;
        if (notes) order.notes = notes;

        if (status === "delivered") {
            order.delivered_at = new Date().toISOString();
            if (order.partner_id) {
                // Record genuine earnings
                try {
                    await recordProductDeliveryEarning(order.partner_id, order.id || order.order_number, 40);
                } catch (e) {
                    console.warn("[EARNINGS RECORD WARN]:", e.message);
                }
            }
        }

        saveOrders(orders);

        // Real-time broadcasts
        try {
            const { emitToAdmin, emitToCustomer, emitToPartner } = require("../../services/socketService");
            emitToAdmin("order:updated", { order_id: id, status, partner_id: order.partner_id });
            emitToAdmin("delivery:status:update", { order_id: id, status, partner_id: order.partner_id });
            if (order.partner_id) emitToPartner(order.partner_id, "order:status_updated", { order_id: id, status });
            if (order.user_id) emitToCustomer(order.user_id, "order:status_updated", { order_id: id, status });
        } catch (_) {}

        return res.json({ success: true, message: `Order status updated to ${status}`, order });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
