const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const { initiateSmartDispatch } = require("../../services/dispatchEngine");

const router = express.Router();
const path = require("path");
const fs = require("fs");
const ORDERS_FILE = path.resolve(__dirname, "..", "..", "data", "orders.json");

/**
 * POST /api/v1/assignments/manual
 * Manually assign order to a partner
 */
router.post("/manual", authenticateToken, adminOnly, async (req, res) => {
    try {
        const { order_id, partner_id } = req.body;
        if (!order_id || !partner_id) {
            return res.status(400).json({ success: false, message: "order_id and partner_id are required." });
        }

        let orders = [];
        if (fs.existsSync(ORDERS_FILE)) {
            orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
        }

        const order = orders.find(o => o.id?.toString() === order_id.toString() || o.order_number === order_id);
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        order.partner_id = partner_id;
        order.order_status = "assigned";
        order.status = "assigned";
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");

        // Notification & Sockets
        try {
            const { sendNotification } = require("../../services/notificationService");
            const { emitToPartner, emitToCustomer, emitToAdmin } = require("../../services/socketService");

            sendNotification({
                userId: partner_id,
                title: "THULIRVA – NEW DELIVERY! 🌾",
                message: `New order assigned to you.\nCustomer: ${order.customer_name}\nAddress: ${order.address}\nOrder: #${order.order_number || order_id}`,
                type: "delivery_assignment",
                targetId: order_id.toString()
            }).catch(() => {});

            emitToPartner(partner_id, "order:assigned", {
                order_id,
                order_number: order.order_number,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone,
                address: order.address,
                total: order.total
            });

            if (order.user_id) {
                emitToCustomer(order.user_id, "order:partner_assigned", { order_id, partner_id });
            }
            emitToAdmin("order:assigned", { order_id, partner_id });
        } catch (_) {}

        return res.json({
            success: true,
            message: `Order #${order_id} manually assigned to partner ${partner_id}`,
            order
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/assignments/auto
 * Smart Dispatch Engine
 */
router.post("/auto", authenticateToken, adminOnly, async (req, res) => {
    try {
        const { order_id } = req.body;
        const result = await initiateSmartDispatch(order_id);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

