const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const BIZ_CONFIG_FILE = path.join(DATA_DIR, "business_configuration.json");
const QR_CONFIG_FILE = path.join(DATA_DIR, "payment_qr_config.json");
const QR_HISTORY_FILE = path.join(DATA_DIR, "payment_qr_history.json");
const SEC_CREDS_FILE = path.join(DATA_DIR, "admin_security_credentials.json");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Default initial delivery & business configuration
const DEFAULT_CONFIG = {
    id: "main",
    delivery_charges_enabled: true,
    fixed_delivery_charge: 30.0,
    free_delivery_threshold: 299.0,
    min_order_value_for_delivery: 150.0,
    partner_base_payout: 35.0,
    partner_distance_bonus_per_km: 6.0,
    distance_charges_enabled: false,
    distance_base_km: 5.0,
    distance_rate_per_km: 10.0,
    zone_charges: {
        "Padur": 20.0,
        "Navalur": 30.0,
        "Siruseri": 30.0,
        "Kelambakkam": 40.0
    },
    delivery_mode: "morning_evening", // morning | evening | morning_evening | always_24x7 | temporarily_disabled
    morning_start_time: "06:00 AM",
    morning_end_time: "10:00 AM",
    evening_start_time: "04:00 PM",
    evening_end_time: "08:00 PM",
    holidays: [],
    closure_reason: "Deliveries are temporarily paused for maintenance.",
    geofence_radius_meters: 100,
    geofence_notifications_enabled: true,
    geofence_alert_title: "Your Thulirva Delivery Partner Has Arrived!",
    geofence_alert_message: "Your Thulirva delivery partner has arrived near your location!",
    delivery_launch_date: "2026-11-25",
    advance_ordering_enabled: true,
    first_delivery_date: "2026-11-25",
    zone_launch_dates: {},
    launch_banner_enabled: true,
    launch_banner_headline: "Freshness delivered to your doorstep! Order now.",
    launch_banner_subtitle: "Pure organic milk and farm-fresh essentials.",
    launch_banner_bg_color: "#1B4332",
    launch_banner_image_url: "",
    zone_banners: {},
    updated_at: new Date().toISOString(),
    updated_by: "Super Admin"
};

// Initial QR configuration
const DEFAULT_QR_CONFIG = {
    id: 1,
    upi_id: "7904880944@superyes",
    merchant_name: "THULIRVA ORGANICS",
    qr_image_url: "/api/uploads/payments/payment_qr_v1.jpg",
    is_active: true,
    version: 1,
    notes: "Official Thulirva Merchant QR",
    created_by: "Super Admin",
    created_at: new Date().toISOString()
};

// Default QR Security Password: "Thulirva@QR2026"
const DEFAULT_QR_PASSWORD_HASH = bcrypt.hashSync("Thulirva@QR2026", 10);

/* =========================================================================
   DISK STORE LOAD & SAVE HELPERS
========================================================================= */

function loadConfigFromDisk() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(BIZ_CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(BIZ_CONFIG_FILE, "utf-8"));
            return { ...DEFAULT_CONFIG, ...data };
        }
    } catch (_) {}
    saveConfigToDisk(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
}

function saveConfigToDisk(cfg) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(BIZ_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
    } catch (_) {}
}

function loadQrConfigFromDisk() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(QR_CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(QR_CONFIG_FILE, "utf-8"));
            return { ...DEFAULT_QR_CONFIG, ...data };
        }
    } catch (_) {}
    saveQrConfigToDisk(DEFAULT_QR_CONFIG);
    return { ...DEFAULT_QR_CONFIG };
}

function saveQrConfigToDisk(qr) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(QR_CONFIG_FILE, JSON.stringify(qr, null, 2), "utf-8");
    } catch (_) {}
}

