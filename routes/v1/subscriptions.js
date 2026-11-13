const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const {
    getSubscriptionDeliveries,
    claimSubscriptionDelivery,
    updateSubscriptionDeliveryStatus
} = require("../../services/subscriptionDeliveryService");
const { recordSubscriptionDeliveryEarning } = require("../../services/financialService");
const { getPartnerById } = require("../../services/deliveryPartnerService");

const router = express.Router();
const path = require("path");
const fs = require("fs");
const SUBS_FILE = path.resolve(__dirname, "..", "..", "data", "subscriptions.json");

/**
 * GET /api/v1/subscriptions/deliveries/today
 */
router.get("/deliveries/today", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const partner = await getPartnerById(partnerId);
        const today = new Date().toISOString().split("T")[0];

        const result = await getSubscriptionDeliveries(today, partner);
        return res.json({ success: true, date: today, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/subscriptions/deliveries/:id/claim
 */
router.post("/deliveries/:id/claim", authenticateToken, async (req, res) => {
    try {
        const deliveryId = req.params.id;
        const partnerId = req.user.partner_id || req.user.id;
        const partnerName = req.user.name || "Delivery Partner";

        const result = await claimSubscriptionDelivery(deliveryId, partnerId, partnerName);
        if (!result.success) return res.status(result.conflict ? 409 : 400).json(result);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/v1/subscriptions/deliveries/:id/status
 */
router.put("/deliveries/:id/status", authenticateToken, async (req, res) => {
    try {
        const deliveryId = req.params.id;
        const partnerId = req.user.partner_id || req.user.id;
        const { status, notes, failed_reason } = req.body;

        const result = await updateSubscriptionDeliveryStatus(deliveryId, status, notes, failed_reason, partnerId);
        if (!result.success) return res.status(result.conflict ? 409 : 400).json(result);

        if (status === "delivered") {
            try {
                await recordSubscriptionDeliveryEarning(partnerId, deliveryId, 35);
            } catch (e) {
                console.warn("[SUB EARNING WARN]:", e.message);
            }
        }

        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

