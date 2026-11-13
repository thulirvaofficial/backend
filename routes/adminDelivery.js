const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { initiateSmartDispatch } = require("../services/dispatchEngine");
const { getAdminAttendanceList, getPartnerAttendanceHistory } = require("../services/attendanceService");
const { getAreaAllocationSetting, setAreaAllocationSetting } = require("../services/subscriptionDeliveryService");
const {
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
    getFleetStatistics,
    loadPartnersFromDisk,
    savePartnersToDisk
} = require("../services/deliveryPartnerService");

const router = express.Router();
const DATA_DIR = path.resolve(__dirname, "..", "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

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
        const partners = await getPartners({ status, area });
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
        const pending = await getPartners({ status: "pending_approval" });
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
        const statistics = await getFleetStatistics();
        return res.json({
            success: true,
            statistics
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/fleet-statistics", getFleetStatisticsHandler);

/**
 * GET /api/admin/delivery/partners/:id & /api/admin/delivery/:id
 * Fetch individual partner details
 */
const getSinglePartnerHandler = async (req, res) => {
    try {
        const partner = await getPartnerById(req.params.id);
        if (!partner) {
            return res.status(404).json({ success: false, message: "Partner not found" });
        }
        return res.json({ success: true, partner });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/partners/:id", getSinglePartnerHandler);

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

        const partners = loadPartnersFromDisk();
        const nextNum = partners.length + 1;
        const partner_id = `THU-DP-${String(nextNum).padStart(4, "0")}`;

        const password_hash = await bcrypt.hash(password, 10);

        const newPartner = {
            partner_id,
            name: name.trim(),
            phone: phone.trim(),
            email: email ? email.trim().toLowerCase() : `${partner_id.toLowerCase()}@thulirva.in`,
            password_hash,
            assigned_area,
            vehicle_type,
            vehicle_number,
            current_latitude: null,
            current_longitude: null,
            is_online: true,
            is_active: true,
            is_blocked: false,
            registration_status: "approved",
            kyc_status: "verified",
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
                    current_latitude, current_longitude, is_online, is_active, is_blocked, registration_status, kyc_status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,false,'approved','verified')
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

        await savePartner(newPartner);
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

        const partner = await getPartnerById(partnerId);
        if (!partner) {
            return res.status(404).json({ success: false, message: "Partner not found." });
        }

        if (name) partner.name = name;
        if (phone) partner.phone = phone;
        if (email) partner.email = email;
        if (assigned_area) partner.assigned_area = assigned_area;
        if (vehicle_type) partner.vehicle_type = vehicle_type;
        if (vehicle_number) partner.vehicle_number = vehicle_number;

        await savePartner(partner);
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

        const result = await approvePartner(partnerId, assigned_area);
        if (!result.success) {
            return res.status(404).json(result);
        }

        await recordAudit("Operations Admin", "APPROVE_DELIVERY_PARTNER", `Approved partner registration ${partnerId}`);
        return res.json(result);
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

        const result = await rejectPartner(partnerId, reason);
        if (!result.success) {
            return res.status(404).json(result);
        }

        await recordAudit("Operations Admin", "REJECT_DELIVERY_PARTNER", `Rejected partner ${partnerId}: ${reason || ""}`);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.patch("/partners/:id/reject", rejectPartnerHandler);
router.put("/partners/:id/reject", rejectPartnerHandler);

/**
 * Block & Unblock Endpoints (Supports both PATCH and POST)
 */
router.patch("/partners/:id/block", async (req, res) => {
    const result = await blockPartner(req.params.id);
    await recordAudit("Operations Admin", "BLOCK_DELIVERY_PARTNER", `Blocked partner ${req.params.id}`);
    return res.json(result);
});

router.post("/partners/:id/block", async (req, res) => {
    const result = await blockPartner(req.params.id);
    await recordAudit("Operations Admin", "BLOCK_DELIVERY_PARTNER", `Blocked partner ${req.params.id}`);
    return res.json(result);
});

router.patch("/partners/:id/unblock", async (req, res) => {
    const result = await unblockPartner(req.params.id);
    await recordAudit("Operations Admin", "UNBLOCK_DELIVERY_PARTNER", `Unblocked partner ${req.params.id}`);
    return res.json(result);
});

router.post("/partners/:id/unblock", async (req, res) => {
    const result = await unblockPartner(req.params.id);
    await recordAudit("Operations Admin", "UNBLOCK_DELIVERY_PARTNER", `Unblocked partner ${req.params.id}`);
    return res.json(result);
});

router.put("/partners/:id/toggle-block", async (req, res) => {
    const result = await toggleBlockPartner(req.params.id);
    await recordAudit("Operations Admin", "TOGGLE_BLOCK_PARTNER", `Toggled block for partner ${req.params.id}`);
    return res.json(result);
});

router.patch("/partners/:id/assign-area", async (req, res) => {
    const partnerId = req.params.id;
    const { assigned_area } = req.body;
    const partner = await getPartnerById(partnerId);
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found" });

    partner.assigned_area = assigned_area;
    await savePartner(partner);
    return res.json({ success: true, message: `Area updated for ${partnerId}.` });
});

/**
 * POST /api/admin/delivery/partners/:id/reset-password
 */
router.post("/partners/:id/reset-password", async (req, res) => {
    try {
        const partnerId = req.params.id;
        const { new_password = "defaultpassword123" } = req.body;

        const result = await resetPartnerPassword(partnerId, new_password);
        if (!result.success) return res.status(404).json(result);

        await recordAudit("Operations Admin", "RESET_PASSWORD_DELIVERY_PARTNER", `Reset password for ${partnerId}`);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/delivery/partners/:id/kyc & /api/admin/delivery-partners/:id/kyc
 * Get KYC document URLs and status for a delivery partner
 */
const getPartnerKycHandler = async (req, res) => {
    try {
        const partnerId = req.params.id;
        const partner = await getPartnerById(partnerId);
        if (!partner) {
            return res.status(404).json({ success: false, message: "Partner not found" });
        }

        const kycDir = path.join(DATA_DIR, "kyc_documents", partnerId);
        const frontExists = fs.existsSync(path.join(kycDir, "aadhaar_front.jpg")) || fs.existsSync(path.join(kycDir, "aadhaar_front.png"));
        const backExists = fs.existsSync(path.join(kycDir, "aadhaar_back.jpg")) || fs.existsSync(path.join(kycDir, "aadhaar_back.png"));

        return res.json({
            success: true,
            partner_id: partner.partner_id,
            name: partner.name,
            phone: partner.phone,
            kyc_status: partner.kyc_status || (partner.is_active ? "verified" : "pending_verification"),
            registration_status: partner.registration_status || (partner.is_active ? "approved" : "pending_approval"),
            aadhaar_front_url: `/api/admin/delivery/partners/${partnerId}/kyc/front`,
            aadhaar_back_url: `/api/admin/delivery/partners/${partnerId}/kyc/back`,
            front_uploaded: frontExists,
            back_uploaded: backExists,
            rejection_reason: partner.rejection_reason || null,
            submitted_at: partner.kyc_submitted_at || partner.created_at || new Date().toISOString()
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/partners/:id/kyc", getPartnerKycHandler);

/**
 * GET /api/admin/delivery/partners/:id/kyc/:type (type: 'front' or 'back')
 * Private authenticated document access for Admin
 */
const getPartnerKycDocumentHandler = async (req, res) => {
    try {
        const { id: partnerId, type } = req.params;
        const cleanType = type === "back" ? "back" : "front";
        const kycDir = path.join(DATA_DIR, "kyc_documents", partnerId);

        const possibleFiles = [
            path.join(kycDir, `aadhaar_${cleanType}.jpg`),
            path.join(kycDir, `aadhaar_${cleanType}.jpeg`),
            path.join(kycDir, `aadhaar_${cleanType}.png`),
            path.join(kycDir, `aadhaar_${cleanType}.webp`)
        ];

        for (const file of possibleFiles) {
            if (fs.existsSync(file)) {
                return res.sendFile(file);
            }
        }

        return res.status(404).json({
            success: false,
            message: `KYC document (${cleanType}) not uploaded for partner ${partnerId}`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/partners/:id/kyc/:type", getPartnerKycDocumentHandler);

/**
 * PATCH /api/admin/delivery/partners/:id/kyc & PUT /partners/:id/kyc
 * Admin KYC Actions: 'approve', 'reject', 'request_reupload'
 */
const updatePartnerKycHandler = async (req, res) => {
    try {
        const partnerId = req.params.id;
        const { action, reason } = req.body;

        if (!action || !["approve", "reject", "request_reupload"].includes(action)) {
            return res.status(400).json({
                success: false,
                message: "Valid action required: 'approve', 'reject', or 'request_reupload'"
            });
        }

        const partner = await getPartnerById(partnerId);
        if (!partner) {
            return res.status(404).json({ success: false, message: "Partner not found" });
        }

        let newKycStatus = "pending_verification";
        let newRegStatus = partner.registration_status;

        if (action === "approve") {
            newKycStatus = "verified";
            newRegStatus = "approved";
            partner.is_active = true;
            partner.rejection_reason = null;
        } else if (action === "reject") {
            newKycStatus = "rejected";
            newRegStatus = "rejected";
            partner.is_active = false;
            partner.rejection_reason = reason || "Aadhaar verification criteria not met.";
        } else if (action === "request_reupload") {
            newKycStatus = "reupload_requested";
            partner.rejection_reason = reason || "Please upload clearer photos of Aadhaar card front and back.";
        }

        partner.kyc_status = newKycStatus;
        partner.registration_status = newRegStatus;
        partner.updated_at = new Date().toISOString();

        await savePartner(partner);
        await recordAudit("Operations Admin", `KYC_${action.toUpperCase()}`, `Updated KYC for ${partnerId}: ${newKycStatus}`);

        return res.json({
            success: true,
            message: `KYC for partner ${partnerId} updated to: ${newKycStatus}`,
            kyc_status: newKycStatus,
            registration_status: newRegStatus
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.patch("/partners/:id/kyc", updatePartnerKycHandler);
router.put("/partners/:id/kyc", updatePartnerKycHandler);

/**
 * DELETE /api/admin/delivery/partners/:id & DELETE /api/admin/delivery-partners/:id
 * Permanent deletion with active order checks
 */
const deletePartnerHandler = async (req, res) => {
    try {
        const partnerId = req.params.id;
        const result = await deletePartnerPermanently(partnerId);
        if (!result.success) {
            return res.status(400).json(result);
        }

        await recordAudit("Operations Admin", "DELETE_DELIVERY_PARTNER", `Permanently deleted delivery partner ${partnerId}`);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.delete("/partners/:id", deletePartnerHandler);

/**
 * GET /api/admin/delivery/partners/:id/attendance
 * Get attendance records for specific partner
 */
router.get("/partners/:id/attendance", (req, res) => {
    try {
        const result = getPartnerAttendanceHistory(req.params.id);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Catch-all parameter routes for /api/admin/delivery/:id
 */
router.get("/:id", (req, res, next) => {
    const reserved = ["partners", "pending", "fleet-statistics", "live-tracking", "live-locations", "audit-logs", "attendance", "settings", "dispatch"];
    if (reserved.includes(req.params.id)) {
        return next();
    }
    return getSinglePartnerHandler(req, res);
});

router.delete("/:id", (req, res, next) => {
    const reserved = ["partners", "pending", "fleet-statistics", "live-tracking", "live-locations", "audit-logs", "attendance", "settings", "dispatch"];
    if (reserved.includes(req.params.id)) {
        return next();
    }
    return deletePartnerHandler(req, res);
});

/* ============================================================
   2. LIVE GPS TRACKING (GOOGLE MAPS)
============================================================ */

/**
 * GET /api/admin/delivery/live-tracking & /live-locations
 */
const liveTrackingHandler = async (req, res) => {
    try {
        const partners = await getPartners();
        const unblockedPartners = partners.filter(p => !p.is_blocked);

        const mapMarkers = unblockedPartners.map(p => ({
            partner_id: p.partner_id,
            name: p.name,
            phone: p.phone,
            email: p.email,
            profile_photo: p.profile_photo || null,
            latitude: (p.current_latitude !== undefined && p.current_latitude !== null && !isNaN(Number(p.current_latitude)) && Number(p.current_latitude) !== 0) ? Number(p.current_latitude) : null,
            longitude: (p.current_longitude !== undefined && p.current_longitude !== null && !isNaN(Number(p.current_longitude)) && Number(p.current_longitude) !== 0) ? Number(p.current_longitude) : null,
            speed: Number(p.speed) || 0,
            heading: Number(p.heading) || 0,
            accuracy: Number(p.accuracy) || 0,
            is_online: Boolean(p.is_online),
            is_active: Boolean(p.is_active),
            kyc_status: p.kyc_status || (p.registration_status === 'approved' || p.is_active ? 'APPROVED' : 'PENDING'),
            registration_status: p.registration_status || (p.is_active ? 'approved' : 'pending_approval'),
            vehicle_type: p.vehicle_type || "Scooter",
            vehicle_number: p.vehicle_number || "",
            active_orders_count: p.active_orders_count || 0,
            total_deliveries_count: p.total_deliveries_count || 0,
            assigned_area: p.assigned_area,
            last_active_at: p.last_active_at || null,
            location_updated_at: p.location_updated_at || null
        }));

        return res.json({
            success: true,
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
            await pool.query("UPDATE orders SET partner_id = $1, order_status = 'processing', updated_at = NOW() WHERE id::text = $2 OR order_number = $2", [partner_id, order_id]);
            await pool.query(`
                INSERT INTO delivery_assignments (assignment_id, order_id, partner_id, assigned_by, status)
                VALUES ($1, $2, $3, 'admin_manual', 'assigned')
                ON CONFLICT (assignment_id) DO UPDATE SET partner_id = $3, status = 'assigned'
            `, [`ASG-MANUAL-${order_id}`, isNaN(Number(order_id)) ? null : Number(order_id), partner_id]);
        } catch {}

        await recordAudit("Operations Admin", "MANUAL_DISPATCH_OVERRIDE", `Manually assigned Order #${order_id} to ${partner_id}`);

        // Immediate high-priority push notification and socket alerts
        const { sendNotification } = require("../services/notificationService");
        const { emitToPartner, emitToCustomer, emitToAdmin } = require("../services/socketService");

        sendNotification({
            userId: partner_id,
            title: "THULIRVA – NEW DELIVERY! 🌾",
            message: `New order assigned to you.\nCustomer: ${order?.customer_name || 'Customer'}\nArea: ${order?.city || order?.address || 'Chennai'}\nOrder: #${order?.order_number || order_id}\nType: Home Delivery`,
            type: "delivery_assignment",
            targetId: order_id.toString()
        }).catch(() => {});

        try {
            emitToPartner(partner_id, "order:assigned", {
                order_id: order_id,
                order_number: order?.order_number || `ORD${order_id}`,
                customer_name: order?.customer_name || 'Customer',
                customer_phone: order?.customer_phone || '',
                address: order?.address || '',
                total: order?.total || 0
            });
            if (order?.user_id) {
                emitToCustomer(order.user_id, "order:partner_assigned", {
                    order_id: order_id,
                    partner_id: partner_id
                });
            }
            emitToAdmin("order:assigned", { order_id, partner_id });
        } catch (_) {}

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

/**
 * GET /api/admin/delivery/attendance
 * List partner attendance records with date and partner filters
 */
router.get("/attendance", (req, res) => {
    try {
        const { filter, partner_id, start_date, end_date, search } = req.query;
        const result = getAdminAttendanceList({
            filter: filter || "today",
            partner_id,
            start_date,
            end_date,
            search
        });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/admin/delivery/settings/area-allocation
 * Fetch current area allocation status (true | false)
 */
router.get("/settings/area-allocation", (req, res) => {
    const enabled = getAreaAllocationSetting();
    return res.json({
        success: true,
        area_allocation_enabled: enabled,
        message: enabled
            ? "Area allocation is ENABLED: Partners only see tasks in their assigned areas."
            : "Area allocation is DISABLED: All approved partners see all tasks across all areas."
    });
});

/**
 * POST /api/admin/delivery/settings/area-allocation
 * Toggle area allocation status
 */
router.post("/settings/area-allocation", async (req, res) => {
    try {
        const val = req.body.enabled !== undefined ? req.body.enabled : req.body.area_allocation_enabled;
        if (val === undefined) {
            return res.status(400).json({ success: false, message: "Field 'enabled' or 'area_allocation_enabled' (boolean) is required." });
        }
        const enabled = Boolean(val);

        const ok = setAreaAllocationSetting(enabled);
        if (!ok) {
            return res.status(500).json({ success: false, message: "Failed to persist setting." });
        }

        await recordAudit("Operations Admin", "AREA_ALLOCATION_TOGGLE", `Changed AREA_ALLOCATION_ENABLED to ${enabled}`);

        return res.json({
            success: true,
            area_allocation_enabled: enabled,
            message: `Area allocation setting updated to ${enabled}`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.put("/settings/area-allocation", async (req, res) => {
    try {
        const val = req.body.enabled !== undefined ? req.body.enabled : req.body.area_allocation_enabled;
        if (val === undefined) {
            return res.status(400).json({ success: false, message: "Field 'enabled' or 'area_allocation_enabled' (boolean) is required." });
        }
        const enabled = Boolean(val);

        const ok = setAreaAllocationSetting(enabled);
        if (!ok) {
            return res.status(500).json({ success: false, message: "Failed to persist setting." });
        }

        await recordAudit("Operations Admin", "AREA_ALLOCATION_TOGGLE", `Changed AREA_ALLOCATION_ENABLED to ${enabled}`);

        return res.json({
            success: true,
            area_allocation_enabled: enabled,
            message: `Area allocation setting updated to ${enabled}`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
