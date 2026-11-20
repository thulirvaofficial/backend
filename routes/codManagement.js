const express = require("express");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const {
    checkCustomerCodEligibility,
    getMonitoredCustomers,
    updateCustomerCodStatus,
    getCodAuditLogs
} = require("../services/codRiskService");

const router = express.Router();

/**
 * GET /api/cod-status and /api/cod/status
 * Public / Authenticated check for checkout flow
 */
router.get(["/", "/status"], async (req, res) => {
    try {
        let userId = null;
        let customerPhone = req.query.phone || null;

        // Try extracting user from bearer token if present
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const jwt = require("jsonwebtoken");
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, process.env.JWT_SECRET || "thulirva_secret_key_2026");
                userId = decoded.id;
                if (!customerPhone && decoded.phone) customerPhone = decoded.phone;
            } catch (_) {}
        }

        if (!userId && req.query.user_id) {
            userId = req.query.user_id;
        }

        const eligibility = await checkCustomerCodEligibility(userId, customerPhone);
        return res.json({
            success: true,
            ...eligibility
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Failed to evaluate COD eligibility: " + err.message
        });
    }
});

/* =========================================================================
   ADMIN COD RISK CONTROL ENDPOINTS
   Base mount: /api/admin/cod-restrictions
========================================================================= */
const adminCodRouter = express.Router();
adminCodRouter.use(authenticateToken, adminOnly);

/**
 * GET /api/admin/cod-restrictions
 * List monitored & restricted customers
 */
adminCodRouter.get("/", async (req, res) => {
    try {
        const { search, status, page, limit } = req.query;
        const data = await getMonitoredCustomers({
            search,
            status,
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 50
        });
        return res.json({ success: true, ...data });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to fetch COD restrictions: " + err.message });
    }
});

/**
 * GET /api/admin/cod-restrictions/audit-logs
 * Full audit log of all manual and automatic COD restrictions/restorations
 */
adminCodRouter.get("/audit-logs", async (req, res) => {
    try {
        const logs = await getCodAuditLogs();
        return res.json({ success: true, count: logs.length, logs });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/cod-restrictions/:customerId
 * Specific customer COD status & refusal order history
 */
adminCodRouter.get("/:customerId", async (req, res) => {
    try {
        const { customerId } = req.params;
        const data = await getMonitoredCustomers({ search: customerId });
        const customer = (data.customers || []).find(c => String(c.id) === String(customerId));
        if (!customer) {
            return res.status(404).json({ success: false, message: "Customer not found." });
        }
        const auditHistory = await getCodAuditLogs(customerId);
        return res.json({
            success: true,
            customer,
            audit_history: auditHistory
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/admin/cod-restrictions/:customerId
 * Restore or Restrict COD eligibility with admin reason
 */
adminCodRouter.patch("/:customerId", async (req, res) => {
    try {
        const { customerId } = req.params;
        const { cod_eligible, reason, reset_count } = req.body;

        if (typeof cod_eligible === "undefined") {
            return res.status(400).json({
                success: false,
                message: "'cod_eligible' boolean is required."
            });
        }

        const adminId = req.user.id || 1;
        const adminName = req.user.name || "THULIRVA Admin";

        const result = await updateCustomerCodStatus(customerId, {
            cod_eligible: Boolean(cod_eligible),
            reason,
            adminId,
            adminName,
            resetCount: Boolean(reset_count)
        });

        return res.json({
            success: true,
            message: cod_eligible ? "Cash on Delivery restored for customer." : "Cash on Delivery restricted for customer.",
            ...result
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = {
    codRouter: router,
    adminCodRouter
};
