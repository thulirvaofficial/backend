const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { initiateSmartDispatch } = require("../services/dispatchEngine");

const router = express.Router();
const DATA_DIR = path.resolve(__dirname, "..", "data");
const PARTNERS_FILE = path.join(DATA_DIR, "delivery_partners.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function loadPartners() {
    try {
        if (fs.existsSync(PARTNERS_FILE)) {
            return JSON.parse(fs.readFileSync(PARTNERS_FILE, "utf-8"));
        }
    } catch {}
    return [];
}

function savePartners(partners) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(PARTNERS_FILE, JSON.stringify(partners, null, 2), "utf-8");
    } catch {}
}

/**
 * Audit log helper
 */
async function recordAudit(adminName, action, details) {
    try {
        await pool.query(`
            INSERT INTO admin_audit_logs (admin_name, action, details)
            VALUES ($1, $2, $3)
        `, [adminName || "Operations Admin", action, details]);
    } catch {
        console.log(`[AUDIT] ${action}: ${details}`);
    }
}

/* ============================================================
   1. PARTNER MANAGEMENT (CRUD & REGISTRATION APPROVAL)
============================================================ */

/**
 * GET /api/admin/delivery/partners & /api/admin/delivery-partners
 * List all delivery partners with live status and registration state
 */
