const express = require("express");
const { checkServiceability, getActiveAreas } = require("../../services/serviceabilityService");

const router = express.Router();

/**
 * GET /api/v1/serviceability/areas
 */
router.get("/areas", (req, res) => {
    try {
        const areas = getActiveAreas();
        return res.json({ success: true, count: areas.length, areas });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/serviceability/check
 */
router.post("/check", async (req, res) => {
    try {
        const { latitude, longitude, pincode, address } = req.body;
        const result = await checkServiceability({ latitude, longitude, pincode, address });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

