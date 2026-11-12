const express = require("express");
const {
    getAllAreas,
    checkServiceability,
    createArea,
    updateArea,
    toggleAreaStatus,
    deleteArea
} = require("../services/serviceabilityService");
const { emitToAdmin } = require("../services/socketService");

const router = express.Router();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyDqhJ1XV_YMFmlEAGYkBxnHhNPCnjGhO8U";

/* ============================================================
   PUBLIC SERVICEABILITY CHECK ENDPOINTS
============================================================ */

/**
 * POST /api/serviceability/check
 * Validates whether a given lat/lng or pincode falls into an active serviceable area
 */
router.post("/check", async (req, res) => {
    try {
        const { latitude, longitude, pincode } = req.body;
        const result = await checkServiceability({ latitude, longitude, pincode });
        return res.json(result);
    } catch (err) {
        console.error("[SERVICEABILITY CHECK ERROR]:", err.message);
        return res.status(500).json({
            success: false,
            serviceable: false,
            message: "Unable to verify serviceability at this moment",
            error: err.message
        });
    }
});

/**
 * GET /api/serviceability/active
 * Returns all active delivery areas
 */
router.get("/active", async (req, res) => {
    try {
        const { areas } = await getAllAreas({ includeInactive: false });
        return res.json({
            success: true,
            count: areas.length,
            areas
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/* ============================================================
   ADMIN SERVICEABLE AREAS MANAGEMENT ENDPOINTS
   Supports both /api/admin/serviceable-areas and /api/serviceability/areas
============================================================ */

const getAreasHandler = async (req, res) => {
    try {
        const result = await getAllAreas({ includeInactive: true });
        return res.json({
            success: true,
            total: result.total,
            activeCount: result.active,
            inactiveCount: result.inactive,
            areas: result.areas
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

const createAreaHandler = async (req, res) => {
    try {
        const {
            area_name,
            city,
            state,
            pincode,
            boundary_type,
            boundary_coordinates,
            latitude,
            longitude,
            radius_meters,
            is_serviceable,
            is_active,
            delivery_charge,
            minimum_order_amount,
            estimated_delivery_time
        } = req.body;

        if (!area_name || !pincode) {
            return res.status(400).json({
                success: false,
                message: "Area name and postal PIN code are required"
            });
        }

        const newArea = await createArea({
            area_name: area_name.trim(),
            city: city ? city.trim() : "Chennai",
            state: state ? state.trim() : "Tamil Nadu",
            pincode: pincode.trim(),
            boundary_type: boundary_type || "polygon",
            boundary_coordinates,
            latitude: latitude ? Number(latitude) : 13.0827,
            longitude: longitude ? Number(longitude) : 80.2707,
            radius_meters: radius_meters ? Number(radius_meters) : 5000,
            is_serviceable: is_serviceable !== undefined ? Boolean(is_serviceable) : true,
            is_active: is_active !== undefined ? Boolean(is_active) : true,
            delivery_charge: delivery_charge !== undefined ? Number(delivery_charge) : 0,
            minimum_order_amount: minimum_order_amount !== undefined ? Number(minimum_order_amount) : 0,
            estimated_delivery_time: estimated_delivery_time || "30-45 minutes"
        });

        // Real-time broadcast to admin and all connected apps
        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("serviceable_area:created", newArea);
                emitToAdmin("serviceable_area:update", { action: "create", area: newArea });
            }
        } catch (_) {}

        return res.status(201).json({
            success: true,
            message: "Serviceable area added successfully",
            area: newArea
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

const updateAreaHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await updateArea(id, req.body);
        if (!updated) {
            return res.status(404).json({ success: false, message: "Area not found" });
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("serviceable_area:update", { action: "update", area: updated });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: "Serviceable area updated successfully",
            area: updated
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

const toggleStatusHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        const updated = await toggleAreaStatus(id, is_active);
        if (!updated) {
            return res.status(404).json({ success: false, message: "Area not found" });
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("serviceable_area:update", { action: "status_change", area: updated });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: `Area is now ${updated.is_active ? "Active" : "Inactive"}`,
            area: updated
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

const deleteAreaHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const ok = await deleteArea(id);
        if (!ok) {
            return res.status(404).json({ success: false, message: "Area not found" });
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("serviceable_area:update", { action: "delete", id });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: "Area deactivated successfully"
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

router.get("/areas", getAreasHandler);
router.get("/", getAreasHandler);

router.post("/areas", createAreaHandler);
router.post("/", createAreaHandler);

router.put("/areas/:id", updateAreaHandler);
router.put("/:id", updateAreaHandler);

router.patch("/areas/:id/status", toggleStatusHandler);
router.patch("/:id/status", toggleStatusHandler);

router.delete("/areas/:id", deleteAreaHandler);
router.delete("/:id", deleteAreaHandler);

/* ============================================================
   GOOGLE MAPS LOCATION HELPER PROXIES
============================================================ */

/**
 * GET /api/serviceability/reverse-geocode
 * Reverse geocode latitude and longitude to street address, city, and pincode
 */
router.get("/reverse-geocode", async (req, res) => {
    const lat = req.query.lat || req.query.latitude;
    const lng = req.query.lng || req.query.longitude;

    if (!lat || !lng) {
        return res.status(400).json({ success: false, message: "Latitude and longitude required" });
    }

    try {
        // Call Google Geocoding API
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(3500) });
        const data = await resp.json();

        if (data && data.results && data.results.length > 0) {
            const first = data.results[0];
            let street = "";
            let area = "";
            let city = "Chennai";
            let state = "Tamil Nadu";
            let pincode = "";

            first.address_components.forEach(comp => {
                if (comp.types.includes("route") || comp.types.includes("street_number")) {
                    street = street ? `${street}, ${comp.long_name}` : comp.long_name;
                }
                if (comp.types.includes("sublocality") || comp.types.includes("sublocality_level_1") || comp.types.includes("neighborhood")) {
                    if (!area) area = comp.long_name;
                }
                if (comp.types.includes("locality")) {
                    city = comp.long_name;
                }
                if (comp.types.includes("administrative_area_level_1")) {
                    state = comp.long_name;
                }
                if (comp.types.includes("postal_code")) {
                    pincode = comp.long_name;
                }
            });

            return res.json({
                success: true,
                address: first.formatted_address,
                street: street || area || "Street Location",
                area: area || city,
                city,
                state,
                pincode,
                latitude: Number(lat),
                longitude: Number(lng)
            });
        }
    } catch (err) {
        // Fallback geocoding if network / Google API key restricted
    }

    // Smart fallback based on coordinates
    const { areas } = await getAllAreas({ includeInactive: false });
    let closestArea = areas[0];
    let minDistance = Infinity;

    for (const a of areas) {
        const d = Math.hypot(Number(lat) - a.latitude, Number(lng) - a.longitude);
        if (d < minDistance) {
            minDistance = d;
            closestArea = a;
        }
    }

    return res.json({
        success: true,
        address: `${closestArea ? closestArea.area_name : "Central Zone"}, ${closestArea ? closestArea.city : "Chennai"}, Tamil Nadu`,
        street: closestArea ? closestArea.area_name : "Main Road",
        area: closestArea ? closestArea.area_name : "Chennai",
        city: closestArea ? closestArea.city : "Chennai",
        state: "Tamil Nadu",
        pincode: closestArea ? closestArea.pincode.split(",")[0].trim() : "600000",
        latitude: Number(lat),
        longitude: Number(lng)
    });
});

/**
 * GET /api/serviceability/autocomplete
 * Search places, streets, and areas
 */
router.get("/autocomplete", async (req, res) => {
    const input = (req.query.input || req.query.q || "").trim();
    if (!input) {
        return res.json({ success: true, predictions: [] });
    }

    try {
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:in&key=${GOOGLE_MAPS_API_KEY}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(3500) });
        const data = await resp.json();
        if (data && data.predictions) {
            const predictions = data.predictions.map(p => ({
                place_id: p.place_id,
                description: p.description,
                main_text: p.structured_formatting?.main_text || p.description,
                secondary_text: p.structured_formatting?.secondary_text || ""
            }));
            return res.json({ success: true, predictions });
        }
    } catch (_) {}

    // Fallback: search local serviceable areas
    const { areas } = await getAllAreas({ includeInactive: false });
    const matches = areas.filter(a =>
        a.area_name.toLowerCase().includes(input.toLowerCase()) ||
        a.pincode.includes(input) ||
        a.city.toLowerCase().includes(input.toLowerCase())
    ).map(a => ({
        place_id: `area_${a.id}`,
        description: `${a.area_name}, ${a.city} (PIN: ${a.pincode})`,
        main_text: a.area_name,
        secondary_text: `${a.city}, Tamil Nadu`,
        latitude: a.latitude,
        longitude: a.longitude
    }));

    return res.json({ success: true, predictions: matches });
});

module.exports = router;
