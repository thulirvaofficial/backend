const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    getDistributionHubs,
    getHubById,
    createDistributionHub
} = require("../../services/hubService");

const router = express.Router();

/**
 * GET /api/v1/hubs
 */
router.get("/", async (req, res) => {
    try {
        const hubs = await getDistributionHubs();
        return res.json({ success: true, hubs });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/hubs/:id
 */
router.get("/:id", async (req, res) => {
    try {
        const hub = await getHubById(req.params.id);
        if (!hub) return res.status(404).json({ success: false, message: "Hub not found." });
        return res.json({ success: true, hub });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/hubs (Admin Only)
 */
router.post("/", authenticateToken, adminOnly, async (req, res) => {
    try {
        const newHub = await createDistributionHub(req.body);
        return res.status(201).json({ success: true, message: "Hub created successfully.", hub: newHub });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;

