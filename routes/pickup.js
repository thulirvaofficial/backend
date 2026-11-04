const express = require("express");
const { pool } = require("../config/database");

const router = express.Router();

let IN_MEMORY_PICKUP_SETTINGS = {
    pickup_enabled: true,
    instructions: "Collect your packed farm fresh order directly from your selected THULIRVA pickup store."
};

let IN_MEMORY_STORES = [
    {
        id: 1,
        name: "Thulirva Main Branch",
        address: "No 1, Mayana Salai, Thimmarajampettai",
        city: "Kanchipuram",
        pincode: "631601",
        phone: "+91 93606 71533",
        timings: "7:00 AM - 8:00 PM (All 7 Days)",
        instructions: "Show your Order ID at the main dairy dispatch counter.",
        status: "active"
    },
    {
        id: 2,
        name: "Thulirva Anna Nagar",
        address: "Plot 42, 2nd Avenue, Near Roundtana, Anna Nagar",
        city: "Chennai",
        pincode: "600040",
        phone: "+91 79048 80944",
        timings: "6:30 AM - 9:00 PM (All 7 Days)",
        instructions: "Collect fresh morning & evening batches from customer service desk.",
        status: "active"
    },
    {
        id: 3,
        name: "Thulirva Velachery",
        address: "No 18, Velachery Main Road, Near Vijaya Nagar Bus Stand",
        city: "Chennai",
        pincode: "600042",
        phone: "+91 79048 80944",
        timings: "6:30 AM - 9:00 PM (All 7 Days)",
        instructions: "Express collection counter available for pre-packed orders.",
        status: "active"
    }
];

const DEFAULT_SLOTS = [
    { id: 1, slot_time: "7:00 AM - 9:00 AM", capacity: 30, is_active: true },
    { id: 2, slot_time: "9:00 AM - 12:00 PM", capacity: 30, is_active: true },
    { id: 3, slot_time: "12:00 PM - 3:00 PM", capacity: 30, is_active: true },
    { id: 4, slot_time: "3:00 PM - 6:00 PM", capacity: 30, is_active: true },
    { id: 5, slot_time: "6:00 PM - 8:00 PM", capacity: 30, is_active: true }
];

/* ============================================================
   1. PICKUP SETTINGS (GLOBAL TOGGLE)
============================================================ */
router.get("/settings", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM pickup_settings ORDER BY id ASC LIMIT 1");
        if (result.rows.length > 0) {
            return res.json({ success: true, settings: result.rows[0] });
        }
    } catch {}
    res.json({ success: true, settings: IN_MEMORY_PICKUP_SETTINGS });
});

router.post("/settings", async (req, res) => {
    const { pickup_enabled, instructions } = req.body;
    const isEnabled = Boolean(pickup_enabled !== undefined ? pickup_enabled : true);

    try {
        await pool.query(
            `UPDATE pickup_settings 
             SET pickup_enabled = $1, instructions = COALESCE($2, instructions), updated_at = CURRENT_TIMESTAMP
             WHERE id = (SELECT id FROM pickup_settings ORDER BY id ASC LIMIT 1)`,
            [isEnabled, instructions || null]
        );
    } catch {}

    IN_MEMORY_PICKUP_SETTINGS.pickup_enabled = isEnabled;
    if (instructions) IN_MEMORY_PICKUP_SETTINGS.instructions = instructions;

    res.json({
        success: true,
        message: isEnabled ? "Store Pickup mode enabled" : "Store Pickup mode disabled",
        settings: IN_MEMORY_PICKUP_SETTINGS
    });
});

/* ============================================================
   2. STORES / LOCATIONS (CUSTOMER & ADMIN)
============================================================ */
router.get("/locations", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM pickup_locations WHERE status = 'active' ORDER BY id ASC");
        if (result.rows.length > 0) {
            return res.json({ success: true, locations: result.rows });
        }
    } catch {}
    const active = IN_MEMORY_STORES.filter(s => s.status === 'active');
    res.json({ success: true, locations: active });
});

