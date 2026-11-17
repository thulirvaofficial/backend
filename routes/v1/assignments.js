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

        const { assignOrderManually } = require("../../services/dispatchEngine");
        const result = await assignOrderManually(order_id, partner_id);
        return res.json(result);
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

