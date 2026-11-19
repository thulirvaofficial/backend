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
const { addDeviceToken } = require("../services/tokenStore");
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
            vehicle_number = "",
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

        // Update partner last_active_at
        try {
            await pool.query(
                "UPDATE delivery_partners SET last_active_at = NOW(), updated_at = NOW() WHERE partner_id = $1",
                [partner.partner_id]
            );
        } catch {}

        partner.last_active_at = new Date().toISOString();
        await savePartner(partner);

        return res.json({
            success: true,
            token,
            partner: {
                partner_id: partner.partner_id,
                name: partner.name,
                phone: partner.phone,
                email: partner.email || "",
                profile_photo: partner.profile_photo || null,
                address: partner.address || "",
                city: partner.city || "Chennai",
                pincode: partner.pincode || "",
                assigned_area: partner.assigned_area || "",
                vehicle_type: partner.vehicle_type || "",
                vehicle_number: partner.vehicle_number || "",
                emergency_contact: partner.emergency_contact || null,
                current_latitude: partner.current_latitude,
                current_longitude: partner.current_longitude,
                is_online: Boolean(partner.is_online),
                is_active: Boolean(partner.is_active),
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
 * POST /api/delivery/fcm-token & /api/delivery/partner/fcm-token & /api/delivery/register-token
 * Register device FCM push notification token for delivery partner
 */
const registerFcmTokenHandler = async (req, res) => {
    try {
        const rawToken = req.body.token || req.body.fcm_token;
        if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length < 10) {
            return res.status(400).json({ success: false, message: 'Valid token is required' });
        }
        const token = rawToken.trim();
        const platform = req.body.platform || 'android';
        const partnerId = req.partner?.partner_id || req.body.partner_id || req.body.user_id || 'delivery_partner';
        const deviceId = req.body.device_id || req.body.deviceId || null;

        // 1. Update database with strict partner role and app_type
        try {
            await pool.query(
                `INSERT INTO device_tokens (token, device_type, user_id, role, app_type, device_id, is_active, updated_at)
                 VALUES ($1, $2, $3, 'delivery_partner', 'partner', $4, true, CURRENT_TIMESTAMP)
                 ON CONFLICT (token) DO UPDATE
                 SET user_id = EXCLUDED.user_id,
                     role = 'delivery_partner',
                     app_type = 'partner',
                     device_id = COALESCE(EXCLUDED.device_id, device_tokens.device_id),
                     is_active = true,
                     updated_at = CURRENT_TIMESTAMP`,
                [token, platform, partnerId ? partnerId.toString() : null, deviceId]
            );
            await pool.query(
                `UPDATE delivery_partners SET fcm_token = $1, updated_at = NOW() WHERE partner_id = $2`,
                [token, partnerId ? partnerId.toString() : null]
            );
        } catch (dbErr) {
            // Non-blocking database update
        }

        // 2. Synchronize to shared in-memory and disk token store
        addDeviceToken({
            token,
            platform,
            user_id: partnerId ? partnerId.toString() : null,
            role: 'delivery_partner',
            app_type: 'partner',
            device_id: deviceId
        });

        // 3. Update disk partner record if exists
        try {
            const partner = await getPartnerById(partnerId);
            if (partner) {
                partner.fcm_token = token;
                await savePartner(partner);
            }
        } catch (_) {}

        console.log(`✓ [PARTNER FCM REGISTERED] Token saved for partner ${partnerId}`);
        return res.json({
            success: true,
            message: 'Delivery partner FCM push token registered successfully',
            partner_id: partnerId
        });
    } catch (err) {
        console.error('[PARTNER FCM REGISTRATION ERROR]', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
};

router.post("/fcm-token", registerFcmTokenHandler);
router.post("/partner/fcm-token", registerFcmTokenHandler);
router.post("/register-token", registerFcmTokenHandler);

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

    const subsData = await getSubscriptionDeliveries(formatDateKey(new Date()), req.partner);
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
            vehicle_type, vehicle_number, emergency_contact, assigned_area
        } = req.body;

        let partner = await getPartnerById(partnerId);
        if (!partner) {
            return res.status(404).json({ success: false, message: "Partner profile not found." });
        }

        if (name && name.trim()) partner.name = name.trim();
        if (phone && phone.trim()) partner.phone = phone.trim();
        if (email !== undefined) partner.email = email ? email.trim() : null;
        if (address !== undefined) partner.address = address ? address.trim() : "";
        if (city !== undefined) partner.city = city ? city.trim() : "Chennai";
        if (pincode !== undefined) partner.pincode = pincode ? pincode.trim() : "";
        if (assigned_area !== undefined && assigned_area.trim()) partner.assigned_area = assigned_area.trim();
        if (vehicle_type !== undefined && vehicle_type.trim()) partner.vehicle_type = vehicle_type.trim();
        if (vehicle_number !== undefined) partner.vehicle_number = (vehicle_number || "").trim().toUpperCase();
        if (emergency_contact !== undefined) partner.emergency_contact = emergency_contact ? emergency_contact.trim() : null;
        partner.updated_at = new Date().toISOString();

        // Save permanently across PostgreSQL (Single Source of Truth) and disk JSON mirror
        await savePartner(partner);

        // Fetch freshly stored database row to guarantee fidelity
        const updatedPartner = await getPartnerById(partnerId) || partner;

        return res.json({
            success: true,
            message: "Profile updated successfully.",
            partner: {
                partner_id: updatedPartner.partner_id,
                name: updatedPartner.name,
                phone: updatedPartner.phone,
                email: updatedPartner.email || "",
                profile_photo: updatedPartner.profile_photo || null,
                address: updatedPartner.address || "",
                city: updatedPartner.city || "Chennai",
                pincode: updatedPartner.pincode || "",
                assigned_area: updatedPartner.assigned_area || "",
                vehicle_type: updatedPartner.vehicle_type || "",
                vehicle_number: updatedPartner.vehicle_number || "",
                emergency_contact: updatedPartner.emergency_contact || null,
                is_online: Boolean(updatedPartner.is_online),
                is_active: Boolean(updatedPartner.is_active),
                rating: updatedPartner.rating || 5.0,
                total_deliveries_count: updatedPartner.total_deliveries_count || 0,
                registration_status: updatedPartner.registration_status || "approved",
                kyc_status: updatedPartner.kyc_status || "APPROVED"
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
/**
 * Helper: Validate image magic bytes
 */
function isValidPartnerImageBuffer(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
    // WEBP: RIFF ... WEBP
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return true;
    return false;
}

/**
 * POST /api/delivery/profile/photo
 * Upload or replace delivery partner profile photo (supports Multipart and Base64)
 */
router.post("/profile/photo", authenticatePartner, uploadPartnerPhoto, async (req, res) => {
    try {
        const partnerId = req.partner?.partner_id || req.partner?.id || req.body?.partner_id || (req.user && (req.user.partner_id || req.user.id));
        if (!partnerId) {
            return res.status(400).json({ success: false, message: "Valid delivery partner session is required." });
        }

        const { photo, photo_base64 } = req.body || {};
        const photoData = photo_base64 || photo;
        const partnersDir = path.resolve(__dirname, "..", "public", "uploads", "partners");
        if (!fs.existsSync(partnersDir)) fs.mkdirSync(partnersDir, { recursive: true });

        let filename = "";
        let photoUrl = "";
        let fileBuffer = null;

        if (req.file) {
            filename = req.file.filename;
            const fullFilePath = path.join(partnersDir, filename);
            if (fs.existsSync(fullFilePath)) {
                fileBuffer = fs.readFileSync(fullFilePath);
            }
            photoUrl = `/api/uploads/partners/${filename}`;
        } else if (photoData && typeof photoData === "string") {
            let ext = "jpg";
            const mimeMatch = photoData.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
            if (mimeMatch) {
                ext = mimeMatch[1].toLowerCase() === "jpeg" ? "jpg" : mimeMatch[1].toLowerCase();
            }
            const cleanBase64 = photoData.replace(/^data:image\/\w+;base64,/, "");
            fileBuffer = Buffer.from(cleanBase64, "base64");

            if (fileBuffer.length > 15 * 1024 * 1024) {
                return res.status(400).json({
                    success: false,
                    message: "Photo file size exceeds maximum limit of 15MB."
                });
            }

            filename = `profile_${partnerId}_${Date.now()}.${ext}`;
            const filePath = path.join(partnersDir, filename);
            fs.writeFileSync(filePath, fileBuffer);
            photoUrl = `/api/uploads/partners/${filename}`;
        } else {
            return res.status(400).json({ success: false, message: "Photo file or base64 data is required." });
        }

        // Validate image magic bytes
        if (fileBuffer && !isValidPartnerImageBuffer(fileBuffer)) {
            // Delete invalid file from disk
            const badFile = path.join(partnersDir, filename);
            try { if (fs.existsSync(badFile)) fs.unlinkSync(badFile); } catch (_) {}
            return res.status(400).json({
                success: false,
                message: "Invalid image format. Only JPEG, PNG, and WebP images are permitted."
            });
        }

        // Mirror to secondary upload directories so all asset routes serve it
        const mirrorDirs = [
            path.resolve(__dirname, "..", "..", "website", "website", "assets", "images", "uploads", "partners"),
            path.resolve(__dirname, "..", "assets", "images", "uploads", "partners")
        ];
        mirrorDirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
            }
            try {
                const src = path.join(partnersDir, filename);
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, path.join(dir, filename));
                }
            } catch (_) {}
        });

        // Retrieve existing partner from Database
        let partner = await getPartnerById(partnerId);
        if (!partner && req.partner?.phone) {
            partner = await getPartnerById(req.partner.phone);
        }
        if (!partner) {
            return res.status(404).json({ success: false, message: "Delivery partner record not found." });
        }

        const versionedPhotoUrl = photoUrl.includes("?v=") ? photoUrl : `${photoUrl}?v=${Date.now()}`;
        partner.profile_photo = versionedPhotoUrl;
        partner.updated_at = new Date().toISOString();

        // Save permanently across PostgreSQL (Single Source of Truth) and disk JSON mirror
        await savePartner(partner);

        emitToAdmin("partner:updated", {
            partner_id: partner.partner_id,
            profile_photo: versionedPhotoUrl,
            updated_at: new Date().toISOString()
        });

        emitToAdmin("fleet:partner_update", {
            partner_id: partner.partner_id,
            profile_photo: versionedPhotoUrl,
            updated_at: new Date().toISOString()
        });

        const host = req.get("host") || "localhost:5500";
        const fullUrl = `${req.protocol}://${host}${versionedPhotoUrl}`;

        return res.json({
            success: true,
            message: "Profile photo uploaded successfully.",
            profile_photo: versionedPhotoUrl,
            photo_url: versionedPhotoUrl,
            full_photo_url: fullUrl,
            partner: {
                partner_id: partner.partner_id,
                name: partner.name,
                phone: partner.phone,
                email: partner.email || "",
                profile_photo: versionedPhotoUrl,
                address: partner.address || "",
                city: partner.city || "Chennai",
                pincode: partner.pincode || "",
                assigned_area: partner.assigned_area || "",
                vehicle_type: partner.vehicle_type || "",
                vehicle_number: partner.vehicle_number || "",
                emergency_contact: partner.emergency_contact || null,
                rating: partner.rating || 5.0,
                is_online: Boolean(partner.is_online)
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
        const partnerId = req.partner?.partner_id || req.partner?.id || req.body?.partner_id;
        if (!partnerId) {
            return res.status(400).json({ success: false, message: "Valid delivery partner session is required." });
        }

        const partner = await getPartnerById(partnerId);
        if (partner) {
            if (partner.profile_photo) {
                const cleanRelPath = partner.profile_photo.split("?")[0].replace(/^\/api/, "").replace(/^\//, "");
                const oldPath = path.resolve(__dirname, "..", "public", cleanRelPath);
                try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (_) {}
            }
            partner.profile_photo = null;
            partner.updated_at = new Date().toISOString();
            await savePartner(partner);
        }

        try {
            await pool.query("ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS profile_photo TEXT;");
            await pool.query(
                "UPDATE delivery_partners SET profile_photo = NULL, updated_at = NOW() WHERE partner_id = $1 OR phone = $1",
                [partnerId]
            );
        } catch (_) {}

        emitToAdmin("partner:updated", {
            partner_id: partnerId,
            profile_photo: null,
            updated_at: new Date().toISOString()
        });

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
        let activeCount = 0;
        try {
            const activeRes = await pool.query(
                "SELECT id, order_status FROM orders WHERE partner_id = $1 AND LOWER(COALESCE(order_status, '')) IN ('assigned', 'accepted', 'in_transit', 'out_for_delivery', 'picked_up')",
                [partnerId]
            );
            if (activeRes.rows && activeRes.rows.length > 0) {
                activeCount = activeRes.rows.length;
            }
        } catch (_) {}

        // Disk fallback for orders
        if (activeCount === 0 && fs.existsSync(ORDERS_FILE)) {
            try {
                const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
                const active = orders.filter(o => {
                    const pId = o.partner_id || o.delivery_partner_id;
                    const status = (o.order_status || o.status || '').toLowerCase();
                    return pId === partnerId && ['assigned', 'accepted', 'in_transit', 'out_for_delivery', 'picked_up'].includes(status);
                });
                activeCount += active.length;
            } catch (_) {}
        }

        // Check active subscriptions
        try {
            const subsFile = path.join(DATA_DIR, "subscription_deliveries.json");
            if (fs.existsSync(subsFile)) {
                const subsData = JSON.parse(fs.readFileSync(subsFile, "utf-8"));
                const activeSubs = (subsData.deliveries || []).filter(d => {
                    const pId = d.partner_id || d.assigned_partner_id;
                    const status = (d.status || '').toLowerCase();
                    return pId === partnerId && ['assigned', 'out_for_delivery', 'in_transit'].includes(status);
                });
                activeCount += activeSubs.length;
            }
        } catch (_) {}

        if (activeCount > 0) {
            return res.status(400).json({
                success: false,
                has_active_deliveries: true,
                active_count: activeCount,
                message: `Cannot go offline while you have ${activeCount} active delivery in progress. Complete all assigned orders before ending your shift.`
            });
        }
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
        partner.last_active_at = new Date().toISOString();
        if (!Boolean(is_online)) {
            // Clear current coordinates on offline so stale location is not displayed as live
            partner.current_latitude = null;
            partner.current_longitude = null;
        }
        await savePartner(partner);
    }

    // Clean up live locations file if partner is going offline
    try {
        const liveFile = path.join(DATA_DIR, "partner_live_locations.json");
        if (fs.existsSync(liveFile)) {
            const liveLocations = JSON.parse(fs.readFileSync(liveFile, "utf-8"));
            const filtered = Boolean(is_online)
                ? liveLocations
                : liveLocations.filter(l => l.partner_id !== partnerId);
            fs.writeFileSync(liveFile, JSON.stringify(filtered, null, 2), "utf-8");
        }
    } catch (_) {}

    const statusPayload = {
        partnerId,
        partner_id: partnerId,
        is_online: Boolean(is_online),
        timestamp: new Date().toISOString()
    };

    emitToAdmin("partner:status:changed", statusPayload);
    emitToAdmin("partner:status:updated", statusPayload);
    emitToAdmin("fleet:partner_status", statusPayload);

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
/**
 * Shared Partner Location Ingestion Handler
 * POST /api/delivery/location
 * POST /api/delivery/location/update
 */
const handlePartnerLocationUpdate = async (req, res) => {
    let partnerId = req.partner?.partner_id || req.body?.partner_id || req.body?.partnerId || req.query?.partnerId;
    const { latitude, longitude, speed = 0, heading = 0, accuracy = 0, altitude = 0, locationSource = 'device_gps', active_delivery_id, orderId } = req.body || {};

    if (!partnerId) {
        return res.status(401).json({ success: false, message: "Authentication required or partnerId missing" });
    }

    if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ success: false, message: "Latitude and longitude required" });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ success: false, message: "Invalid numeric coordinates" });
    }

    const activeDeliveryId = active_delivery_id || orderId || null;

    let update = null;
    try {
        const { recordLocationUpdate } = require("../services/gpsService");
        update = await recordLocationUpdate({
            partner_id: partnerId,
            latitude: lat,
            longitude: lng,
            speed: parseFloat(speed) || 0,
            heading: parseFloat(heading) || 0,
            accuracy: parseFloat(accuracy) || 0,
            altitude: parseFloat(altitude) || 0,
            locationSource: locationSource || 'device_gps',
            active_delivery_id: activeDeliveryId
        });
    } catch (gpsErr) {
        // Fallback to direct DB/file update
        try {
            await pool.query(`
                UPDATE delivery_partners 
                SET current_latitude = $1, current_longitude = $2, location_updated_at = NOW(), updated_at = NOW(), is_online = true
                WHERE partner_id = $3
            `, [lat, lng, partnerId]);
        } catch {}

        const partner = await getPartnerById(partnerId);
        if (partner) {
            partner.current_latitude = lat;
            partner.current_longitude = lng;
            partner.speed = parseFloat(speed) || 0;
            partner.heading = parseFloat(heading) || 0;
            partner.accuracy = parseFloat(accuracy) || 0;
            partner.is_online = true;
            partner.last_active_at = new Date().toISOString();
            partner.location_updated_at = new Date().toISOString();
            await savePartner(partner);
        }
    }

    // Broadcast Socket.IO events to all relevant channels
    try {
        const { emitToAdmin, emitToOrder, emitToPartner } = require("../services/socketService");
        const payload = {
            partnerId,
            partner_id: partnerId,
            latitude: lat,
            longitude: lng,
            speed: parseFloat(speed) || 0,
            heading: parseFloat(heading) || 0,
            accuracy: parseFloat(accuracy) || 0,
            altitude: parseFloat(altitude) || 0,
            locationSource: locationSource || 'device_gps',
            isOnline: true,
            is_online: true,
            orderId: activeDeliveryId,
            active_delivery_id: activeDeliveryId,
            timestamp: new Date().toISOString()
        };

        emitToAdmin("delivery:location_updated", payload);
        emitToAdmin("delivery:location:update", payload);
        emitToAdmin("partner:location:updated", payload);
        emitToAdmin("fleet:location:updated", payload);
        emitToAdmin("fleet:partner_location", payload);
        emitToAdmin("partner:location_update", payload);
        emitToAdmin("fleet:location:updated", payload);

        if (activeDeliveryId) {
            emitToOrder(activeDeliveryId, "delivery:location_updated", payload);
            emitToOrder(activeDeliveryId, "delivery:location:update", payload);
            emitToOrder(activeDeliveryId, "partner:location:updated", payload);
        }

        emitToPartner(partnerId, "delivery:location_updated", payload);
    } catch (_) {}

    return res.json({
        success: true,
        message: "Location updated successfully",
        location: update || {
            partner_id: partnerId,
            latitude: lat,
            longitude: lng,
            speed: parseFloat(speed) || 0,
            heading: parseFloat(heading) || 0,
            accuracy: parseFloat(accuracy) || 0,
            updated_at: new Date().toISOString()
        }
    });
};

router.post("/location", authenticatePartner, handlePartnerLocationUpdate);
router.post("/location/update", (req, res, next) => {
    if (req.headers["authorization"]) {
        return authenticatePartner(req, res, () => handlePartnerLocationUpdate(req, res));
    }
    return handlePartnerLocationUpdate(req, res);
});

/**
 * GET /api/delivery/location/:id
 * Retrieve real-time or last known location for a specific partner OR for an order's assigned partner
 */
router.get("/location/:id", async (req, res) => {
    try {
        const id = req.params.id;
        let partnerId = id;
        const { getPartnerLiveLocation } = require("../services/gpsService");

        // Check if id is an order ID rather than a partner ID
        let location = await getPartnerLiveLocation(partnerId);
        let partner = await getPartnerById(partnerId);

        if (!location && !partner) {
            // Attempt to resolve as order or subscription ID
            try {
                const details = await getDeliveryDetails(id);
                if (details && (details.partner_id || details.partner?.partner_id)) {
                    partnerId = details.partner_id || details.partner.partner_id;
                    location = await getPartnerLiveLocation(partnerId);
                    partner = await getPartnerById(partnerId);
                }
            } catch (_) {}
        }

        if (!location && partner) {
            const hasGps = partner.current_latitude != null && partner.current_longitude != null;
            location = {
                partner_id: partner.partner_id,
                location_available: Boolean(hasGps),
                latitude: hasGps ? Number(partner.current_latitude) : null,
                longitude: hasGps ? Number(partner.current_longitude) : null,
                speed: partner.speed || 0,
                heading: partner.heading || 0,
                accuracy: partner.accuracy || 0,
                is_fresh: false,
                last_seen_seconds_ago: hasGps ? 9999 : null
            };
        }

        if (!location && !partner) {
            return res.status(404).json({ success: false, message: `Partner or order ${id} not found` });
        }

        return res.json({
            success: true,
            partner_id: partnerId,
            name: partner?.name || "Partner",
            is_online: Boolean(partner?.is_online),
            location
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/delivery/tracking/:orderId
 * Order tracking endpoint on delivery router
 */
router.get("/tracking/:orderId", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const details = await getDeliveryDetails(orderId);
        if (!details) {
            return res.status(404).json({ success: false, message: `Order ${orderId} not found` });
        }

        const partnerId = details.partner_id || details.partner?.partner_id;
        let partnerLocation = null;
        let partnerInfo = details.partner ? {
            partner_id: details.partner.partner_id,
            name: details.partner.name,
            phone: details.partner.phone,
            photo_url: details.partner.profile_photo || null,
            vehicle_type: details.partner.vehicle_type || "Electric Scooter",
            vehicle_number: details.partner.vehicle_number || "",
            rating: Number(details.partner.rating) || 5.0,
            is_online: Boolean(details.partner.is_online)
        } : null;

        if (partnerId) {
            try {
                const { getPartnerLiveLocation } = require("../services/gpsService");
                partnerLocation = await getPartnerLiveLocation(partnerId);
            } catch (_) {}

            try {
                const p = await getPartnerById(partnerId);
                if (p) {
                    partnerInfo = {
                        partner_id: p.partner_id,
                        name: p.name,
                        phone: p.phone,
                        photo_url: p.profile_photo || null,
                        vehicle_type: p.vehicle_type || "Electric Scooter",
                        vehicle_number: p.vehicle_number || "",
                        rating: Number(p.rating) || 5.0,
                        is_online: Boolean(p.is_online)
                    };
                    if (!partnerLocation && p.current_latitude && p.current_longitude) {
                        partnerLocation = {
                            partner_id: p.partner_id,
                            latitude: Number(p.current_latitude),
                            longitude: Number(p.current_longitude),
                            speed: Number(p.speed) || 0,
                            heading: Number(p.heading) || 0,
                            accuracy: Number(p.accuracy) || 0,
                            is_fresh: false
                        };
                    }
                }
            } catch (_) {}
        }

        const { geocodeAddress } = require("../services/geocodingService");
        const destinationAddress = details.delivery_address || details.address || details.shipping_address || "";
        const destinationCity = details.city || "";
        const destinationPincode = details.pincode || "";

        let destLat = details.latitude || details.delivery_latitude;
        let destLng = details.longitude || details.delivery_longitude;

        if (!destLat || !destLng || isNaN(Number(destLat)) || isNaN(Number(destLng))) {
            const geo = await geocodeAddress({ address: destinationAddress, city: destinationCity, pincode: destinationPincode });
            destLat = geo.latitude;
            destLng = geo.longitude;
        } else {
            destLat = Number(destLat);
            destLng = Number(destLng);
        }

        return res.json({
            success: true,
            order_id: details.id || orderId,
            order_number: details.order_number || orderId,
            order_status: details.order_status || details.status || "confirmed",
            order_type: details.order_type || "product",
            customer_destination: {
                address: destinationAddress,
                city: destinationCity || "Chennai",
                latitude: destLat,
                longitude: destLng
            },
            hub_location: {
                name: "Thulirva Central Hub",
                address: "Arcot Road, Valasaravakkam, Chennai, Tamil Nadu, India",
                latitude: 13.0403,
                longitude: 80.1723
            },
            partner: partnerInfo,
            partner_live_location: partnerLocation,
            timeline: details.timeline || [],
            estimated_delivery_time: details.estimated_delivery_time || "15-20 mins"
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/delivery/accept/:orderId
 * Partner accepts an order or subscription delivery
 */
router.post("/accept/:orderId", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const partnerId = req.partner?.partner_id || req.body?.partner_id || req.body?.partnerId;
        if (!partnerId) {
            return res.status(400).json({ success: false, message: "partner_id is required" });
        }

        const isSub = orderId.toString().startsWith("SUB-");
        const cleanId = isSub ? orderId.toString().replace("SUB-", "") : orderId.toString();

        if (isSub) {
            const subs = loadJson(SUBS_DELIVERIES_FILE, []);
            const sub = subs.find(s => s.id?.toString() === cleanId || s.subscription_id?.toString() === cleanId);
            if (sub) {
                sub.partner_id = partnerId;
                sub.status = "assigned";
                saveJson(SUBS_DELIVERIES_FILE, subs);
            }
        } else {
            const orders = loadJson(ORDERS_FILE, []);
            const order = orders.find(o => o.id?.toString() === cleanId || o.order_number === cleanId);
            if (order) {
                order.partner_id = partnerId;
                order.order_status = "assigned";
                saveJson(ORDERS_FILE, orders);
            }
        }

        try {
            const { broadcastStatusChange } = require("../utils/deliveryStateMachine");
            broadcastStatusChange(orderId, "assigned", { partnerId });
        } catch (_) {}

        return res.json({ success: true, message: `Order ${orderId} accepted and assigned to partner ${partnerId}` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/delivery/status/:orderId
 * Delivery status update handler
 */
router.post("/status/:orderId", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const status = req.body?.status || req.body?.order_status;
        const partnerId = req.partner?.partner_id || req.body?.partner_id || req.body?.partnerId;

        if (!status) {
            return res.status(400).json({ success: false, message: "status is required" });
        }

        const isSub = orderId.toString().startsWith("SUB-");
        const cleanId = isSub ? orderId.toString().replace("SUB-", "") : orderId.toString();

        if (isSub) {
            const subs = loadJson(SUBS_DELIVERIES_FILE, []);
            const sub = subs.find(s => s.id?.toString() === cleanId || s.subscription_id?.toString() === cleanId);
            if (sub) {
                sub.status = status;
                if (partnerId) sub.partner_id = partnerId;
                saveJson(SUBS_DELIVERIES_FILE, subs);
            }
        } else {
            const orders = loadJson(ORDERS_FILE, []);
            const order = orders.find(o => o.id?.toString() === cleanId || o.order_number === cleanId);
            if (order) {
                order.order_status = status;
                if (partnerId) order.partner_id = partnerId;
                saveJson(ORDERS_FILE, orders);
            }
        }

        try {
            const { broadcastStatusChange } = require("../utils/deliveryStateMachine");
            broadcastStatusChange(orderId, status, { partnerId });
        } catch (_) {}

        return res.json({ success: true, message: `Order ${orderId} status updated to ${status}` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * In-App Chat endpoints on delivery router
 * GET /api/delivery/orders/:id/chat
 * POST /api/delivery/orders/:id/chat
 */
router.get("/orders/:id/chat", async (req, res) => {
    try {
        const { getChatMessages } = require("../services/chatService");
        const messages = await getChatMessages(req.params.id);
        return res.json({ success: true, order_id: req.params.id, messages });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/orders/:id/chat", async (req, res) => {
    try {
        const { sender, sender_name, text, message } = req.body || {};
        const msgText = text || message;
        if (!msgText || !msgText.trim()) {
            return res.status(400).json({ success: false, message: "Message text is required" });
        }
        const { saveChatMessage } = require("../services/chatService");
        const saved = await saveChatMessage(req.params.id, {
            sender: sender || "partner",
            sender_name: sender_name || "Delivery Partner",
            text: msgText,
            role: "partner"
        });
        return res.json({ success: true, message: saved });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

router.post("/orders/:id/chat/read", async (req, res) => {
    try {
        const { markChatAsRead } = require("../services/chatService");
        const result = await markChatAsRead(req.params.id, "partner");
        return res.json({ success: true, ...result });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/* ============================================================
   2. HOME DASHBOARD METRICS (EXACT MATCH SCREEN 2)
============================================================ */

/**
 * Shared Authorized Product Orders Filter for Partner
 * Matches orders explicitly assigned to partner, or unassigned within partner's service area
 */
const getAuthorizedProductOrdersForPartner = (orders, partnerId, partnerArea) => {
    return (orders || []).filter(o => {
        const isSub = (o.order_type === "subscription" || o.delivery_type === "subscription" || (o.id && o.id.toString().startsWith("SUB-")));
        if (isSub) return false;

        // Assigned directly to this partner
        if (o.partner_id && o.partner_id === partnerId) return true;

        // Unassigned order available for claim/delivery in partner's assigned territory
        if (!o.partner_id) {
            if (!partnerArea || partnerArea.toLowerCase() === "all") return true;
            const orderArea = `${o.city || ''} ${o.address || ''} ${o.area || ''}`.toLowerCase();
            return orderArea.includes(partnerArea.toLowerCase());
        }
        return false;
    });
};

/**
 * Shared Asia/Kolkata Date Boundary Helper
 * Used consistently for Home Dashboard today counts and Orders list
 */
const getIstDateBoundaries = (dateKey) => {
    let targetKey;
    if (dateKey && typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey.trim())) {
        targetKey = dateKey.trim();
    } else if (dateKey) {
        const parsed = new Date(dateKey);
        targetKey = !isNaN(parsed.getTime())
            ? parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
            : new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    } else {
        targetKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    }
    const [y, m, d] = targetKey.split("-").map(Number);
    const startIstUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - (5 * 60 + 30) * 60 * 1000);
    const endIstUtc = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - (5 * 60 + 30) * 60 * 1000);
    return { targetKey, startIstUtc, endIstUtc };
};

const filterProductOrdersByDate = (orders, dateKey) => {
    const { startIstUtc, endIstUtc } = getIstDateBoundaries(dateKey);
    return (orders || []).filter(o => {
        const isSub = (o.order_type === "subscription" || o.delivery_type === "subscription" || (o.id && o.id.toString().startsWith("SUB-")));
        if (isSub) return false;
        const ts = o.created_at || o.createdAt || o.order_date || o.orderDate;
        if (!ts) return false;
        const orderTime = new Date(ts).getTime();
        if (isNaN(orderTime)) return false;
        return orderTime >= startIstUtc.getTime() && orderTime <= endIstUtc.getTime();
    });
};

/**
 * GET /api/delivery/dashboard
 * Real-time dynamic live counts calculated from database & disk strictly for Today (Asia/Kolkata)
 */
router.get("/dashboard", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const now = new Date();
        const todayStr = formatDateKey(now);
        const dateLabel = formatReadableDate(now);

        const subsData = await getSubscriptionDeliveries(todayStr, req.partner);

        // Fetch product orders strictly (excluding subscriptions)
        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        // Strict Date & Partner Filtering for Today Orders in Asia/Kolkata timezone
        const partnerOrders = getAuthorizedProductOrdersForPartner(orders, partnerId, req.partner.assigned_area);
        const todayPartnerOrders = filterProductOrdersByDate(partnerOrders);

        const ordersTotal = todayPartnerOrders.length;
        const ordersDelivered = todayPartnerOrders.filter(o => (o.order_status || o.status || "").toLowerCase() === "delivered").length;
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

        // Credit subscription delivery earning idempotently
        if (status === "delivered") {
            try {
                const { getDeliveryConfig } = require("../services/businessConfigService");
                const { recordSubscriptionDeliveryEarning } = require("../services/financialService");
                const config = await getDeliveryConfig();
                const subEarning = Number(config.partner_earnings_config?.default_subscription_earning || 30.0);
                const snapshot = {
                    customer_delivery_fee: 0.0,
                    partner_delivery_earning: subEarning,
                    company_delivery_revenue: 0.0,
                    company_funded_delivery_expense: subEarning,
                    order_type: "subscription",
                    pricing_version: Number(config.pricing_config_version || 1)
                };
                await recordSubscriptionDeliveryEarning(partnerId, id, subEarning, snapshot);
            } catch (subEarnErr) {
                console.warn("[SUB DELIVERY EARNING RECORD WARN]:", subEarnErr.message);
            }
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
 * GET /api/delivery/orders & /api/delivery/product-orders
 * Precise date filtering using Asia/Kolkata timezone with 00:00:00 - 23:59:59.999 IST boundaries
 */
const getOrdersHandler = async (req, res) => {
    try {
        const partnerId = req.partner.partner_id;
        const { date, search } = req.query;

        // 1. Resolve target date in Asia/Kolkata timezone (YYYY-MM-DD)
        let targetDateKey;
        if (date && typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
            targetDateKey = date.trim();
        } else if (date) {
            const parsed = new Date(date);
            targetDateKey = !isNaN(parsed.getTime())
                ? parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
                : new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        } else {
            targetDateKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        }

        // 2. Strict Asia/Kolkata date boundaries (00:00:00.000 to 23:59:59.999 IST)
        const [y, m, d] = targetDateKey.split("-").map(Number);
        const startIstUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - (5 * 60 + 30) * 60 * 1000);
        const endIstUtc = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - (5 * 60 + 30) * 60 * 1000);

        // 3. User-friendly date label in Asia/Kolkata
        const todayIstKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        let dateLabel;
        if (targetDateKey === todayIstKey) {
            dateLabel = "Today";
        } else {
            const midDate = new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
            dateLabel = midDate.toLocaleDateString("en-IN", {
                timeZone: "Asia/Kolkata",
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric"
            });
        }

        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        // 4. Strict Product Orders partition: NEVER return subscriptions!
        let authorized = getAuthorizedProductOrdersForPartner(orders, partnerId, req.partner.assigned_area);

        // 5. Filter orders by creation date within Asia/Kolkata boundaries using shared helper
        let filtered = filterProductOrdersByDate(authorized, targetDateKey);

        // 6. Search within selected date's orders
        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter(o =>
                (o.order_number || o.orderNumber || "").toLowerCase().includes(q) ||
                (o.customer_name || o.customerName || "").toLowerCase().includes(q) ||
                (o.address || "").toLowerCase().includes(q) ||
                (o.customer_phone || o.customerPhone || "").toLowerCase().includes(q)
            );
        }

        // 7. Calculate accurate statistics strictly for the selected date
        // Total Orders = Delivered Orders + Pending Orders
        const total = filtered.length;
        const delivered = filtered.filter(o => (o.order_status || o.status || "").toLowerCase() === "delivered").length;
        const pending = total - delivered;

        return res.json({
            success: true,
            date: targetDateKey,
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
 * GET /api/delivery/orders/:id
 * Retrieve single order details for delivery partner
 */
router.get("/orders/:id", authenticatePartner, async (req, res) => {
    try {
        const id = req.params.id;
        const partnerId = req.partner.partner_id;

        let orders = [];
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            }
        } catch {}

        let order = orders.find(o => o.id?.toString() === id?.toString() || o.order_number === id);

        if (!order) {
            try {
                const dbRes = await pool.query(
                    "SELECT * FROM orders WHERE id::text = $1 OR order_number = $1",
                    [id.toString()]
                );
                if (dbRes.rows && dbRes.rows.length) {
                    order = dbRes.rows[0];
                }
            } catch (_) {}
        }

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        return res.json({ success: true, order, data: order });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});
router.get("/product-orders/:id", authenticatePartner, async (req, res) => {
    return req.app.handle(req, res);
});

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
            const num = parseInt(id, 10);
            if (!isNaN(num)) {
                await pool.query(`
                    UPDATE orders 
                    SET order_status = $1, partner_id = $2,
                        delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
                        updated_at = NOW()
                    WHERE id = $3 OR order_number = $4
                `, [normStatus, partnerId, num, id.toString()]);
            } else {
                await pool.query(`
                    UPDATE orders 
                    SET order_status = $1, partner_id = $2,
                        delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
                        updated_at = NOW()
                    WHERE order_number = $3
                `, [normStatus, partnerId, id.toString()]);
            }
        } catch (dbErr) {
            console.error("[UPDATE PARTNER ORDER DB ERROR]", dbErr.message);
        }

        try {
            if (fs.existsSync(ORDERS_FILE)) {
                fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
            }
        } catch (_) {}

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

        // If delivered, increment partner delivery count & credit earnings
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

            // Credit Partner Earnings & Record Immutable Financial Snapshot
            try {
                const { calculateDeliveryCharge } = require("../services/businessConfigService");
                const { recordProductDeliveryEarning } = require("../services/financialService");

                let partnerPayout = 35.0;
                let snapshot = {};
                if (order.financial_breakdown) {
                    partnerPayout = Number(order.financial_breakdown.partner_delivery_earning || 35.0);
                    snapshot = order.financial_breakdown;
                } else {
                    const chargeCalc = await calculateDeliveryCharge({
                        subtotal: order.subtotal || 0,
                        order_type: order.order_type || "delivery",
                        zone: order.delivery_zone || order.delivery_location || null,
                        distance_km: order.distance_km || null
                    });
                    partnerPayout = Number(chargeCalc.partner_delivery_earning || 35.0);
                    snapshot = {
                        customer_delivery_fee: chargeCalc.delivery_fee,
                        partner_delivery_earning: partnerPayout,
                        company_delivery_revenue: chargeCalc.company_delivery_revenue,
                        company_funded_delivery_expense: chargeCalc.company_funded_delivery_expense,
                        zone: chargeCalc.zone,
                        order_type: chargeCalc.order_type,
                        pricing_version: chargeCalc.pricing_version
                    };
                    order.financial_breakdown = snapshot;
                }

                await recordProductDeliveryEarning(partnerId, order.id || id, partnerPayout, snapshot);
                order.partner_earnings_credited = true;
                order.partner_earning_amount = partnerPayout;
            } catch (earnErr) {
                console.warn("[DELIVERY EARNING RECORD WARN]:", earnErr.message);
            }
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
        const partnerId = req.partner.partner_id || req.partner.id;
        const { remarks, latitude, longitude, image, photo, proof, cash_collected, cash_mismatch_reason } = req.body || {};

        const result = await saveDeliveryProof({
            orderId: id,
            partnerId,
            file: req.file,
            imageBase64: image || photo || proof,
            remarks,
            latitude,
            longitude,
            markDelivered: true,
            cash_collected,
            cash_mismatch_reason
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
        const subsData = await getSubscriptionDeliveries(dateKey, req.partner);
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
            SELECT do.*, o.order_number, o.customer_name, o.customer_phone, o.phone, o.address, o.city, o.total, o.items, o.delivery_instructions, o.landmark, o.pincode, o.latitude, o.longitude, o.payment_method, o.delivery_charge
            FROM dispatch_offers do
            LEFT JOIN orders o ON (do.order_id = o.id::text OR do.order_id = o.order_number)
            WHERE do.partner_id = $1 AND do.status = 'pending' AND do.expires_at > NOW()
            ORDER BY do.offer_time DESC LIMIT 1
        `, [partnerId]).catch(() => ({ rows: [] }));

        if (offers.rows.length > 0) {
            const offer = offers.rows[0];
            const remainingSecs = Math.max(0, Math.floor((new Date(offer.expires_at) - new Date()) / 1000));
            let itemsCount = 1;
            let parsedItems = [];
            if (Array.isArray(offer.items)) {
                itemsCount = offer.items.length;
                parsedItems = offer.items;
            } else if (typeof offer.items === 'string') {
                try {
                    const parsed = JSON.parse(offer.items);
                    if (Array.isArray(parsed)) {
                        itemsCount = parsed.length;
                        parsedItems = parsed;
                    }
                } catch (_) {}
            }
            const deliveryEarnings = Number(offer.delivery_charge || 35.0);
            return res.json({
                success: true,
                has_active_offer: true,
                offer: {
                    ...offer,
                    order_id: String(offer.order_id),
                    order_number: offer.order_number || `ORD${offer.order_id}`,
                    customer_name: offer.customer_name || 'Customer',
                    customer_phone: offer.customer_phone || offer.phone || '+91 98401 23456',
                    customer_area: offer.landmark || offer.city || 'Valasaravakkam, Chennai',
                    pickup_hub: 'Valasaravakkam Hub, Chennai',
                    delivery_address: offer.address || offer.city || 'Chennai',
                    items: parsedItems,
                    items_count: itemsCount,
                    total: Number(offer.total || 0),
                    payment_method: offer.payment_method || 'UPI (Prepaid)',
                    delivery_instructions: offer.delivery_instructions || 'Deliver to doorstep',
                    latitude: offer.latitude ? Number(offer.latitude) : null,
                    longitude: offer.longitude ? Number(offer.longitude) : null,
                    delivery_charge: deliveryEarnings,
                    delivery_earnings: deliveryEarnings,
                    remaining_seconds: remainingSecs,
                    timeout_seconds: 180
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

/**
 * POST /api/delivery/offers/:id/timeout
 */
const timeoutOfferHandler = async (req, res) => {
    const orderId = req.params.id;
    const partnerId = req.partner.partner_id;
    const { handleOfferTimeout } = require("../services/dispatchEngine");
    const result = await handleOfferTimeout(orderId, partnerId);
    return res.json(result || { success: true, message: "Offer marked timed out" });
};

router.post("/offers/:id/timeout", authenticatePartner, timeoutOfferHandler);
router.post("/assignments/:id/timeout", authenticatePartner, timeoutOfferHandler);

/* ============================================================
   7. EARNINGS (DYNAMIC SERVER-CALCULATED)
============================================================ */

router.get("/earnings", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id || req.partner.id;
        const now = new Date();
        const todayStr = formatDateKey(now);

        // Load partner wallet and immutable ledger
        const { getPartnerWalletBalance, getPartnerLedger } = require("../services/financialService");
        const wallet = await getPartnerWalletBalance(partnerId);
        const ledgerRes = getPartnerLedger(partnerId, { page: 1, limit: 100 });
        const ledgerItems = ledgerRes.items || [];

        const isToday = (dateStr) => {
            if (!dateStr) return false;
            try { return formatDateKey(new Date(dateStr)) === todayStr; } catch { return false; }
        };
        const isWithinDays = (dateStr, days) => {
            if (!dateStr) return false;
            try {
                const diff = (now.getTime() - new Date(dateStr).getTime()) / (1000 * 3600 * 24);
                return diff >= 0 && diff <= days;
            } catch { return false; }
        };

        const todayEntries = ledgerItems.filter(e => isToday(e.created_at));
        const weekEntries = ledgerItems.filter(e => isWithinDays(e.created_at, 7));
        const monthEntries = ledgerItems.filter(e => isWithinDays(e.created_at, 30));

        const earningsToday = todayEntries.reduce((sum, e) => sum + (Number(e.amount_rupees) || 0), 0);
        const weeklyEarnings = weekEntries.reduce((sum, e) => sum + (Number(e.amount_rupees) || 0), 0);
        const monthlyEarnings = monthEntries.reduce((sum, e) => sum + (Number(e.amount_rupees) || 0), 0);
        const deliveriesToday = todayEntries.length;

        // Delivery history list with individual delivery earnings
        const deliveryHistory = ledgerItems.slice(0, 30).map(entry => ({
            id: entry.id,
            order_id: entry.reference_id,
            delivery_date: entry.created_at,
            partner_earning: Number(entry.amount_rupees),
            order_type: entry.entry_type === "delivery_subscription" ? "Subscription" : "Product Order",
            payment_status: entry.is_settled ? "Settled" : "Credited",
            description: entry.description
        }));

        // Recent payouts / bank settlements
        const settlementsFile = path.resolve(__dirname, "..", "data", "partner_settlements.json");
        let recentPayouts = [];
        try {
            if (fs.existsSync(settlementsFile)) {
                const allSettlements = JSON.parse(fs.readFileSync(settlementsFile, "utf-8"));
                recentPayouts = allSettlements
                    .filter(s => s.partner_id === partnerId)
                    .slice(0, 10)
                    .map(s => ({
                        date: s.created_at ? s.created_at.split("T")[0] : todayStr,
                        amount: s.net_payout_rupees || (s.net_payout_paise / 100),
                        deliveries: s.eligible_entries_count || 1,
                        status: s.status === "settled" ? "Deposited" : "Processing",
                        utr: s.bank_reference_utr || null
                    }));
            }
        } catch (_) {}

        return res.json({
            success: true,
            earnings: {
                today: Math.round(earningsToday * 100) / 100,
                this_week: Math.round(weeklyEarnings * 100) / 100,
                this_month: Math.round(monthlyEarnings * 100) / 100,
                deliveries_today: deliveriesToday,
                base_payout: Math.round(earningsToday * 100) / 100,
                incentives: 0,
                tips: 0,
                total_completed_earnings: wallet.lifetime_earned_rupees,
                pending_earnings: (wallet.pending_settlement_paise || 0) / 100,
                paid_earnings: wallet.total_settled_rupees,
                available_earnings: wallet.available_payable_rupees,
                delivery_history: deliveryHistory,
                recent_payouts: recentPayouts
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
        const partnerId = req.partner.partner_id || req.partner.id;
        const { notes, remarks, latitude, longitude, image, photo, proof, cash_collected, cash_mismatch_reason } = req.body || {};

        const result = await completeDelivery({
            orderId: id,
            partnerId,
            remarks: remarks || notes || "Doorstep delivery confirmed with photo",
            latitude,
            longitude,
            file: req.file,
            imageBase64: image || photo || proof,
            cash_collected,
            cash_mismatch_reason
        });

        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/* ============================================================
   MODULE 2: BANK DETAILS ENDPOINTS (DELIVERY PARTNER)
============================================================ */

const {
    getPartnerCodBalance,
    recordCodCashCollected,
    submitCodRemittance,
    reviewCodRemittance,
    recordCashHandover,
    getCodRemittanceHistory,
    getAllCodRemittances,
    savePartnerBankDetails,
    getPartnerBankDetails,
    getPartnerWalletBalance,
    getPartnerLedger,
    executePartnerPayout
} = require("../services/financialService");

// GET /api/delivery/bank-details
router.get("/bank-details", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id || req.partner.id;
        const details = await getPartnerBankDetails(partnerId, false);
        return res.json({ success: true, bank_details: details });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/delivery/bank-details
router.post("/bank-details", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id || req.partner.id;
        const result = await savePartnerBankDetails(partnerId, req.body || {});
        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/* ============================================================
   MODULE 5, 6, 7: COD CASH MANAGEMENT & REMITTANCE (DELIVERY PARTNER)
============================================================ */

// GET /api/delivery/cod/balance
router.get("/cod/balance", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id || req.partner.id;
        const balance = getPartnerCodBalance(partnerId);
        return res.json({ success: true, ...balance });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/delivery/cod/remittance
router.post("/cod/remittance", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id || req.partner.id;
        const { amount, payment_mode, transaction_id, proof_image, notes } = req.body || {};
        const result = await submitCodRemittance({
            partner_id: partnerId,
            amount,
            payment_mode,
            transaction_id,
            proof_image,
            notes
        });
        const balance = getPartnerCodBalance(partnerId);
        return res.status(201).json({
            success: true,
            message: `COD remittance request of ₹${result.amount} submitted successfully.`,
            remittance: result,
            balance
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

// GET /api/delivery/cod/remittance-history
router.get("/cod/remittance-history", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id || req.partner.id;
        const history = getCodRemittanceHistory(partnerId);
        const balance = getPartnerCodBalance(partnerId);
        return res.json({ success: true, remittances: history, balance });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   MODULE 3: EARNINGS & FINANCIAL LEDGER (DELIVERY PARTNER)
============================================================ */

// GET /api/delivery/earnings/ledger
router.get("/earnings/ledger", authenticatePartner, async (req, res) => {
    try {
        const partnerId = req.partner.partner_id || req.partner.id;
        const wallet = await getPartnerWalletBalance(partnerId);
        const ledger = getPartnerLedger(partnerId, { page: req.query.page || 1, limit: req.query.limit || 50 });
        const codBalance = getPartnerCodBalance(partnerId);

        return res.json({
            success: true,
            wallet: {
                available_earnings: wallet.available_payable_rupees,
                lifetime_earnings: wallet.lifetime_earned_rupees,
                pending_earnings: (wallet.pending_settlement_paise || 0) / 100,
                processing_payout: wallet.reserved_withdrawal_rupees,
                total_paid: wallet.total_settled_rupees
            },
            cod: codBalance,
            ledger
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
