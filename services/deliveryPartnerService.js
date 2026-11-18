const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/database");
const { emitToAdmin, emitToPartner } = require("./socketService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const PARTNERS_FILE = path.join(DATA_DIR, "delivery_partners.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

/**
 * Load partners from disk store
 */
function loadPartnersFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(PARTNERS_FILE)) {
            const data = fs.readFileSync(PARTNERS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.warn("[DELIVERY PARTNER DISK LOAD WARN]:", e.message);
    }
    return [];
}

/**
 * Save partners to disk store
 */
function savePartnersToDisk(partners) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(PARTNERS_FILE, JSON.stringify(partners, null, 2), "utf-8");
    } catch (e) {
        console.warn("[DELIVERY PARTNER DISK SAVE WARN]:", e.message);
    }
}

/**
 * Get all active delivery partners
 * Excludes soft-deleted or deactivated partners unless includeDeleted is true
 */
async function getPartners({ status, area, includeDeleted = false } = {}) {
    let partners = [];

    // Try PostgreSQL
    try {
        let sql = `
            SELECT 
                partner_id, name, phone, email, password, password_hash, profile_photo, address, city, pincode, assigned_area,
                vehicle_type, vehicle_number, driving_licence, identity_documents,
                emergency_contact, registration_status, rejection_reason, kyc_status, aadhaar_front_url, aadhaar_back_url,
                current_latitude, current_longitude, is_online, is_active, is_blocked,
                rating, total_deliveries_count, active_orders_count, last_active_at,
                location_updated_at, created_at, updated_at
            FROM delivery_partners
            WHERE 1=1
        `;
        const params = [];

        if (!includeDeleted) {
            sql += " AND (registration_status IS NULL OR registration_status NOT IN ('deleted', 'deactivated'))";
        }

        if (status && status !== "all") {
            params.push(status);
            sql += ` AND registration_status = $${params.length}`;
        }

        if (area) {
            params.push(`%${area}%`);
            sql += ` AND assigned_area ILIKE $${params.length}`;
        }

        sql += " ORDER BY id DESC";

        const dbRes = await pool.query(sql, params);
        if (dbRes.rows && dbRes.rows.length > 0) {
            partners = dbRes.rows;
        }
    } catch (_) {}

    // Fallback or merge from disk JSON
    if (partners.length === 0) {
        const diskPartners = loadPartnersFromDisk();
        partners = diskPartners
            .filter(p => {
                if (!includeDeleted && (p.registration_status === "deleted" || p.registration_status === "deactivated")) {
                    return false;
                }
                if (status && status !== "all" && p.registration_status !== status) {
                    return false;
                }
                if (area && !((p.assigned_area || "").toLowerCase().includes(area.toLowerCase()))) {
                    return false;
                }
                return true;
            })
            .map(p => ({
                partner_id: p.partner_id,
                name: p.name,
                phone: p.phone,
                email: p.email,
                password: p.password || null,
                password_hash: p.password_hash || null,
                profile_photo: p.profile_photo || null,
                address: p.address || "",
                city: p.city || "Chennai",
                pincode: p.pincode || "",
                assigned_area: p.assigned_area,
                vehicle_type: p.vehicle_type,
                vehicle_number: p.vehicle_number,
                driving_licence: p.driving_licence || null,
                identity_documents: p.identity_documents || null,
                emergency_contact: p.emergency_contact || null,
                registration_status: p.registration_status || (p.is_active ? "approved" : "pending_approval"),
                rejection_reason: p.rejection_reason || null,
                kyc_status: p.kyc_status || (p.registration_status === "approved" || p.is_active ? "APPROVED" : "PENDING"),
                aadhaar_front_url: p.aadhaar_front_url || null,
                aadhaar_back_url: p.aadhaar_back_url || null,
                current_latitude: p.current_latitude !== undefined && p.current_latitude !== null ? Number(p.current_latitude) : null,
                current_longitude: p.current_longitude !== undefined && p.current_longitude !== null ? Number(p.current_longitude) : null,
                speed: Number(p.speed) || 0,
                heading: Number(p.heading) || 0,
                accuracy: Number(p.accuracy) || 0,
                is_online: Boolean(p.is_online),
                is_active: Boolean(p.is_active),
                is_blocked: Boolean(p.is_blocked),
                rating: p.rating || 5.0,
                total_deliveries_count: p.total_deliveries_count || 0,
                active_orders_count: p.active_orders_count || 0,
                last_active_at: p.last_active_at || null,
                location_updated_at: p.location_updated_at || null,
                created_at: p.created_at || new Date().toISOString()
            }));
    }

    return partners;
}

