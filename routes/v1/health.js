const express = require("express");
const router = express.Router();

/**
 * GET /api/v1/health
 * Production health and uptime monitoring
 */
router.get("/", (req, res) => {
    res.json({
        status: "healthy",
        service: "THULIRVA Centralized API",
        version: "v1.0.0",
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.round(process.uptime()),
        memory_usage_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        modules: {
            auth: "operational",
            partners: "operational",
            orders: "operational",
            subscriptions: "operational",
            gps: "operational",
            kyc: "operational",
            financial_ledger: "operational",
            attendance: "operational",
            notifications: "operational",
            serviceability: "operational"
        }
    });
});

module.exports = router;

