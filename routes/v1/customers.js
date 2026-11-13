const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const { pool } = require("../../config/database");

const router = express.Router();
const path = require("path");
const fs = require("fs");
const ORDERS_FILE = path.resolve(__dirname, "..", "..", "data", "orders.json");

/**
 * GET /api/v1/customers/me
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        let customer = null;
        try {
            const result = await pool.query(
                "SELECT id, name, email, phone, address, city, pincode, profile_photo, created_at FROM users WHERE id = $1",
                [userId]
            );
            if (result.rows.length > 0) customer = result.rows[0];
        } catch (_) {}

        if (!customer) {
            customer = {
                id: userId,
                name: req.user.name || "Customer",
                email: req.user.email || "",
                phone: req.user.phone || "",
                role: "customer"
            };
        }

        return res.json({ success: true, customer });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/customers/me/orders
 */
router.get("/me/orders", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        let orders = [];
        if (fs.existsSync(ORDERS_FILE)) {
            orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
        }
        const userOrders = orders.filter(o => o.user_id?.toString() === userId.toString());
        return res.json({ success: true, count: userOrders.length, orders: userOrders });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