/**
 * Get single partner by partner_id or phone
 */
async function getPartnerById(identifier) {
    if (!identifier) return null;
    const cleanId = String(identifier).trim();

    // 1. Try PostgreSQL Database (Single Source of Truth)
    try {
        const dbRes = await pool.query(`
            SELECT * FROM delivery_partners 
            WHERE (LOWER(partner_id) = LOWER($1) OR phone = $1)
              AND (registration_status IS NULL OR registration_status NOT IN ('deleted', 'deactivated'))
            LIMIT 1
        `, [cleanId]);
        if (dbRes.rows && dbRes.rows.length > 0) {
            const partner = dbRes.rows[0];
            // Synchronize disk store with fresh DB row to ensure complete consistency
            try {
                let partners = loadPartnersFromDisk();
                const idx = partners.findIndex(p => p.partner_id?.toLowerCase() === partner.partner_id?.toLowerCase());
                if (idx >= 0) {
                    partners[idx] = { ...partners[idx], ...partner };
                } else {
                    partners.push(partner);
                }
                savePartnersToDisk(partners);
            } catch (_) {}
            return partner;
        }
    } catch (e) {
        console.warn("[POSTGRES GET PARTNER WARN]:", e.message);
    }

    // 2. Fallback to disk JSON store if DB query returned no rows or errored
    const partners = loadPartnersFromDisk();
    const diskPartner = partners.find(p =>
        (p.partner_id?.toLowerCase() === cleanId.toLowerCase() || p.phone === cleanId) &&
        p.registration_status !== "deleted" &&
        p.registration_status !== "deactivated"
    ) || null;

    // If partner found on disk, ensure it is persisted to PostgreSQL for future queries
    if (diskPartner) {
        try {
            await savePartner(diskPartner);
        } catch (_) {}
    }

    return diskPartner;
}

/**
 * Save / Update partner permanently across DB and disk
 * Performs transactional UPSERT to PostgreSQL ensuring zero data loss
 */