const getPartnersHandler = async (req, res) => {
    try {
        const { status, area } = req.query;
        let partners = [];

        try {
            let sql = `
                SELECT 
                    partner_id, name, phone, email, address, city, pincode, assigned_area,
                    vehicle_type, vehicle_number, driving_licence, identity_documents,
                    emergency_contact, registration_status, rejection_reason,
                    current_latitude, current_longitude, is_online, is_active, is_blocked,
                    rating, total_deliveries_count, active_orders_count, last_active_at,
                    location_updated_at, created_at, updated_at
                FROM delivery_partners
                WHERE 1=1
            `;
            const params = [];

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
            if (dbRes.rows.length > 0) partners = dbRes.rows;
        } catch {}

        if (partners.length === 0) {
            partners = loadPartners().map(p => ({
                partner_id: p.partner_id,
                name: p.name,
                phone: p.phone,
                email: p.email,
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

            if (status && status !== "all") {
                partners = partners.filter(p => p.registration_status === status);
            }
        }

        return res.json({ success: true, count: partners.length, partners });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/partners", getPartnersHandler);
router.get("/", getPartnersHandler);

/**
 * GET /api/admin/delivery/pending & /api/admin/delivery-partners/pending
 * List only pending registrations
 */
const getPendingRegistrationsHandler = async (req, res) => {
    try {
        let pending = [];
        try {
            const dbRes = await pool.query(
                "SELECT * FROM delivery_partners WHERE registration_status = 'pending_approval' ORDER BY id ASC"
            );
            pending = dbRes.rows;
        } catch {}

        if (pending.length === 0) {
            pending = loadPartners().filter(p => p.registration_status === "pending_approval");
        }

        return res.json({ success: true, count: pending.length, pending });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/pending", getPendingRegistrationsHandler);

/**
 * GET /api/admin/delivery/fleet-statistics & /api/admin/delivery-partners/fleet-statistics
 * Real calculated metrics from DB
 */
const getFleetStatisticsHandler = async (req, res) => {
    try {
        let totalFleet = 0;
        let onlineNow = 0;
        let totalTrips = 0;
        let activeDeliveries = 0;
        let pendingRegistrations = 0;

        try {
            const partnersRes = await pool.query("SELECT * FROM delivery_partners");
            const partners = partnersRes.rows;

            totalFleet = partners.filter(p => p.registration_status === "approved" && !p.is_blocked).length;
            onlineNow = partners.filter(p => p.is_online && !p.is_blocked).length;
            pendingRegistrations = partners.filter(p => p.registration_status === "pending_approval").length;
            totalTrips = partners.reduce((sum, p) => sum + (Number(p.total_deliveries_count) || 0), 0);
            activeDeliveries = partners.reduce((sum, p) => sum + (Number(p.active_orders_count) || 0), 0);
        } catch {
            const partners = loadPartners();
            totalFleet = partners.filter(p => (p.registration_status === "approved" || !p.registration_status) && !p.is_blocked).length;
            onlineNow = partners.filter(p => p.is_online && !p.is_blocked).length;
            pendingRegistrations = partners.filter(p => p.registration_status === "pending_approval").length;
            totalTrips = partners.reduce((sum, p) => sum + (Number(p.total_deliveries_count) || 0), 0);
            activeDeliveries = partners.reduce((sum, p) => sum + (Number(p.active_orders_count) || 0), 0);
        }

        return res.json({
            success: true,
            statistics: {
                total_fleet: totalFleet,
                online_now: onlineNow,
                total_trips: totalTrips,
                active_deliveries: activeDeliveries,
                pending_registrations: pendingRegistrations
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/fleet-statistics", getFleetStatisticsHandler);

/**
 * POST /api/admin/delivery/partners
 * Add a new delivery partner
 */
router.post("/partners", async (req, res) => {
    try {
        const {
            name,
            phone,
            email,
            password = "defaultpassword123",
            assigned_area = "Kanchipuram Main Hub",
            vehicle_type = "Scooter",
            vehicle_number = "TN 21 XY 9999"
        } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ success: false, message: "Partner name and phone are required." });
        }

        let partners = loadPartners();
        const nextNum = partners.length + 1;
        const partner_id = `THU-DP-${String(nextNum).padStart(4, "0")}`;

        const password_hash = await bcrypt.hash(password, 10);

        const newPartner = {
            partner_id,
            name,
            phone,
            email: email || `${partner_id.toLowerCase()}@thulirva.in`,
            password_hash,
            assigned_area,
            vehicle_type,
            vehicle_number,
            current_latitude: 12.8342,
            current_longitude: 79.7036,
            is_online: true,
            is_active: true,
            is_blocked: false,
            rating: 5.0,
            total_deliveries_count: 0,
            active_orders_count: 0,
            created_at: new Date().toISOString()
        };

        // Try DB insert
        try {
            await pool.query(`
                INSERT INTO delivery_partners (
                    partner_id, name, phone, email, password, assigned_area, vehicle_type, vehicle_number,
                    current_latitude, current_longitude, is_online, is_active, is_blocked
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,false)
            `, [
                newPartner.partner_id,
                newPartner.name,
                newPartner.phone,
                newPartner.email,
                password_hash,
                newPartner.assigned_area,
                newPartner.vehicle_type,
                newPartner.vehicle_number,
                newPartner.current_latitude,
                newPartner.current_longitude
            ]);
        } catch {}

        partners.push(newPartner);
        savePartners(partners);

        await recordAudit("Operations Admin", "CREATE_DELIVERY_PARTNER", `Created partner ${partner_id} (${name})`);

        return res.json({
            success: true,
            message: "Delivery partner created successfully.",
            partner: newPartner
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/admin/delivery/partners/:id
 * Edit partner info
 */
router.put("/partners/:id", async (req, res) => {
    try {
        const partnerId = req.params.id;
        const { name, phone, email, assigned_area, vehicle_type, vehicle_number } = req.body;

        let partners = loadPartners();
        const partner = partners.find(p => p.partner_id === partnerId);
        if (!partner) {
            return res.status(404).json({ success: false, message: "Partner not found." });
        }

        if (name) partner.name = name;
        if (phone) partner.phone = phone;
        if (email) partner.email = email;
        if (assigned_area) partner.assigned_area = assigned_area;
        if (vehicle_type) partner.vehicle_type = vehicle_type;
        if (vehicle_number) partner.vehicle_number = vehicle_number;

        try {
            await pool.query(`
                UPDATE delivery_partners
                SET name = COALESCE($1, name),
                    phone = COALESCE($2, phone),
                    email = COALESCE($3, email),
                    assigned_area = COALESCE($4, assigned_area),
                    vehicle_type = COALESCE($5, vehicle_type),
                    vehicle_number = COALESCE($6, vehicle_number),
                    updated_at = NOW()
                WHERE partner_id = $7
            `, [name, phone, email, assigned_area, vehicle_type, vehicle_number, partnerId]);
        } catch {}

        savePartners(partners);
        await recordAudit("Operations Admin", "UPDATE_DELIVERY_PARTNER", `Updated partner ${partnerId}`);

        return res.json({ success: true, message: "Partner updated successfully.", partner });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/admin/delivery/partners/:id/approve & PUT /partners/:id/approve
 */
const approvePartnerHandler = async (req, res) => {
    try {
        const partnerId = req.params.id;
        const { assigned_area } = req.body;

        try {
            await pool.query(`
                UPDATE delivery_partners
                SET registration_status = 'approved',
                    is_active = true,
                    assigned_area = COALESCE($1, assigned_area),
                    updated_at = NOW()
                WHERE partner_id = $2
            `, [assigned_area || null, partnerId]);
        } catch {}

        let partners = loadPartners();
        const p = partners.find(x => x.partner_id === partnerId);
        if (p) {
            p.registration_status = "approved";
            p.is_active = true;
            if (assigned_area) p.assigned_area = assigned_area;
            savePartners(partners);
        }

        await recordAudit("Operations Admin", "APPROVE_DELIVERY_PARTNER", `Approved partner registration ${partnerId}`);

        return res.json({
            success: true,
            message: `Partner ${partnerId} approved successfully and can now log in.`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.patch("/partners/:id/approve", approvePartnerHandler);
router.put("/partners/:id/approve", approvePartnerHandler);

/**
 * PATCH /api/admin/delivery/partners/:id/reject & PUT /partners/:id/reject
 */
const rejectPartnerHandler = async (req, res) => {
    try {
        const partnerId = req.params.id;
        const { reason } = req.body;

        const rejectionReason = reason || "Application verification criteria not met.";

        try {
            await pool.query(`
                UPDATE delivery_partners
                SET registration_status = 'rejected',
                    rejection_reason = $1,
                    is_active = false,
                    is_online = false,
                    updated_at = NOW()
                WHERE partner_id = $2
            `, [rejectionReason, partnerId]);
        } catch {}

        let partners = loadPartners();
        const p = partners.find(x => x.partner_id === partnerId);
        if (p) {
            p.registration_status = "rejected";
            p.rejection_reason = rejectionReason;
            p.is_active = false;
            p.is_online = false;
            savePartners(partners);
        }

        await recordAudit("Operations Admin", "REJECT_DELIVERY_PARTNER", `Rejected partner ${partnerId}: ${rejectionReason}`);

        return res.json({
            success: true,
            message: `Partner application ${partnerId} rejected.`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.patch("/partners/:id/reject", rejectPartnerHandler);
router.put("/partners/:id/reject", rejectPartnerHandler);

/**
 * PATCH /api/admin/delivery/partners/:id/block & unblock
 */
router.patch("/partners/:id/block", async (req, res) => {
    const partnerId = req.params.id;
    try {
        await pool.query("UPDATE delivery_partners SET is_blocked = true, is_online = false, registration_status = 'blocked', updated_at = NOW() WHERE partner_id = $1", [partnerId]);
    } catch {}
    let partners = loadPartners();
    const p = partners.find(x => x.partner_id === partnerId);
    if (p) { p.is_blocked = true; p.is_online = false; p.registration_status = "blocked"; savePartners(partners); }
    return res.json({ success: true, message: `Partner ${partnerId} blocked.` });
});

router.patch("/partners/:id/unblock", async (req, res) => {
    const partnerId = req.params.id;
    try {
        await pool.query("UPDATE delivery_partners SET is_blocked = false, registration_status = 'approved', updated_at = NOW() WHERE partner_id = $1", [partnerId]);
    } catch {}
    let partners = loadPartners();
    const p = partners.find(x => x.partner_id === partnerId);
    if (p) { p.is_blocked = false; p.registration_status = "approved"; savePartners(partners); }
    return res.json({ success: true, message: `Partner ${partnerId} unblocked.` });
});

router.patch("/partners/:id/suspend", async (req, res) => {
    const partnerId = req.params.id;
    try {
        await pool.query("UPDATE delivery_partners SET registration_status = 'suspended', is_online = false, updated_at = NOW() WHERE partner_id = $1", [partnerId]);
    } catch {}
    let partners = loadPartners();
    const p = partners.find(x => x.partner_id === partnerId);
    if (p) { p.registration_status = "suspended"; p.is_online = false; savePartners(partners); }
    return res.json({ success: true, message: `Partner ${partnerId} suspended.` });
});

router.patch("/partners/:id/assign-area", async (req, res) => {
    const partnerId = req.params.id;
    const { assigned_area } = req.body;
    try {
        await pool.query("UPDATE delivery_partners SET assigned_area = $1, updated_at = NOW() WHERE partner_id = $2", [assigned_area, partnerId]);
    } catch {}
    let partners = loadPartners();
    const p = partners.find(x => x.partner_id === partnerId);
    if (p) { p.assigned_area = assigned_area; savePartners(partners); }
    return res.json({ success: true, message: `Area updated for ${partnerId}.` });
});

/**
 * PUT /api/admin/delivery/partners/:id/toggle-block
 */
router.put("/partners/:id/toggle-block", async (req, res) => {
    try {
        const partnerId = req.params.id;
        let partners = loadPartners();
        const partner = partners.find(p => p.partner_id === partnerId);
        if (!partner) {
            return res.status(404).json({ success: false, message: "Partner not found." });
        }

        partner.is_blocked = !partner.is_blocked;
        if (partner.is_blocked) partner.is_online = false;

        try {
            await pool.query(
                "UPDATE delivery_partners SET is_blocked = $1, is_online = $2, updated_at = NOW() WHERE partner_id = $3",
                [partner.is_blocked, partner.is_online, partnerId]
            );
        } catch {}

        savePartners(partners);
        await recordAudit(
            "Operations Admin",
            partner.is_blocked ? "BLOCK_DELIVERY_PARTNER" : "UNBLOCK_DELIVERY_PARTNER",
            `${partner.is_blocked ? "Blocked" : "Unblocked"} partner ${partnerId}`
        );

        return res.json({
            success: true,
            is_blocked: partner.is_blocked,
            message: `Partner ${partnerId} is now ${partner.is_blocked ? "Blocked" : "Active"}`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/delivery/partners/:id/reset-password
 */
router.post("/partners/:id/reset-password", async (req, res) => {
    try {
        const partnerId = req.params.id;
        const { new_password = "defaultpassword123" } = req.body;

        const password_hash = await bcrypt.hash(new_password, 10);

        let partners = loadPartners();
        const partner = partners.find(p => p.partner_id === partnerId);
        if (partner) {
            partner.password_hash = password_hash;
            savePartners(partners);
        }

        try {
            await pool.query(
                "UPDATE delivery_partners SET password = $1, updated_at = NOW() WHERE partner_id = $2",
                [password_hash, partnerId]
            );
        } catch {}

        await recordAudit("Operations Admin", "RESET_PASSWORD_DELIVERY_PARTNER", `Reset password for ${partnerId}`);

        return res.json({ success: true, message: `Password reset successfully for ${partnerId}.` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   2. LIVE GPS TRACKING (GOOGLE MAPS)
============================================================ */

/**
 * GET /api/admin/delivery/live-tracking & /live-locations
 */
const liveTrackingHandler = async (req, res) => {
    try {
        let partners = [];
        try {
            const dbRes = await pool.query(`
                SELECT partner_id, name, phone, assigned_area, vehicle_type, vehicle_number,
                       current_latitude, current_longitude, is_online, active_orders_count, location_updated_at
                FROM delivery_partners
                WHERE is_blocked = false
            `);
            if (dbRes.rows.length > 0) partners = dbRes.rows;
        } catch {}

        if (partners.length === 0) {
            partners = loadPartners().filter(p => !p.is_blocked);
        }

        const mapMarkers = partners.map(p => ({
            partner_id: p.partner_id,
            name: p.name,
            phone: p.phone,
            latitude: Number(p.current_latitude) || 12.8342,
            longitude: Number(p.current_longitude) || 79.7036,
            is_online: Boolean(p.is_online),
            vehicle_type: p.vehicle_type || "Scooter",
            active_orders_count: p.active_orders_count || 0,
            assigned_area: p.assigned_area
        }));

        return res.json({
            success: true,
            hub_location: {
                name: "Thulirva Farm Hub (Kanchipuram)",
                latitude: 12.8342,
                longitude: 79.7036
            },
            partners: mapMarkers
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/live-tracking", liveTrackingHandler);
router.get("/live-locations", liveTrackingHandler);

/* ============================================================
   3. SMART DISPATCH & "PROCEED" TRIGGER
============================================================ */

/**
 * POST /api/admin/delivery/dispatch/initiate
 * Called when Admin clicks "PROCEED" on verified order
 */
router.post("/dispatch/initiate", async (req, res) => {
    try {
        const order_id = req.body.order_id || req.body.orderId;
        if (!order_id) {
            return res.status(400).json({ success: false, message: "order_id is required" });
        }

        const result = await initiateSmartDispatch(order_id);
        await recordAudit("Operations Admin", "INITIATE_SMART_DISPATCH", `Initiated dispatch for Order #${order_id}. Result: ${JSON.stringify(result)}`);

        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/delivery/dispatch/manual-assign
 * Manual override by Operations Admin
 */
router.post("/dispatch/manual-assign", async (req, res) => {
    try {
        const { order_id, partner_id } = req.body;
        if (!order_id || !partner_id) {
            return res.status(400).json({ success: false, message: "order_id and partner_id are required" });
        }

        // Update orders file / DB
        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        const order = orders.find(o => o.id?.toString() === order_id?.toString() || o.order_number === order_id);
        if (order) {
            order.partner_id = partner_id;
            order.order_status = "processing";
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
        }

        try {
            await pool.query("UPDATE orders SET order_status = 'processing', updated_at = NOW() WHERE id::text = $1 OR order_number = $1", [order_id]);
            await pool.query(`
                INSERT INTO delivery_assignments (assignment_id, order_id, partner_id, assigned_by, status)
                VALUES ($1, $2, $3, 'admin_manual', 'assigned')
                ON CONFLICT (assignment_id) DO UPDATE SET partner_id = $3, status = 'assigned'
            `, [`ASG-MANUAL-${order_id}`, isNaN(Number(order_id)) ? null : Number(order_id), partner_id]);
        } catch {}

        await recordAudit("Operations Admin", "MANUAL_DISPATCH_OVERRIDE", `Manually assigned Order #${order_id} to ${partner_id}`);

        return res.json({
            success: true,
            message: `Order #${order_id} manually assigned to Partner ${partner_id}`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/delivery/dispatch/status/:orderId
 */
router.get("/dispatch/status/:orderId", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const offer = await pool.query(`
            SELECT do.*, dp.name as partner_name, dp.phone as partner_phone
            FROM dispatch_offers do
            JOIN delivery_partners dp ON do.partner_id = dp.partner_id
            WHERE do.order_id = $1
            ORDER BY do.offer_time DESC LIMIT 1
        `, [orderId]).catch(() => ({ rows: [] }));

        if (offer.rows.length > 0) {
            return res.json({ success: true, dispatch: offer.rows[0] });
        }

        return res.json({ success: true, dispatch: null });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/delivery/audit-logs
 */
router.get("/audit-logs", async (req, res) => {
    try {
        const logs = await pool.query(`
            SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 50
        `).catch(() => ({ rows: [] }));

        return res.json({ success: true, logs: logs.rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
