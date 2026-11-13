const express = require("express");
const { authenticateToken } = require("../../middleware/auth");
const {
    getPartnerWalletBalance,
    getPartnerLedger,
    recordEarningEntry,
    recordFinancialAudit
} = require("../../services/financialService");
const { getPartners } = require("../../services/deliveryPartnerService");

const router = express.Router();

/**
 * GET /api/v1/earnings/me
 * Authenticated Partner Wallet & Earnings Overview
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const wallet = await getPartnerWalletBalance(partnerId);
        if (!wallet) {
            return res.status(404).json({ success: false, message: "Wallet not found for this partner." });
        }

        const recentLedger = getPartnerLedger(partnerId, { page: 1, limit: 10 });

        return res.json({
            success: true,
            partner_id: partnerId,
            wallet: {
                available_payable_rupees: wallet.available_payable_rupees,
                reserved_withdrawal_rupees: wallet.reserved_withdrawal_rupees,
                total_settled_rupees: wallet.total_settled_rupees,
                lifetime_earned_rupees: wallet.lifetime_earned_rupees,
                available_payable_paise: wallet.available_payable_paise,
                reserved_withdrawal_paise: wallet.reserved_withdrawal_paise,
                total_settled_paise: wallet.total_settled_paise,
                lifetime_earned_paise: wallet.lifetime_earned_paise,
                updated_at: wallet.updated_at
            },
            recent_transactions: recentLedger.items
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/earnings/me/ledger
 * Partner immutable ledger history with pagination
 */
router.get("/me/ledger", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const entryType = req.query.type || null;

        const result = getPartnerLedger(partnerId, { page, limit, entry_type: entryType });
        return res.json({
            success: true,
            partner_id: partnerId,
            ...result
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/earnings/partner/:partnerId
 * Admin view of partner earnings and ledger
 */
router.get("/partner/:partnerId", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.params.partnerId;
        const wallet = await getPartnerWalletBalance(partnerId);
        if (!wallet) {
            return res.status(404).json({ success: false, message: "Partner wallet not found." });
        }

        const ledger = getPartnerLedger(partnerId, { page: 1, limit: 50 });
        return res.json({
            success: true,
            partner_id: partnerId,
            wallet,
            ledger
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