function loadQrHistoryFromDisk() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(QR_HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(QR_HISTORY_FILE, "utf-8"));
        }
    } catch (_) {}
    const initial = [{ ...DEFAULT_QR_CONFIG }];
    try {
        fs.writeFileSync(QR_HISTORY_FILE, JSON.stringify(initial, null, 2), "utf-8");
    } catch (_) {}
    return initial;
}

function saveQrHistoryToDisk(history) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(QR_HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
    } catch (_) {}
}

function loadSecCredsFromDisk() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(SEC_CREDS_FILE)) {
            return JSON.parse(fs.readFileSync(SEC_CREDS_FILE, "utf-8"));
        }
    } catch (_) {}
    const initial = {
        credential_type: "payment_qr_security",
        password_hash: DEFAULT_QR_PASSWORD_HASH,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
        updated_by: "Super Admin"
    };
    try {
        fs.writeFileSync(SEC_CREDS_FILE, JSON.stringify(initial, null, 2), "utf-8");
    } catch (_) {}
    return initial;
}

function saveSecCredsToDisk(creds) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(SEC_CREDS_FILE, JSON.stringify(creds, null, 2), "utf-8");
    } catch (_) {}
}

/* =========================================================================
   1. DELIVERY & BUSINESS CONFIGURATION APIs
========================================================================= */

async function getDeliveryConfig() {
    try {
        const res = await pool.query("SELECT * FROM business_configurations WHERE id = 'main' LIMIT 1");
        if (res.rows.length > 0) {
            const dbRow = res.rows[0];
            const merged = {
                ...DEFAULT_CONFIG,
                ...dbRow,
                fixed_delivery_charge: Number(dbRow.fixed_delivery_charge ?? DEFAULT_CONFIG.fixed_delivery_charge),
                free_delivery_threshold: Number(dbRow.free_delivery_threshold ?? DEFAULT_CONFIG.free_delivery_threshold),
                distance_base_km: Number(dbRow.distance_base_km ?? DEFAULT_CONFIG.distance_base_km),
                distance_rate_per_km: Number(dbRow.distance_rate_per_km ?? DEFAULT_CONFIG.distance_rate_per_km),
                geofence_radius_meters: Number(dbRow.geofence_radius_meters ?? DEFAULT_CONFIG.geofence_radius_meters)
            };
            saveConfigToDisk(merged);
            return merged;
        }
    } catch (_) {}
    return loadConfigFromDisk();
}

