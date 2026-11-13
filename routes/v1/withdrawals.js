const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    createWithdrawalRequest,
    reviewWithdrawalRequest,
    getPartnerWithdrawalRequests,
    getPartnerWalletBalance
} = require("../../services/financialService");

const router = express.Router();
const path = require("path");
const fs = require("fs");
const WITHDRAWALS_FILE = path.resolve(__dirname, "..", "..", "data", "partner_withdrawal_requests.json");

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
 * GET /api/v1/withdrawals/me
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const requests = getPartnerWithdrawalRequests(partnerId);
        const wallet = await getPartnerWalletBalance(partnerId);
        return res.json({
            success: true,
            partner_id: partnerId,
            available_payable_rupees: wallet?.available_payable_rupees || 0,
            reserved_withdrawal_rupees: wallet?.reserved_withdrawal_rupees || 0,
            requests
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/withdrawals/me
 */
router.post("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const { amount, bank_account_id, notes } = req.body;

        const request = await createWithdrawalRequest({
            partner_id: partnerId,
            amount_in_rupees: amount,
            bank_account_id,
            notes
        });

        return res.status(201).json({
            success: true,
            message: `Withdrawal request of ₹${amount} created successfully. Amount reserved.`,
            request
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/withdrawals/admin/all
 */
router.get("/admin/all", optionalAdminAuth, async (req, res) => {
    try {
        let requests = [];
        if (fs.existsSync(WITHDRAWALS_FILE)) {
            requests = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf-8"));
        }
        const statusFilter = req.query.status;
        if (statusFilter) {
            requests = requests.filter(r => r.status === statusFilter);
        }
        return res.json({ success: true, total: requests.length, requests });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/", optionalAdminAuth, async (req, res) => {
    try {
        let requests = [];
        if (fs.existsSync(WITHDRAWALS_FILE)) {
            requests = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf-8"));
        }
        const statusFilter = req.query.status;
        if (statusFilter) {
            requests = requests.filter(r => r.status === statusFilter);
        }
        return res.json({ success: true, total: requests.length, requests });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/all", optionalAdminAuth, async (req, res) => {
    try {
        let requests = [];
        if (fs.existsSync(WITHDRAWALS_FILE)) {
            requests = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf-8"));
        }
        const statusFilter = req.query.status;
        if (statusFilter) {
            requests = requests.filter(r => r.status === statusFilter);
        }
        return res.json({ success: true, total: requests.length, requests });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/withdrawals/:id/review (Admin Only)
 */
router.post("/:id/review", authenticateToken, adminOnly, async (req, res) => {
    try {
        const requestId = req.params.id;
        const { action, reviewer_notes, utr_number } = req.body;
        const adminName = req.user.name || "Operations Admin";

        const updated = await reviewWithdrawalRequest({
            request_id: requestId,
            action,
            reviewer_notes,
            utr_number,
            admin_name: adminName
        });

        return res.json({
            success: true,
            message: `Withdrawal request #${requestId} successfully processed (${action}).`,
            request: updated
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;

