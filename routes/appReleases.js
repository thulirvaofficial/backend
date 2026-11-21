const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
    getLatestPublishedRelease,
    checkUpdate,
    getAllReleases,
    getReleaseById,
    createRelease,
    publishRelease,
    disableRelease,
    rollbackRelease,
    deleteRelease,
    incrementDownloadCount,
    getStatistics
} = require("../services/appReleaseService");

const publicRouter = express.Router();
const adminRouter = express.Router();

// Setup Multer Storage for APKs
const apksDir = path.resolve(__dirname, "..", "public", "uploads", "apks");
if (!fs.existsSync(apksDir)) {
    fs.mkdirSync(apksDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, apksDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || ".apk";
        const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
        const uniqueSuffix = Date.now() + "_" + Math.round(Math.random() * 1e5);
        cb(null, `thulirva_v${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 150 * 1024 * 1024 // 150 MB limit
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === ".apk" || file.mimetype === "application/vnd.android.package-archive" || file.mimetype === "application/octet-stream") {
            cb(null, true);
        } else {
            cb(new Error("Only Android APK files (.apk) are allowed"));
        }
    }
});

/* ============================================================
   PUBLIC APP RELEASE ENDPOINTS (/api/app/releases)
============================================================ */

/**
 * GET /api/app/releases/latest
 * Returns details of the currently published customer app release
 */
publicRouter.get("/latest", async (req, res) => {
    try {
        const latest = await getLatestPublishedRelease();
        if (!latest) {
            return res.status(404).json({
                success: false,
                message: "No published app release found"
            });
        }

        res.json({
            success: true,
            release: {
                version: latest.version,
                version_code: latest.version_code,
                release_title: latest.release_title,
                release_notes: latest.release_notes,
                release_date: latest.release_date || latest.published_at,
                download_url: "/api/app/releases/download",
                file_size: latest.file_size_formatted,
                file_size_bytes: Number(latest.file_size_bytes) || 0,
                checksum_sha256: latest.checksum_sha256,
                min_supported_version: latest.min_supported_version,
                is_mandatory: latest.is_mandatory,
                status: latest.status
            }
        });
    } catch (err) {
        console.error("[PUBLIC RELEASE ERROR] /latest:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/app/releases/check
 * Query params: version (e.g. 1.0.0), version_code (e.g. 1)
 * Compares client version against latest published version
 */
publicRouter.get("/check", async (req, res) => {
    try {
        const clientVersion = req.query.version || req.query.v || "1.0.0";
        const clientVersionCode = req.query.version_code || req.query.code || req.query.vc || 0;

        const result = await checkUpdate({ clientVersion, clientVersionCode });
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        console.error("[PUBLIC RELEASE ERROR] /check:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Helper to resolve actual APK file path across OS boundaries (Linux VPS vs Windows dev)
 */
function resolveApkFilePath(release) {
    if (!release) return null;
    const baseDir = path.resolve(__dirname, "..", "public", "uploads", "apks");
    const filename = release.apk_filename || (release.apk_path ? path.basename(release.apk_path.replace(/\\/g, "/")) : "");
    const localInApks = path.join(baseDir, filename);

    if (fs.existsSync(localInApks)) {
        return localInApks;
    }
    if (release.apk_path && fs.existsSync(release.apk_path)) {
        return release.apk_path;
    }
    return null;
}

/**
 * GET /api/app/releases/download
 * Streams the currently published APK directly
 */
publicRouter.get("/download", async (req, res) => {
    try {
        const latest = await getLatestPublishedRelease();
        if (!latest) {
            return res.status(404).send("No active published APK available for download.");
        }

        const filePath = resolveApkFilePath(latest);
        if (!filePath) {
            console.error(`[DOWNLOAD ERROR] APK file not found at: ${latest.apk_path} or uploads/apks/${latest.apk_filename}`);
            return res.status(404).send("APK binary file not found on server disk. Please upload the APK via the Admin Panel.");
        }

        // Increment download counter
        incrementDownloadCount(latest.id).catch((e) => console.error(e));

        const stat = fs.statSync(filePath);
        const filename = `Thulirva-v${latest.version}.apk`;

        res.writeHead(200, {
            "Content-Type": "application/vnd.android.package-archive",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": stat.size,
            "Cache-Control": "public, max-age=3600",
            "X-App-Version": latest.version,
            "X-App-Version-Code": String(latest.version_code),
            "X-App-Checksum-Sha256": latest.checksum_sha256
        });

        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
    } catch (err) {
        console.error("[DOWNLOAD ERROR] /download:", err);
        res.status(500).send("Server error processing APK download.");
    }
});

/**
 * GET /api/app/releases/download/:id
 * Streams specific release APK
 */
publicRouter.get("/download/:id", async (req, res) => {
    try {
        const release = await getReleaseById(req.params.id);
        if (!release) {
            return res.status(404).send("Release record not found.");
        }

        const filePath = resolveApkFilePath(release);
        if (!filePath) {
            return res.status(404).send("APK binary file not found on server disk.");
        }

        incrementDownloadCount(release.id).catch((e) => console.error(e));

        const stat = fs.statSync(filePath);
        const filename = `Thulirva-v${release.version}.apk`;

        res.writeHead(200, {
            "Content-Type": "application/vnd.android.package-archive",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": stat.size,
            "Cache-Control": "public, max-age=3600",
            "X-App-Version": release.version,
            "X-App-Checksum-Sha256": release.checksum_sha256
        });

        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
    } catch (err) {
        console.error("[DOWNLOAD ERROR] /download/:id:", err);
        res.status(500).send("Server error processing APK download.");
    }
});

/* ============================================================
   ADMIN APP RELEASE MANAGEMENT ENDPOINTS (/api/admin/app/releases)
============================================================ */

/**
 * GET /api/admin/app/releases
 * List releases with pagination & filters
 */
adminRouter.get("/", async (req, res) => {
    try {
        const { page = 1, limit = 20, status = "all", search = "" } = req.query;
        const data = await getAllReleases({ page, limit, status, search });
        res.json({ success: true, ...data });
    } catch (err) {
        console.error("[ADMIN RELEASE ERROR] GET /:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/app/releases/statistics
 * Download and adoption metrics
 */
adminRouter.get("/statistics", async (req, res) => {
    try {
        const stats = await getStatistics();
        res.json({ success: true, statistics: stats });
    } catch (err) {
        console.error("[ADMIN RELEASE ERROR] GET /statistics:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/app/releases/:id
 * Single release details
 */
adminRouter.get("/:id", async (req, res) => {
    try {
        const release = await getReleaseById(req.params.id);
        if (!release) {
            return res.status(404).json({ success: false, message: "Release not found" });
        }
        res.json({ success: true, release });
    } catch (err) {
        console.error("[ADMIN RELEASE ERROR] GET /:id:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/app/releases
 * Upload new customer APK & create release record
 */
adminRouter.post("/", upload.single("apk_file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "Please upload an APK file (.apk)." });
        }

        const {
            version,
            version_code,
            release_title,
            release_notes,
            min_supported_version = "1.0.0",
            is_mandatory = false,
            status = "draft"
        } = req.body;

        if (!version || !version_code || !release_title) {
            // Clean up uploaded file if validation fails
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(400).json({
                success: false,
                error: "Version number, version code, and release title are required."
            });
        }

        const adminUser = req.user ? (req.user.name || req.user.email || "Admin") : "Admin";

        const newRelease = await createRelease({
            version,
            versionCode: version_code,
            releaseTitle: release_title,
            releaseNotes: release_notes,
            minSupportedVersion: min_supported_version,
            isMandatory: is_mandatory === "true" || is_mandatory === true,
            status: status || "draft",
            apkPath: req.file.path,
            apkFilename: req.file.filename,
            fileSizeBytes: req.file.size,
            uploadedBy: adminUser
        });

        res.status(201).json({
            success: true,
            message: `Release v${newRelease.version} created successfully.`,
            release: newRelease
        });
    } catch (err) {
        console.error("[ADMIN RELEASE ERROR] POST /:", err);
        // If file was uploaded before error, delete it
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/app/releases/:id/publish
 * Publish release and notify customers
 */
adminRouter.post("/:id/publish", async (req, res) => {
    try {
        const adminUser = req.user ? (req.user.name || req.user.email || "Admin") : "Admin";
        const published = await publishRelease(req.params.id, adminUser);
        res.json({
            success: true,
            message: `Release v${published.version} is now LIVE in production!`,
            release: published
        });
    } catch (err) {
        console.error("[ADMIN RELEASE ERROR] POST /:id/publish:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/app/releases/:id/disable
 * Disable a release
 */
adminRouter.post("/:id/disable", async (req, res) => {
    try {
        const disabled = await disableRelease(req.params.id);
        res.json({
            success: true,
            message: `Release v${disabled.version} has been disabled.`,
            release: disabled
        });
    } catch (err) {
        console.error("[ADMIN RELEASE ERROR] POST /:id/disable:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/app/releases/:id/rollback
 * Roll back to a previous stable release
 */
adminRouter.post("/:id/rollback", async (req, res) => {
    try {
        const adminUser = req.user ? (req.user.name || req.user.email || "Admin") : "Admin";
        const rolledBack = await rollbackRelease(req.params.id, adminUser);
        res.json({
            success: true,
            message: `Successfully rolled back to v${rolledBack.version}! It is now the live published version.`,
            release: rolledBack
        });
    } catch (err) {
        console.error("[ADMIN RELEASE ERROR] POST /:id/rollback:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/admin/app/releases/:id
 * Delete release and APK file (if not currently published)
 */
adminRouter.delete("/:id", async (req, res) => {
    try {
        const result = await deleteRelease(req.params.id);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error("[ADMIN RELEASE ERROR] DELETE /:id:", err);
        res.status(400).json({ success: false, error: err.message });
    }
});

module.exports = {
    publicRouter,
    adminRouter
};