async function updateDeliveryConfig(updates = {}, adminName = "Super Admin") {
    const current = await getDeliveryConfig();
    const merged = {
        ...current,
        ...updates,
        updated_at: new Date().toISOString(),
        updated_by: adminName
    };

    // Coerce numeric values
    if (merged.fixed_delivery_charge !== undefined) merged.fixed_delivery_charge = Number(merged.fixed_delivery_charge);
    if (merged.free_delivery_threshold !== undefined) merged.free_delivery_threshold = Number(merged.free_delivery_threshold);
    if (merged.min_order_value_for_delivery !== undefined) merged.min_order_value_for_delivery = Number(merged.min_order_value_for_delivery);
    if (merged.partner_base_payout !== undefined) merged.partner_base_payout = Number(merged.partner_base_payout);
    if (merged.partner_distance_bonus_per_km !== undefined) merged.partner_distance_bonus_per_km = Number(merged.partner_distance_bonus_per_km);
    if (merged.distance_base_km !== undefined) merged.distance_base_km = Number(merged.distance_base_km);
    if (merged.distance_rate_per_km !== undefined) merged.distance_rate_per_km = Number(merged.distance_rate_per_km);
    if (merged.geofence_radius_meters !== undefined) merged.geofence_radius_meters = Number(merged.geofence_radius_meters);

    saveConfigToDisk(merged);

    try {
        await pool.query(`
            INSERT INTO business_configurations (
                id, delivery_charges_enabled, fixed_delivery_charge, free_delivery_threshold,
                distance_charges_enabled, distance_base_km, distance_rate_per_km, zone_charges,
                delivery_mode, morning_start_time, morning_end_time, evening_start_time, evening_end_time,
                holidays, closure_reason, geofence_radius_meters, geofence_notifications_enabled,
                geofence_alert_title, geofence_alert_message, delivery_launch_date, advance_ordering_enabled,
                first_delivery_date, zone_launch_dates, launch_banner_enabled, launch_banner_headline,
                launch_banner_subtitle, launch_banner_bg_color, launch_banner_image_url, zone_banners,
                updated_at, updated_by
            ) VALUES (
                'main', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, NOW(), $29
            )
            ON CONFLICT (id) DO UPDATE SET
                delivery_charges_enabled = EXCLUDED.delivery_charges_enabled,
                fixed_delivery_charge = EXCLUDED.fixed_delivery_charge,
                free_delivery_threshold = EXCLUDED.free_delivery_threshold,
                distance_charges_enabled = EXCLUDED.distance_charges_enabled,
                distance_base_km = EXCLUDED.distance_base_km,
                distance_rate_per_km = EXCLUDED.distance_rate_per_km,
                zone_charges = EXCLUDED.zone_charges,
                delivery_mode = EXCLUDED.delivery_mode,
                morning_start_time = EXCLUDED.morning_start_time,
                morning_end_time = EXCLUDED.morning_end_time,
                evening_start_time = EXCLUDED.evening_start_time,
                evening_end_time = EXCLUDED.evening_end_time,
                holidays = EXCLUDED.holidays,
                closure_reason = EXCLUDED.closure_reason,
                geofence_radius_meters = EXCLUDED.geofence_radius_meters,
                geofence_notifications_enabled = EXCLUDED.geofence_notifications_enabled,
                geofence_alert_title = EXCLUDED.geofence_alert_title,
                geofence_alert_message = EXCLUDED.geofence_alert_message,
                delivery_launch_date = EXCLUDED.delivery_launch_date,
                advance_ordering_enabled = EXCLUDED.advance_ordering_enabled,
                first_delivery_date = EXCLUDED.first_delivery_date,
                zone_launch_dates = EXCLUDED.zone_launch_dates,
                launch_banner_enabled = EXCLUDED.launch_banner_enabled,
                launch_banner_headline = EXCLUDED.launch_banner_headline,
                launch_banner_subtitle = EXCLUDED.launch_banner_subtitle,
                launch_banner_bg_color = EXCLUDED.launch_banner_bg_color,
                launch_banner_image_url = EXCLUDED.launch_banner_image_url,
                zone_banners = EXCLUDED.zone_banners,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
        `, [
            merged.delivery_charges_enabled,
            merged.fixed_delivery_charge,
            merged.free_delivery_threshold,
            merged.distance_charges_enabled,
            merged.distance_base_km,
            merged.distance_rate_per_km,
            JSON.stringify(merged.zone_charges || {}),
            merged.delivery_mode,
            merged.morning_start_time,
            merged.morning_end_time,
            merged.evening_start_time,
            merged.evening_end_time,
            JSON.stringify(merged.holidays || []),
            merged.closure_reason,
            merged.geofence_radius_meters,
            merged.geofence_notifications_enabled,
            merged.geofence_alert_title,
            merged.geofence_alert_message,
            merged.delivery_launch_date,
            merged.advance_ordering_enabled,
            merged.first_delivery_date,
            JSON.stringify(merged.zone_launch_dates || {}),
            merged.launch_banner_enabled,
            merged.launch_banner_headline,
            merged.launch_banner_subtitle,
            merged.launch_banner_bg_color,
            merged.launch_banner_image_url,
            JSON.stringify(merged.zone_banners || {}),
            adminName
        ]);
    } catch (_) {}

    // Audit log
    try {
        await pool.query(`
            INSERT INTO admin_audit_logs (admin_name, action, details)
            VALUES ($1, 'UPDATE_BUSINESS_CONFIG', $2)
        `, [adminName, `Updated business & delivery configuration: mode=${merged.delivery_mode}, charge=₹${merged.fixed_delivery_charge}`]);
    } catch (_) {}

    // Real-time broadcast to connected clients
    try {
        const { getIO } = require("./socketService");
        const io = getIO();
        if (io) {
            io.emit("config:delivery_updated", merged);
            io.emit("config:banner_updated", getLaunchBannerFromConfig(merged));
        }
    } catch (_) {}

    return merged;
}

