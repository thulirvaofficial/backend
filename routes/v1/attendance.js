const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    checkIn,
    checkOut,
    getPartnerAttendanceHistory,
    getAdminAttendanceList
} = require("../../services/attendanceService");

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
 * POST /api/v1/attendance/check-in
 */
router.post("/check-in", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const partnerName = req.user.name || "Delivery Partner";
        const { latitude, longitude, photo_base64 } = req.body;

        const result = await checkIn({
            partner_id: partnerId,
            partner_name: partnerName,
            latitude,
            longitude,
            photo_base64
        });

        if (!result.success) return res.status(400).json(result);
        return res.status(201).json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/attendance/check-out
 */
router.post("/check-out", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const { latitude, longitude, photo_base64 } = req.body;

        const result = await checkOut({
            partner_id: partnerId,
            latitude,
            longitude,
            photo_base64
        });
        if (!result.success) return res.status(400).json(result);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/attendance/me
 */
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const resData = await getPartnerAttendanceHistory(partnerId);
        const historyList = Array.isArray(resData?.history) ? resData.history : (Array.isArray(resData) ? resData : []);
        return res.json({
            success: true,
            partner_id: partnerId,
            count: historyList.length,
            history: historyList
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/attendance/admin/all (Admin Roster)
 */
router.get("/admin/all", optionalAdminAuth, async (req, res) => {
    try {
        const { date, partner_id, search, filter } = req.query;
        const result = await getAdminAttendanceList({
            filter: filter || (date ? "custom" : "all"),
            start_date: date || null,
            end_date: date || null,
            partner_id: partner_id || null,
            search: search || null
        });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
