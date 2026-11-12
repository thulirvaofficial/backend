const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const AREAS_FILE = path.join(DATA_DIR, "serviceable_areas.json");

// Default 15 Thulirva Serviceable Areas
const INITIAL_15_AREAS = [
    {
        id: 1,
        area_name: "Oragadam",
        city: "Chennai / Kanchipuram",
        state: "Tamil Nadu",
        pincode: "603109",
        boundary_type: "polygon",
        latitude: 12.8342,
        longitude: 79.9575,
        radius_meters: 5000,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 30,
        minimum_order_amount: 199,
        estimated_delivery_time: "30-45 minutes"
    },
    {
        id: 2,
        area_name: "Padapai",
        city: "Chennai / Kanchipuram",
        state: "Tamil Nadu",
        pincode: "601301",
        boundary_type: "polygon",
        latitude: 12.8988,
        longitude: 80.0152,
        radius_meters: 5000,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 30,
        minimum_order_amount: 199,
        estimated_delivery_time: "35-50 minutes"
    },
    {
        id: 3,
        area_name: "Sriperumbudur",
        city: "Kanchipuram",
        state: "Tamil Nadu",
        pincode: "602105",
        boundary_type: "polygon",
        latitude: 12.9691,
        longitude: 79.9482,
        radius_meters: 6000,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 30,
        minimum_order_amount: 199,
        estimated_delivery_time: "30-45 minutes"
    },
    {
        id: 4,
        area_name: "Valasaravakkam",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600087",
        boundary_type: "polygon",
        latitude: 13.0403,
        longitude: 80.1723,
        radius_meters: 4000,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "25-35 minutes"
    },
    {
        id: 5,
        area_name: "Porur",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600116",
        boundary_type: "polygon",
        latitude: 13.0382,
        longitude: 80.1565,
        radius_meters: 4500,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "25-35 minutes"
    },
    {
        id: 6,
        area_name: "Virugambakkam",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600092",
        boundary_type: "polygon",
        latitude: 13.0537,
        longitude: 80.1916,
        radius_meters: 4000,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "20-30 minutes"
    },
    {
        id: 7,
        area_name: "Vadapalani",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600026",
        boundary_type: "polygon",
        latitude: 13.0500,
        longitude: 80.2121,
        radius_meters: 3500,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "20-30 minutes"
    },
    {
        id: 8,
        area_name: "Koyambedu",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600107",
        boundary_type: "polygon",
        latitude: 13.0694,
        longitude: 80.1948,
        radius_meters: 4000,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "25-35 minutes"
    },
    {
        id: 9,
        area_name: "KK Nagar",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600078",
        boundary_type: "polygon",
        latitude: 13.0410,
        longitude: 80.1994,
        radius_meters: 3500,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "20-30 minutes"
    },
    {
        id: 10,
        area_name: "Alapakkam",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600116",
        boundary_type: "polygon",
        latitude: 13.0475,
        longitude: 80.1601,
        radius_meters: 3500,
        is_serviceable: true,
        is_active: true,
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "25-35 minutes"
    },
    {
        id: 11,
        area_name: "Maduravoyal",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600095",
        boundary_type: "polygon",
        latitude: 13.0637,
        longitude: 80.1661,
        radius_meters: 4000,
        is_serviceable: true,
        is_active: true,
        coverage_status: "active",
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "25-35 minutes"
    },
    {
        id: 12,
        area_name: "Anna Nagar",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600040, 600101, 600102",
        boundary_type: "polygon",
        latitude: 13.0850,
        longitude: 80.2100,
        radius_meters: 4500,
        is_serviceable: false,
        is_active: false,
        coverage_status: "coming_soon",
        delivery_charge: 0,
        minimum_order_amount: 199,
        estimated_delivery_time: "Coming Soon"
    },
    {
        id: 13,
        area_name: "T Nagar",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600017",
        boundary_type: "polygon",
        latitude: 13.0418,
        longitude: 80.2341,
        radius_meters: 4000,
        is_serviceable: false,
        is_active: false,
        coverage_status: "coming_soon",
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "Coming Soon"
    },
    {
        id: 14,
        area_name: "Velachery",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600042",
        boundary_type: "polygon",
        latitude: 12.9800,
        longitude: 80.2200,
        radius_meters: 4500,
        is_serviceable: false,
        is_active: false,
        coverage_status: "coming_soon",
        delivery_charge: 0,
        minimum_order_amount: 149,
        estimated_delivery_time: "Coming Soon"
    },
    {
        id: 15,
        area_name: "Adyar",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600020",
        boundary_type: "polygon",
        latitude: 13.0012,
        longitude: 80.2565,
        radius_meters: 4500,
        is_serviceable: false,
        is_active: false,
        coverage_status: "coming_soon",
        delivery_charge: 0,
        minimum_order_amount: 199,
        estimated_delivery_time: "Coming Soon"
    }
];