/* =========================================================================
   2. DYNAMIC DELIVERY CHARGES CALCULATION (SINGLE SOURCE OF TRUTH)
========================================================================= */

async function calculateDeliveryCharge({ subtotal = 0, order_type = "delivery", zone = null, distance_km = null }) {
    const config = await getDeliveryConfig();

    if (order_type === "pickup") {
        return {
            delivery_charge: 0.0,
            delivery_fee: 0.0,
            is_free: true,
            reason: "Store Pickup is always free.",
            free_delivery_threshold: config.free_delivery_threshold,
            amount_needed_for_free_delivery: 0.0
        };
    }

    if (!config.delivery_charges_enabled) {
        return {
            delivery_charge: 0.0,
            delivery_fee: 0.0,
            is_free: true,
            reason: "Delivery charges are currently waived.",
            free_delivery_threshold: config.free_delivery_threshold,
            amount_needed_for_free_delivery: 0.0
        };
    }

    const sub = Number(subtotal) || 0;
    const threshold = Number(config.free_delivery_threshold) || 299.0;

    if (sub >= threshold) {
        return {
            delivery_charge: 0.0,
            delivery_fee: 0.0,
            is_free: true,
            reason: `Free delivery unlocked on orders above ₹${threshold.toFixed(0)}!`,
            free_delivery_threshold: threshold,
            amount_needed_for_free_delivery: 0.0
        };
    }

    let baseCharge = Number(config.fixed_delivery_charge) || 30.0;

    // Check zone override if present
    if (zone && config.zone_charges && config.zone_charges[zone] !== undefined) {
        baseCharge = Number(config.zone_charges[zone]);
    }

    // Distance charge if enabled
    let distanceCharge = 0.0;
    if (config.distance_charges_enabled && distance_km && Number(distance_km) > Number(config.distance_base_km)) {
        const extraKm = Number(distance_km) - Number(config.distance_base_km);
        distanceCharge = extraKm * Number(config.distance_rate_per_km || 10.0);
    }

    const finalCharge = Math.max(0.0, Math.round((baseCharge + distanceCharge) * 100) / 100);
    const amountNeeded = Math.max(0.0, Math.round((threshold - sub) * 100) / 100);

    return {
        delivery_charge: finalCharge,
        delivery_fee: finalCharge,
        is_free: false,
        reason: `Standard delivery charge. Add ₹${amountNeeded.toFixed(0)} more for FREE delivery.`,
        free_delivery_threshold: threshold,
        amount_needed_for_free_delivery: amountNeeded
    };
}

/* =========================================================================
   3. DELIVERY AVAILABILITY & TIMINGS (ASIA/KOLKATA TIMEZONE)
========================================================================= */

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) return 0;
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const period = match[3]?.toUpperCase();

    if (period === "PM" && hour < 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;

    return hour * 60 + minute;
}

function getNowInKolkata() {
    const now = new Date();
    // Format to Asia/Kolkata timezone string
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const partMap = {};
    for (const p of parts) partMap[p.type] = p.value;

    const hour = parseInt(partMap.hour, 10);
    const minute = parseInt(partMap.minute, 10);
    const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;

    return {
        dateStr,
        hour,
        minute,
        minutesOfDay: hour * 60 + minute,
        formattedTime: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
    };
}

