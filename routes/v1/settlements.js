const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    executeWeeklySettlement,
    getPartnerSettlementHistory
} = require("../../services/financialService");

const router = express.Router();
const path = require("path");
const fs = require("fs");
const SETTLEMENTS_FILE = path.resolve(__dirname, "..", "..", "data", "partner_settlements.json");

/**
 * GET /api/v1/settlements/me
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const settlements = getPartnerSettlementHistory(partnerId);
        return res.json({ success: true, partner_id: partnerId, settlements });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/settlements/admin/all (Admin Only)
 */
router.get("/admin/all", authenticateToken, adminOnly, async (req, res) => {
    try {
        let settlements = [];
        if (fs.existsSync(SETTLEMENTS_FILE)) {
            settlements = JSON.parse(fs.readFileSync(SETTLEMENTS_FILE, "utf-8"));
        }
        return res.json({ success: true, total: settlements.length, settlements });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/settlements/admin/process (Admin Only)
 * Executes weekly salary disbursement with UTR record
 */
router.post("/admin/process", authenticateToken, adminOnly, async (req, res) => {
    try {
        const {
            partner_id,
            period_start,
            period_end,
            payment_mode,
            utr_number,
            notes
        } = req.body;

        const adminName = req.user.name || "Finance Operations Admin";

        const settlement = await executeWeeklySettlement({
            partner_id,
            period_start,
            period_end,
            payment_mode,
            utr_number,
            notes,
            admin_name: adminName
        });

        return res.status(201).json({
            success: true,
            message: `Weekly salary settlement successfully executed for partner ${partner_id}. Amount: ₹${settlement.net_amount_rupees}.`,
            settlement
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;