router.get("/stores", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM pickup_locations ORDER BY id ASC");
        if (result.rows.length > 0) {
            return res.json({ success: true, stores: result.rows });
        }
    } catch {}
    res.json({ success: true, stores: IN_MEMORY_STORES });
});

router.post("/stores", async (req, res) => {
    try {
        const { name, address, city, pincode, phone, timings, instructions, status } = req.body;
        if (!name || !address) {
            return res.status(400).json({ success: false, message: "Store name and address are required" });
        }

        try {
            const result = await pool.query(
                `INSERT INTO pickup_locations (name, address, city, pincode, phone, timings, instructions, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [name, address, city || 'Kanchipuram', pincode || '631601', phone || '+91 79048 80944', timings || '7:00 AM - 8:00 PM', instructions || '', status || 'active']
            );
            return res.json({ success: true, store: result.rows[0] });
        } catch {
            const newId = IN_MEMORY_STORES.length ? Math.max(...IN_MEMORY_STORES.map(s => s.id)) + 1 : 1;
            const newStore = {
                id: newId,
                name,
                address,
                city: city || 'Kanchipuram',
                pincode: pincode || '631601',
                phone: phone || '+91 79048 80944',
                timings: timings || '7:00 AM - 8:00 PM',
                instructions: instructions || '',
                status: status || 'active'
            };
            IN_MEMORY_STORES.push(newStore);
            return res.json({ success: true, store: newStore });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put("/stores/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const { name, address, city, pincode, phone, timings, instructions, status } = req.body;

    try {
        const result = await pool.query(
            `UPDATE pickup_locations SET
                name = COALESCE($1, name),
                address = COALESCE($2, address),
                city = COALESCE($3, city),
                pincode = COALESCE($4, pincode),
                phone = COALESCE($5, phone),
                timings = COALESCE($6, timings),
                instructions = COALESCE($7, instructions),
                status = COALESCE($8, status)
             WHERE id = $9 RETURNING *`,
            [name, address, city, pincode, phone, timings, instructions, status, id]
        );
        if (result.rows.length) return res.json({ success: true, store: result.rows[0] });
    } catch {}

    const idx = IN_MEMORY_STORES.findIndex(s => s.id === id);
    if (idx !== -1) {
        IN_MEMORY_STORES[idx] = { ...IN_MEMORY_STORES[idx], ...req.body };
        return res.json({ success: true, store: IN_MEMORY_STORES[idx] });
    }

    res.json({ success: true, message: "Store updated" });
});

router.delete("/stores/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query("DELETE FROM pickup_locations WHERE id = $1", [id]);
    } catch {}
    IN_MEMORY_STORES = IN_MEMORY_STORES.filter(s => s.id !== id);
    res.json({ success: true, message: "Store removed" });
});

router.put("/stores/:id/toggle", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const current = await pool.query("SELECT status FROM pickup_locations WHERE id = $1", [id]);
        if (current.rows.length) {
            const newStatus = current.rows[0].status === 'active' ? 'inactive' : 'active';
            const updated = await pool.query(
                "UPDATE pickup_locations SET status = $1 WHERE id = $2 RETURNING *",
                [newStatus, id]
            );
            return res.json({ success: true, store: updated.rows[0] });
        }
    } catch {}

    const store = IN_MEMORY_STORES.find(s => s.id === id);
    if (store) {
        store.status = store.status === 'active' ? 'inactive' : 'active';
        return res.json({ success: true, store });
    }

    res.status(404).json({ success: false, message: "Store not found" });
});

/* ============================================================
   3. TIME SLOTS
============================================================ */
router.get("/slots", async (req, res) => {
    const locId = parseInt(req.query.location_id || 1);
    try {
        const result = await pool.query(
            "SELECT * FROM pickup_time_slots WHERE location_id = $1 AND is_active = true ORDER BY id ASC",
            [locId]
        );
        if (result.rows.length > 0) {
            return res.json({ success: true, slots: result.rows });
        }
    } catch {}
    res.json({ success: true, slots: DEFAULT_SLOTS });
});

module.exports = router;