async function checkDeliveryAvailability({ zone = null } = {}) {
    const config = await getDeliveryConfig();
    const kolkata = getNowInKolkata();

    // 1. Temporarily Disabled check
    if (config.delivery_mode === "temporarily_disabled") {
        return {
            is_available: false,
            available: false,
            status: "UNAVAILABLE",
            mode: config.delivery_mode,
            message: config.closure_reason || "Deliveries are currently paused. Please check back later.",
            next_available_time: "Please check our next available delivery time.",
            can_order: false
        };
    }

    // 2. Holiday check
    if (Array.isArray(config.holidays) && config.holidays.includes(kolkata.dateStr)) {
        return {
            is_available: false,
            available: false,
            status: "HOLIDAY",
            mode: "holiday",
            message: "Deliveries are closed today on account of holiday.",
            next_available_time: "Tomorrow morning 6:00 AM",
            can_order: false
        };
    }

    // 3. Launch Date check
    const launchDate = config.zone_launch_dates?.[zone] || config.delivery_launch_date;
    if (launchDate && kolkata.dateStr < launchDate) {
        if (config.advance_ordering_enabled) {
            return {
                is_available: true,
                available: true,
                status: "ADVANCE_ORDERING",
                is_advance_order: true,
                mode: config.delivery_mode,
                message: `Advance orders active! Deliveries start from ${launchDate}.`,
                next_available_time: `Deliveries begin ${launchDate}`,
                can_order: true
            };
        } else {
            return {
                is_available: false,
                available: false,
                status: "PRE_LAUNCH",
                is_advance_order: false,
                mode: "pre_launch",
                message: `Delivery is currently unavailable. Deliveries start from ${launchDate}.`,
                next_available_time: `Starting ${launchDate}`,
                can_order: false
            };
        }
    }

    // 4. 24/7 Mode
    if (config.delivery_mode === "always_24x7") {
        return {
            is_available: true,
            available: true,
            status: "AVAILABLE",
            mode: "always_24x7",
            message: "Fresh deliveries available 24/7!",
            next_available_time: "Immediate Delivery",
            can_order: true
        };
    }

    // 5. Morning / Evening Slot Evaluation
    const mStart = parseTimeToMinutes(config.morning_start_time || "06:00 AM");
    const mEnd = parseTimeToMinutes(config.morning_end_time || "10:00 AM");
    const eStart = parseTimeToMinutes(config.evening_start_time || "04:00 PM");
    const eEnd = parseTimeToMinutes(config.evening_end_time || "08:00 PM");

    const cur = kolkata.minutesOfDay;
    const isMorning = cur >= mStart && cur <= mEnd;
    const isEvening = cur >= eStart && cur <= eEnd;

    let available = false;
    let nextSlot = "";

    if (config.delivery_mode === "morning") {
        available = isMorning;
        nextSlot = `Morning Delivery (${config.morning_start_time} - ${config.morning_end_time})`;
    } else if (config.delivery_mode === "evening") {
        available = isEvening;
        nextSlot = `Evening Delivery (${config.evening_start_time} - ${config.evening_end_time})`;
    } else {
        // morning_evening
        available = isMorning || isEvening;
        if (cur < mStart) {
            nextSlot = `Morning Delivery (${config.morning_start_time} - ${config.morning_end_time})`;
        } else if (cur <= mEnd) {
            nextSlot = `Currently in Morning Delivery (${config.morning_start_time} - ${config.morning_end_time})`;
        } else if (cur < eStart) {
            nextSlot = `Evening Delivery (${config.evening_start_time} - ${config.evening_end_time})`;
        } else if (cur <= eEnd) {
            nextSlot = `Currently in Evening Delivery (${config.evening_start_time} - ${config.evening_end_time})`;
        } else {
            nextSlot = `Tomorrow Morning (${config.morning_start_time} - ${config.morning_end_time})`;
        }
    }

    if (available) {
        return {
            is_available: true,
            available: true,
            status: "AVAILABLE",
            mode: config.delivery_mode,
            message: "Delivery is available now!",
            current_slot: nextSlot,
            next_available_time: nextSlot,
            can_order: true
        };
    } else {
        return {
            is_available: false,
            available: false,
            status: "UNAVAILABLE",
            mode: config.delivery_mode,
            message: "Delivery is currently unavailable. Please check our next available delivery time.",
            next_available_time: nextSlot,
            can_order: Boolean(config.advance_ordering_enabled)
        };
    }
}

