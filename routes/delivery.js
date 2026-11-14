const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const {
    getSubscriptionDeliveries,
    updateSubscriptionDeliveryStatus,
    claimSubscriptionDelivery,
    formatDateKey,
    formatReadableDate
} = require("../services/subscriptionDeliveryService");
const {
    checkIn,
    checkOut,
    getTodayAttendance,
    getPartnerAttendanceHistory
} = require("../services/attendanceService");
const {
    checkServiceability,
    getAllAreas
} = require("../services/serviceabilityService");
const {
    handleOfferAccept,
    handleOfferReject,
    getActiveOfferFromMemory
} = require("../services/dispatchEngine");
const {
    emitToAdmin,
    emitToOrder,
    emitToPartner
} = require("../services/socketService");
const {
    loadPartnersFromDisk,
    savePartnersToDisk,
    getPartnerById,
    savePartner
} = require("../services/deliveryPartnerService");
const { uploadDeliveryProof, uploadPartnerPhoto } = require("../middleware/uploadMiddleware");
const { saveDeliveryProof, completeDelivery, getDeliveryDetails } = require("../services/deliveryProofService");
const { validateTransition, normalizeStatus, recordStatusHistory, broadcastStatusChange } = require("../utils/deliveryStateMachine");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "THULIRVA_CHANGE_THIS_SECRET_KEY";

const DATA_DIR = path.resolve(__dirname, "..", "data");
const PARTNERS_FILE = path.join(DATA_DIR, "delivery_partners.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function loadPartners() {
    return loadPartnersFromDisk();
}

function savePartners(partners) {
    savePartnersToDisk(partners);
}

/**
 * Middleware: Verify Delivery Partner JWT Token
 */
function authenticatePartner(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, message: "Authentication required. Please sign in as Delivery Partner." });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== "delivery_partner" && decoded.role !== "admin") {
            return res.status(403).json({ success: false, message: "Access restricted to Delivery Partners." });
        }
        req.partner = decoded;
        next();
    } catch {
        return res.status(401).json({ success: false, message: "Session expired or invalid token. Please log in again." });
    }
}

/* ============================================================
   1. PARTNER REGISTRATION & AUTHENTICATION
============================================================ */

/**
 * Helper: Save Delivery Partner KYC Aadhaar front and back documents
 * Persists images to DATA_DIR/kyc_documents/<partnerId>/aadhaar_front.<ext>
 * Supports Base64 Data URLs (JPEG, PNG, WebP) and raw Base64
 * Returns document access URLs
 */
function savePartnerKycFiles(partnerId, frontData, backData) {
    if (!partnerId) return { frontSaved: false, backSaved: false, frontUrl: null, backUrl: null };

    const kycDir = path.join(DATA_DIR, "kyc_documents", partnerId);
    if (!fs.existsSync(kycDir)) {
        try {
            fs.mkdirSync(kycDir, { recursive: true });
        } catch (dirErr) {
            console.error(`[KYC MKDIR ERROR] ${partnerId}:`, dirErr.message);
        }
    }

    const writeImage = (data, prefix) => {
        if (!data || typeof data !== "string") return false;
        try {
            let ext = "jpg";
            let cleanBase64 = data.trim();
            if (cleanBase64.includes("base64,")) {
                if (cleanBase64.includes("data:image/png")) ext = "png";
                else if (cleanBase64.includes("data:image/webp")) ext = "webp";
                else if (cleanBase64.includes("data:image/jpeg") || cleanBase64.includes("data:image/jpg")) ext = "jpg";
                cleanBase64 = cleanBase64.replace(/^data:image\/[a-zA-Z0-9.+_-]+;base64,/, "");
            }
            const buffer = Buffer.from(cleanBase64, "base64");
            if (!buffer || buffer.length === 0) return false;

            // Remove any existing variant files before saving new file
            ["jpg", "jpeg", "png", "webp"].forEach(e => {
                const old = path.join(kycDir, `${prefix}.${e}`);
                if (fs.existsSync(old)) {
                    try { fs.unlinkSync(old); } catch (_) {}
                }
            });

            fs.writeFileSync(path.join(kycDir, `${prefix}.${ext}`), buffer);
            return true;
        } catch (e) {
            console.error(`[KYC WRITE ERROR] ${partnerId} (${prefix}):`, e.message);
            return false;
        }
    };

    const frontSaved = frontData ? writeImage(frontData, "aadhaar_front") : false;
    const backSaved = backData ? writeImage(backData, "aadhaar_back") : false;

    return {
        frontSaved,
        backSaved,
        frontUrl: `/api/admin/delivery/partners/${partnerId}/kyc/front`,
        backUrl: `/api/admin/delivery/partners/${partnerId}/kyc/back`
    };
}

/**
 * POST /api/delivery/register & /api/delivery-partners/auth/register
 * Real delivery partner registration with DB persistence
 */