async function savePartner(partner) {
    if (!partner || !partner.partner_id) return false;

    // 1. Update disk JSON store
    let partners = loadPartnersFromDisk();
    const idx = partners.findIndex(p =>
        p.partner_id?.toLowerCase() === partner.partner_id.toLowerCase() ||
        (partner.phone && p.phone === partner.phone)
    );
    if (idx >= 0) {
        partners[idx] = { ...partners[idx], ...partner, updated_at: new Date().toISOString() };
    } else {
        partners.push({ ...partner, created_at: partner.created_at || new Date().toISOString() });
    }
    savePartnersToDisk(partners);

    // 2. Update PostgreSQL DB (UPSERT: Update existing, or Insert if not yet in DB)
    try {
        const updateRes = await pool.query(`
            UPDATE delivery_partners
            SET name = COALESCE($1, name),
                phone = COALESCE($2, phone),
                email = COALESCE($3, email),
                address = COALESCE($4, address),
                city = COALESCE($5, city),
                pincode = COALESCE($6, pincode),
                assigned_area = COALESCE($7, assigned_area),
                vehicle_type = COALESCE($8, vehicle_type),
                vehicle_number = COALESCE($9, vehicle_number),
                is_online = COALESCE($10, is_online),
                is_active = COALESCE($11, is_active),
                is_blocked = COALESCE($12, is_blocked),
                registration_status = COALESCE($13, registration_status),
                rejection_reason = COALESCE($14, rejection_reason),
                kyc_status = COALESCE($15, kyc_status),
                aadhaar_front_url = COALESCE($16, aadhaar_front_url),
                aadhaar_back_url = COALESCE($17, aadhaar_back_url),
                current_latitude = COALESCE($18, current_latitude),
                current_longitude = COALESCE($19, current_longitude),
                last_active_at = COALESCE($20, last_active_at),
                profile_photo = COALESCE($21, profile_photo),
                emergency_contact = COALESCE($22, emergency_contact),
                rating = COALESCE($23, rating),
                total_deliveries_count = COALESCE($24, total_deliveries_count),
                updated_at = NOW()
            WHERE LOWER(partner_id) = LOWER($25) OR (phone = $2 AND $2 IS NOT NULL)
            RETURNING *;
        `, [
            partner.name || null,
            partner.phone || null,
            partner.email || null,
            partner.address || null,
            partner.city || null,
            partner.pincode || null,
            partner.assigned_area || null,
            partner.vehicle_type || null,
            partner.vehicle_number || null,
            partner.is_online !== undefined ? Boolean(partner.is_online) : null,
            partner.is_active !== undefined ? Boolean(partner.is_active) : null,
            partner.is_blocked !== undefined ? Boolean(partner.is_blocked) : null,
            partner.registration_status || null,
            partner.rejection_reason || null,
            partner.kyc_status || null,
            partner.aadhaar_front_url || null,
            partner.aadhaar_back_url || null,
            partner.current_latitude !== undefined && partner.current_latitude !== null ? Number(partner.current_latitude) : null,
            partner.current_longitude !== undefined && partner.current_longitude !== null ? Number(partner.current_longitude) : null,
            partner.last_active_at ? new Date(partner.last_active_at) : null,
            partner.profile_photo || null,
            partner.emergency_contact || null,
            partner.rating ? Number(partner.rating) : null,
            partner.total_deliveries_count ? Number(partner.total_deliveries_count) : null,
            partner.partner_id
        ]);

        if (updateRes.rows && updateRes.rows.length > 0) {
            Object.assign(partner, updateRes.rows[0]);
        } else {
            // Row not present in PostgreSQL: Insert new permanent record
            const insertRes = await pool.query(`
                INSERT INTO delivery_partners (
                    partner_id, name, phone, email, password, profile_photo, address, city, pincode,
                    assigned_area, vehicle_type, vehicle_number, emergency_contact, registration_status,
                    rejection_reason, kyc_status, aadhaar_front_url, aadhaar_back_url, current_latitude,
                    current_longitude, is_online, is_active, is_blocked, rating, total_deliveries_count,
                    last_active_at, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9,
                    $10, $11, $12, $13, $14,
                    $15, $16, $17, $18, $19,
                    $20, $21, $22, $23, $24, $25,
                    $26, NOW(), NOW()
                )
                ON CONFLICT (partner_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    phone = EXCLUDED.phone,
                    email = COALESCE(EXCLUDED.email, delivery_partners.email),
                    profile_photo = COALESCE(EXCLUDED.profile_photo, delivery_partners.profile_photo),
                    address = COALESCE(EXCLUDED.address, delivery_partners.address),
                    city = COALESCE(EXCLUDED.city, delivery_partners.city),
                    pincode = COALESCE(EXCLUDED.pincode, delivery_partners.pincode),
                    assigned_area = COALESCE(EXCLUDED.assigned_area, delivery_partners.assigned_area),
                    vehicle_type = COALESCE(EXCLUDED.vehicle_type, delivery_partners.vehicle_type),
                    vehicle_number = COALESCE(EXCLUDED.vehicle_number, delivery_partners.vehicle_number),
                    emergency_contact = COALESCE(EXCLUDED.emergency_contact, delivery_partners.emergency_contact),
                    registration_status = COALESCE(EXCLUDED.registration_status, delivery_partners.registration_status),
                    rejection_reason = COALESCE(EXCLUDED.rejection_reason, delivery_partners.rejection_reason),
                    kyc_status = COALESCE(EXCLUDED.kyc_status, delivery_partners.kyc_status),
                    aadhaar_front_url = COALESCE(EXCLUDED.aadhaar_front_url, delivery_partners.aadhaar_front_url),
                    aadhaar_back_url = COALESCE(EXCLUDED.aadhaar_back_url, delivery_partners.aadhaar_back_url),
                    current_latitude = COALESCE(EXCLUDED.current_latitude, delivery_partners.current_latitude),
                    current_longitude = COALESCE(EXCLUDED.current_longitude, delivery_partners.current_longitude),
                    is_online = COALESCE(EXCLUDED.is_online, delivery_partners.is_online),
                    is_active = COALESCE(EXCLUDED.is_active, delivery_partners.is_active),
                    is_blocked = COALESCE(EXCLUDED.is_blocked, delivery_partners.is_blocked),
                    rating = COALESCE(EXCLUDED.rating, delivery_partners.rating),
                    total_deliveries_count = COALESCE(EXCLUDED.total_deliveries_count, delivery_partners.total_deliveries_count),
                    last_active_at = COALESCE(EXCLUDED.last_active_at, delivery_partners.last_active_at),
                    updated_at = NOW()
                RETURNING *;
            `, [
                partner.partner_id,
                partner.name || "Delivery Partner",
                partner.phone || "0000000000",
                partner.email || null,
                partner.password || partner.password_hash || "123456",
                partner.profile_photo || null,
                partner.address || null,
                partner.city || "Chennai",
                partner.pincode || null,
                partner.assigned_area || "Chennai Central",
                partner.vehicle_type || "Scooter",
                partner.vehicle_number || "TN 01 AB 1234",
                partner.emergency_contact || null,
                partner.registration_status || "approved",
                partner.rejection_reason || null,
                partner.kyc_status || "APPROVED",
                partner.aadhaar_front_url || null,
                partner.aadhaar_back_url || null,
                partner.current_latitude !== undefined && partner.current_latitude !== null ? Number(partner.current_latitude) : null,
                partner.current_longitude !== undefined && partner.current_longitude !== null ? Number(partner.current_longitude) : null,
                partner.is_online !== undefined ? Boolean(partner.is_online) : false,
                partner.is_active !== undefined ? Boolean(partner.is_active) : true,
                partner.is_blocked !== undefined ? Boolean(partner.is_blocked) : false,
                partner.rating ? Number(partner.rating) : 5.0,
                partner.total_deliveries_count ? Number(partner.total_deliveries_count) : 0,
                partner.last_active_at ? new Date(partner.last_active_at) : new Date()
            ]);
            if (insertRes.rows && insertRes.rows.length > 0) {
                Object.assign(partner, insertRes.rows[0]);
            }
        }
    } catch (dbErr) {
        console.warn("[POSTGRES SAVE PARTNER WARN]:", dbErr.message);
    }

    return true;
}