// Generate polygonal geofence surrounding a center coordinate (approx 4km polygon with 6 vertices)
function generatePolygonForCenter(lat, lng, delta = 0.035) {
    return [
        { lat: Number((lat + delta).toFixed(6)), lng: Number(lng.toFixed(6)) },
        { lat: Number((lat + delta * 0.5).toFixed(6)), lng: Number((lng + delta * 0.866).toFixed(6)) },
        { lat: Number((lat - delta * 0.5).toFixed(6)), lng: Number((lng + delta * 0.866).toFixed(6)) },
        { lat: Number((lat - delta).toFixed(6)), lng: Number(lng.toFixed(6)) },
        { lat: Number((lat - delta * 0.5).toFixed(6)), lng: Number((lng - delta * 0.866).toFixed(6)) },
        { lat: Number((lat + delta * 0.5).toFixed(6)), lng: Number((lng - delta * 0.866).toFixed(6)) }
    ];
}

// Populate polygon coordinates & standardized fields for all initial areas
INITIAL_15_AREAS.forEach(area => {
    area.location_id = area.id;
    area.country = "India";
    area.delivery_type = "doorstep";
    area.delivery_time = area.estimated_delivery_time;
    if (area.is_active === undefined) area.is_active = true;
    if (area.is_serviceable === undefined) area.is_serviceable = true;
    if (!area.coverage_status) {
        area.coverage_status = area.is_active && area.is_serviceable ? "active" : "coming_soon";
    }
    area.boundary_coordinates = generatePolygonForCenter(area.latitude, area.longitude);
    area.boundary_polygon = area.boundary_coordinates;
    area.created_at = area.created_at || new Date().toISOString();
    area.updated_at = new Date().toISOString();
});

// Load areas from disk or initialize
function loadAreasFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(AREAS_FILE)) {
            const content = fs.readFileSync(AREAS_FILE, "utf-8");
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (err) {
        console.warn("[SERVICEABILITY LOAD WARN]:", err.message);
    }
    saveAreasToDisk(INITIAL_15_AREAS);
    return [...INITIAL_15_AREAS];
}

function saveAreasToDisk(areas) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(AREAS_FILE, JSON.stringify(areas, null, 2), "utf-8");
    } catch (err) {
        console.warn("[SERVICEABILITY SAVE WARN]:", err.message);
    }
}

let MEMORY_AREAS = loadAreasFromDisk();

/* ============================================================
   GEOSPATIAL HELPER FUNCTIONS
============================================================ */

/**
 * Standard Ray-Casting algorithm for point-in-polygon testing
 * @param {[number, number]} point [lat, lng]
 * @param {Array<{lat: number, lng: number}>} vs
 */
