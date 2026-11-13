const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    getPartnerBankAccounts,
    addPartnerBankAccount,
    verifyPartnerBankAccount
} = require("../../services/bankAccountService");

const router = express.Router();

/**
 * GET /api/v1/bank-accounts/me
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const accounts = await getPartnerBankAccounts(partnerId);
        return res.json({ success: true, partner_id: partnerId, accounts });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/bank-accounts/me
 */
router.post("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const {
            account_holder_name,
            account_number,
            ifsc_code,
            bank_name,
            branch_name,
            passbook_url
        } = req.body;

        const newAccount = await addPartnerBankAccount({
            partner_id: partnerId,
            account_holder_name,
            account_number,
            ifsc_code,
            bank_name,
            branch_name,
            passbook_url
        });

        return res.status(201).json({
            success: true,
            message: "Bank account added successfully. Verification in progress.",
            account: newAccount
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/bank-accounts/partner/:partnerId
 */
router.get("/partner/:partnerId", authenticateToken, async (req, res) => {
    try {
        const accounts = await getPartnerBankAccounts(req.params.partnerId);
        return res.json({ success: true, partner_id: req.params.partnerId, accounts });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/bank-accounts/:id/verify (Admin Only)
 */
router.post("/:id/verify", authenticateToken, adminOnly, async (req, res) => {
    try {
        const accountId = req.params.id;
        const { is_verified = true } = req.body;
        const adminName = req.user.name || "Operations Admin";

        const verified = await verifyPartnerBankAccount(accountId, is_verified, adminName);
        return res.json({
            success: true,
            message: `Bank account #${accountId} marked as ${is_verified ? "VERIFIED" : "UNVERIFIED"}`,
            account: verified
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;