/**
 * Permanently Delete Partner
 * Ensures the partner NEVER reappears after refresh or restart
 */
async function deletePartnerPermanently(partnerId) {
    if (!partnerId) return { success: false, message: "partner_id is required" };
    const id = partnerId.trim();

    // 1. Safety validation: verify no active orders in progress
    let activeOrders = 0;
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            activeOrders = orders.filter(
                o => o.partner_id === id && ["pending", "processing", "assigned", "picked_up", "out_for_delivery"].includes(o.order_status)
            ).length;
        }
    } catch {}

    try {
        const dbCheck = await pool.query(`
            SELECT COUNT(*) FROM orders 
            WHERE partner_id = $1 AND order_status IN ('pending', 'processing', 'assigned', 'picked_up', 'out_for_delivery')
        `, [id]);
        if (dbCheck.rows && dbCheck.rows.length) {
            activeOrders = Math.max(activeOrders, Number(dbCheck.rows[0].count));
        }
    } catch {}

    if (activeOrders > 0) {
        return {
            success: false,
            message: `Cannot delete partner ${id}: Has ${activeOrders} active delivery order(s) in progress. Reassign orders first.`
        };
    }

    // 2. Remove permanently from disk JSON
    let partners = loadPartnersFromDisk();
    partners = partners.filter(p => p.partner_id?.toLowerCase() !== id.toLowerCase());
    savePartnersToDisk(partners);

    // 3. Delete or unlink from DB
    try {
        // Unlink from orders to preserve order history
        await pool.query("UPDATE orders SET partner_id = NULL WHERE partner_id = $1", [id]).catch(() => {});
        // Delete from delivery_partners
        await pool.query("DELETE FROM delivery_partners WHERE LOWER(partner_id) = LOWER($1)", [id]).catch(() => {});
    } catch (e) {
        console.warn("[DELETE PARTNER DB WARN]:", e.message);
    }

    // 4. Remove KYC document files from disk
    try {
        const kycDir = path.join(DATA_DIR, "kyc_documents", id);
        if (fs.existsSync(kycDir)) {
            fs.rmSync(kycDir, { recursive: true, force: true });
        }
    } catch (_) {}

    // 5. Notify connected apps via Socket.IO
    emitToAdmin("partner:deleted", { partner_id: id, timestamp: new Date().toISOString() });
    emitToPartner(id, "account:deleted", { message: "Your delivery partner account has been removed by administrator." });

    return {
        success: true,
        message: `Delivery partner ${id} deleted permanently.`
    };
}

