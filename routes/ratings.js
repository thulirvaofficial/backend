const express = require("express");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const { authenticatePartner } = require("../middleware/deliveryAuth");
const {
    submitCustomerRating,
    submitPartnerRating,
    getOrderRatings,
    getPartnerRatings,
    getAllRatings
} = require("../services/ratingService");

const router = express.Router();

// POST /api/ratings/customer - Customer Rates Partner
router.post("/customer", authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id || req.body.user_id;
        const { order_id, rating, on_time_rating, behavior_rating, communication_rating, feedback, issue_report } = req.body || {};
        const result = await submitCustomerRating({
            order_id,
            user_id: userId,
            rating,
            on_time_rating,
            behavior_rating,
            communication_rating,
            feedback,
            issue_report
        });
        return res.status(201).json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

// POST /api/ratings/partner - Delivery Partner Rates Customer / Delivery Experience
router.post("/partner", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const { order_id, rating, delivery_experience, feedback, difficulty_report } = req.body || {};
        const result = await submitPartnerRating({
            order_id,
            partner_id: partnerId,
            rating,
            delivery_experience,
            feedback,
            difficulty_report
        });
        return res.status(201).json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/ratings/order/:id
router.get("/order/:id", async (req, res) => {
    try {
        const ratings = getOrderRatings(req.params.id);
        return res.json({ success: true, count: ratings.length, ratings });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/ratings/partner/:id
router.get("/partner/:id", async (req, res) => {
    try {
        const summary = getPartnerRatings(req.params.id);
        return res.json({ success: true, ...summary });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/admin/ratings - Admin Moderation List
router.get("/admin", authenticateToken, adminOnly, async (req, res) => {
    try {
        const { rater_type, has_issue } = req.query;
        const ratings = getAllRatings({
            rater_type,
            has_issue: has_issue !== undefined ? has_issue === "true" : null
        });
        return res.json({ success: true, count: ratings.length, ratings });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

