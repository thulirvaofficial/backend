const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { emitToAdmin } = require("./socketService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const ATTENDANCE_FILE = path.join(DATA_DIR, "partner_attendance.json");
const UPLOADS_DIR = path.resolve(__dirname, "..", "public", "uploads", "attendance");

function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function loadAttendance() {
    ensureDirs();
    try {
        if (fs.existsSync(ATTENDANCE_FILE)) {
            return JSON.parse(fs.readFileSync(ATTENDANCE_FILE, "utf-8"));
        }
    } catch (e) {
        console.warn("[ATTENDANCE LOAD WARN]:", e.message);
    }
    return [];
}

function saveAttendance(records) {
    ensureDirs();
    try {
        fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify(records, null, 2), "utf-8");
    } catch (e) {
        console.warn("[ATTENDANCE SAVE WARN]:", e.message);
    }
}

/**
 * Get current date string formatted as YYYY-MM-DD in Asia/Kolkata timezone
 */
function getTodayStr() {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        return formatter.format(new Date());
    } catch (_) {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }
}

function savePhotoFromBase64(base64Data, filename) {
    ensureDirs();
    try {
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const filePath = path.join(UPLOADS_DIR, filename);
        fs.writeFileSync(filePath, buffer);
        return `/uploads/attendance/${filename}`;
    } catch (e) {
        console.warn("[PHOTO SAVE WARN]:", e.message);
        return null;
    }
}

/**
 * Check In with Live Selfie and GPS
 */
