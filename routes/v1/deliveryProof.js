const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    saveDeliveryProof,
    completeDelivery,
    getDeliveryDetails,
    verifyDeliveryProof,
    flagDeliveryProof,
    reportDeliveryIssue,
    getDeliveredOrdersForPartner
} = require("../../services/deliveryProofService");
const { getPartners, getPartnerById } = require("../../services/deliveryPartnerService");

const router = express.Router();

/* ============================================================
   DELIVERY PROOF & COMPLETION ENDPOINTS (PARTNER / SHARED)
============================================================ */

/**
 * POST /api/v1/delivery-proof/:orderId/upload (or /api/orders/:orderId/delivery-proof)
 * Partner captures & uploads delivery proof image
 */
router.post("/:orderId/proof", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { image, photo, proof, remarks, latitude, longitude, partner_id, sub_id } = req.body;
        const imageBase64 = image || photo || proof;

        if (!imageBase64) {
            return res.status(400).json({ success: false, message: "Delivery photograph data is required." });
        }

        const result = await saveDeliveryProof({
            orderId,
            subId: sub_id,
            partnerId: partner_id || req.user?.partner_id,
            imageBase64,
            remarks,
            latitude,
            longitude
        });

        return res.status(200).json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/delivery-proof/:orderId/complete (or /api/orders/:orderId/complete-delivery)
 * Final confirm delivery with mandatory photograph verification
 */
router.post("/:orderId/complete", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { image, photo, proof, remarks, latitude, longitude, partner_id, sub_id } = req.body;
        const imageBase64 = image || photo || proof;

        const result = await completeDelivery({
            orderId,
            subId: sub_id,
            partnerId: partner_id || req.user?.partner_id,
            remarks,
            latitude,
            longitude,
            imageBase64
        });

        return res.status(200).json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/delivery-proof/:orderId/details (or /api/orders/:orderId/delivery-details)
 * Complete delivery details for read-only viewing in Partner, Customer & Admin apps
 */
router.get("/:orderId/details", async (req, res) => {
    try {
        const details = await getDeliveryDetails(req.params.orderId);
        if (!details) {
            return res.status(404).json({ success: false, message: "Delivery details not found." });
        }
        return res.json({ success: true, delivery: details, order: details });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   ADMIN DELIVERY VERIFICATION & AUDIT
============================================================ */

/**
 * POST /api/v1/delivery-proof/:orderId/verify (Admin Only)
 */
router.post("/:orderId/verify", async (req, res) => {
    try {
        const { admin_name, notes } = req.body;
        const result = await verifyDeliveryProof(req.params.orderId, admin_name || "Operations Admin", notes || "");
        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/delivery-proof/:orderId/flag (Admin Only)
 */
router.post("/:orderId/flag", async (req, res) => {
    try {
        const { admin_name, reason } = req.body;
        if (!reason) {
            return res.status(400).json({ success: false, message: "Reason for flagging proof is required." });
        }
        const result = await flagDeliveryProof(req.params.orderId, admin_name || "Operations Admin", reason);
        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/* ============================================================
   CUSTOMER DELIVERY ISSUES & COMPLAINTS
============================================================ */

/**
 * POST /api/v1/delivery-proof/:orderId/issues (Customer Complaint)
 */
router.post("/:orderId/issues", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { customer_id, issue_category, description, image } = req.body;

        const result = await reportDeliveryIssue({
            orderId,
            customerId: customer_id || req.user?.id,
            issueCategory: issue_category,
            description,
            imageBase64: image
        });

        return res.status(201).json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/* ============================================================
   PARTNER DELIVERED ORDER HISTORY
============================================================ */

/**
 * GET /api/v1/delivery-proof/partner/:partnerId/delivered
 */
router.get("/partner/:partnerId/delivered", async (req, res) => {
    try {
        const partnerId = req.params.partnerId;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const date = req.query.date || null;

        const result = await getDeliveredOrdersForPartner(partnerId, { page, limit, date });
        return res.json({ success: true, partner_id: partnerId, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
