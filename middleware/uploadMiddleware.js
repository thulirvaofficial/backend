const multer = require("multer");
const path = require("path");
const fs = require("fs");

const PROOF_UPLOADS_DIR = path.resolve(__dirname, "..", "public", "uploads", "delivery_proofs");
const PARTNER_UPLOADS_DIR = path.resolve(__dirname, "..", "public", "uploads", "partners");
const USER_UPLOADS_DIR = path.resolve(__dirname, "..", "public", "uploads", "profiles");

// Ensure upload dirs exist
[PROOF_UPLOADS_DIR, PARTNER_UPLOADS_DIR, USER_UPLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
});

// Allowed image mime types & extensions
const ALLOWED_EXTS = /jpeg|jpg|png|webp/;

function imageFileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
    const mime = file.mimetype.toLowerCase();
    if (ALLOWED_EXTS.test(ext) || mime.includes("image") || mime.includes("octet-stream") || mime.includes("binary") || !ext || ext === "tmp") {
        cb(null, true);
    } else {
        cb(new Error("Only image files (JPG, PNG, WEBP) are permitted."));
    }
}

// 1. Delivery Proof Storage
const proofStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, PROOF_UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const id = req.params.orderId || req.params.id || "order";
        let ext = path.extname(file.originalname).toLowerCase() || ".jpg";
        if (ext === ".tmp" || !ext || ext === ".") ext = ".jpg";
        const cleanExt = ext.startsWith(".") ? ext : `.${ext}`;
        const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        cb(null, `proof_${id}_${uniqueSuffix}${cleanExt}`);
    }
});

const uploadProofMulter = multer({
    storage: proofStorage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    fileFilter: imageFileFilter
});

// Middleware supporting any common field name for proof photos
const uploadDeliveryProof = (req, res, next) => {
    // If request is JSON / urlencoded, bypass multer seamlessly
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("multipart/form-data")) {
        return next();
    }

    const handler = uploadProofMulter.fields([
        { name: "proof_photo", maxCount: 1 },
        { name: "photo", maxCount: 1 },
        { name: "image", maxCount: 1 },
        { name: "proof", maxCount: 1 },
        { name: "delivery_proof", maxCount: 1 },
        { name: "proof_image", maxCount: 1 },
        { name: "file", maxCount: 1 }
    ]);

    handler(req, res, (err) => {
        if (err) {
            console.warn("[UPLOAD PROOF WARNING]:", err.message);
            // Don't crash if optional file fails, let handler check body
        }
        // Normalize single file to req.file
        if (req.files) {
            const found = req.files["proof_photo"]?.[0] ||
                          req.files["photo"]?.[0] ||
                          req.files["image"]?.[0] ||
                          req.files["proof"]?.[0] ||
                          req.files["delivery_proof"]?.[0] ||
                          req.files["proof_image"]?.[0] ||
                          req.files["file"]?.[0];
            if (found) req.file = found;
        }
        next();
    });
};

// 2. Partner Profile Photo Storage
const partnerStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, PARTNER_UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const partnerId = req.partner?.partner_id || req.body?.partner_id || req.params?.partnerId || "partner";
        const ext = path.extname(file.originalname).toLowerCase() || ".png";
        const cleanExt = ext.startsWith(".") ? ext : `.${ext}`;
        const uniqueSuffix = `${Date.now()}`;
        cb(null, `profile_${partnerId}_${uniqueSuffix}${cleanExt}`);
    }
});

const uploadPartnerMulter = multer({
    storage: partnerStorage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: imageFileFilter
});

const uploadPartnerPhoto = (req, res, next) => {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("multipart/form-data")) {
        return next();
    }

    const handler = uploadPartnerMulter.fields([
        { name: "photo", maxCount: 1 },
        { name: "profile_photo", maxCount: 1 },
        { name: "avatar", maxCount: 1 },
        { name: "image", maxCount: 1 },
        { name: "file", maxCount: 1 }
    ]);

    handler(req, res, (err) => {
        if (err) {
            console.warn("[UPLOAD PARTNER PHOTO WARNING]:", err.message);
        }
        if (req.files) {
            const found = req.files["photo"]?.[0] ||
                          req.files["profile_photo"]?.[0] ||
                          req.files["avatar"]?.[0] ||
                          req.files["image"]?.[0] ||
                          req.files["file"]?.[0];
            if (found) req.file = found;
        }
        next();
    });
};

// 3. Customer & Admin User Profile Photo Storage
const userProfileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, USER_UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const userId = req.user?.id || req.body?.userId || req.body?.user_id || "user";
        const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
        const cleanExt = (ext === ".tmp" || !ext || ext === ".") ? ".jpg" : (ext.startsWith(".") ? ext : `.${ext}`);
        const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        cb(null, `profile_${userId}_${uniqueSuffix}${cleanExt}`);
    }
});

const uploadUserProfileMulter = multer({
    storage: userProfileStorage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    fileFilter: imageFileFilter
});

const uploadUserProfilePhoto = (req, res, next) => {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("multipart/form-data")) {
        return next();
    }

    const handler = uploadUserProfileMulter.fields([
        { name: "photo", maxCount: 1 },
        { name: "profile_photo", maxCount: 1 },
        { name: "image", maxCount: 1 },
        { name: "avatar", maxCount: 1 },
        { name: "file", maxCount: 1 }
    ]);

    handler(req, res, (err) => {
        if (err) {
            console.warn("[UPLOAD USER PHOTO WARNING]:", err.message);
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({ success: false, message: "File exceeds 25MB limit" });
            }
        }
        if (req.files) {
            const found = req.files["photo"]?.[0] ||
                          req.files["profile_photo"]?.[0] ||
                          req.files["image"]?.[0] ||
                          req.files["avatar"]?.[0] ||
                          req.files["file"]?.[0];
            if (found) req.file = found;
        }
        next();
    });
};

module.exports = {
    uploadDeliveryProof,
    uploadPartnerPhoto,
    uploadUserProfilePhoto,
    USER_UPLOADS_DIR,
    PARTNER_UPLOADS_DIR,
    PROOF_UPLOADS_DIR
};