function pointInPolygon(point, vs) {
    if (!vs || !Array.isArray(vs) || vs.length < 3) return false;
    const x = Number(point[0]);
    const y = Number(point[1]);
    let inside = false;

    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = Number(vs[i].lat ?? vs[i][0]);
        const yi = Number(vs[i].lng ?? vs[i][1]);
        const xj = Number(vs[j].lat ?? vs[j][0]);
        const yj = Number(vs[j].lng ?? vs[j][1]);

        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Haversine formula to calculate great-circle distance between two points in meters
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Clean and normalize pincode string for comparison
 */
function matchPincode(targetPin, areaPincodes) {
    if (!targetPin || !areaPincodes) return false;
    const targetClean = String(targetPin).trim().replace(/\D/g, "");
    if (!targetClean) return false;

    const tokens = String(areaPincodes).split(/[,|\s]+/).map(p => p.trim().replace(/\D/g, ""));
    return tokens.includes(targetClean);
}

/* ============================================================
   SERVICEABILITY CORE METHODS
============================================================ */

/**
 * Fetch all areas from database or memory
 */
async function getAllAreas({ includeInactive = true } = {}) {
    try {
        let sql = "SELECT * FROM serviceable_areas";
        if (!includeInactive) {
            sql += " WHERE is_active = true AND is_serviceable = true";
        }
        sql += " ORDER BY area_name ASC";
        const result = await pool.query(sql);
        if (result.rows && result.rows.length > 0) {
            const areas = result.rows.map(r => ({
                id: r.id,
                area_name: r.area_name,
                city: r.city,
                state: r.state,
                pincode: r.pincode,
                boundary_type: r.boundary_type,
                boundary_coordinates: typeof r.boundary_coordinates === "string" ? JSON.parse(r.boundary_coordinates) : r.boundary_coordinates,
                latitude: Number(r.latitude),
                longitude: Number(r.longitude),
                radius_meters: Number(r.radius_meters || 5000),
                is_serviceable: r.is_serviceable,
                is_active: r.is_active,
                delivery_charge: Number(r.delivery_charge || 0),
                minimum_order_amount: Number(r.minimum_order_amount || 0),
                estimated_delivery_time: r.estimated_delivery_time,
                created_at: r.created_at,
                updated_at: r.updated_at
            }));

            const active = areas.filter(a => a.is_active && a.is_serviceable).length;
            const inactive = areas.length - active;

            return {
                total: areas.length,
                active,
                inactive,
                areas
            };
        }
    } catch (_) {}

    // Fallback to memory
    let list = [...MEMORY_AREAS];
    if (!includeInactive) {
        list = list.filter(a => a.is_active && a.is_serviceable);
    }
    const activeCount = MEMORY_AREAS.filter(a => a.is_active && a.is_serviceable).length;
    const inactiveCount = MEMORY_AREAS.length - activeCount;

    return {
        total: MEMORY_AREAS.length,
        active: activeCount,
        inactive: inactiveCount,
        areas: list
    };
}

/**
 * Check serviceability for coordinates and/or pincode
 */
async function checkServiceability({ latitude, longitude, pincode }) {
    const lat = latitude !== undefined && latitude !== null && latitude !== "" ? Number(latitude) : null;
    const lng = longitude !== undefined && longitude !== null && longitude !== "" ? Number(longitude) : null;
    const pin = pincode ? String(pincode).trim() : null;

    if (lat === null && lng === null && !pin) {
        return {
            success: true,
            serviceable: false,
            message: "Please provide coordinates or pincode to check serviceability",
            area: null
        };
    }

    const { areas } = await getAllAreas({ includeInactive: false });

    let matchedArea = null;
    let matchType = null;

    // 1. Polygon / Geofence Check (Highest Precision)
    if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        for (const area of areas) {
            if (area.boundary_coordinates && Array.isArray(area.boundary_coordinates) && area.boundary_coordinates.length >= 3) {
                if (pointInPolygon([lat, lng], area.boundary_coordinates)) {
                    matchedArea = area;
                    matchType = "polygon";
                    break;
                }
            }
        }

        // 2. Radius Check (if not matched by polygon)
        if (!matchedArea) {
            for (const area of areas) {
                if (area.latitude && area.longitude) {
                    const dist = haversineDistanceMeters(lat, lng, area.latitude, area.longitude);
                    const allowedRadius = area.radius_meters || 5000;
                    if (dist <= allowedRadius) {
                        matchedArea = area;
                        matchType = "radius";
                        break;
                    }
                }
            }
        }
    }

    // 3. Pincode Check (Fallback if no coordinate match or if coordinates are outside)
    if (!matchedArea && pin) {
        for (const area of areas) {
            if (matchPincode(pin, area.pincode)) {
                matchedArea = area;
                matchType = "pincode";
                break;
            }
        }
    }

    if (matchedArea) {
        return {
            success: true,
            serviceable: true,
            matchType,
            message: "Available for Delivery",
            area: {
                id: matchedArea.id,
                name: matchedArea.area_name,
                city: matchedArea.city,
                state: matchedArea.state,
                pincode: matchedArea.pincode,
                deliveryCharge: matchedArea.delivery_charge,
                minimumOrderAmount: matchedArea.minimum_order_amount,
                estimatedDeliveryTime: matchedArea.estimated_delivery_time,
                latitude: matchedArea.latitude,
                longitude: matchedArea.longitude
            }
        };
    }

    return {
        success: true,
        serviceable: false,
        message: "Sorry! Thulirva is not available in your area yet. We're working hard to bring fresh dairy products to your doorstep.",
        area: null
    };
}

