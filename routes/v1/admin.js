const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const { getPartners } = require("../../services/deliveryPartnerService");
const { getFinancialSummaryReport, getFleetPerformanceReport } = require("../../services/reportService");

const router = express.Router();
const path = require("path");
const fs = require("fs");
const AUDIT_FILE = path.resolve(__dirname, "..", "..", "data", "admin_audit_logs.json");

/**
 * GET /api/v1/admin/dashboard
 */
router.get("/dashboard", authenticateToken, adminOnly, async (req, res) => {
    try {
        const fleetReport = await getFleetPerformanceReport();
        const financialReport = await getFinancialSummaryReport();

        return res.json({
            success: true,
            dashboard: {
                fleet: fleetReport,
                financials: financialReport
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/admin/audit-logs
 */
router.get("/audit-logs", authenticateToken, adminOnly, async (req, res) => {
    try {
        let logs = [];
        if (fs.existsSync(AUDIT_FILE)) {
            logs = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf-8"));
        }
        return res.json({ success: true, count: logs.length, logs });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