/* =========================================================================
   4. CUSTOMER LAUNCH BANNER API
========================================================================= */

function getLaunchBannerFromConfig(config, zone = null) {
    if (!config.launch_banner_enabled) {
        return {
            enabled: false,
            headline: "",
            subtitle: "",
            background_color: "#1B4332",
            image_url: "",
            state: "disabled"
        };
    }

    const kolkata = getNowInKolkata();
    const launchDate = config.zone_launch_dates?.[zone] || config.delivery_launch_date;

    let state = "active";
    let headline = config.launch_banner_headline || "Freshness delivered to your doorstep! Order now.";

    if (config.delivery_mode === "temporarily_disabled") {
        state = "unavailable";
        headline = "Delivery coming soon to your area!";
    } else if (launchDate && kolkata.dateStr < launchDate) {
        state = "upcoming";
        const parts = launchDate.split("-");
        const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : launchDate;
        headline = `Thulirva deliveries start from ${formattedDate}!`;
    }

    return {
        enabled: true,
        state,
        headline,
        subtitle: config.launch_banner_subtitle || "Pure organic milk and farm-fresh essentials.",
        background_color: config.launch_banner_bg_color || "#1B4332",
        image_url: config.launch_banner_image_url || "",
        launch_date: launchDate,
        advance_ordering_enabled: config.advance_ordering_enabled
    };
}

async function getLaunchBanner(zone = null) {
    try {
        const { getActiveAnnouncements } = require("./announcementService");
        const activeAnnouncements = await getActiveAnnouncements();
        // Look for hero / launch announcements or any active announcement
        const heroAnn = activeAnnouncements.find(a => a.position === "homepage_hero" || a.position === "all") || (activeAnnouncements.length > 0 ? activeAnnouncements[0] : null);

        if (heroAnn) {
            return {
                enabled: true,
                state: "active",
                headline: heroAnn.title,
                subtitle: heroAnn.description || "",
                bg_color: heroAnn.bg_color || "#1B4332",
                background_color: heroAnn.bg_color || "#1B4332",
                text_color: heroAnn.text_color || "#FFFFFF",
                accent_color: heroAnn.accent_color || "#E5C97A",
                badge_text: heroAnn.badge_text || "DELIVERY LAUNCH",
                image_url: heroAnn.image_url || "",
                cta_text: heroAnn.cta_text || "Shop Farm Fresh",
                cta_url: heroAnn.cta_url || "/pages/shop.html",
                launch_date: heroAnn.start_date || null,
                expiry_date: heroAnn.expiry_date || null,
                id: heroAnn.id
            };
        } else {
            // When all announcements are disabled or expired, banner is strictly disabled
            return {
                enabled: false,
                headline: "",
                subtitle: "",
                background_color: "#1B4332",
                bg_color: "#1B4332",
                image_url: "",
                state: "disabled"
            };
        }
    } catch (e) {
        console.warn("[BusinessConfig] Announcement check fallback:", e.message);
        const config = await getDeliveryConfig();
        return getLaunchBannerFromConfig(config, zone);
    }
}

/* =========================================================================
   5. PAYMENT QR CODE MANAGEMENT & DEDICATED SECURITY PASSWORD
========================================================================= */