/**
 * Create a new serviceable area
 */
async function createArea(data) {
    const {
        area_name,
        city = "Chennai",
        state = "Tamil Nadu",
        pincode,
        boundary_type = "polygon",
        boundary_coordinates,
        latitude,
        longitude,
        radius_meters = 5000,
        is_serviceable = true,
        is_active = true,
        delivery_charge = 0,
        minimum_order_amount = 0,
        estimated_delivery_time = "30-45 minutes"
    } = data;

    if (!area_name || !pincode) {
        throw new Error("Area name and PIN code are required");
    }

    const lat = Number(latitude || 13.0827);
    const lng = Number(longitude || 80.2707);
    const coords = boundary_coordinates && Array.isArray(boundary_coordinates) && boundary_coordinates.length >= 3
        ? boundary_coordinates
        : generatePolygonForCenter(lat, lng);

    try {
        const result = await pool.query(`
            INSERT INTO serviceable_areas (
                area_name, city, state, pincode, boundary_type, boundary_coordinates,
                latitude, longitude, radius_meters, is_serviceable, is_active,
                delivery_charge, minimum_order_amount, estimated_delivery_time
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `, [
            area_name, city, state, pincode, boundary_type, JSON.stringify(coords),
            lat, lng, radius_meters, Boolean(is_serviceable), Boolean(is_active),
            Number(delivery_charge), Number(minimum_order_amount), estimated_delivery_time
        ]);

        if (result.rows.length) {
            const newArea = result.rows[0];
            MEMORY_AREAS.push(newArea);
            saveAreasToDisk(MEMORY_AREAS);
            return newArea;
        }
    } catch (err) {
        console.warn("[SERVICEABILITY DB INSERT WARN]:", err.message);
    }

    const newId = MEMORY_AREAS.length ? Math.max(...MEMORY_AREAS.map(a => Number(a.id) || 0)) + 1 : 1;
    const newArea = {
        id: newId,
        area_name,
        city,
        state,
        pincode,
        boundary_type,
        boundary_coordinates: coords,
        latitude: lat,
        longitude: lng,
        radius_meters,
        is_serviceable: Boolean(is_serviceable),
        is_active: Boolean(is_active),
        delivery_charge: Number(delivery_charge),
        minimum_order_amount: Number(minimum_order_amount),
        estimated_delivery_time,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    MEMORY_AREAS.push(newArea);
    saveAreasToDisk(MEMORY_AREAS);
    return newArea;
}

/**
 * Update existing area
 */
async function updateArea(id, data) {
    const numericId = parseInt(id, 10);
    const existing = MEMORY_AREAS.find(a => a.id === numericId);

    const lat = data.latitude !== undefined ? Number(data.latitude) : (existing ? existing.latitude : 13.0827);
    const lng = data.longitude !== undefined ? Number(data.longitude) : (existing ? existing.longitude : 80.2707);

    const coords = data.boundary_coordinates && Array.isArray(data.boundary_coordinates) && data.boundary_coordinates.length >= 3
        ? data.boundary_coordinates
        : (data.latitude || data.longitude ? generatePolygonForCenter(lat, lng) : (existing ? existing.boundary_coordinates : generatePolygonForCenter(lat, lng)));

    try {
        await pool.query(`
            UPDATE serviceable_areas
            SET area_name = COALESCE($1, area_name),
                city = COALESCE($2, city),
                state = COALESCE($3, state),
                pincode = COALESCE($4, pincode),
                boundary_type = COALESCE($5, boundary_type),
                boundary_coordinates = COALESCE($6, boundary_coordinates),
                latitude = COALESCE($7, latitude),
                longitude = COALESCE($8, longitude),
                radius_meters = COALESCE($9, radius_meters),
                is_serviceable = COALESCE($10, is_serviceable),
                is_active = COALESCE($11, is_active),
                delivery_charge = COALESCE($12, delivery_charge),
                minimum_order_amount = COALESCE($13, minimum_order_amount),
                estimated_delivery_time = COALESCE($14, estimated_delivery_time),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $15
        `, [
            data.area_name,
            data.city,
            data.state,
            data.pincode,
            data.boundary_type,
            coords ? JSON.stringify(coords) : null,
            data.latitude !== undefined ? Number(data.latitude) : null,
            data.longitude !== undefined ? Number(data.longitude) : null,
            data.radius_meters !== undefined ? Number(data.radius_meters) : null,
            data.is_serviceable !== undefined ? Boolean(data.is_serviceable) : null,
            data.is_active !== undefined ? Boolean(data.is_active) : null,
            data.delivery_charge !== undefined ? Number(data.delivery_charge) : null,
            data.minimum_order_amount !== undefined ? Number(data.minimum_order_amount) : null,
            data.estimated_delivery_time,
            numericId
        ]);
    } catch (_) {}

    if (existing) {
        Object.assign(existing, {
            ...data,
            id: numericId,
            boundary_coordinates: coords,
            latitude: lat,
            longitude: lng,
            updated_at: new Date().toISOString()
        });
        saveAreasToDisk(MEMORY_AREAS);
        return existing;
    }
    return null;
}

/**
 * Toggle active/inactive status
 */
async function toggleAreaStatus(id, isActive) {
    const numericId = parseInt(id, 10);
    const activeBool = Boolean(isActive);

    try {
        await pool.query(`
            UPDATE serviceable_areas
            SET is_active = $1, is_serviceable = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [activeBool, numericId]);
    } catch (_) {}

    const area = MEMORY_AREAS.find(a => a.id === numericId);
    if (area) {
        area.is_active = activeBool;
        area.is_serviceable = activeBool;
        area.updated_at = new Date().toISOString();
        saveAreasToDisk(MEMORY_AREAS);
        return area;
    }
    return null;
}

/**
 * Soft delete area (deactivate to preserve historical records)
 */
async function deleteArea(id) {
    const numericId = parseInt(id, 10);
    try {
        // Soft deactivation to protect order and subscription foreign key references
        await pool.query(`
            UPDATE serviceable_areas
            SET is_active = false, is_serviceable = false, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [numericId]);
    } catch (_) {}

    const idx = MEMORY_AREAS.findIndex(a => a.id === numericId);
    if (idx !== -1) {
        MEMORY_AREAS[idx].is_active = false;
        MEMORY_AREAS[idx].is_serviceable = false;
        saveAreasToDisk(MEMORY_AREAS);
        return true;
    }
    return false;
}

module.exports = {
    getAllAreas,
    checkServiceability,
    createArea,
    updateArea,
    toggleAreaStatus,
    deleteArea,
    pointInPolygon,
    haversineDistanceMeters
};

