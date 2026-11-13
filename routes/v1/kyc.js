const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    submitKycDocuments,
    reviewKycSubmission,
    getPartnerKycDetails
} = require("../../services/kycService");
const { getPartners } = require("../../services/deliveryPartnerService");

const router = express.Router();

/**
 * GET /api/v1/kyc/me
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const details = await getPartnerKycDetails(partnerId);
        if (!details) {
            return res.status(404).json({ success: false, message: "Partner profile not found." });
        }
        return res.json({ success: true, kyc: details });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/kyc/me/submit
 */
router.post("/me/submit", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const {
            aadhaar_number,
            aadhaar_front_url,
            aadhaar_back_url,
            pan_number,
            pan_url,
            driving_license_number,
            driving_license_url
        } = req.body;

        const result = await submitKycDocuments({
            partner_id: partnerId,
            aadhaar_number,
            aadhaar_front_url,
            aadhaar_back_url,
            pan_number,
            pan_url,
            driving_license_number,
            driving_license_url
        });

        return res.status(200).json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/kyc/admin/pending (Admin Only)
 */
router.get("/admin/pending", authenticateToken, adminOnly, async (req, res) => {
    try {
        const partners = await getPartners();
        const pending = partners.filter(p =>
            p.kyc_status === "PENDING" ||
            p.kyc_status === "UNDER_REVIEW" ||
            p.registration_status === "pending_approval"
        );
        return res.json({ success: true, count: pending.length, partners: pending });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/kyc/admin/:partnerId/review (Admin Only)
 */
router.post("/admin/:partnerId/review", authenticateToken, adminOnly, async (req, res) => {
    try {
        const partnerId = req.params.partnerId;
        const { status, rejection_reason, notes } = req.body;
        const adminName = req.user.name || "Operations Admin";

        const result = await reviewKycSubmission({
            partner_id: partnerId,
            status,
            rejection_reason,
            reviewer_name: adminName,
            notes
        });

        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;

