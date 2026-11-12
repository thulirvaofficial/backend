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
                partner_id, name, phone, email, profile_photo, address, city, pincode, assigned_area,
                vehicle_type, vehicle_number, driving_licence, identity_documents,
                emergency_contact, registration_status, rejection_reason,
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
                current_latitude: p.current_latitude,
                current_longitude: p.current_longitude,
                is_online: Boolean(p.is_online),
                is_active: Boolean(p.is_active),
                is_blocked: Boolean(p.is_blocked),
                rating: p.rating || 5.0,
                total_deliveries_count: p.total_deliveries_count || 0,
                active_orders_count: p.active_orders_count || 0,
                last_active_at: p.last_active_at || null,
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

    // Try DB
    try {
        const dbRes = await pool.query(`
            SELECT * FROM delivery_partners 
            WHERE (LOWER(partner_id) = LOWER($1) OR phone = $1)
              AND (registration_status IS NULL OR registration_status NOT IN ('deleted', 'deactivated'))
            LIMIT 1
        `, [cleanId]);
        if (dbRes.rows && dbRes.rows.length > 0) {
            return dbRes.rows[0];
        }
    } catch (_) {}

    // Fallback to disk JSON
    const partners = loadPartnersFromDisk();
    return partners.find(p =>
        (p.partner_id?.toLowerCase() === cleanId.toLowerCase() || p.phone === cleanId) &&
        p.registration_status !== "deleted" &&
        p.registration_status !== "deactivated"
    ) || null;
}

/**
 * Save / Update partner permanently across DB and disk
 */
async function savePartner(partner) {
    if (!partner || !partner.partner_id) return false;

    // Update disk JSON
    let partners = loadPartnersFromDisk();
    const idx = partners.findIndex(p => p.partner_id?.toLowerCase() === partner.partner_id.toLowerCase());
    if (idx >= 0) {
        partners[idx] = { ...partners[idx], ...partner, updated_at: new Date().toISOString() };
    } else {
        partners.push({ ...partner, created_at: partner.created_at || new Date().toISOString() });
    }
    savePartnersToDisk(partners);

    // Update DB
    try {
        await pool.query(`
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
                updated_at = NOW()
            WHERE partner_id = $22
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
            partner.current_latitude ? Number(partner.current_latitude) : null,
            partner.current_longitude ? Number(partner.current_longitude) : null,
            partner.last_active_at ? new Date(partner.last_active_at) : null,
            partner.profile_photo || null,
            partner.partner_id
        ]);
    } catch (_) {}

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
