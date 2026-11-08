const express = require("express");
const { pool } = require("../config/database");
const { sendNotification } = require("../services/notificationService");

const router = express.Router();

const DEFAULT_OFFER = {
    id: 1,
    title: "Special Thulirva Offer! 🎉",
    description: "Get 10% off on monthly milk subscriptions and dairy products. Limited time only!",
    code: "THULIRVA10",
    discount_percent: 10,
    discount_amount: 0,
    banner_image: "/assets/images/home_clean_bg.png",
    is_active: true,
    is_published: true,
    created_at: new Date().toISOString()
};

/* GET ALL ACTIVE OFFERS */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM offers WHERE is_active = true AND is_published = true ORDER BY created_at DESC"
        );
        if (result.rows.length > 0) {
            return res.json({ success: true, offers: result.rows });
        }
    } catch {}
    res.json({ success: true, offers: [DEFAULT_OFFER] });
});

/* ADMIN: CREATE AND PUBLISH OFFER */
router.post("/", async (req, res) => {
    try {
        const { title, description, code, discount_percent, discount_amount, banner_image, is_active, is_published, expires_at } = req.body;
        const result = await pool.query(
            `INSERT INTO offers (title, description, code, discount_percent, discount_amount, banner_image, is_active, is_published, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [title, description, code, discount_percent || 0, discount_amount || 0, banner_image, is_active !== false, is_published !== false, expires_at]
        );

        // If published, also record and broadcast offer notification
        if (is_published !== false) {
            sendNotification({
                title: `Special Offer: ${title} 🎉`,
                message: description || `Special Offer! Use code ${code || ''} for farm discounts.`,
                type: "offer",
                targetId: result.rows[0]?.id ? result.rows[0].id.toString() : "",
                forAdmin: false
            }).catch(() => {});
        }

        res.json({ success: true, offer: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ADMIN: UPDATE OFFER */
router.put("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { title, description, code, discount_percent, discount_amount, banner_image, is_active, is_published } = req.body;
        const result = await pool.query(
            `UPDATE offers SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                code = COALESCE($3, code),
                discount_percent = COALESCE($4, discount_percent),
                discount_amount = COALESCE($5, discount_amount),
                banner_image = COALESCE($6, banner_image),
                is_active = COALESCE($7, is_active),
                is_published = COALESCE($8, is_published)
             WHERE id = $9 RETURNING *`,
            [title, description, code, discount_percent, discount_amount, banner_image, is_active, is_published, id]
        );
        res.json({ success: true, offer: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
