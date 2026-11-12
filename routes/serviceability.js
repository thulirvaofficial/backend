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
 * OR Forward geocode search query `q` or `address` to coordinates and address
 */
router.get("/reverse-geocode", async (req, res) => {
    const lat = req.query.lat || req.query.latitude;
    const lng = req.query.lng || req.query.longitude;
    const queryText = (req.query.q || req.query.address || "").trim();

    // -------------------------------------------------------------
    // FORWARD GEOCODING: When query text is provided without lat/lng
    // -------------------------------------------------------------
    if ((!lat || !lng) && queryText) {
        // Check for Pondicherry / Puducherry keyword match directly
        if (/pondicherry|puducherry/i.test(queryText)) {
            return res.json({
                success: true,
                address: "Pondicherry, Puducherry - 605001",
                street: "Pondicherry Main",
                area: "Pondicherry",
                city: "Pondicherry",
                state: "Puducherry",
                pincode: "605001",
                latitude: 11.9416,
                longitude: 79.8083,
                source: "exact_city"
            });
        }

        // Try Google Geocoding for forward geocode
        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(queryText)}&components=country:in&key=${GOOGLE_MAPS_API_KEY}`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(3500) });
            const data = await resp.json();
            if (data && data.results && data.results.length > 0) {
                const first = data.results[0];
                const loc = first.geometry.location;
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
                    street: street || area || queryText,
                    area: area || city || queryText,
                    city,
                    state,
                    pincode: pincode || "600001",
                    latitude: loc.lat,
                    longitude: loc.lng,
                    source: "google_forward"
                });
            }
        } catch (_) {}

        // Forward geocode fallback via OpenStreetMap Nominatim
        try {
            const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryText)}&format=json&limit=1&countrycodes=in&addressdetails=1`;
            const nomResp = await fetch(nomUrl, {
                headers: { "User-Agent": "Thulirva/1.0 (contact@thulirva.in)" },
                signal: AbortSignal.timeout(3500)
            });
            if (nomResp.ok) {
                const nomArr = await nomResp.json();
                if (nomArr && nomArr.length > 0) {
                    const first = nomArr[0];
                    const addr = first.address || {};
                    const suburb = addr.suburb || addr.neighbourhood || addr.village || addr.quarter || "";
                    const city = addr.city || addr.town || addr.state_district || queryText;
                    const state = addr.state || "Tamil Nadu";
                    const pincode = addr.postcode ? addr.postcode.trim() : "";
                    const area = suburb || city;

                    return res.json({
                        success: true,
                        address: first.display_name,
                        street: area,
                        area: area,
                        city: city,
                        state: state,
                        pincode: pincode || "600001",
                        latitude: Number(first.lat),
                        longitude: Number(first.lon),
                        source: "nominatim_forward"
                    });
                }
            }
        } catch (_) {}

        return res.status(404).json({
            success: false,
            message: `Could not find location for '${queryText}'`
        });
    }

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
            let city = "";
            let state = "";
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

            if (!city) city = area || "Tamil Nadu";
            if (!state) state = "Tamil Nadu";

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
        // Google geocoding API error / restricted / network timeout
    }

    const numLat = Number(lat);
    const numLng = Number(lng);

    // Tier 2: OpenStreetMap Nominatim reverse geocoding (accurate street & suburb data)
    try {
        const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${numLat}&lon=${numLng}&zoom=18&addressdetails=1`;
        const nomResp = await fetch(nomUrl, {
            headers: { "User-Agent": "Thulirva/1.0 (contact@thulirva.in)" },
            signal: AbortSignal.timeout(3500)
        });
        if (nomResp.ok) {
            const nomData = await nomResp.json();
            if (nomData && nomData.address) {
                const addr = nomData.address;
                const suburb = addr.suburb || addr.neighbourhood || addr.village || addr.quarter || "";
                const town = addr.town || addr.city_district || addr.county || "";
                const city = addr.city || addr.town || addr.city_district || addr.county || addr.state_district || (addr.state === "Puducherry" ? "Puducherry" : "Tamil Nadu");
                const state = addr.state || "Tamil Nadu";
                const pincode = addr.postcode ? addr.postcode.trim() : "";
                const road = addr.road || addr.residential || addr.path || "";
                const area = suburb || town || city;

                const parts = [road, suburb, town, city, state].filter(Boolean);
                const formatted = parts.join(", ") + (pincode ? ` (PIN: ${pincode})` : "");

                return res.json({
                    success: true,
                    address: formatted || nomData.display_name,
                    street: road || area || "Street Location",
                    area: area,
                    city: city,
                    state: state,
                    pincode: pincode || "600001",
                    latitude: numLat,
                    longitude: numLng,
                    source: "nominatim"
                });
            }
        }
    } catch (_) {}

    // Tier 3: Explicit Tamil Nadu / Pondicherry geographic bounding boxes
    const KNOWN_BOUNDS = [
        { name: "Pondicherry", pincode: "605001", city: "Pondicherry", state: "Puducherry", minLat: 11.850, maxLat: 12.050, minLng: 79.720, maxLng: 79.880 },
        { name: "Padur", pincode: "603103", city: "Chengalpattu / Chennai", state: "Tamil Nadu", minLat: 12.770, maxLat: 12.825, minLng: 80.205, maxLng: 80.245 },
        { name: "Kelambakkam", pincode: "603103", city: "Chengalpattu", state: "Tamil Nadu", minLat: 12.750, maxLat: 12.795, minLng: 80.200, maxLng: 80.240 },
        { name: "Navalur", pincode: "600130", city: "Chennai", state: "Tamil Nadu", minLat: 12.830, maxLat: 12.865, minLng: 80.210, maxLng: 80.245 },
        { name: "Siruseri", pincode: "603103", city: "Chengalpattu", state: "Tamil Nadu", minLat: 12.805, maxLat: 12.835, minLng: 80.200, maxLng: 80.235 },
        { name: "Sholinganallur", pincode: "600119", city: "Chennai", state: "Tamil Nadu", minLat: 12.880, maxLat: 12.920, minLng: 80.210, maxLng: 80.250 },
        { name: "Perungudi", pincode: "600096", city: "Chennai", state: "Tamil Nadu", minLat: 12.945, maxLat: 12.980, minLng: 80.220, maxLng: 80.260 },
        { name: "Velachery", pincode: "600042", city: "Chennai", state: "Tamil Nadu", minLat: 12.965, maxLat: 13.000, minLng: 80.205, maxLng: 80.235 },
        { name: "Adyar", pincode: "600020", city: "Chennai", state: "Tamil Nadu", minLat: 12.985, maxLat: 13.015, minLng: 80.240, maxLng: 80.270 },
        { name: "Besant Nagar", pincode: "600090", city: "Chennai", state: "Tamil Nadu", minLat: 12.990, maxLat: 13.015, minLng: 80.260, maxLng: 80.285 },
        { name: "Guindy", pincode: "600032", city: "Chennai", state: "Tamil Nadu", minLat: 12.995, maxLat: 13.025, minLng: 80.195, maxLng: 80.225 },
        { name: "Saidapet", pincode: "600015", city: "Chennai", state: "Tamil Nadu", minLat: 13.010, maxLat: 13.030, minLng: 80.210, maxLng: 80.235 },
        { name: "T Nagar", pincode: "600017", city: "Chennai", state: "Tamil Nadu", minLat: 13.030, maxLat: 13.055, minLng: 80.220, maxLng: 80.250 },
        { name: "Vadapalani", pincode: "600026", city: "Chennai", state: "Tamil Nadu", minLat: 13.040, maxLat: 13.060, minLng: 80.200, maxLng: 80.225 },
        { name: "KK Nagar", pincode: "600078", city: "Chennai", state: "Tamil Nadu", minLat: 13.030, maxLat: 13.050, minLng: 80.190, maxLng: 80.210 },
        { name: "Porur", pincode: "600116", city: "Chennai", state: "Tamil Nadu", minLat: 13.025, maxLat: 13.050, minLng: 80.145, maxLng: 80.170 },
        { name: "Alapakkam", pincode: "600116", city: "Chennai", state: "Tamil Nadu", minLat: 13.040, maxLat: 13.055, minLng: 80.150, maxLng: 80.170 },
        { name: "Valasaravakkam", pincode: "600087", city: "Chennai", state: "Tamil Nadu", minLat: 13.030, maxLat: 13.050, minLng: 80.160, maxLng: 80.185 },
        { name: "Virugambakkam", pincode: "600092", city: "Chennai", state: "Tamil Nadu", minLat: 13.045, maxLat: 13.065, minLng: 80.180, maxLng: 80.200 },
        { name: "Maduravoyal", pincode: "600095", city: "Chennai", state: "Tamil Nadu", minLat: 13.055, maxLat: 13.075, minLng: 80.155, maxLng: 80.180 },
        { name: "Koyambedu", pincode: "600107", city: "Chennai", state: "Tamil Nadu", minLat: 13.060, maxLat: 13.080, minLng: 80.185, maxLng: 80.210 },
        { name: "Anna Nagar", pincode: "600040", city: "Chennai", state: "Tamil Nadu", minLat: 13.075, maxLat: 13.095, minLng: 80.200, maxLng: 80.225 },
        { name: "Oragadam", pincode: "603109", city: "Chennai / Kanchipuram", state: "Tamil Nadu", minLat: 12.810, maxLat: 12.855, minLng: 79.935, maxLng: 79.975 },
        { name: "Padapai", pincode: "601301", city: "Chennai / Kanchipuram", state: "Tamil Nadu", minLat: 12.880, maxLat: 12.920, minLng: 79.995, maxLng: 80.035 },
        { name: "Sriperumbudur", pincode: "602105", city: "Kanchipuram", state: "Tamil Nadu", minLat: 12.950, maxLat: 12.990, minLng: 79.930, maxLng: 79.970 },
        { name: "Kanchipuram", pincode: "631501", city: "Kanchipuram", state: "Tamil Nadu", minLat: 12.815, maxLat: 12.865, minLng: 79.680, maxLng: 79.730 }
    ];

    for (const b of KNOWN_BOUNDS) {
        if (numLat >= b.minLat && numLat <= b.maxLat && numLng >= b.minLng && numLng <= b.maxLng) {
            return res.json({
                success: true,
                address: `${b.name}, ${b.city}, ${b.state || "Tamil Nadu"} (PIN: ${b.pincode})`,
                street: b.name,
                area: b.name,
                city: b.city,
                state: b.state || "Tamil Nadu",
                pincode: b.pincode,
                latitude: numLat,
                longitude: numLng,
                source: "bounds"
            });
        }
    }

    // Tier 4: Geographic coordinate pin location (never substitute with random nearest serviceable area)
    const isPuducherry = (numLat >= 11.80 && numLat <= 12.10 && numLng >= 79.65 && numLng <= 80.00);
    const regionName = isPuducherry ? "Puducherry" : "Tamil Nadu";
    return res.json({
        success: true,
        address: `Selected Location (${numLat.toFixed(4)}, ${numLng.toFixed(4)})`,
        street: "Selected Pin Location",
        area: regionName,
        city: regionName,
        state: regionName,
        pincode: isPuducherry ? "605001" : "600000",
        latitude: numLat,
        longitude: numLng,
        source: "coordinates"
    });
});

/**
 * GET /api/serviceability/place-details
 * Fetches place details including exact lat/lng for a Google Place ID
 */
router.get("/place-details", async (req, res) => {
    const placeId = (req.query.place_id || req.query.placeId || "").trim();
    if (!placeId) {
        return res.status(400).json({ success: false, message: "Place ID is required" });
    }

    // Check if it's a local area ID
    if (placeId.startsWith("area_")) {
        const areaId = parseInt(placeId.replace("area_", ""), 10);
        const { areas } = await getAllAreas({ includeInactive: true });
        const matched = areas.find(a => a.id === areaId);
        if (matched) {
            return res.json({
                success: true,
                latitude: matched.latitude,
                longitude: matched.longitude,
                formatted_address: `${matched.area_name}, ${matched.city}, Tamil Nadu ${matched.pincode}`,
                area: matched.area_name,
                city: matched.city,
                pincode: matched.pincode
            });
        }
    }

    try {
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry,formatted_address,address_components,name&key=${GOOGLE_MAPS_API_KEY}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(3500) });
        const data = await resp.json();
        if (data && data.result && data.result.geometry && data.result.geometry.location) {
            const loc = data.result.geometry.location;
            let area = "";
            let city = "Chennai";
            let state = "Tamil Nadu";
            let pincode = "";

            (data.result.address_components || []).forEach(comp => {
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
                latitude: loc.lat,
                longitude: loc.lng,
                formatted_address: data.result.formatted_address,
                name: data.result.name,
                area: area || city || data.result.name,
                city,
                state,
                pincode
            });
        }
    } catch (_) {}

    return res.status(404).json({
        success: false,
        message: "Unable to retrieve place details"
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
