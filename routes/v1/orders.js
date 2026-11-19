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
        const { status, partner_id, user_id, date } = req.query;
        let orders = loadOrders();

        if (date) {
            orders = orders.filter(o => {
                if (!o.created_at) return false;
                try {
                    return new Date(o.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === date.trim();
                } catch (_) { return false; }
            });
        }
        if (status) orders = orders.filter(o => o.order_status === status);
        if (partner_id) orders = orders.filter(o => o.partner_id === partner_id);
        if (user_id) orders = orders.filter(o => o.user_id?.toString() === user_id.toString());

        const enrichedList = await Promise.all(orders.map(enrichOrder));
        const stats = {
            total: enrichedList.length,
            delivered: enrichedList.filter(o => (o.order_status || '').toLowerCase() === 'delivered').length,
            pending: enrichedList.filter(o => {
                const s = (o.order_status || '').toLowerCase();
                return s !== 'delivered' && s !== 'cancelled';
            }).length,
            cancelled: enrichedList.filter(o => (o.order_status || '').toLowerCase() === 'cancelled').length,
            revenue: enrichedList.reduce((sum, o) => {
                const s = (o.order_status || '').toLowerCase();
                return (s === 'delivered' || s === 'completed') ? sum + (Number(o.total || o.total_price) || 0) : sum;
            }, 0)
        };
        return res.json({ success: true, total: enrichedList.length, stats, selected_date: date || null, orders: enrichedList });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

const { validateTransition, normalizeStatus, recordStatusHistory, broadcastStatusChange } = require("../../utils/deliveryStateMachine");

/**
 * PUT & POST /api/v1/orders/:id/status
 */
const updateOrderStatusHandler = async (req, res) => {
    try {
        const id = req.params.id;
        const { status, partner_id, notes } = req.body;
        const orders = loadOrders();
        const order = orders.find(o => o.id?.toString() === id.toString() || o.order_number === id);

        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        const actorPartnerId = partner_id || req.user?.partner_id || req.partner?.partner_id;

        // Enforce mandatory delivery state machine
        if (status) {
            const check = validateTransition(order.order_status, status, {
                partnerId: actorPartnerId,
                orderPartnerId: order.partner_id,
                hasProof: Boolean(order.delivery_proof || req.body?.imageBase64 || req.body?.image),
                isAdmin: Boolean(req.user?.role === "admin" || req.headers["x-admin-key"])
            });

            if (!check.valid) {
                return res.status(check.status).json({
                    success: false,
                    error_code: check.code,
                    message: check.message
                });
            }
        }

        const normStatus = status ? normalizeStatus(status) : order.order_status;

        order.order_status = normStatus;
        order.status = normStatus;
        if (actorPartnerId && !order.partner_id) order.partner_id = actorPartnerId;
        if (notes) order.notes = notes;

        if (normStatus === "delivered") {
            order.delivered_at = new Date().toISOString();
            if (order.partner_id) {
                try {
                    let partnerPayout = 35.0;
                    let snapshot = {};
                    if (order.financial_breakdown) {
                        partnerPayout = Number(order.financial_breakdown.partner_delivery_earning || 35.0);
                        snapshot = order.financial_breakdown;
                    } else {
                        const { calculateDeliveryCharge } = require("../../services/businessConfigService");
                        const chargeCalc = await calculateDeliveryCharge({
                            subtotal: order.subtotal || 0,
                            order_type: order.order_type || "delivery",
                            zone: order.delivery_zone || order.delivery_location || null,
                            distance_km: order.distance_km || null
                        });
                        partnerPayout = Number(chargeCalc.partner_delivery_earning || 35.0);
                        snapshot = {
                            customer_delivery_fee: chargeCalc.delivery_fee,
                            partner_delivery_earning: partnerPayout,
                            company_delivery_revenue: chargeCalc.company_delivery_revenue,
                            company_funded_delivery_expense: chargeCalc.company_funded_delivery_expense,
                            zone: chargeCalc.zone,
                            order_type: chargeCalc.order_type,
                            pricing_version: chargeCalc.pricing_version
                        };
                        order.financial_breakdown = snapshot;
                    }
                    await recordProductDeliveryEarning(order.partner_id, order.id || order.order_number, partnerPayout, snapshot);
                    order.partner_earnings_credited = true;
                    order.partner_earning_amount = partnerPayout;
                } catch (e) {
                    console.warn("[EARNINGS RECORD WARN]:", e.message);
                }
            }
        }

        saveOrders(orders);

        // Record status history in PostgreSQL & timeline
        try {
            await recordStatusHistory({
                orderId: order.id || id,
                status: normStatus,
                partnerId: actorPartnerId || order.partner_id,
                notes
            });
            await pool.query(
                `UPDATE orders SET order_status = $1, delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END, updated_at = NOW() WHERE id::text = $2 OR order_number = $2`,
                [normStatus, id.toString()]
            );
        } catch (_) {}

        // Real-time broadcasts
        try {
            broadcastStatusChange({
                orderId: id,
                status: normStatus,
                partnerId: order.partner_id,
                userId: order.user_id,
                additionalData: { delivered_at: order.delivered_at }
            });
        } catch (_) {}

        return res.json({ success: true, message: `Order status updated to ${normStatus}`, order });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.put("/:id/status", updateOrderStatusHandler);
router.post("/:id/status", updateOrderStatusHandler);

module.exports = router;