async function verifyQrSecurityPassword(password) {
    if (!password || typeof password !== "string") {
        return { verified: false, message: "Security password is required." };
    }

    let creds = null;
    try {
        const res = await pool.query("SELECT * FROM admin_security_credentials WHERE credential_type = 'payment_qr_security' LIMIT 1");
        if (res.rows.length > 0) creds = res.rows[0];
    } catch (_) {}

    if (!creds) creds = loadSecCredsFromDisk();

    // Check account lockout
    if (creds.locked_until) {
        const lockTime = new Date(creds.locked_until);
        const now = new Date();
        if (lockTime > now) {
            const remainingMins = Math.ceil((lockTime - now) / 60000);
            return {
                verified: false,
                is_locked: true,
                message: `Too many incorrect attempts. QR Security is locked for ${remainingMins} more minute(s).`
            };
        }
    }

    const matches = bcrypt.compareSync(password, creds.password_hash);
    if (matches) {
        // Reset failed attempts on success
        creds.failed_attempts = 0;
        creds.locked_until = null;
        saveSecCredsToDisk(creds);
        try {
            await pool.query("UPDATE admin_security_credentials SET failed_attempts = 0, locked_until = NULL WHERE credential_type = 'payment_qr_security'");
        } catch (_) {}

        return { verified: true, message: "Security password verified." };
    } else {
        // Increment failed attempts
        const attempts = (creds.failed_attempts || 0) + 1;
        creds.failed_attempts = attempts;
        let lockedUntil = null;
        if (attempts >= 5) {
            lockedUntil = new Date(Date.now() + 15 * 60000).toISOString();
            creds.locked_until = lockedUntil;
        }
        saveSecCredsToDisk(creds);
        try {
            await pool.query("UPDATE admin_security_credentials SET failed_attempts = $1, locked_until = $2 WHERE credential_type = 'payment_qr_security'", [attempts, lockedUntil]);
        } catch (_) {}

        if (attempts >= 5) {
            return {
                verified: false,
                is_locked: true,
                message: "Security password failed 5 times. Account locked for 15 minutes."
            };
        }

        return {
            verified: false,
            attempts_remaining: 5 - attempts,
            message: `Incorrect security password. ${5 - attempts} attempt(s) remaining before lockout.`
        };
    }
}