const registerPartnerHandler = async (req, res) => {
    try {
        const {
            name,
            phone,
            email,
            password,
            address,
            city = "Chennai",
            pincode,
            vehicle_type = "Scooter",
            vehicle_number = "TN 21 AB 1234",
            assigned_area = "Chennai Central",
            driving_licence,
            identity_documents,
            emergency_contact
        } = req.body;

        if (!name || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Full name, mobile number, and password are required for partner registration."
            });
        }

        const cleanPhone = phone.trim().replace(/\D/g, "").slice(-10);
        if (cleanPhone.length < 10) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit mobile number."
            });
        }

        // Service Area & Pincode Validation via Central Serviceability Engine
        if (pincode) {
            const cleanPin = String(pincode).trim().replace(/\D/g, "");
            if (cleanPin.length === 6) {
                try {
                    const checkRes = await checkServiceability({ pincode: cleanPin });
                    if (!checkRes.serviceable) {
                        const { areas } = await getAllAreas({ includeInactive: false });
                        const areaMatch = areas.find(a => 
                            a.area_name.toLowerCase().includes((assigned_area || "").toLowerCase()) ||
                            (assigned_area || "").toLowerCase().includes(a.area_name.toLowerCase())
                        );
                        if (!areaMatch && cleanPin.startsWith("600") === false && cleanPin.startsWith("601") === false && cleanPin.startsWith("602") === false && cleanPin.startsWith("603") === false) {
                            return res.status(422).json({
                                success: false,
                                message: `Postal PIN code ${cleanPin} is outside Thulirva's active service clusters. Please select a supported delivery hub (e.g. Oragadam, Porur, Valasaravakkam, Adyar, T Nagar).`
                            });
                        }
                    }
                } catch (svcErr) {
                    console.warn("[PARTNER REG SERVICEABILITY CHECK WARN]", svcErr.message);
                }
            }
        }

        // Check duplicate phone or email in PostgreSQL
        try {
            const dupCheck = await pool.query(
                "SELECT id, partner_id, phone, email FROM delivery_partners WHERE phone = $1 OR (email IS NOT NULL AND email = $2)",
                [cleanPhone, email ? email.trim().toLowerCase() : ""]
            );
            if (dupCheck.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: "A delivery partner with this phone number or email is already registered."
                });
            }
        } catch {}

        // Also check disk store
        const existingMemory = loadPartnersFromDisk().find(
            p => p.phone === cleanPhone || (email && p.email && p.email.toLowerCase() === email.trim().toLowerCase())
        );
        if (existingMemory) {
            return res.status(409).json({
                success: false,
                message: "A delivery partner with this phone number or email is already registered."
            });
        }

        // Generate sequential unique partner ID (e.g. THU-DP-0005)
        let nextNumber = loadPartnersFromDisk().length + 1;
        try {
            const countRes = await pool.query("SELECT COUNT(*) FROM delivery_partners");
            nextNumber = Math.max(nextNumber, Number(countRes.rows[0].count) + 1);
        } catch {}

        const partner_id = `THU-DP-${String(nextNumber).padStart(4, "0")}`;
        const password_hash = await bcrypt.hash(password.trim(), 10);

        const newPartner = {
            partner_id,
            name: name.trim(),
            phone: cleanPhone,
            email: email ? email.trim().toLowerCase() : `${partner_id.toLowerCase()}@thulirva.in`,
            password_hash,
            address: address ? address.trim() : "",
            city: city.trim(),
            pincode: pincode ? pincode.trim() : "",
            assigned_area: assigned_area.trim(),
            vehicle_type: vehicle_type.trim(),
            vehicle_number: vehicle_number.trim().toUpperCase(),
            driving_licence: driving_licence ? driving_licence.trim() : null,
            identity_documents: identity_documents ? identity_documents.trim() : null,
            emergency_contact: emergency_contact ? emergency_contact.trim() : null,
            registration_status: "pending_approval",
            rejection_reason: null,
            current_latitude: 13.0827,
            current_longitude: 80.2707,
            is_online: false,
            is_active: false,
            is_blocked: false,
            rating: 5.0,
            total_deliveries_count: 0,
            active_orders_count: 0,
            created_at: new Date().toISOString()
        };

        // Insert into database
        try {
            await pool.query(`
                INSERT INTO delivery_partners (
                    partner_id, name, phone, email, password, address, city, pincode,
                    assigned_area, vehicle_type, vehicle_number, driving_licence,
                    identity_documents, emergency_contact, registration_status,
                    current_latitude, current_longitude, is_online, is_active, is_blocked
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending_approval',$15,$16,false,false,false)
            `, [
                newPartner.partner_id,
                newPartner.name,
                newPartner.phone,
                newPartner.email,
                password_hash,
                newPartner.address,
                newPartner.city,
                newPartner.pincode,
                newPartner.assigned_area,
                newPartner.vehicle_type,
                newPartner.vehicle_number,
                newPartner.driving_licence,
                newPartner.identity_documents,
                newPartner.emergency_contact,
                newPartner.current_latitude,
                newPartner.current_longitude
            ]);
        } catch (dbErr) {
            console.error("[PARTNER REGISTER DB INSERT ERROR]", dbErr.message);
        }

        // Save Aadhaar KYC documents if provided during registration
        if (req.body.aadhaar_front || req.body.aadhaar_back) {
            const kycDocs = savePartnerKycFiles(partner_id, req.body.aadhaar_front, req.body.aadhaar_back);
            newPartner.kyc_status = "pending_verification";
            newPartner.kyc_submitted_at = new Date().toISOString();
            newPartner.aadhaar_front_url = kycDocs.frontUrl;
            newPartner.aadhaar_back_url = kycDocs.backUrl;

            try {
                await pool.query(`
                    UPDATE delivery_partners
                    SET kyc_status = $1, kyc_submitted_at = NOW(), aadhaar_front_url = $2, aadhaar_back_url = $3
                    WHERE partner_id = $4
                `, [newPartner.kyc_status, newPartner.aadhaar_front_url, newPartner.aadhaar_back_url, partner_id]);
            } catch (_) {}
        }

        // Save to central store
        await savePartner(newPartner);

        // Notify Admin via Socket.IO
        emitToAdmin("partner:new_registration", {
            partner_id,
            name: newPartner.name,
            phone: newPartner.phone,
            assigned_area: newPartner.assigned_area,
            timestamp: new Date().toISOString()
        });

        return res.status(201).json({
            success: true,
            message: "Registration submitted successfully! Your application is pending admin approval.",
            partner_id,
            registration_status: "pending_approval",
            kyc_status: newPartner.kyc_status || "pending_verification",
            aadhaar_front_url: newPartner.aadhaar_front_url || null,
            aadhaar_back_url: newPartner.aadhaar_back_url || null
        });
    } catch (err) {
        console.error("[PARTNER REGISTRATION ERROR]", err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.post("/register", registerPartnerHandler);
router.post("/auth/register", registerPartnerHandler);

/**
 * POST /api/delivery/kyc/upload & /api/delivery-partner/kyc/upload
 * Upload Aadhaar card front and back documents
 */
const uploadPartnerKycHandler = async (req, res) => {
    try {
        const { partner_id, partnerId, aadhaar_front, aadhaar_back } = req.body;
        const id = (partner_id || partnerId || (req.partner && req.partner.partner_id) || "").trim();

        if (!id) {
            return res.status(400).json({ success: false, message: "partner_id is required" });
        }

        if (!aadhaar_front && !aadhaar_back) {
            return res.status(400).json({
                success: false,
                message: "Please provide aadhaar_front or aadhaar_back image data."
            });
        }

        const docs = savePartnerKycFiles(id, aadhaar_front, aadhaar_back);

        const p = await getPartnerById(id);
        if (p) {
            p.kyc_status = "pending_verification";
            p.kyc_submitted_at = new Date().toISOString();
            p.updated_at = new Date().toISOString();
            p.aadhaar_front_url = docs.frontUrl;
            p.aadhaar_back_url = docs.backUrl;
            await savePartner(p);
        }

        emitToAdmin("partner:kyc_uploaded", {
            partner_id: id,
            timestamp: new Date().toISOString()
        });

        return res.json({
            success: true,
            message: "Aadhaar KYC documents uploaded successfully. Awaiting operations approval.",
            partner_id: id,
            kyc_status: "pending_verification",
            documents: docs
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.post("/kyc/upload", uploadPartnerKycHandler);
router.post("/auth/kyc/upload", uploadPartnerKycHandler);

/**
 * GET /api/delivery/partners/:id/kyc/:type
 * Document serving endpoint for delivery partner route
 */
router.get("/partners/:id/kyc/:type", (req, res) => {
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
});

/**
 * POST /api/delivery/login & /api/delivery-partners/auth/login
 */
const loginPartnerHandler = async (req, res) => {
    try {
        const { partner_id, partnerId, phone, identifier: rawId, password } = req.body;
        const identifier = (partner_id || partnerId || rawId || phone || "").trim();

        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: "Partner ID or Phone and password are required." });
        }

        let partner = await getPartnerById(identifier);

        if (!partner) {
            return res.status(401).json({ success: false, message: "Invalid Delivery Partner ID or Phone number." });
        }

        // Check registration approval status
        const regStatus = (partner.registration_status || "approved").toLowerCase();
        if (regStatus === "pending_approval") {
            return res.status(403).json({
                success: false,
                status: "pending_approval",
                message: "Your application is currently under review by Thulirva Admin. You will be able to sign in once approved."
            });
        }

        if (regStatus === "rejected") {
            return res.status(403).json({
                success: false,
                status: "rejected",
                message: `Your partner application was not approved. Reason: ${partner.rejection_reason || "Document verification requirements were not met. Please contact support."}`
            });
        }

        if (regStatus === "suspended" || partner.is_suspended) {
            return res.status(403).json({
                success: false,
                status: "suspended",
                message: "Your delivery account is temporarily suspended. Please contact operations admin."
            });
        }

        if (partner.is_blocked || regStatus === "blocked") {
            return res.status(403).json({
                success: false,
                status: "blocked",
                message: "Your delivery account has been blocked. Please contact Thulirva Admin."
            });
        }

        // Validate password (plain 123456 or bcrypt)
        let isValid = false;
        if (password === "123456" || password === partner.password) {
            isValid = true;
        } else if (partner.password_hash || partner.password) {
            isValid = await bcrypt.compare(password, partner.password_hash || partner.password).catch(() => false);
        }

        if (!isValid) {
            return res.status(401).json({ success: false, message: "Incorrect password." });
        }

        // Create JWT token
        const token = jwt.sign(
            {
                partner_id: partner.partner_id,
                name: partner.name,
                phone: partner.phone,
                role: "delivery_partner"
            },
            JWT_SECRET,
            { expiresIn: "30d" }
        );

        // Update partner online status and last_active_at
        try {
            await pool.query(
                "UPDATE delivery_partners SET is_online = true, last_active_at = NOW(), updated_at = NOW() WHERE partner_id = $1",
                [partner.partner_id]
            );
        } catch {}

        partner.is_online = true;
        partner.last_active_at = new Date().toISOString();
        await savePartner(partner);

        return res.json({
            success: true,
            token,
            partner: {
                partner_id: partner.partner_id,
                name: partner.name,
                phone: partner.phone,
                email: partner.email,
                profile_photo: partner.profile_photo || null,
                assigned_area: partner.assigned_area,
                vehicle_type: partner.vehicle_type,
                vehicle_number: partner.vehicle_number,
                current_latitude: partner.current_latitude,
                current_longitude: partner.current_longitude,
                is_online: true,
                rating: partner.rating || 5.0,
                total_deliveries_count: partner.total_deliveries_count || 0,
                registration_status: regStatus,
                kyc_status: partner.kyc_status ? (partner.kyc_status === 'verified' ? 'APPROVED' : partner.kyc_status.toUpperCase()) : (regStatus === "approved" || partner.is_active ? "APPROVED" : "PENDING")
            }
        });
    } catch (err) {
        console.error("[PARTNER LOGIN ERROR]", err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.post("/login", loginPartnerHandler);
router.post("/auth/login", loginPartnerHandler);

/**
 * POST /api/delivery/logout & /api/delivery-partners/auth/logout
 */
const logoutPartnerHandler = async (req, res) => {
    try {
        const partnerId = req.partner?.partner_id;
        if (partnerId) {
            try {
                await pool.query(
                    "UPDATE delivery_partners SET is_online = false, updated_at = NOW() WHERE partner_id = $1",
                    [partnerId]
                );
            } catch {}
            const p = await getPartnerById(partnerId);
            if (p) {
                p.is_online = false;
                await savePartner(p);
            }
        }
        return res.json({ success: true, message: "Logged out successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.post("/logout", authenticatePartner, logoutPartnerHandler);
router.post("/auth/logout", authenticatePartner, logoutPartnerHandler);

/**
 * POST /api/delivery/heartbeat & /api/delivery-partners/heartbeat
 * Real-time periodic heartbeat with online status, coordinates, and pending offers
 */
const heartbeatHandler = async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const { latitude, longitude, is_online = true } = req.body;

        try {
            await pool.query(`
                UPDATE delivery_partners 
                SET last_active_at = NOW(), 
                    is_online = $1,
                    current_latitude = COALESCE($2, current_latitude),
                    current_longitude = COALESCE($3, current_longitude),
                    location_updated_at = NOW(),
                    updated_at = NOW()
                WHERE partner_id = $4
            `, [Boolean(is_online), latitude ? Number(latitude) : null, longitude ? Number(longitude) : null, partnerId]);
        } catch {}

        let partner = await getPartnerById(partnerId);
        if (partner) {
            partner.is_online = Boolean(is_online);
            partner.last_active_at = new Date().toISOString();
            if (latitude) partner.current_latitude = Number(latitude);
            if (longitude) partner.current_longitude = Number(longitude);
            await savePartner(partner);
        }

        // Return active dispatch offer if any
        const activeOffer = getActiveOfferFromMemory(partnerId);

        return res.json({
            success: true,
            is_online: Boolean(is_online),
            has_pending_offer: Boolean(activeOffer),
            offer: activeOffer || null
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.post("/heartbeat", authenticatePartner, heartbeatHandler);
router.post("/auth/heartbeat", authenticatePartner, heartbeatHandler);

/**
 * POST /api/delivery/forgot-password & reset-password
 */
router.post("/forgot-password", async (req, res) => {
    const { identifier, phone, partner_id } = req.body;
    const key = (identifier || phone || partner_id || "").trim();
    if (!key) {
        return res.status(400).json({ success: false, message: "Please provide your registered phone number or Partner ID." });
    }
    return res.json({
        success: true,
        message: "Password reset request recorded. Operations admin will verify your details and assist with the reset."
    });
});
router.post("/auth/forgot-password", (req, res) => res.redirect(307, "../forgot-password"));

/**
 * GET /api/delivery/profile
 */
router.get("/profile", authenticatePartner, async (req, res) => {
    const partnerId = req.partner.partner_id;
    let partner = await getPartnerById(partnerId);

    if (!partner) {
        return res.status(404).json({ success: false, message: "Partner profile not found." });
    }

    // Compute actual completed trips
    let completedOrders = 0;
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            const allOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            completedOrders = allOrders.filter(o => o.partner_id === partnerId && o.order_status === "delivered").length;
        }
    } catch {}

    const subsData = await getSubscriptionDeliveries(formatDateKey(new Date()), partnerId);
    const completedSubs = (subsData.deliveries || []).filter(d => d.status === "delivered").length;
    const calculatedTrips = (Number(partner.total_deliveries_count) || 0) + completedOrders + completedSubs;

    return res.json({
        success: true,
        partner: {
            partner_id: partner.partner_id,
            name: partner.name,
            phone: partner.phone,
            email: partner.email,
            profile_photo: partner.profile_photo || null,
            address: partner.address || "",
            city: partner.city || "Chennai",
            pincode: partner.pincode || "",
            assigned_area: partner.assigned_area,
            vehicle_type: partner.vehicle_type,
            vehicle_number: partner.vehicle_number,
            emergency_contact: partner.emergency_contact || null,
            current_latitude: partner.current_latitude,
            current_longitude: partner.current_longitude,
            is_online: Boolean(partner.is_online),
            is_active: Boolean(partner.is_active),
            rating: partner.rating || 5.0,
            primary_hub: partner.primary_hub || "Thulirva South Distribution Hub, Chennai",
            account_status: (partner.is_active || partner.registration_status === 'approved') ? "Active • Verified" : "Pending Verification",
            kyc_status: partner.kyc_status ? (partner.kyc_status === 'verified' ? 'APPROVED' : partner.kyc_status.toUpperCase()) : (partner.is_active || partner.registration_status === 'approved' ? 'APPROVED' : 'PENDING'),
            registration_status: (partner.registration_status || (partner.is_active ? 'approved' : 'pending_approval')).toUpperCase(),
            total_deliveries_count: calculatedTrips
        }
    });
});

/**
 * PUT /api/delivery/profile & POST /api/delivery/profile/update
 * Update partner profile details
 */
const updatePartnerProfileHandler = async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const {
            name, phone, email, address, city, pincode,
            vehicle_type, vehicle_number, emergency_contact
        } = req.body;

        let partner = await getPartnerById(partnerId);
        if (!partner) {
            return res.status(404).json({ success: false, message: "Partner profile not found." });
        }

        if (name && name.trim()) partner.name = name.trim();
        if (phone && phone.trim()) partner.phone = phone.trim();
        if (email && email.trim()) partner.email = email.trim();
        if (address !== undefined) partner.address = address.trim();
        if (city !== undefined) partner.city = city.trim();
        if (pincode !== undefined) partner.pincode = pincode.trim();
        if (vehicle_type && vehicle_type.trim()) partner.vehicle_type = vehicle_type.trim();
        if (vehicle_number && vehicle_number.trim()) partner.vehicle_number = vehicle_number.trim();
        if (emergency_contact !== undefined) partner.emergency_contact = emergency_contact ? emergency_contact.trim() : null;
        partner.updated_at = new Date().toISOString();

        await savePartner(partner);

        try {
            await pool.query(`
                UPDATE delivery_partners
                SET name = COALESCE($1, name),
                    phone = COALESCE($2, phone),
                    email = COALESCE($3, email),
                    address = COALESCE($4, address),
                    city = COALESCE($5, city),
                    pincode = COALESCE($6, pincode),
                    vehicle_type = COALESCE($7, vehicle_type),
                    vehicle_number = COALESCE($8, vehicle_number),
                    emergency_contact = COALESCE($9, emergency_contact),
                    updated_at = NOW()
                WHERE partner_id = $10
            `, [
                name ? name.trim() : null,
                phone ? phone.trim() : null,
                email ? email.trim() : null,
                address !== undefined ? address.trim() : null,
                city !== undefined ? city.trim() : null,
                pincode !== undefined ? pincode.trim() : null,
                vehicle_type ? vehicle_type.trim() : null,
                vehicle_number ? vehicle_number.trim() : null,
                emergency_contact ? emergency_contact.trim() : null,
                partnerId
            ]);
        } catch (_) {}

        return res.json({
            success: true,
            message: "Profile updated successfully.",
            partner: {
                partner_id: partner.partner_id,
                name: partner.name,
                phone: partner.phone,
                email: partner.email,
                profile_photo: partner.profile_photo || null,
                address: partner.address || "",
                city: partner.city || "Chennai",
                pincode: partner.pincode || "",
                assigned_area: partner.assigned_area,
                vehicle_type: partner.vehicle_type,
                vehicle_number: partner.vehicle_number,
                emergency_contact: partner.emergency_contact || null,
                is_online: Boolean(partner.is_online),
                is_active: Boolean(partner.is_active),
                rating: partner.rating || 5.0
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.put("/profile", authenticatePartner, updatePartnerProfileHandler);
router.post("/profile/update", authenticatePartner, updatePartnerProfileHandler);

/**
 * POST /api/delivery/profile/photo
 * Upload or replace delivery partner profile photo (supports Multipart and Base64)
 */
router.post("/profile/photo", authenticatePartner, uploadPartnerPhoto, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const { photo, photo_base64 } = req.body || {};
        const photoData = photo_base64 || photo;
        const partnersDir = path.resolve(__dirname, "..", "public", "uploads", "partners");
        if (!fs.existsSync(partnersDir)) fs.mkdirSync(partnersDir, { recursive: true });

        let filename = "";
        let photoUrl = "";

        if (req.file) {
            filename = req.file.filename;
            photoUrl = `/uploads/partners/${filename}`;
        } else if (photoData && typeof photoData === "string") {
            let ext = "jpg";
            const mimeMatch = photoData.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
            if (mimeMatch) {
                ext = mimeMatch[1].toLowerCase() === "jpeg" ? "jpg" : mimeMatch[1].toLowerCase();
            }
            const cleanBase64 = photoData.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(cleanBase64, "base64");

            if (buffer.length > 10 * 1024 * 1024) {
                return res.status(400).json({
                    success: false,
                    message: "Photo file size exceeds maximum limit of 10MB."
                });
            }

            filename = `profile_${partnerId}_${Date.now()}.${ext}`;
            const filePath = path.join(partnersDir, filename);
            fs.writeFileSync(filePath, buffer);
            photoUrl = `/uploads/partners/${filename}`;
        } else {
            return res.status(400).json({ success: false, message: "Photo file or base64 data is required." });
        }

        // Also copy to website uploads so all static paths work seamlessly
        const altDir = path.resolve(__dirname, "..", "..", "website", "website", "assets", "images", "uploads", "partners");
        if (!fs.existsSync(altDir)) {
            try { fs.mkdirSync(altDir, { recursive: true }); } catch (_) {}
        }
        try {
            const src = path.join(partnersDir, filename);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(altDir, filename));
            }
        } catch (_) {}

        // Retrieve existing partner
        const partner = await getPartnerById(partnerId);

        // Update in central store
        if (partner) {
            partner.profile_photo = photoUrl;
            partner.updated_at = new Date().toISOString();
            await savePartner(partner);
        }

        // Update in PostgreSQL
        try {
            await pool.query(
                "UPDATE delivery_partners SET profile_photo = $1, updated_at = NOW() WHERE partner_id = $2",
                [photoUrl, partnerId]
            );
        } catch (_) {}

        emitToAdmin("partner:updated", {
            partner_id: partnerId,
            profile_photo: photoUrl,
            updated_at: new Date().toISOString()
        });

        return res.json({
            success: true,
            message: "Profile photo uploaded successfully.",
            profile_photo: photoUrl,
            photo_url: photoUrl,
            partner: {
                partner_id: partner ? partner.partner_id : partnerId,
                name: partner ? partner.name : "Partner",
                phone: partner ? partner.phone : "",
                email: partner ? partner.email : "",
                profile_photo: photoUrl
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * DELETE /api/delivery/profile/photo
 * Remove delivery partner profile photo
 */
router.delete("/profile/photo", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;

        const partner = await getPartnerById(partnerId);
        if (partner) {
            partner.profile_photo = null;
            partner.updated_at = new Date().toISOString();
            await savePartner(partner);
        }

        try {
            await pool.query(
                "UPDATE delivery_partners SET profile_photo = NULL, updated_at = NOW() WHERE partner_id = $1",
                [partnerId]
            );
        } catch (_) {}

        return res.json({
            success: true,
            message: "Profile photo removed successfully."
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   DAILY PHOTO ATTENDANCE ENDPOINTS
============================================================ */

/**
 * POST /api/delivery/attendance/check-in
 * Check in with live camera selfie & GPS location
 */
router.post("/attendance/check-in", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const partnerName = req.partner.name;
        const { photo, photo_base64, latitude, longitude, is_camera } = req.body;

        const result = await checkIn({
            partner_id: partnerId,
            partner_name: partnerName,
            photo_base64: photo_base64 || photo,
            latitude,
            longitude,
            is_camera: is_camera !== undefined ? is_camera : true
        });

        if (!result.success) {
            return res.status(400).json(result);
        }

        // Mark partner online upon check-in
        const partner = await getPartnerById(partnerId);
        if (partner) {
            partner.is_online = true;
            await savePartner(partner);
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("attendance_checked_in", result.attendance);
            }
        } catch (_) {}

        return res.status(201).json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/delivery/attendance/check-out
 * Check out with photo, GPS location & working hours calculation
 */
router.post("/attendance/check-out", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const { photo, photo_base64, latitude, longitude } = req.body;

        const result = await checkOut({
            partner_id: partnerId,
            photo_base64: photo_base64 || photo,
            latitude,
            longitude
        });

        if (!result.success) {
            return res.status(400).json(result);
        }

        // Mark partner offline upon checkout
        const partner = await getPartnerById(partnerId);
        if (partner) {
            partner.is_online = false;
            await savePartner(partner);
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("attendance_checked_out", result.attendance);
            }
        } catch (_) {}

        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/delivery/attendance/today
 * Check today's attendance status
 */
router.get("/attendance/today", authenticatePartner, (req, res) => {
    const partnerId = req.partner.partner_id;
    const result = getTodayAttendance(partnerId);
    return res.json(result);
});

/**
 * GET /api/delivery/attendance/history
 * List partner's historical attendance records
 */
router.get("/attendance/history", authenticatePartner, (req, res) => {
    const partnerId = req.partner.partner_id;
    const result = getPartnerAttendanceHistory(partnerId);
    return res.json(result);
});

/**
 * PUT & PATCH /api/delivery/status
 * Toggle online / offline
 */
const updatePartnerStatusHandler = async (req, res) => {
    const partnerId = req.partner.partner_id;
    const is_online = req.body.is_online !== undefined ? req.body.is_online : req.body.isOnline;

    // Issue 6: Block going offline if active deliveries exist
    if (!Boolean(is_online) && !req.body.force) {
        try {
            const activeRes = await pool.query(
                "SELECT id, order_status FROM orders WHERE partner_id = $1 AND LOWER(COALESCE(order_status, '')) IN ('assigned', 'accepted', 'in_transit', 'out_for_delivery')",
                [partnerId]
            );
            if (activeRes.rows && activeRes.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    has_active_deliveries: true,
                    active_count: activeRes.rows.length,
                    message: `Cannot go offline while you have ${activeRes.rows.length} active delivery in progress. Complete all assigned orders before ending your shift.`
                });
            }
        } catch (_) {}
    }

    try {
        await pool.query(
            "UPDATE delivery_partners SET is_online = $1, updated_at = NOW() WHERE partner_id = $2",
            [Boolean(is_online), partnerId]
        );
    } catch {}

    const partner = await getPartnerById(partnerId);
    if (partner) {
        partner.is_online = Boolean(is_online);
        await savePartner(partner);
    }

    emitToAdmin("partner:status:changed", {
        partnerId,
        is_online: Boolean(is_online),
        timestamp: new Date().toISOString()
    });

    return res.json({
        success: true,
        is_online: Boolean(is_online),
        message: `Delivery Partner is now ${is_online ? "ONLINE" : "OFFLINE"}`
    });
};

router.put("/status", authenticatePartner, updatePartnerStatusHandler);
router.patch("/status", authenticatePartner, updatePartnerStatusHandler);
router.patch("/availability", authenticatePartner, updatePartnerStatusHandler);

/**
 * POST /api/delivery/location
 * GPS tracking updates from mobile app foreground/background service
 */
router.post("/location", authenticatePartner, async (req, res) => {
    const partnerId = req.partner.partner_id;
    const { latitude, longitude, speed = 0, heading = 0, accuracy = 0 } = req.body;

    if (!latitude || !longitude) {
        return res.status(400).json({ success: false, message: "Latitude and longitude required" });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    try {
        await pool.query(`
            UPDATE delivery_partners 
            SET current_latitude = $1, current_longitude = $2, location_updated_at = NOW(), updated_at = NOW()
            WHERE partner_id = $3
        `, [lat, lng, partnerId]);

        await pool.query(`
            INSERT INTO partner_location_history (partner_id, latitude, longitude, speed, heading, accuracy)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [partnerId, lat, lng, speed, heading, accuracy]);
    } catch {}

    let partner = await getPartnerById(partnerId);
    if (partner) {
        partner.current_latitude = lat;
        partner.current_longitude = lng;
        partner.speed = speed;
        partner.heading = heading;
        partner.last_active_at = new Date().toISOString();
        await savePartner(partner);
    }

    emitToAdmin("delivery:location:update", {
        partnerId,
        latitude: lat,
        longitude: lng,
        speed,
        heading,
        accuracy,
        timestamp: new Date().toISOString()
    });

    return res.json({ success: true, message: "Location updated" });
});

/* ============================================================
   2. HOME DASHBOARD METRICS (EXACT MATCH SCREEN 2)
============================================================ */

/**
 * GET /api/delivery/dashboard
 * Real-time dynamic live counts calculated from database & disk
 */
router.get("/dashboard", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const now = new Date();
        const todayStr = formatDateKey(now);
        const dateLabel = formatReadableDate(now);

        const subsData = await getSubscriptionDeliveries(todayStr, partnerId);

        // Fetch product orders strictly (excluding subscriptions)
        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        const partnerOrders = orders.filter(o => {
            const isSub = (o.order_type === "subscription" || o.delivery_type === "subscription" || (o.id && o.id.toString().startsWith("SUB-")));
            if (isSub) return false;
            return !o.partner_id || o.partner_id === partnerId;
        });

        const ordersTotal = partnerOrders.length;
        const ordersDelivered = partnerOrders.filter(o => o.order_status === "delivered").length;
        const ordersPending = ordersTotal - ordersDelivered;

        const subTotal = subsData.total;
        const subDelivered = subsData.delivered;
        const subPending = subsData.pending;

        const totalDelivered = subDelivered + ordersDelivered;
        const earningsToday = Math.round(ordersDelivered * 35 + subDelivered * 30);

        // Partner name & status
        const partner = await getPartnerById(partnerId) || {
            name: req.partner.name || "Delivery Partner",
            is_online: false
        };

        return res.json({
            success: true,
            dashboard: {
                partner_name: partner.name || req.partner.name || "Delivery Partner",
                is_online: Boolean(partner.is_online),
                date_label: dateLabel,
                today_deliveries: {
                    subscription_total: subTotal,
                    orders_total: ordersTotal,
                    subscription_delivered: subDelivered,
                    subscription_pending: subPending,
                    orders_delivered: ordersDelivered,
                    orders_pending: ordersPending,
                    total_deliveries: totalDelivered
                },
                earnings_today: earningsToday,
                banner: {
                    title: "Deliver Fresh from Our Farms",
                    subtitle: "Pure Organic Farm Goodness Doorstep Delivery",
                    image: "/assets/images/farm_milk_bottle.png"
                }
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   3. SUBSCRIPTION DELIVERIES (EXACT MATCH SCREEN 3)
============================================================ */

/**
 * GET /api/delivery/subscriptions
 * Query param: date (YYYY-MM-DD or today)
 */
const getSubscriptionsHandler = async (req, res) => {
    try {
        const { date, search } = req.query;
        const targetDate = date ? new Date(date) : new Date();
        const dateKey = formatDateKey(targetDate);
        const dateLabel = formatReadableDate(targetDate);

        // Pass partner object to respect AREA_ALLOCATION_ENABLED business rule
        const result = await getSubscriptionDeliveries(dateKey, req.partner);
        let items = result.deliveries || [];

        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            items = items.filter(i =>
                (i.customer_name || "").toLowerCase().includes(q) ||
                (i.subscription_id || "").toLowerCase().includes(q) ||
                (i.address || "").toLowerCase().includes(q) ||
                (i.product_name || "").toLowerCase().includes(q)
            );
        }

        return res.json({
            success: true,
            date: dateKey,
            date_label: dateLabel,
            stats: {
                total: result.total,
                delivered: result.delivered,
                pending: result.pending,
                out_for_delivery: result.outForDelivery || 0,
                failed: result.failed || 0
            },
            deliveries: items
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/subscriptions", authenticatePartner, getSubscriptionsHandler);
router.get("/subscription-deliveries", authenticatePartner, getSubscriptionsHandler);

/**
 * POST /api/delivery/subscriptions/:id/claim
 * Atomic Claiming of a Subscription Delivery Task
 */
router.post("/subscriptions/:id/claim", authenticatePartner, async (req, res) => {
    try {
        const id = req.params.id;
        const partnerId = req.partner.partner_id;
        const partnerName = req.partner.name;

        const result = await claimSubscriptionDelivery(id, partnerId, partnerName);
        if (!result.success) {
            return res.status(result.conflict ? 409 : 400).json(result);
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("subscription_delivery_claimed", {
                    delivery_id: id,
                    partner_id: partnerId,
                    partner_name: partnerName,
                    claimed_at: new Date().toISOString()
                });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: "Subscription delivery task claimed successfully.",
            delivery: result.delivery
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/delivery/subscriptions/:id/status
 * Mark delivered or failed (with partner ownership check)
 */
router.put("/subscriptions/:id/status", authenticatePartner, async (req, res) => {
    try {
        const id = req.params.id;
        const partnerId = req.partner.partner_id;
        const { status, notes, failed_reason } = req.body;

        if (!status) {
            return res.status(400).json({ success: false, message: "Status required ('delivered' or 'failed')" });
        }

        const result = await updateSubscriptionDeliveryStatus(id, status, notes, failed_reason, partnerId);
        if (!result.success) {
            return res.status(result.conflict ? 409 : 404).json(result);
        }

        try {
            if (typeof emitToAdmin === "function") {
                emitToAdmin("subscription_delivery_updated", {
                    delivery_id: id,
                    status,
                    partner_id: partnerId,
                    delivered_at: result.delivery?.delivered_at
                });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: `Subscription delivery marked as ${status}`,
            delivery: result.delivery
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   4. PRODUCT ORDERS (EXACT MATCH SCREEN 4)
============================================================ */

/**
 * GET /api/delivery/orders
 */
const getOrdersHandler = async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const { date, search } = req.query;
        const targetDate = date ? new Date(date) : new Date();
        const dateKey = formatDateKey(targetDate);
        const dateLabel = formatReadableDate(targetDate);

        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        // Strict Product Orders partition: NEVER return subscriptions!
        let filtered = orders.filter(o => {
            const isSub = (o.order_type === "subscription" || o.delivery_type === "subscription" || (o.id && o.id.toString().startsWith("SUB-")));
            if (isSub) return false;
            return !o.partner_id || o.partner_id === partnerId;
        });

        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter(o =>
                (o.order_number || "").toLowerCase().includes(q) ||
                (o.customer_name || "").toLowerCase().includes(q) ||
                (o.address || "").toLowerCase().includes(q)
            );
        }

        const total = filtered.length;
        const delivered = filtered.filter(o => o.order_status === "delivered").length;
        const pending = total - delivered;

        return res.json({
            success: true,
            date: dateKey,
            date_label: dateLabel,
            stats: {
                total,
                delivered,
                pending
            },
            orders: filtered
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/orders", authenticatePartner, getOrdersHandler);
router.get("/product-orders", authenticatePartner, getOrdersHandler);

/**
 * PUT & POST /api/delivery/orders/:id/status
 * Multi-stage workflow: assigned -> pickup_confirmed -> in_transit -> delivered
 */
const updatePartnerOrderStatusHandler = async (req, res) => {
    try {
        const id = req.params.id;
        const { status, failed_reason, notes, latitude, longitude } = req.body;
        const partnerId = req.partner.partner_id;

        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        let order = orders.find(o => o.id?.toString() === id?.toString() || o.order_number === id);

        // Also query DB if not in file or to get complete order data
        try {
            const dbRes = await pool.query(
                "SELECT * FROM orders WHERE id::text = $1 OR order_number = $1",
                [id.toString()]
            );
            if (dbRes.rows && dbRes.rows.length) {
                if (!order) {
                    order = dbRes.rows[0];
                    orders.unshift(order);
                } else {
                    Object.assign(order, dbRes.rows[0]);
                }
            }
        } catch (_) {}

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        // Enforce mandatory delivery state machine
        if (status) {
            const check = validateTransition(order.order_status, status, {
                partnerId,
                orderPartnerId: order.partner_id,
                hasProof: Boolean(order.delivery_proof || req.body?.imageBase64 || req.body?.image),
                isAdmin: false
            });

            if (!check.valid) {
                return res.status(check.status).json({
                    success: false,
                    error_code: check.code,
                    message: check.message
                });
            }
        }

        const normStatus = status ? normalizeStatus(status) : order.order_status;

        order.order_status = normStatus;
        order.status = normStatus;
        order.partner_id = partnerId;
        if (normStatus === "delivered") {
            order.delivered_at = new Date().toISOString();
        }
        if (failed_reason) order.failed_reason = failed_reason;
        if (notes) order.notes = notes;

        // Also update in DB if available
        try {
            await pool.query(`
                UPDATE orders 
                SET order_status = $1, partner_id = COALESCE(partner_id, $2),
                    delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
                    updated_at = NOW()
                WHERE id::text = $3 OR order_number = $3
            `, [normStatus, partnerId, id.toString()]);
        } catch {}

        // Log to order status history
        try {
            await recordStatusHistory({
                orderId: order.id || id,
                status: normStatus,
                partnerId,
                notes: notes || `Partner status update: ${normStatus}`,
                latitude,
                longitude
            });
        } catch (_) {}

        // If delivered, increment partner delivery count
        if (normStatus === "delivered") {
            try {
                const partner = await getPartnerById(partnerId);
                if (partner) {
                    partner.total_deliveries_count = (partner.total_deliveries_count || 0) + 1;
                    partner.today_deliveries_count = (partner.today_deliveries_count || 0) + 1;
                    await savePartner(partner);
                }
                await pool.query(`
                    UPDATE delivery_partners 
                    SET total_deliveries_count = COALESCE(total_deliveries_count, 0) + 1,
                        today_deliveries_count = COALESCE(today_deliveries_count, 0) + 1,
                        updated_at = NOW()
                    WHERE partner_id = $1
                `, [partnerId]);
            } catch (_) {}
        }

        saveOrders(orders);

        // Real-time Socket broadcasts via state machine
        try {
            broadcastStatusChange({
                orderId: id,
                status: normStatus,
                partnerId,
                userId: order.user_id,
                additionalData: { delivered_at: order.delivered_at }
            });
        } catch (_) {}

        return res.json({
            success: true,
            message: `Order status updated to ${normStatus}`,
            order
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.put("/orders/:id/status", authenticatePartner, updatePartnerOrderStatusHandler);
router.post("/orders/:id/status", authenticatePartner, updatePartnerOrderStatusHandler);

/**
 * POST /api/delivery/orders/:id/delivery-proof
 * Delivery partner uploads photo proof and completes order
 */
router.post("/orders/:id/delivery-proof", authenticatePartner, uploadDeliveryProof, async (req, res) => {
    try {
        const id = req.params.id;
        const partnerId = req.partner.partner_id;
        const { remarks, latitude, longitude, image, photo, proof } = req.body || {};

        const result = await saveDeliveryProof({
            orderId: id,
            partnerId,
            file: req.file,
            imageBase64: image || photo || proof,
            remarks,
            latitude,
            longitude,
            markDelivered: true
        });

        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/delivery/subscriptions/:id/delivery-proof
 * Delivery partner uploads photo proof for subscription delivery
 */
router.post("/subscriptions/:id/delivery-proof", authenticatePartner, uploadDeliveryProof, async (req, res) => {
    try {
        const id = req.params.id;
        const partnerId = req.partner.partner_id;
        const { remarks, latitude, longitude, image, photo, proof } = req.body || {};

        const result = await saveDeliveryProof({
            subId: id,
            partnerId,
            file: req.file,
            imageBase64: image || photo || proof,
            remarks,
            latitude,
            longitude,
            markDelivered: true
        });

        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

router.get("/orders/:id/delivery-proof", authenticatePartner, async (req, res) => {
    try {
        const details = await getDeliveryDetails(req.params.id);
        if (!details) return res.status(404).json({ success: false, message: "Order not found" });
        return res.json({
            success: true,
            order_id: req.params.id,
            delivery_proof: details.delivery_proof,
            delivery_proof_urls: details.delivery_proof_urls,
            proof_status: details.proof_status
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/subscriptions/:id/delivery-proof", authenticatePartner, async (req, res) => {
    try {
        const details = await getDeliveryDetails(`SUB-${req.params.id}`);
        if (!details) return res.status(404).json({ success: false, message: "Subscription not found" });
        return res.json({
            success: true,
            subscription_id: req.params.id,
            delivery_proof: details.delivery_proof,
            delivery_proof_urls: details.delivery_proof_urls,
            proof_status: details.proof_status
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

function saveOrders(orders) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
    } catch {}
}

/* ============================================================
   5. DELIVERY LOG (EXACT MATCH SCREEN 5)
============================================================ */

/**
 * GET /api/delivery/log
 * Filter: 'all', 'subscription', 'orders'
 */
const getDeliveryLogHandler = async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const filter = (req.query.filter || "all").toLowerCase();
        const dateParam = req.query.date;
        const targetDate = dateParam ? new Date(dateParam) : new Date();
        const dateKey = formatDateKey(targetDate);

        // Subscriptions
        const subsData = await getSubscriptionDeliveries(dateKey, partnerId);
        const deliveredSubs = (subsData.deliveries || []).filter(d => d.status === "delivered").map(d => ({
            id: d.subscription_id || `SUB${d.id}`,
            code: d.subscription_id || `SUB${d.id}`,
            type: "subscription",
            item_text: d.product_name,
            customer_name: d.customer_name,
            address: d.address,
            delivery_time: d.delivered_at ? formatTimeStr(d.delivered_at) : "08:12 AM",
            status: "Delivered",
            icon: "calendar"
        }));

        // Product orders (excluding subscriptions)
        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        const deliveredOrders = orders.filter(o => {
            const isSub = (o.order_type === "subscription" || o.delivery_type === "subscription" || (o.id && o.id.toString().startsWith("SUB-")));
            if (isSub) return false;
            return o.order_status === "delivered" && (!o.partner_id || o.partner_id === partnerId);
        }).map(o => {
            const firstItem = (o.items && o.items[0]) ? (o.items[0].name || o.items[0].product_name) : "Farm Products";
            return {
                id: o.order_number || `ORD${o.id}`,
                code: o.order_number || `ORD${o.id}`,
                type: "order",
                item_text: firstItem,
                customer_name: o.customer_name,
                address: o.address,
                delivery_time: o.delivered_at ? formatTimeStr(o.delivered_at) : "08:45 AM",
                status: "Delivered",
                icon: "box"
            };
        });

        let combined = [];
        if (filter === "subscription") {
            combined = deliveredSubs;
        } else if (filter === "orders") {
            combined = deliveredOrders;
        } else {
            combined = [...deliveredSubs, ...deliveredOrders];
        }

        const subDeliveredCount = deliveredSubs.length;
        const ordDeliveredCount = deliveredOrders.length;
        const totalDeliveredCount = subDeliveredCount + ordDeliveredCount;

        return res.json({
            success: true,
            filter,
            log_items: combined,
            today_summary: {
                subscription_delivered: subDeliveredCount,
                orders_delivered: ordDeliveredCount,
                total_deliveries: totalDeliveredCount
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/log", authenticatePartner, getDeliveryLogHandler);
router.get("/delivery-log", authenticatePartner, getDeliveryLogHandler);

function formatTimeStr(dateStr) {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "08:30 AM";
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, "0");
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
    } catch {
        return "08:30 AM";
    }
}

/* ============================================================
   6. DISPATCH OFFERS & LIVE REQUESTS (MODAL & TIMEOUT)
============================================================ */

/**
 * GET /api/delivery/active-offers
 */
const getActiveOffersHandler = async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;

        // Check DB for pending offers
        const offers = await pool.query(`
            SELECT do.*, o.customer_name, o.address, o.total, o.city
            FROM dispatch_offers do
            LEFT JOIN orders o ON do.order_id = o.id
            WHERE do.partner_id = $1 AND do.status = 'pending' AND do.expires_at > NOW()
            ORDER BY do.offer_time DESC LIMIT 1
        `, [partnerId]).catch(() => ({ rows: [] }));

        if (offers.rows.length > 0) {
            const offer = offers.rows[0];
            const remainingSecs = Math.max(0, Math.floor((new Date(offer.expires_at) - new Date()) / 1000));
            return res.json({
                success: true,
                has_active_offer: true,
                offer: {
                    ...offer,
                    remaining_seconds: remainingSecs
                }
            });
        }

        // Check in-memory offer fallback
        const memoryOffer = getActiveOfferFromMemory(partnerId);
        if (memoryOffer) {
            return res.json({
                success: true,
                has_active_offer: true,
                offer: memoryOffer
            });
        }

        return res.json({ success: true, has_active_offer: false });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/active-offers", authenticatePartner, getActiveOffersHandler);
router.get("/assignments", authenticatePartner, getActiveOffersHandler);

/**
 * POST /api/delivery/offers/:id/accept
 */
const acceptOfferHandler = async (req, res) => {
    const orderId = req.params.id;
    const partnerId = req.partner.partner_id;

    const result = await handleOfferAccept(orderId, partnerId);
    return res.json(result);
};

router.post("/offers/:id/accept", authenticatePartner, acceptOfferHandler);
router.post("/assignments/:id/accept", authenticatePartner, acceptOfferHandler);

/**
 * POST /api/delivery/offers/:id/reject
 */
const rejectOfferHandler = async (req, res) => {
    const orderId = req.params.id;
    const partnerId = req.partner.partner_id;
    const { reason = "Not Available" } = req.body;

    const result = await handleOfferReject(orderId, partnerId, reason);
    return res.json(result);
};

router.post("/offers/:id/reject", authenticatePartner, rejectOfferHandler);
router.post("/assignments/:id/reject", authenticatePartner, rejectOfferHandler);

/* ============================================================
   7. EARNINGS (DYNAMIC SERVER-CALCULATED)
============================================================ */

router.get("/earnings", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const now = new Date();
        const todayStr = formatDateKey(now);

        // 1. Subscription deliveries
        const subsData = await getSubscriptionDeliveries(todayStr, req.partner);
        const subDeliveredToday = (subsData.deliveries || []).filter(d => 
            (d.partner_id === partnerId || d.assigned_partner_id === partnerId) && d.status === "delivered"
        ).length;

        // 2. Product orders
        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        const isToday = (dateStr) => {
            if (!dateStr) return false;
            try {
                return formatDateKey(new Date(dateStr)) === todayStr;
            } catch { return false; }
        };

        const isWithinDays = (dateStr, days) => {
            if (!dateStr) return false;
            try {
                const diff = (now.getTime() - new Date(dateStr).getTime()) / (1000 * 3600 * 24);
                return diff >= 0 && diff <= days;
            } catch { return false; }
        };

        const partnerOrders = orders.filter(o => {
            const isSub = (o.order_type === "subscription" || o.delivery_type === "subscription" || (o.id && o.id.toString().startsWith("SUB-")));
            if (isSub) return false;
            return o.partner_id === partnerId && (o.order_status === "delivered" || o.status === "delivered");
        });

        const ordersDeliveredToday = partnerOrders.filter(o => isToday(o.delivered_at || o.updated_at || o.created_at)).length;
        const totalDeliveredToday = subDeliveredToday + ordersDeliveredToday;

        const basePayoutToday = Math.round(ordersDeliveredToday * 40 + subDeliveredToday * 35);
        const incentivesToday = totalDeliveredToday >= 20 ? 200 : (totalDeliveredToday >= 10 ? 100 : 0);
        const earningsToday = basePayoutToday + incentivesToday;

        // Week and Month calculations strictly from real records
        const ordersThisWeek = partnerOrders.filter(o => isWithinDays(o.delivered_at || o.updated_at || o.created_at, 7)).length;
        const ordersThisMonth = partnerOrders.filter(o => isWithinDays(o.delivered_at || o.updated_at || o.created_at, 30)).length;

        const weeklyEarnings = (ordersThisWeek * 40) + (subDeliveredToday * 35) + (ordersThisWeek >= 10 ? 100 : 0);
        const monthlyEarnings = (ordersThisMonth * 40) + (subDeliveredToday * 35) + (ordersThisMonth >= 10 ? 100 : 0);

        return res.json({
            success: true,
            earnings: {
                today: earningsToday,
                this_week: Math.max(weeklyEarnings, earningsToday),
                this_month: Math.max(monthlyEarnings, weeklyEarnings, earningsToday),
                deliveries_today: totalDeliveredToday,
                base_payout: basePayoutToday,
                incentives: incentivesToday,
                tips: 0,
                recent_payouts: []
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   8. NOTIFICATIONS & TASK COMPLETION LIFECYCLE
============================================================ */

/**
 * GET /api/delivery/notifications
 * Also /api/delivery-partner/notifications
 */
router.get("/notifications", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        let notifs = [];
        try {
            const dbRes = await pool.query(
                `SELECT * FROM notifications 
                 WHERE LOWER(user_id::text) = $1 OR user_id = 'all' OR user_id = 'delivery_partners'
                 ORDER BY created_at DESC LIMIT 50`,
                [partnerId.toLowerCase()]
            );
            if (dbRes.rows && dbRes.rows.length) {
                notifs = dbRes.rows;
            }
        } catch {}

        if (notifs.length === 0) {
            try {
                const { IN_APP_NOTIFICATIONS } = require("../services/notificationService");
                if (IN_APP_NOTIFICATIONS && IN_APP_NOTIFICATIONS.length) {
                    notifs = IN_APP_NOTIFICATIONS.filter(n => {
                        const uid = (n.user_id || "").toString().toLowerCase().trim();
                        return uid === partnerId.toLowerCase() || uid === "all" || uid === "delivery_partners";
                    });
                }
            } catch {}
        }

        if (notifs.length === 0) {
            const welcomeNotif = {
                id: `NOTIF-${partnerId}-welcome`,
                user_id: partnerId,
                title: "Welcome to Thulirva Delivery Fleet! 🌿",
                message: "Your delivery account is active and verified. Go online to receive delivery requests and morning subscription runs.",
                type: "system",
                is_read: false,
                created_at: new Date().toISOString()
            };
            notifs = [welcomeNotif];
            try {
                const { sendNotification } = require("../services/notificationService");
                sendNotification(welcomeNotif);
            } catch (_) {}
        }

        const unreadCount = notifs.filter(n => !n.is_read).length;
        return res.json({
            success: true,
            notifications: notifs,
            unread_count: unreadCount
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/delivery/notifications/:id/read & POST /api/delivery/notifications/:id/read
 */
const markSingleReadHandler = async (req, res) => {
    try {
        const id = req.params.id;
        const partnerId = req.partner.partner_id;
        try {
            await pool.query(`UPDATE notifications SET is_read = true WHERE id::text = $1`, [id]);
        } catch {}
        try {
            const { markNotificationAsRead } = require("../services/notificationService");
            markNotificationAsRead(id, partnerId);
        } catch {}
        return res.json({ success: true, message: "Notification marked as read" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.put("/notifications/:id/read", authenticatePartner, markSingleReadHandler);
router.post("/notifications/:id/read", authenticatePartner, markSingleReadHandler);

/**
 * PUT /api/delivery/notifications/read-all & POST /api/delivery/notifications/read-all
 */
const markAllReadHandler = async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        try {
            await pool.query(
                `UPDATE notifications SET is_read = true WHERE LOWER(user_id::text) = $1 OR user_id = 'all' OR user_id = 'delivery_partners'`,
                [partnerId.toLowerCase()]
            );
        } catch {}
        try {
            const { markAllNotificationsAsRead } = require("../services/notificationService");
            markAllNotificationsAsRead(partnerId);
        } catch {}
        return res.json({ success: true, message: "All notifications marked as read" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.put("/notifications/read-all", authenticatePartner, markAllReadHandler);
router.post("/notifications/read-all", authenticatePartner, markAllReadHandler);

/**
 * POST /api/delivery/deliveries/:id/pickup
 * Stage: Pickup Confirmed from Farm Hub
 */
router.post("/deliveries/:id/pickup", authenticatePartner, async (req, res) => {
    try {
        const id = req.params.id;
        const notes = req.body.notes || "Picked up from Farm Hub";
        const partnerId = req.partner.partner_id;

        // Check if subscription delivery
        if (String(id).toUpperCase().startsWith("SUB") || String(id).toUpperCase().startsWith("DLY")) {
            const result = await updateSubscriptionDeliveryStatus(id, "pickup_confirmed", notes);
            emitToAdmin("delivery:status:update", { deliveryId: id, status: "pickup_confirmed", partnerId });
            return res.json(result);
        }

        // Product order
        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        const order = orders.find(o => o.id?.toString() === id?.toString() || o.order_number === id);
        if (!order) {
            return res.status(404).json({ success: false, message: "Delivery not found" });
        }

        const check = validateTransition(order.order_status, "pickup_confirmed", {
            partnerId,
            orderPartnerId: order.partner_id,
            isAdmin: false
        });

        if (!check.valid) {
            return res.status(check.status).json({ success: false, error_code: check.code, message: check.message });
        }

        order.order_status = "pickup_confirmed";
        order.status = "pickup_confirmed";
        order.notes = notes;
        saveOrders(orders);

        try {
            await pool.query(`UPDATE orders SET order_status = 'pickup_confirmed', updated_at = NOW() WHERE id::text = $1 OR order_number = $1`, [id]);
            await recordStatusHistory({ orderId: order.id || id, status: "pickup_confirmed", partnerId, notes });
        } catch {}

        broadcastStatusChange({ orderId: id, status: "pickup_confirmed", partnerId, userId: order.user_id });

        return res.json({
            success: true,
            message: "Order picked up from Farm Hub successfully",
            order
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/delivery/deliveries/:id/in-transit
 * Stage: In Transit to Customer Doorstep
 */
router.post("/deliveries/:id/in-transit", authenticatePartner, async (req, res) => {
    try {
        const id = req.params.id;
        const notes = req.body.notes || "In transit to customer doorstep";
        const partnerId = req.partner.partner_id;

        // Check if subscription delivery
        if (String(id).toUpperCase().startsWith("SUB") || String(id).toUpperCase().startsWith("DLY")) {
            const result = await updateSubscriptionDeliveryStatus(id, "out_for_delivery", notes);
            emitToAdmin("delivery:status:update", { deliveryId: id, status: "in_transit", partnerId });
            return res.json(result);
        }

        // Product order
        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        const order = orders.find(o => o.id?.toString() === id?.toString() || o.order_number === id);
        if (!order) {
            return res.status(404).json({ success: false, message: "Delivery not found" });
        }

        const check = validateTransition(order.order_status, "in_transit", {
            partnerId,
            orderPartnerId: order.partner_id,
            isAdmin: false
        });

        if (!check.valid) {
            return res.status(check.status).json({ success: false, error_code: check.code, message: check.message });
        }

        order.order_status = "in_transit";
        order.status = "in_transit";
        order.notes = notes;
        saveOrders(orders);

        try {
            await pool.query(`UPDATE orders SET order_status = 'in_transit', updated_at = NOW() WHERE id::text = $1 OR order_number = $1`, [id]);
            await recordStatusHistory({ orderId: order.id || id, status: "in_transit", partnerId, notes });
        } catch {}

        broadcastStatusChange({ orderId: id, status: "in_transit", partnerId, userId: order.user_id });

        return res.json({
            success: true,
            message: "Delivery is now in transit",
            order
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/delivery/deliveries/:id/complete
 * Stage: Final Doorstep Delivery with mandatory photo verification
 */
router.post("/deliveries/:id/complete", authenticatePartner, uploadDeliveryProof, async (req, res) => {
    try {
        const id = req.params.id;
        const partnerId = req.partner.partner_id;
        const { notes, remarks, latitude, longitude, image, photo, proof } = req.body || {};

        const result = await completeDelivery({
            orderId: id,
            partnerId,
            remarks: remarks || notes || "Doorstep delivery confirmed with photo",
            latitude,
            longitude,
            file: req.file,
            imageBase64: image || photo || proof
        });

        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;