/**
 * Block partner
 */
async function blockPartner(partnerId) {
    const partner = await getPartnerById(partnerId);
    if (!partner) return { success: false, message: "Partner not found" };

    partner.is_blocked = true;
    partner.is_online = false;
    partner.registration_status = "blocked";
    partner.updated_at = new Date().toISOString();

    await savePartner(partner);

    emitToAdmin("partner:blocked", { partner_id: partnerId });
    emitToPartner(partnerId, "partner:blocked", { message: "Your partner account has been blocked by administrator." });

    return { success: true, message: `Partner ${partnerId} blocked successfully.` };
}

/**
 * Unblock partner
 */
async function unblockPartner(partnerId) {
    const partner = await getPartnerById(partnerId);
    if (!partner) return { success: false, message: "Partner not found" };

    partner.is_blocked = false;
    partner.registration_status = "approved";
    partner.is_active = true;
    partner.updated_at = new Date().toISOString();

    await savePartner(partner);

    emitToAdmin("partner:unblocked", { partner_id: partnerId });
    emitToPartner(partnerId, "partner:unblocked", { message: "Your partner account has been unblocked." });

    return { success: true, message: `Partner ${partnerId} unblocked successfully.` };
}

/**
 * Toggle block status
 */
async function toggleBlockPartner(partnerId) {
    const partner = await getPartnerById(partnerId);
    if (!partner) return { success: false, message: "Partner not found" };

    if (partner.is_blocked) {
        return await unblockPartner(partnerId);
    } else {
        return await blockPartner(partnerId);
    }
}

/**
 * Approve partner registration
 */
async function approvePartner(partnerId, assignedArea) {
    const partner = await getPartnerById(partnerId);
    if (!partner) return { success: false, message: "Partner not found" };

    partner.registration_status = "approved";
    partner.is_active = true;
    partner.is_blocked = false;
    partner.rejection_reason = null;
    partner.kyc_status = "verified";
    if (assignedArea) partner.assigned_area = assignedArea;
    partner.updated_at = new Date().toISOString();

    await savePartner(partner);

    emitToAdmin("partner:approved", { partner_id: partnerId, assigned_area: partner.assigned_area });
    emitToPartner(partnerId, "partner:approved", { message: "Your delivery partner registration has been approved!" });

    return { success: true, message: `Partner ${partnerId} approved successfully.` };
}

/**
 * Reject partner registration
 */
async function rejectPartner(partnerId, reason) {
    const partner = await getPartnerById(partnerId);
    if (!partner) return { success: false, message: "Partner not found" };

    const rejectionReason = reason || "Application verification criteria not met.";
    partner.registration_status = "rejected";
    partner.rejection_reason = rejectionReason;
    partner.kyc_status = "rejected";
    partner.is_active = false;
    partner.is_online = false;
    partner.updated_at = new Date().toISOString();

    await savePartner(partner);

    emitToAdmin("partner:rejected", { partner_id: partnerId, reason: rejectionReason });
    emitToPartner(partnerId, "partner:rejected", { reason: rejectionReason });

    return { success: true, message: `Partner ${partnerId} registration rejected.` };
}

