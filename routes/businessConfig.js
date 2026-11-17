const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
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
    togglePaymentQrStatus
} = require("../services/businessConfigService");

const router = express.Router();

// Multer storage for payment QR image uploads
const uploadDir = path.resolve(__dirname, "..", "public", "uploads", "payments");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `payment_qr_v${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/* =========================================================================
   PUBLIC / CUSTOMER CONFIGURATION ENDPOINTS
========================================================================= */

// 1. GET /api/config/delivery - Full Delivery Configuration
router.get(["/delivery", "/"], async (req, res) => {
    try {
        const config = await getDeliveryConfig();
        const availability = await checkDeliveryAvailability({ zone: req.query.zone });
        res.json({
            success: true,
            config,
            availability
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. POST /api/config/delivery/calculate-charge - Calculate authoritative delivery fee
router.post(["/delivery/calculate-charge", "/calculate-charge"], async (req, res) => {
    try {
        const { subtotal = 0, order_type = "delivery", zone = null, distance_km = null } = req.body;
        const result = await calculateDeliveryCharge({ subtotal, order_type, zone, distance_km });
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. GET /api/config/delivery/availability - Check real-time morning/evening/24-7 delivery slot
router.get(["/delivery/availability", "/availability"], async (req, res) => {
    try {
        const result = await checkDeliveryAvailability({ zone: req.query.zone });
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. GET /api/config/launch-banner - Dynamic Promotional / Launch Banner
router.get(["/launch-banner", "/banner"], async (req, res) => {
    try {
        const banner = await getLaunchBanner(req.query.zone);
        res.json({
            success: true,
            banner
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5. GET /api/config/payment-qr - Dynamic Active Payment QR for Customer App
router.get(["/payment-qr", "/qr"], async (req, res) => {
    try {
        const qr = await getActivePaymentQr();
        res.json({
            success: true,
            qr
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* =========================================================================
   ADMIN CONFIGURATION ENDPOINTS
========================================================================= */

// 6. PUT or POST /api/admin/config/delivery - Update delivery & business configuration
router.all(["/admin/delivery", "/delivery/update", "/delivery", "/update"], async (req, res) => {
    if (req.method !== "POST" && req.method !== "PUT") {
        return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }
    try {
        const b = req.body || {};
        const adminName = b.admin_name || req.headers["x-admin-name"] || req.user?.admin_name || req.user?.name || "Super Admin";
        const updated = await updateDeliveryConfig(b, adminName);
        res.json({
            success: true,
            message: "Delivery & Business configuration successfully updated.",
            config: updated
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 7. POST /api/admin/payment-qr/verify-password - Verify Dedicated Security Password
router.post(["/payment-qr/verify-password", "/verify-password", "/payment-qr/verify-security-password", "/verify-security-password"], async (req, res) => {
    try {
        const { password } = req.body || {};
        const result = await verifyQrSecurityPassword(password);
        if (!result.verified) {
            return res.status(401).json({
                success: false,
                ...result
            });
        }
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 8. POST /api/admin/payment-qr/set-password - Update/Reset Dedicated Security Password
router.post(["/payment-qr/set-password", "/set-password"], async (req, res) => {
    try {
        const { current_password, new_password, admin_name = "Super Admin" } = req.body || {};

        // If a current password was provided, verify it first
        if (current_password) {
            const chk = await verifyQrSecurityPassword(current_password);
            if (!chk.verified) {
                return res.status(401).json({ success: false, message: "Current security password incorrect." });
            }
        }

        const safeAdminName = admin_name || req.headers["x-admin-name"] || req.user?.name || "Super Admin";
        const result = await setQrSecurityPassword(new_password, safeAdminName);
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 9. GET /api/admin/payment-qr/history - View QR Version History & Audit Trail
router.get(["/payment-qr/history", "/history"], async (req, res) => {
    try {
        const history = await getPaymentQrHistory();
        res.json({
            success: true,
            history
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 10. POST /api/admin/payment-qr/upload - Upload, Replace & Publish New Payment QR
router.post(["/payment-qr/upload", "/upload"], upload.single("qr_image"), async (req, res) => {
    try {
        const { security_password, upi_id, merchant_name, notes, admin_name = "Super Admin", qr_image_base64 } = req.body || {};

        // Strict Security Password Validation
        const authCheck = await verifyQrSecurityPassword(security_password);
        if (!authCheck.verified) {
            // Clean up uploaded file if password failed
            if (req.file) {
                try { fs.unlinkSync(req.file.path); } catch (_) {}
            }
            return res.status(401).json({
                success: false,
                message: authCheck.message || "Unauthorized: Valid QR Security Password is required."
            });
        }

        let relativeUrl = "";
        if (req.file) {
            relativeUrl = `/api/uploads/payments/${req.file.filename}`;
        } else if (qr_image_base64) {
            const matches = qr_image_base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            const ext = (matches && matches[1].includes("png")) ? ".png" : ".jpg";
            const filename = `payment_qr_v${Date.now()}${ext}`;
            const targetPath = path.join(uploadDir, filename);
            const buffer = Buffer.from(matches ? matches[2] : qr_image_base64, "base64");
            fs.writeFileSync(targetPath, buffer);
            relativeUrl = `/api/uploads/payments/${filename}`;
        } else {
            return res.status(400).json({ success: false, message: "Payment QR image file or base64 is required." });
        }

        const safeAdminName = admin_name || req.headers["x-admin-name"] || req.user?.name || "Super Admin";
        const result = await uploadAndActivatePaymentQr({
            qr_image_url: relativeUrl,
            upi_id,
            merchant_name,
            notes,
            adminName: safeAdminName
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 11. POST /api/admin/payment-qr/status - Activate or Deactivate QR Code
router.post(["/payment-qr/status", "/status"], async (req, res) => {
    try {
        const { security_password, is_active, admin_name = "Super Admin" } = req.body || {};

        const authCheck = await verifyQrSecurityPassword(security_password);
        if (!authCheck.verified) {
            return res.status(401).json({
                success: false,
                message: authCheck.message || "Unauthorized: Valid QR Security Password is required."
            });
        }

        const safeAdminName = admin_name || req.headers["x-admin-name"] || req.user?.name || "Super Admin";
        const result = await togglePaymentQrStatus({ is_active, adminName: safeAdminName });
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
