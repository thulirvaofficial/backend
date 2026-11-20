const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const DATA_DIR = path.resolve(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "delivery_settings.json");

function getDefaultSettings() {
    return {
        time_selection_enabled: true,
        mode: "standard",
        default_slot_id: "morning",
        slots: [
            {
                id: "morning",
                name: "Morning Delivery",
                start_time: "06:00 AM",
                end_time: "07:00 AM",
                enabled: true,
                display_text: "Morning (6:00 AM – 7:00 AM)"
            },
            {
                id: "evening",
                name: "Evening Delivery",
                start_time: "06:00 PM",
                end_time: "07:00 PM",
                enabled: true,
                display_text: "Evening (6:00 PM – 7:00 PM)"
            }
        ],
        hourly_slots_24x7: [
            { id: "slot_00_01", name: "12:00 AM – 01:00 AM", start_time: "12:00 AM", end_time: "01:00 AM", enabled: true },
            { id: "slot_01_02", name: "01:00 AM – 02:00 AM", start_time: "01:00 AM", end_time: "02:00 AM", enabled: true },
            { id: "slot_02_03", name: "02:00 AM – 03:00 AM", start_time: "02:00 AM", end_time: "03:00 AM", enabled: true },
            { id: "slot_03_04", name: "03:00 AM – 04:00 AM", start_time: "03:00 AM", end_time: "04:00 AM", enabled: true },
            { id: "slot_04_05", name: "04:00 AM – 05:00 AM", start_time: "04:00 AM", end_time: "05:00 AM", enabled: true },
            { id: "slot_05_06", name: "05:00 AM – 06:00 AM", start_time: "05:00 AM", end_time: "06:00 AM", enabled: true },
            { id: "slot_06_07", name: "06:00 AM – 07:00 AM", start_time: "06:00 AM", end_time: "07:00 AM", enabled: true },
            { id: "slot_07_08", name: "07:00 AM – 08:00 AM", start_time: "07:00 AM", end_time: "08:00 AM", enabled: true },
            { id: "slot_08_09", name: "08:00 AM – 09:00 AM", start_time: "08:00 AM", end_time: "09:00 AM", enabled: true },
            { id: "slot_09_10", name: "09:00 AM – 10:00 AM", start_time: "09:00 AM", end_time: "10:00 AM", enabled: true },
            { id: "slot_10_11", name: "10:00 AM – 11:00 AM", start_time: "10:00 AM", end_time: "11:00 AM", enabled: true },
            { id: "slot_11_12", name: "11:00 AM – 12:00 PM", start_time: "11:00 AM", end_time: "12:00 PM", enabled: true },
            { id: "slot_12_13", name: "12:00 PM – 01:00 PM", start_time: "12:00 PM", end_time: "01:00 PM", enabled: true },
            { id: "slot_13_14", name: "01:00 PM – 02:00 PM", start_time: "01:00 PM", end_time: "02:00 PM", enabled: true },
            { id: "slot_14_15", name: "02:00 PM – 03:00 PM", start_time: "02:00 PM", end_time: "03:00 PM", enabled: true },
            { id: "slot_15_16", name: "03:00 PM – 04:00 PM", start_time: "03:00 PM", end_time: "04:00 PM", enabled: true },
            { id: "slot_16_17", name: "04:00 PM – 05:00 PM", start_time: "04:00 PM", end_time: "05:00 PM", enabled: true },
            { id: "slot_17_18", name: "05:00 PM – 06:00 PM", start_time: "05:00 PM", end_time: "06:00 PM", enabled: true },
            { id: "slot_18_19", name: "06:00 PM – 07:00 PM", start_time: "06:00 PM", end_time: "07:00 PM", enabled: true },
            { id: "slot_19_20", name: "07:00 PM – 08:00 PM", start_time: "07:00 PM", end_time: "08:00 PM", enabled: true },
            { id: "slot_20_21", name: "08:00 PM – 09:00 PM", start_time: "08:00 PM", end_time: "09:00 PM", enabled: true },
            { id: "slot_21_22", name: "09:00 PM – 10:00 PM", start_time: "09:00 PM", end_time: "10:00 PM", enabled: true },
            { id: "slot_22_23", name: "10:00 PM – 11:00 PM", start_time: "10:00 PM", end_time: "11:00 PM", enabled: true },
            { id: "slot_23_00", name: "11:00 PM – 12:00 AM", start_time: "11:00 PM", end_time: "12:00 AM", enabled: true }
        ],
        updated_at: new Date().toISOString()
    };
}

function loadSettings() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
            return { ...getDefaultSettings(), ...JSON.parse(data) };
        }
    } catch (e) {
        console.warn("[DELIVERY SETTINGS LOAD WARN]:", e.message);
    }
    const def = getDefaultSettings();
    saveSettings(def);
    return def;
}

function saveSettings(settings) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        settings.updated_at = new Date().toISOString();
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
        return true;
    } catch (e) {
        console.warn("[DELIVERY SETTINGS SAVE WARN]:", e.message);
        return false;
    }
}

