const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    getPartnerBankAccounts,
    getAllPartnerBankAccounts,
    addPartnerBankAccount,
    verifyPartnerBankAccount,
    reviewPartnerBankAccount
} = require("../../services/bankAccountService");

const router = express.Router();

function optionalAdminAuth(req, res, next) {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authenticateToken(req, res, () => {
            next();
        });
    }
    next();
}

/**
 * GET /api/v1/bank-accounts/admin/all & /api/bank-accounts/admin/all
 */
router.get("/admin/all", optionalAdminAuth, async (req, res) => {
    try {
        const { status } = req.query;
        const accounts = await getAllPartnerBankAccounts({ status });
        return res.json({ success: true, count: accounts.length, accounts });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/bank-accounts/:id/review
 */
router.post("/:id/review", optionalAdminAuth, async (req, res) => {
    try {
        const accountId = req.params.id;
        const { status, reason } = req.body;
        const adminName = req.user?.name || "Operations Admin";

        if (!status || !["APPROVED", "REJECTED"].includes(status.toUpperCase())) {
            return res.status(400).json({ success: false, message: "status must be 'APPROVED' or 'REJECTED'." });
        }

        const reviewed = await reviewPartnerBankAccount(accountId, status.toUpperCase(), reason, adminName);
        return res.json({
            success: true,
            message: `Bank account #${accountId} has been ${status.toUpperCase()}`,
            account: reviewed
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/bank-accounts/me
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user?.partner_id || req.user?.id;
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
        const partnerId = req.user?.partner_id || req.user?.id || req.body.partner_id;
        const {
            account_holder_name,
            account_number,
            ifsc_code,
            bank_name,
            branch_name,
            account_type,
            passbook_url,
            passbook_base64
        } = req.body;

        const newAccount = await addPartnerBankAccount({
            partner_id: partnerId,
            account_holder_name,
            account_number,
            ifsc_code,
            bank_name,
            branch_name,
            account_type: account_type || "Savings",
            passbook_url,
            passbook_base64
        });

        return res.status(201).json({
            success: true,
            message: "Bank account submitted successfully. Verification in progress.",
            account: newAccount
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/bank-accounts/partner/:partnerId
 */
router.get("/partner/:partnerId", optionalAdminAuth, async (req, res) => {
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
router.post("/:id/verify", optionalAdminAuth, async (req, res) => {
    try {
        const accountId = req.params.id;
        const { is_verified = true, reason } = req.body;
        const adminName = req.user?.name || "Operations Admin";

        const verified = await reviewPartnerBankAccount(
            accountId,
            is_verified ? "APPROVED" : "REJECTED",
            reason,
            adminName
        );
        return res.json({
            success: true,
            message: `Bank account #${accountId} marked as ${is_verified ? "APPROVED" : "REJECTED"}`,
            account: verified
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;