/**
 * Reset partner password
 */
async function resetPartnerPassword(partnerId, newPassword) {
    const partner = await getPartnerById(partnerId);
    if (!partner) return { success: false, message: "Partner not found" };

    const passwordHash = await bcrypt.hash(newPassword || "defaultpassword123", 10);
    partner.password_hash = passwordHash;
    partner.password = passwordHash;
    partner.updated_at = new Date().toISOString();

    await savePartner(partner);

    try {
        await pool.query("UPDATE delivery_partners SET password = $1, updated_at = NOW() WHERE partner_id = $2", [passwordHash, partnerId]);
    } catch (_) {}

    return { success: true, message: `Password reset successfully for ${partnerId}.` };
}

/**
 * Calculate accurate fleet statistics
 */
async function getFleetStatistics() {
    let partners = [];
    try {
        const dbRes = await pool.query("SELECT * FROM delivery_partners WHERE registration_status IS NULL OR registration_status NOT IN ('deleted', 'deactivated')");
        partners = dbRes.rows;
    } catch {
        partners = loadPartnersFromDisk().filter(p => p.registration_status !== "deleted" && p.registration_status !== "deactivated");
    }

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    const totalFleet = partners.filter(p =>
        (p.registration_status === "approved" || (!p.registration_status && p.is_active)) &&
        !p.is_blocked
    ).length;

    const pendingApprovals = partners.filter(p => p.registration_status === "pending_approval").length;
    const blockedPartners = partners.filter(p => Boolean(p.is_blocked)).length;

    const onlineNow = partners.filter(p => {
        if (!p.is_online || p.is_blocked || p.is_active === false) return false;
        if (!p.last_active_at) return false;
        const t = new Date(p.last_active_at).getTime();
        return !isNaN(t) && t >= fiveMinutesAgo;
    }).length;

    const offlinePartners = Math.max(0, totalFleet - onlineNow);

    // Calculate actual delivered trips and active transit orders
    let totalCompletedTrips = 0;
    let activeDeliveries = 0;

    try {
        if (fs.existsSync(ORDERS_FILE)) {
            const allOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            totalCompletedTrips += allOrders.filter(o => o.order_status === "delivered").length;
            activeDeliveries += allOrders.filter(o => ["assigned", "picked_up", "out_for_delivery"].includes(o.order_status)).length;
        }
    } catch {}

    try {
        const dbOrders = await pool.query(`
            SELECT 
                COUNT(CASE WHEN order_status = 'delivered' THEN 1 END) as delivered_count,
                COUNT(CASE WHEN order_status IN ('assigned', 'picked_up', 'out_for_delivery') THEN 1 END) as active_count
            FROM orders
        `);
        if (dbOrders.rows && dbOrders.rows.length) {
            totalCompletedTrips = Math.max(totalCompletedTrips, Number(dbOrders.rows[0].delivered_count) || 0);
            activeDeliveries = Math.max(activeDeliveries, Number(dbOrders.rows[0].active_count) || 0);
        }
    } catch {}

    return {
        total_fleet: totalFleet,
        total_approved: totalFleet,
        pending_registrations: pendingApprovals,
        pending_approvals: pendingApprovals,
        blocked_partners: blockedPartners,
        online_now: onlineNow,
        offline_partners: offlinePartners,
        total_trips: totalCompletedTrips,
        active_deliveries: activeDeliveries
    };
}

module.exports = {
    loadPartnersFromDisk,
    savePartnersToDisk,
    getPartners,
    getPartnerById,
    savePartner,
    deletePartnerPermanently,
    blockPartner,
    unblockPartner,
    toggleBlockPartner,
    approvePartner,
    rejectPartner,
    resetPartnerPassword,
    getFleetStatistics
};