// 1. GET /api/delivery-settings (Full settings)
router.get("/delivery-settings", (req, res) => {
    const settings = loadSettings();
    res.json({ success: true, settings });
});

// Alias: GET /api/delivery/settings
router.get("/delivery/settings", (req, res) => {
    const settings = loadSettings();
    res.json({ success: true, settings });
});

// 2. GET /api/delivery-slots (Customer checkout slots)
router.get("/delivery-slots", (req, res) => {
    const settings = loadSettings();
    const isEnabled = settings.time_selection_enabled !== false;
    
    if (!isEnabled) {
        return res.json({
            success: true,
            enabled: false,
            message: "Delivery time selection is disabled by admin",
            slots: []
        });
    }

    let activeSlots = [];
    if (settings.mode === "24x7") {
        activeSlots = (settings.hourly_slots_24x7 || []).filter(s => s.enabled !== false);
    } else {
        activeSlots = (settings.slots || []).filter(s => s.enabled !== false).map(s => ({
            ...s,
            display_text: s.display_text || `${s.name} (${s.start_time} – ${s.end_time})`
        }));
    }

    res.json({
        success: true,
        enabled: true,
        mode: settings.mode || "standard",
        default_slot_id: settings.default_slot_id || (activeSlots[0]?.id || "morning"),
        slots: activeSlots
    });
});

// Alias: GET /api/delivery/slots
router.get("/delivery/slots", (req, res) => {
    const settings = loadSettings();
    const isEnabled = settings.time_selection_enabled !== false;
    
    if (!isEnabled) {
        return res.json({
            success: true,
            enabled: false,
            message: "Delivery time selection is disabled by admin",
            slots: []
        });
    }

    let activeSlots = [];
    if (settings.mode === "24x7") {
        activeSlots = (settings.hourly_slots_24x7 || []).filter(s => s.enabled !== false);
    } else {
        activeSlots = (settings.slots || []).filter(s => s.enabled !== false).map(s => ({
            ...s,
            display_text: s.display_text || `${s.name} (${s.start_time} – ${s.end_time})`
        }));
    }

    res.json({
        success: true,
        enabled: true,
        mode: settings.mode || "standard",
        default_slot_id: settings.default_slot_id || (activeSlots[0]?.id || "morning"),
        slots: activeSlots
    });
});

// 3. PUT /api/admin/delivery-settings (Admin update)
router.put("/admin/delivery-settings", (req, res) => {
    try {
        const cur = loadSettings();
        const incoming = req.body || {};

        const updated = {
            ...cur,
            time_selection_enabled: typeof incoming.time_selection_enabled === "boolean" ? incoming.time_selection_enabled : cur.time_selection_enabled,
            mode: incoming.mode || cur.mode || "standard",
            default_slot_id: incoming.default_slot_id || cur.default_slot_id || "morning",
            slots: Array.isArray(incoming.slots) ? incoming.slots : cur.slots,
            hourly_slots_24x7: Array.isArray(incoming.hourly_slots_24x7) ? incoming.hourly_slots_24x7 : cur.hourly_slots_24x7
        };

        // Recalculate display_text for standard slots if start/end times changed
        if (Array.isArray(updated.slots)) {
            updated.slots = updated.slots.map(s => ({
                ...s,
                display_text: `${s.name} (${s.start_time} – ${s.end_time})`
            }));
        }

        saveSettings(updated);
        console.log("[DELIVERY SETTINGS UPDATED]:", JSON.stringify(updated));
        res.json({
            success: true,
            message: "Delivery settings updated successfully",
            settings: updated
        });
    } catch (e) {
        console.error("[DELIVERY SETTINGS UPDATE ERROR]:", e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// Alias: PUT /api/delivery/admin/settings
router.put("/delivery/admin/settings", (req, res) => {
    try {
        const cur = loadSettings();
        const incoming = req.body || {};

        const updated = {
            ...cur,
            time_selection_enabled: typeof incoming.time_selection_enabled === "boolean" ? incoming.time_selection_enabled : cur.time_selection_enabled,
            mode: incoming.mode || cur.mode || "standard",
            default_slot_id: incoming.default_slot_id || cur.default_slot_id || "morning",
            slots: Array.isArray(incoming.slots) ? incoming.slots : cur.slots,
            hourly_slots_24x7: Array.isArray(incoming.hourly_slots_24x7) ? incoming.hourly_slots_24x7 : cur.hourly_slots_24x7
        };

        if (Array.isArray(updated.slots)) {
            updated.slots = updated.slots.map(s => ({
                ...s,
                display_text: `${s.name} (${s.start_time} – ${s.end_time})`
            }));
        }

        saveSettings(updated);
        res.json({
            success: true,
            message: "Delivery settings updated successfully",
            settings: updated
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = {
    router,
    loadSettings,
    saveSettings
};

