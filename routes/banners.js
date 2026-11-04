const express = require("express");
const { pool } = require("../config/database");

const router = express.Router();

const DEFAULT_BANNER = {
    id: 1,
    title: "Pure Goodness from Our Farms",
    description: "Farm fresh A2 milk, hand-churned ghee and organic dairy directly to your doorstep.",
    image: "/assets/images/home_clean_bg.png",
    button_label: "Shop Now",
    destination: "/shop",
    is_active: true,
    sort_order: 1
};

/* GET ACTIVE BANNERS */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM banners WHERE is_active = true ORDER BY sort_order ASC, created_at DESC"
        );
        if (result.rows.length > 0) {
            return res.json({ success: true, banners: result.rows });
        }
    } catch {}
    res.json({ success: true, banners: [DEFAULT_BANNER] });
});

/* ADMIN: CREATE BANNER */
router.post("/", async (req, res) => {
    try {
        const { title, description, image, button_label, destination, is_active, sort_order } = req.body;
        const result = await pool.query(
            `INSERT INTO banners (title, description, image, button_label, destination, is_active, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [title, description, image || '/assets/images/home_clean_bg.png', button_label || 'Shop Now', destination || '/shop', is_active !== false, sort_order || 1]
        );
        res.json({ success: true, banner: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ADMIN: UPDATE BANNER */
router.put("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { title, description, image, button_label, destination, is_active, sort_order } = req.body;
        const result = await pool.query(
            `UPDATE banners SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                image = COALESCE($3, image),
                button_label = COALESCE($4, button_label),
                destination = COALESCE($5, destination),
                is_active = COALESCE($6, is_active),
                sort_order = COALESCE($7, sort_order)
             WHERE id = $8 RETURNING *`,
            [title, description, image, button_label, destination, is_active, sort_order, id]
        );
        res.json({ success: true, banner: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ADMIN: DELETE BANNER */
router.delete("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await pool.query("DELETE FROM banners WHERE id = $1", [id]);
        res.json({ success: true, message: "Banner deleted" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