async function checkIn({ partner_id, partner_name, photo_base64, latitude, longitude, is_camera }) {
    if (!partner_id) {
        return { success: false, message: "Partner ID is required." };
    }

    // Require live camera capture
    if (is_camera === false || is_camera === "false") {
        return { success: false, message: "Attendance selfie must be captured live from the camera. Gallery photos are prohibited." };
    }

    const todayStr = getTodayStr();
    const records = loadAttendance();

    // Check for duplicate check-in today
    const existing = records.find(r => r.partner_id === partner_id && r.date === todayStr);
    if (existing) {
        return {
            success: false,
            message: "You have already checked in for today at " + new Date(existing.check_in_time).toLocaleTimeString(),
            attendance: existing
        };
    }

    let photoUrl = null;
    if (photo_base64) {
        const filename = `checkin_${partner_id}_${Date.now()}.jpg`;
        photoUrl = savePhotoFromBase64(photo_base64, filename);
    }

    const newRecord = {
        id: `ATT-${Date.now()}-${partner_id}`,
        date: todayStr,
        partner_id,
        partner_name: partner_name || "Delivery Partner",
        check_in_time: new Date().toISOString(),
        check_in_photo: photoUrl,
        check_in_location: {
            latitude: latitude ? Number(latitude) : 13.0827,
            longitude: longitude ? Number(longitude) : 80.2707
        },
        check_out_time: null,
        check_out_photo: null,
        check_out_location: null,
        working_hours: null,
        status: "checked_in"
    };

    records.unshift(newRecord);
    saveAttendance(records);

    // Save to PostgreSQL if available
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_attendance (
                id VARCHAR(100) PRIMARY KEY,
                date DATE NOT NULL,
                partner_id VARCHAR(50) NOT NULL,
                partner_name VARCHAR(150),
                check_in_time TIMESTAMP NOT NULL,
                check_in_photo TEXT,
                check_in_latitude NUMERIC(10,7),
                check_in_longitude NUMERIC(10,7),
                check_out_time TIMESTAMP,
                check_out_photo TEXT,
                check_out_latitude NUMERIC(10,7),
                check_out_longitude NUMERIC(10,7),
                working_hours NUMERIC(5,2),
                status VARCHAR(30) DEFAULT 'checked_in',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            INSERT INTO partner_attendance (
                id, date, partner_id, partner_name, check_in_time, check_in_photo,
                check_in_latitude, check_in_longitude, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'checked_in')
        `, [
            newRecord.id, newRecord.date, newRecord.partner_id, newRecord.partner_name,
            newRecord.check_in_time, newRecord.check_in_photo,
            newRecord.check_in_location.latitude, newRecord.check_in_location.longitude
        ]);
    } catch (_) {}

    // Mark partner online in database
    try {
        await pool.query(
            "UPDATE delivery_partners SET is_online = true, updated_at = NOW() WHERE partner_id = $1",
            [newRecord.partner_id]
        );
        const { getPartnerById, savePartner } = require("./deliveryPartnerService");
        const partner = await getPartnerById(newRecord.partner_id);
        if (partner) {
            partner.is_online = true;
            await savePartner(partner);
        }
    } catch (_) {}

    // Emit live update to Admin App & Website
    try {
        emitToAdmin("partner:status:changed", {
            partnerId: newRecord.partner_id,
            is_online: true,
            timestamp: new Date().toISOString()
        });
        emitToAdmin("partner:attendance_check_in", {
            partner_id: newRecord.partner_id,
            partner_name: newRecord.partner_name,
            check_in_time: newRecord.check_in_time,
            date: newRecord.date,
            status: "checked_in"
        });
    } catch (_) {}

    return {
        success: true,
        message: "Check-in successful! Have a great delivery day.",
        attendance: newRecord
    };
}

/**
 * Check Out with Photo, GPS, and Working Hours Calculation
 */
async function checkOut({ partner_id, photo_base64, latitude, longitude }) {
    if (!partner_id) {
        return { success: false, message: "Partner ID is required." };
    }

    const todayStr = getTodayStr();
    const records = loadAttendance();
    const record = records.find(r => r.partner_id === partner_id && r.date === todayStr);

    if (!record) {
        return { success: false, message: "No active check-in record found for today. Please check in first." };
    }

    if (record.status === "checked_out") {
        return {
            success: false,
            message: "You have already checked out for today at " + new Date(record.check_out_time).toLocaleTimeString(),
            attendance: record
        };
    }

    // Guard: Block checkout if partner has active assigned deliveries
    try {
        const activeRes = await pool.query(
            "SELECT id, order_status FROM orders WHERE partner_id = $1 AND LOWER(COALESCE(order_status, '')) IN ('assigned', 'accepted', 'in_transit', 'out_for_delivery')",
            [partner_id]
        );
        if (activeRes.rows && activeRes.rows.length > 0) {
            return {
                success: false,
                has_active_deliveries: true,
                message: `Cannot check out: You have ${activeRes.rows.length} active delivery in progress. Complete all assigned orders before ending your shift.`
            };
        }
    } catch (_) {}

    let photoUrl = null;
    if (photo_base64) {
        const filename = `checkout_${partner_id}_${Date.now()}.jpg`;
        photoUrl = savePhotoFromBase64(photo_base64, filename);
    }

    const checkOutTime = new Date();
    const checkInTime = new Date(record.check_in_time);
    const diffMs = checkOutTime.getTime() - checkInTime.getTime();
    const hours = Math.max(0.1, Number((diffMs / (1000 * 60 * 60)).toFixed(2)));

    record.check_out_time = checkOutTime.toISOString();
    record.check_out_photo = photoUrl;
    record.check_out_location = {
        latitude: latitude ? Number(latitude) : 13.0827,
        longitude: longitude ? Number(longitude) : 80.2707
    };
    record.working_hours = hours;
    record.status = "checked_out";

    saveAttendance(records);

    // Update in PostgreSQL
    try {
        await pool.query(`
            UPDATE partner_attendance
            SET check_out_time = $1, check_out_photo = $2,
                check_out_latitude = $3, check_out_longitude = $4,
                working_hours = $5, status = 'checked_out'
            WHERE id = $6
        `, [
            record.check_out_time, record.check_out_photo,
            record.check_out_location.latitude, record.check_out_location.longitude,
            hours, record.id
        ]);
        // Set partner status to offline in delivery_partners table & disk store
        await pool.query(
            "UPDATE delivery_partners SET is_online = false, updated_at = NOW() WHERE partner_id = $1",
            [partner_id]
        );
        const { getPartnerById, savePartner } = require("./deliveryPartnerService");
        const partner = await getPartnerById(partner_id);
        if (partner) {
            partner.is_online = false;
            await savePartner(partner);
        }
    } catch (_) {}

    // Emit live update to Admin App & Website
    try {
        emitToAdmin("partner:status:changed", {
            partnerId: partner_id,
            is_online: false,
            timestamp: new Date().toISOString()
        });
        emitToAdmin("partner:attendance_check_out", {
            partner_id,
            check_out_time: record.check_out_time,
            working_hours: hours,
            status: "checked_out"
        });
    } catch (_) {}

    return {
        success: true,
        message: `Check-out successful! Total logged hours: ${hours} hrs.`,
        working_hours: hours,
        attendance: record
    };
}

/**
 * Get Today's Status for a Partner
 */
function getTodayAttendance(partner_id) {
    const todayStr = getTodayStr();
    const records = loadAttendance();
    const record = records.find(r => r.partner_id === partner_id && r.date === todayStr);

    if (!record) {
        return {
            success: true,
            status: "not_checked_in",
            attendance: null
        };
    }

    return {
        success: true,
        status: record.status,
        attendance: record
    };
}

/**
 * Get Attendance History for a Partner
 */
function getPartnerAttendanceHistory(partner_id) {
    const records = loadAttendance();
    const history = records.filter(r => r.partner_id === partner_id);
    return {
        success: true,
        count: history.length,
        history
    };
}

/**
 * Get Admin Attendance List with Date & Search Filters
 */
function getAdminAttendanceList(options = {}) {
    let opts = {};
    if (typeof options === "string") {
        opts = { filter: "custom", start_date: options, end_date: options };
    } else if (options && typeof options === "object") {
        opts = options;
    }
    const { filter = "all", partner_id = null, start_date = null, end_date = null, search = null } = opts;
    const records = loadAttendance();
    const todayStr = getTodayStr();

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    const sevenDaysAgoStr = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, "0")}-${String(sevenDaysAgo.getDate()).padStart(2, "0")}`;

    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    let filtered = records.filter(r => {
        if (partner_id && r.partner_id !== partner_id) return false;

        if (filter === "today") {
            return r.date === todayStr;
        } else if (filter === "yesterday") {
            return r.date === yesterdayStr;
        } else if (filter === "this_week") {
            return r.date >= sevenDaysAgoStr && r.date <= todayStr;
        } else if (filter === "this_month") {
            return r.date >= monthStart && r.date <= todayStr;
        } else if (filter === "custom" && start_date && end_date) {
            return r.date >= start_date && r.date <= end_date;
        } else if (filter === "custom" && start_date) {
            return r.date === start_date;
        }
        return true;
    });

    if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(r =>
            (r.partner_name || "").toLowerCase().includes(q) ||
            (r.partner_id || "").toLowerCase().includes(q)
        );
    }

    // Attach partner metadata and calculate attendance metrics
    let totalPartners = 0;
    const partnerMap = new Map();
    try {
        const partnersFile = path.join(DATA_DIR, "delivery_partners.json");
        if (fs.existsSync(partnersFile)) {
            const raw = JSON.parse(fs.readFileSync(partnersFile, "utf-8"));
            const valid = raw.filter(p => p.registration_status !== "deleted" && p.registration_status !== "deactivated");
            totalPartners = valid.filter(p => p.registration_status === "approved" || p.is_active).length;
            valid.forEach(p => partnerMap.set(p.partner_id, p));
        }
    } catch (_) {}

    filtered = filtered.map(r => {
        const p = partnerMap.get(r.partner_id);
        return {
            ...r,
            assigned_area: r.assigned_area || p?.assigned_area || "Chennai Central",
            vehicle_type: p?.vehicle_type || "Scooter",
            vehicle_number: p?.vehicle_number || ""
        };
    });

    const todayRecords = records.filter(r => r.date === todayStr);
    const presentToday = new Set(todayRecords.map(r => r.partner_id)).size;
    const absentToday = Math.max(0, totalPartners - presentToday);

    return {
        success: true,
        filter,
        total_partners: totalPartners,
        present_today: presentToday,
        absent_today: absentToday,
        count: filtered.length,
        attendance: filtered
    };
}

module.exports = {
    checkIn,
    checkOut,
    getTodayAttendance,
    getPartnerAttendanceHistory,
    getAdminAttendanceList,
    savePhotoFromBase64
};

