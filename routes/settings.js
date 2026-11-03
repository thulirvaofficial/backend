const express = require("express");
const { pool } = require("../config/database");

const router = express.Router();

let STORE_SETTINGS = {
    pickup_mode: false,
    store_name: "THULIRVA Farm Store",
    store_address: "No 1, Mayana Salai, Thimmarajampettai, Kanchipuram - 631601, Tamil Nadu",
    store_phone: "+91 93606 71533",
    store_timings: "7:00 AM - 8:00 PM (All 7 Days)",
    pickup_instructions: "Please show your order ID or registered mobile number at the store counter.",
    updated_at: new Date().toISOString()
};

// Initialize settings table if needed
async function ensureSettingsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS store_settings (
                key VARCHAR(100) PRIMARY KEY,
                value JSONB,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        const res = await pool.query("SELECT value FROM store_settings WHERE key = 'store_config'");
        if (res.rows.length > 0 && res.rows[0].value) {
            STORE_SETTINGS = { ...STORE_SETTINGS, ...res.rows[0].value };
        }
    } catch {
        // Table create failed or DB offline, using in-memory store
    }
}
ensureSettingsTable();

/* GET STORE SETTINGS */
router.get("/store", async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM store_settings WHERE key = 'store_config'");
        if (result.rows.length > 0 && result.rows[0].value) {
            return res.json({ success: true, settings: result.rows[0].value });
        }
    } catch {
        // DB offline fallback
    }
    res.json({ success: true, settings: STORE_SETTINGS });
});

/* UPDATE STORE SETTINGS (PICKUP MODE TOGGLE) */
router.post("/store", async (req, res) => {
    try {
        const { pickup_mode, store_address, store_timings } = req.body;

        if (pickup_mode !== undefined) {
            STORE_SETTINGS.pickup_mode = Boolean(pickup_mode);
        }
        if (store_address) {
            STORE_SETTINGS.store_address = store_address;
        }
        if (store_timings) {
            STORE_SETTINGS.store_timings = store_timings;
        }
        STORE_SETTINGS.updated_at = new Date().toISOString();

        try {
            await pool.query(`
                INSERT INTO store_settings (key, value, updated_at)
                VALUES ('store_config', $1, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE
                SET value = $1, updated_at = CURRENT_TIMESTAMP
            `, [JSON.stringify(STORE_SETTINGS)]);
        } catch {
            // DB offline fallback
        }

        res.json({
            success: true,
            message: `Store Pickup Mode is now ${STORE_SETTINGS.pickup_mode ? 'ACTIVATED (Pickup Orders Only)' : 'DEACTIVATED (Normal Delivery)'}`,
            settings: STORE_SETTINGS
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
