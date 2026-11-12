const express = require("express");
const {
    getAllAreas,
    createArea,
    updateArea,
    toggleAreaStatus,
    deleteArea
} = require("../services/serviceabilityService");
const { emitToAdmin } = require("../services/socketService");

const router = express.Router();

/**
 * Format a serviceable area model into the delivery location representation
 * for web checkout and admin compatibility.
 */
function formatLocation(a) {
    const isActive = Boolean(a.is_active && a.is_serviceable);
    return {
        id: a.id,
        name: a.area_name,
        area_name: a.area_name,
        pincode: a.pincode,
        city: a.city,
        state: a.state,
        country: a.country || "India",
        latitude: a.latitude,
        longitude: a.longitude,
        status: isActive ? "active" : "inactive",
        is_active: a.is_active,
        is_serviceable: a.is_serviceable,
        coverage_status: a.coverage_status || (isActive ? "active" : "coming_soon"),
        delivery_charge: a.delivery_charge || 0,
        minimum_order_amount: a.minimum_order_amount || 0,
        estimated_delivery_time: a.estimated_delivery_time || "Early Morning (5:30 - 7:30 AM)",
        delivery_time: a.delivery_time || a.estimated_delivery_time || "Early Morning (5:30 - 7:30 AM)",
        boundary_coordinates: a.boundary_coordinates,
        created_at: a.created_at,
        updated_at: a.updated_at
    };
}

/* GET ALL DELIVERY LOCATIONS (Unified with central serviceability service) */
router.get("/", async (req, res) => {
    try {
        const { areas } = await getAllAreas({ includeInactive: true });
        let locations = areas.map(formatLocation);

        if (req.query.active_only === "true") {
            locations = locations.filter(l => l.status === "active");
        }

        return res.json({
            success: true,
            total: locations.length,
            active_count: locations.filter(l => l.status === "active").length,
            locations
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* GET ACTIVE LOCATIONS ONLY */
router.get("/active", async (req, res) => {
    try {
        const { areas } = await getAllAreas({ includeInactive: false });
        const locations = areas.map(formatLocation);
        return res.json({
            success: true,
            count: locations.length,
            locations
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ADD NEW DELIVERY LOCATION (Admin) */
router.post("/", async (req, res) => {
    const { name, area_name, pincode, status, city, state, latitude, longitude } = req.body;
    const cleanName = (name || area_name || "").trim();

    if (!cleanName) {
        return res.status(400).json({ success: false, message: "Location name is required." });
    }

    try {
        const isActive = status ? status === "active" : true;
        const newArea = await createArea({
            area_name: cleanName,
            pincode: (pincode || "").trim(),
            city: city || "Chennai",
            state: state || "Tamil Nadu",
            latitude: latitude ? Number(latitude) : 13.0827,
            longitude: longitude ? Number(longitude) : 80.2707,
            is_active: isActive,
            is_serviceable: isActive,
            coverage_status: isActive ? "active" : "coming_soon"
        });

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("serviceable_area:update", { action: "create", area: newArea });
            }
        } catch (_) {}

        const loc = formatLocation(newArea);
        return res.json({ success: true, location: loc, message: "Delivery location added successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* UPDATE DELIVERY LOCATION (Admin) */
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const { name, area_name, pincode, status, city, state, latitude, longitude } = req.body;

    try {
        const updateData = {};
        if (name || area_name) updateData.area_name = (name || area_name).trim();
        if (pincode !== undefined) updateData.pincode = pincode.trim();
        if (city) updateData.city = city.trim();
        if (state) updateData.state = state.trim();
        if (latitude !== undefined) updateData.latitude = Number(latitude);
        if (longitude !== undefined) updateData.longitude = Number(longitude);
        if (status !== undefined) {
            updateData.is_active = status === "active";
            updateData.is_serviceable = status === "active";
            updateData.coverage_status = status === "active" ? "active" : "coming_soon";
        }

        const updated = await updateArea(id, updateData);
        if (!updated) {
            return res.status(404).json({ success: false, message: "Delivery location not found" });
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("serviceable_area:update", { action: "update", id, area: updated });
            }
        } catch (_) {}

        return res.json({ success: true, message: "Delivery location updated", location: formatLocation(updated) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* TOGGLE LOCATION ACTIVE / PAUSED STATUS (Admin) */
const toggleStatusRoute = async (req, res) => {
    const id = req.params.id;
    try {
        const updated = await toggleAreaStatus(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: "Delivery location not found" });
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("serviceable_area:update", { action: "toggle", id, area: updated });
            }
        } catch (_) {}

        return res.json({
            success: true,
            status: updated.is_active ? "active" : "inactive",
            message: `Location is now ${updated.is_active ? "Active" : "Paused"}`,
            location: formatLocation(updated)
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.patch("/:id/toggle", toggleStatusRoute);
router.put("/:id/toggle", toggleStatusRoute);

/* DELETE DELIVERY LOCATION (Admin - Soft Deactivation) */
router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    try {
        const ok = await deleteArea(id);
        if (!ok) {
            return res.status(404).json({ success: false, message: "Delivery location not found" });
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("serviceable_area:update", { action: "delete", id });
            }
        } catch (_) {}

        return res.json({ success: true, message: "Delivery location deactivated successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
