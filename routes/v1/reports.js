const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    getFinancialSummaryReport,
    getFleetPerformanceReport
} = require("../../services/reportService");

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
 * GET /api/v1/reports/financial
 */
router.get("/financial", optionalAdminAuth, async (req, res) => {
    try {
        const report = await getFinancialSummaryReport();
        return res.json({ success: true, report });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/reports/fleet
 */
router.get("/fleet", optionalAdminAuth, async (req, res) => {
    try {
        const report = await getFleetPerformanceReport();
        return res.json({ success: true, report });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

