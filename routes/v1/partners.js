const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    getPartners,
    getPartnerById,
    savePartner,
    deletePartnerPermanently,
    toggleBlockPartner,
    resetPartnerPassword
} = require("../../services/deliveryPartnerService");

const router = express.Router();

/**
 * GET /api/v1/partners
 */
router.get("/", authenticateToken, async (req, res) => {
    try {
        const { area, is_online, status, search } = req.query;
        let partners = await getPartners();

        if (area) {
            partners = partners.filter(p => (p.assigned_area || "").toLowerCase().includes(area.toLowerCase()));
        }
        if (is_online !== undefined) {
            const onlineBool = is_online === "true";
            partners = partners.filter(p => Boolean(p.is_online) === onlineBool);
        }
        if (status) {
            partners = partners.filter(p => (p.registration_status || "approved").toLowerCase() === status.toLowerCase());
        }
        if (search) {
            const q = search.toLowerCase();
            partners = partners.filter(p =>
                (p.name || "").toLowerCase().includes(q) ||
                (p.phone || "").includes(q) ||
                (p.partner_id || "").toLowerCase().includes(q)
            );
        }

        return res.json({ success: true, count: partners.length, partners });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/partners/:id
 */
router.get("/:id", authenticateToken, async (req, res) => {
    try {
        const partner = await getPartnerById(req.params.id);
        if (!partner) return res.status(404).json({ success: false, message: "Partner not found." });
        return res.json({ success: true, partner });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/partners (Admin Create Partner)
 */
router.post("/", authenticateToken, adminOnly, async (req, res) => {
    try {
        const { name, phone, email, assigned_area, vehicle_type, vehicle_number } = req.body;
        if (!name || !phone) {
            return res.status(400).json({ success: false, message: "Name and phone are required." });
        }

        const partners = await getPartners();
        let maxId = 0;
        partners.forEach(p => {
            const match = (p.partner_id || "").match(/THU-DP-(\d+)/i);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxId) maxId = num;
            }
        });
        const nextNum = Math.max(partners.length + 1, maxId + 1);
        const partner_id = `THU-DP-${String(nextNum).padStart(4, "0")}`;

        const newPartner = {
            partner_id,
            name: name.trim(),
            phone: phone.trim(),
            email: email ? email.trim() : `${partner_id.toLowerCase()}@thulirva.in`,
            assigned_area: assigned_area || "Padur",
            vehicle_type: vehicle_type || "Electric Scooter",
            vehicle_number: vehicle_number || "TN 09 CY 7890",
            is_active: true,
            is_online: false,
            kyc_status: "APPROVED",
            registration_status: "approved",
            rating: 5.0,
            total_deliveries_count: 0,
            today_deliveries_count: 0,
            current_latitude: 12.8025,
            current_longitude: 80.2233,
            speed: 0,
            heading: 0,
            accuracy: 0,
            created_at: new Date().toISOString()
        };

        await savePartner(newPartner);
        return res.status(201).json({ success: true, message: "Partner created successfully.", partner: newPartner });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/v1/partners/:id
 */
router.put("/:id", authenticateToken, async (req, res) => {
    try {
        const partner = await getPartnerById(req.params.id);
        if (!partner) return res.status(404).json({ success: false, message: "Partner not found." });

        const allowedFields = ["name", "phone", "email", "assigned_area", "vehicle_type", "vehicle_number", "profile_photo"];
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) partner[field] = req.body[field];
        });

        await savePartner(partner);
        return res.json({ success: true, message: "Partner updated successfully.", partner });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/partners/:id/toggle-block (Admin Only)
 */
router.post("/:id/toggle-block", authenticateToken, adminOnly, async (req, res) => {
    try {
        const result = await toggleBlockPartner(req.params.id);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
