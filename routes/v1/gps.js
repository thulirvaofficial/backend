const express = require("express");
const { authenticateToken, adminOnly } = require("../../middleware/auth");
const {
    recordLocationUpdate,
    getPartnerLiveLocation,
    getAllLiveLocations,
    getPartnerLocationHistory
} = require("../../services/gpsService");
const { getPartnerById } = require("../../services/deliveryPartnerService");

const router = express.Router();
const path = require("path");
const fs = require("fs");
const ORDERS_FILE = path.resolve(__dirname, "..", "..", "data", "orders.json");

/**
 * POST /api/v1/gps/partners/me/location
 * Authenticated Partner Real-time GPS Location Ingestion
 */
router.post("/partners/me/location", authenticateToken, async (req, res) => {
    try {
        const partnerId = req.user.partner_id || req.user.id;
        const {
            latitude,
            longitude,
            accuracy,
            speed,
            heading,
            device_timestamp,
            active_delivery_id
        } = req.body;

        const update = await recordLocationUpdate({
            partner_id: partnerId,
            latitude,
            longitude,
            accuracy,
            speed,
            heading,
            device_timestamp,
            active_delivery_id
        });

        return res.json({
            success: true,
            location: update
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/gps/admin/partners/live-locations
 * Admin Live Fleet Map (returns Padur coordinates, never Kanchipuram fallback)
 */
router.get("/admin/partners/live-locations", authenticateToken, adminOnly, async (req, res) => {
    try {
        const fleet = await getAllLiveLocations();
        return res.json({
            success: true,
            total_fleet: fleet.length,
            online_fleet: fleet.filter(p => p.is_online).length,
            partners: fleet
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/gps/admin/partners/:partnerId/location
 * Admin single partner live location & history
 */
router.get("/admin/partners/:partnerId/location", authenticateToken, adminOnly, async (req, res) => {
    try {
        const partnerId = req.params.partnerId;
        const location = await getPartnerLiveLocation(partnerId);
        const history = getPartnerLocationHistory(partnerId, { limit: 50 });

        return res.json({
            success: true,
            partner_id: partnerId,
            current_location: location,
            history
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/v1/gps/orders/:orderId/tracking
 * Customer Live Order Tracking with real-time partner coordinates
 */
router.get("/orders/:orderId/tracking", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        let orders = [];
        if (fs.existsSync(ORDERS_FILE)) {
            orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
        }

        const order = orders.find(o => o.id?.toString() === orderId.toString() || o.order_number === orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        const partnerId = order.partner_id;
        let partnerLocation = null;
        let partnerInfo = null;

        if (partnerId) {
            partnerLocation = await getPartnerLiveLocation(partnerId);
            const partner = await getPartnerById(partnerId);
            if (partner) {
                partnerInfo = {
                    partner_id: partner.partner_id,
                    name: partner.name,
                    phone: partner.phone,
                    photo_url: partner.profile_photo || null,
                    vehicle_type: partner.vehicle_type || "Electric Scooter",
                    vehicle_number: partner.vehicle_number || "",
                    rating: Number(partner.rating) || 5.0
                };
            }
        }

        return res.json({
            success: true,
            order_id: order.id,
            order_number: order.order_number,
            order_status: order.order_status,
            customer_destination: {
                address: order.address,
                city: order.city,
                latitude: order.latitude ? Number(order.latitude) : 12.8035,
                longitude: order.longitude ? Number(order.longitude) : 80.2245
            },
            partner: partnerInfo,
            partner_live_location: partnerLocation
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

