const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    getFinancialSummaryReport,
    getFleetPerformanceReport
} = require("../../services/reportService");

const router = express.Router();

/**
 * GET /api/v1/reports/financial (Admin Only)
 */
router.get("/financial", authenticateToken, adminOnly, async (req, res) => {
    try {
        const report = await getFinancialSummaryReport();
        return res.json({ success: true, report });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/reports/fleet (Admin Only)
 */
router.get("/fleet", authenticateToken, adminOnly, async (req, res) => {
    try {
        const report = await getFleetPerformanceReport();
        return res.json({ success: true, report });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