async function setQrSecurityPassword(newPassword, adminName = "Super Admin") {
    if (!newPassword || newPassword.length < 6) {
        return { success: false, message: "Password must be at least 6 characters." };
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    const creds = {
        credential_type: "payment_qr_security",
        password_hash: hash,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
        updated_by: adminName
    };

    saveSecCredsToDisk(creds);

    try {
        await pool.query(`
            INSERT INTO admin_security_credentials (credential_type, password_hash, failed_attempts, locked_until, updated_at, updated_by)
            VALUES ('payment_qr_security', $1, 0, NULL, NOW(), $2)
            ON CONFLICT (credential_type) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                failed_attempts = 0,
                locked_until = NULL,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
        `, [hash, adminName]);
    } catch (_) {}

    try {
        await pool.query(`
            INSERT INTO admin_audit_logs (admin_name, action, details)
            VALUES ($1, 'RESET_QR_SECURITY_PASSWORD', 'Payment QR security password was updated')
        `, [adminName]);
    } catch (_) {}

    return { success: true, message: "Payment QR security password successfully updated." };
}

async function getActivePaymentQr() {
    try {
        const res = await pool.query("SELECT * FROM payment_qr_configs WHERE is_active = true ORDER BY version DESC LIMIT 1");
        if (res.rows.length > 0) {
            const qr = res.rows[0];
            saveQrConfigToDisk(qr);
            return qr;
        }
    } catch (_) {}
    return loadQrConfigFromDisk();
}

async function getPaymentQrHistory() {
    try {
        const res = await pool.query("SELECT * FROM payment_qr_configs ORDER BY version DESC LIMIT 50");
        if (res.rows.length > 0) {
            return res.rows;
        }
    } catch (_) {}
    return loadQrHistoryFromDisk();
}

async function uploadAndActivatePaymentQr({ qr_image_url, upi_id = "7904880944@superyes", merchant_name = "THULIRVA ORGANICS", notes = "", adminName = "Super Admin" }) {
    if (!qr_image_url) {
        return { success: false, message: "qr_image_url is required." };
    }

    const current = await getActivePaymentQr();
    const newVersion = (current.version || 1) + 1;

    const newQr = {
        upi_id: upi_id || current.upi_id,
        merchant_name: merchant_name || current.merchant_name,
        qr_image_url,
        is_active: true,
        version: newVersion,
        notes: notes || `Updated by ${adminName}`,
        created_by: adminName,
        created_at: new Date().toISOString()
    };

    saveQrConfigToDisk(newQr);

    const history = loadQrHistoryFromDisk();
    history.unshift(newQr);
    saveQrHistoryToDisk(history);

    try {
        // Deactivate older QRs in DB
        await pool.query("UPDATE payment_qr_configs SET is_active = false");
        const res = await pool.query(`
            INSERT INTO payment_qr_configs (upi_id, merchant_name, qr_image_url, is_active, version, notes, created_by, created_at)
            VALUES ($1, $2, $3, true, $4, $5, $6, NOW())
            RETURNING *
        `, [newQr.upi_id, newQr.merchant_name, newQr.qr_image_url, newQr.version, newQr.notes, adminName]);

        if (res.rows.length > 0) {
            newQr.id = res.rows[0].id;
        }
    } catch (_) {}

    try {
        await pool.query(`
            INSERT INTO admin_audit_logs (admin_name, action, details)
            VALUES ($1, 'UPLOAD_PAYMENT_QR', $2)
        `, [adminName, `Published new Payment QR v${newVersion} with UPI ${newQr.upi_id}`]);
    } catch (_) {}

    // Broadcast new QR to customer apps in real-time
    try {
        const { getIO } = require("./socketService");
        const io = getIO();
        if (io) {
            io.emit("config:payment_qr_updated", newQr);
        }
    } catch (_) {}

    return { success: true, message: `Payment QR v${newVersion} published successfully.`, qr: newQr };
}

async function togglePaymentQrStatus({ is_active, adminName = "Super Admin" }) {
    const active = await getActivePaymentQr();
    active.is_active = Boolean(is_active);
    saveQrConfigToDisk(active);

    try {
        await pool.query("UPDATE payment_qr_configs SET is_active = $1 WHERE id = $2", [active.is_active, active.id]);
    } catch (_) {}

    try {
        const { getIO } = require("./socketService");
        const io = getIO();
        if (io) io.emit("config:payment_qr_updated", active);
    } catch (_) {}

    return { success: true, message: `Payment QR is now ${active.is_active ? 'ACTIVE' : 'DEACTIVATED'}.`, qr: active };
}

/* =========================================================================
   6. GEOFENCE ARRIVAL EVENT RECORDING
========================================================================= */

async function recordGeofenceArrival({ order_id, delivery_type = "order", partner_id, user_id, distance_meters, partner_lat, partner_lng, customer_lat, customer_lng }) {
    try {
        await pool.query(`
            INSERT INTO delivery_geofence_events (
                order_id, delivery_type, partner_id, user_id, distance_meters,
                partner_lat, partner_lng, customer_lat, customer_lng, notified_at, notification_sent
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), true)
        `, [
            order_id, delivery_type, partner_id, user_id || null, distance_meters,
            partner_lat, partner_lng, customer_lat, customer_lng
        ]);
    } catch (_) {}
}

module.exports = {
    DEFAULT_CONFIG,
    DEFAULT_QR_CONFIG,
    getDeliveryConfig,
    updateDeliveryConfig,
    calculateDeliveryCharge,
    checkDeliveryAvailability,
    getLaunchBanner,
    verifyQrSecurityPassword,
    setQrSecurityPassword,
    getActivePaymentQr,
    getPaymentQrHistory,
    uploadAndActivatePaymentQr,
    togglePaymentQrStatus,
    recordGeofenceArrival
};

