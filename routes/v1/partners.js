const express = require("express");
const bcrypt = require("bcryptjs");
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

// Helper for optional auth
function optionalAuth(req, res, next) {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authenticateToken(req, res, next);
    }
    next();
}

/**
 * GET /api/v1/partners/online & /api/partners/online
 */
router.get("/online", optionalAuth, async (req, res) => {
    try {
        const partners = await getPartners();
        const online = partners.filter(p => Boolean(p.is_online));
        return res.json({ success: true, count: online.length, partners: online });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/partners/locations & /api/partners/locations
 */
router.get("/locations", optionalAuth, async (req, res) => {
    try {
        const partners = await getPartners();
        const locations = partners.map(p => ({
            partner_id: p.partner_id,
            name: p.name,
            phone: p.phone,
            is_online: Boolean(p.is_online),
            latitude: p.current_latitude || 12.8025,
            longitude: p.current_longitude || 80.2233,
            speed: p.speed || 0,
            heading: p.heading || 0,
            accuracy: p.accuracy || 0,
            active_orders_count: p.active_orders_count || 0,
            updated_at: p.location_updated_at || p.updated_at
        }));
        return res.json({ success: true, count: locations.length, locations });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/partners/search & /api/partners/search
 */
router.get("/search", optionalAuth, async (req, res) => {
    try {
        const query = (req.query.q || req.query.search || "").toLowerCase().trim();
        const partners = await getPartners();
        if (!query) {
            return res.json({ success: true, count: partners.length, partners });
        }
        const filtered = partners.filter(p =>
            (p.name || "").toLowerCase().includes(query) ||
            (p.phone || "").includes(query) ||
            (p.partner_id || "").toLowerCase().includes(query) ||
            (p.vehicle_number || "").toLowerCase().includes(query) ||
            (p.assigned_area || "").toLowerCase().includes(query)
        );
        return res.json({ success: true, count: filtered.length, partners: filtered });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/v1/partners/location & /api/partners/location
 * Ingest partner live GPS location
 */
router.post("/location", optionalAuth, async (req, res) => {
    try {
        const partnerId = req.body.partner_id || req.body.partnerId || req.user?.partner_id || req.user?.id;
        const latitude = parseFloat(req.body.latitude);
        const longitude = parseFloat(req.body.longitude);
        const speed = parseFloat(req.body.speed || 0);
        const heading = parseFloat(req.body.heading || 0);
        const accuracy = parseFloat(req.body.accuracy || 0);

        if (!partnerId || isNaN(latitude) || isNaN(longitude)) {
            return res.status(400).json({ success: false, message: "partner_id, latitude and longitude are required." });
        }

        const partner = await getPartnerById(partnerId);
        if (partner) {
            partner.current_latitude = latitude;
            partner.current_longitude = longitude;
            partner.speed = speed;
            partner.heading = heading;
            partner.accuracy = accuracy;
            partner.location_updated_at = new Date().toISOString();
            partner.last_active_at = new Date().toISOString();
            partner.is_online = true;
            await savePartner(partner);
        }

        // Real-time broadcast
        try {
            const { emitToAdmin } = require("../../services/socketService");
            const payload = {
                partnerId,
                latitude,
                longitude,
                speed,
                heading,
                accuracy,
                timestamp: new Date().toISOString()
            };
            emitToAdmin("delivery:location:update", payload);
            emitToAdmin("fleet:location:updated", payload);
            emitToAdmin("partner:location:updated", payload);
        } catch (_) {}

        return res.json({
            success: true,
            message: "Location recorded successfully.",
            location: { partner_id: partnerId, latitude, longitude, speed, heading, accuracy }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/partners & /api/partners
 */
router.get("/", optionalAuth, async (req, res) => {
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
 * POST /api/v1/partners (Admin Create Partner)
 */
router.post("/", optionalAuth, async (req, res) => {
    try {
        const { name, phone, email, assigned_area, vehicle_type, vehicle_number, password } = req.body;
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

        // Secure password hashing
        const rawPassword = password || "Partner@123";
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(rawPassword, salt);

        const newPartner = {
            partner_id,
            name: name.trim(),
            phone: phone.trim(),
            email: email ? email.trim() : `${partner_id.toLowerCase()}@thulirva.in`,
            password_hash,
            must_change_password: true,
            assigned_area: assigned_area || "Padur",
            vehicle_type: vehicle_type || "Electric Scooter",
            vehicle_number: vehicle_number || "TN 09 CY 7890",
            is_active: true,
            is_online: false,
            kyc_status: "NOT_SUBMITTED",
            registration_status: "pending_documents",
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
 * GET /api/v1/partners/:id/location & /api/partners/:id/location
 */
router.get("/:id/location", optionalAuth, async (req, res) => {
    try {
        const partner = await getPartnerById(req.params.id);
        if (!partner) return res.status(404).json({ success: false, message: "Partner not found" });
        return res.json({
            success: true,
            partner_id: partner.partner_id,
            name: partner.name,
            is_online: Boolean(partner.is_online),
            latitude: partner.current_latitude || 12.8025,
            longitude: partner.current_longitude || 80.2233,
            speed: partner.speed || 0,
            heading: partner.heading || 0,
            accuracy: partner.accuracy || 0,
            location_updated_at: partner.location_updated_at || partner.updated_at
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/partners/:id/delivered-orders & /api/partners/:id/delivered-orders
 */
router.get("/:id/delivered-orders", optionalAuth, async (req, res) => {
    try {
        const { getDeliveredOrdersForPartner } = require("../../services/deliveryProofService");
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const date = req.query.date || null;
        const result = await getDeliveredOrdersForPartner(req.params.id, { page, limit, date });
        return res.json({ success: true, partner_id: req.params.id, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/partners/:id/orders & /api/partners/:id/orders
 */
router.get("/:id/orders", optionalAuth, async (req, res) => {
    try {
        const partnerId = req.params.id;
        const ordersPath = require("path").resolve(__dirname, "..", "..", "data", "orders.json");
        let orders = [];
        if (require("fs").existsSync(ordersPath)) {
            orders = JSON.parse(require("fs").readFileSync(ordersPath, "utf-8"));
        }
        const partnerOrders = orders.filter(o => o.partner_id === partnerId);
        return res.json({ success: true, partner_id: partnerId, total: partnerOrders.length, orders: partnerOrders });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/partners/:id
 */
router.get("/:id", optionalAuth, async (req, res) => {
    try {
        const partner = await getPartnerById(req.params.id);
        if (!partner) return res.status(404).json({ success: false, message: "Partner not found." });
        return res.json({ success: true, partner });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/v1/partners/:id
 */
router.put("/:id", optionalAuth, async (req, res) => {
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
 * POST /api/v1/partners/:id/toggle-block
 */
router.post("/:id/toggle-block", optionalAuth, async (req, res) => {
    try {
        const result = await toggleBlockPartner(req.params.id);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
