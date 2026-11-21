const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool, isDbOnline } = require("../config/database");
const { sendNotification } = require("./notificationService");
const { getIO } = require("./socketService");

const JSON_STORE_PATH = path.resolve(__dirname, "..", "data", "app_releases.json");

// Ensure data directory and fallback store exist
function ensureJsonStore() {
    try {
        const dir = path.dirname(JSON_STORE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(JSON_STORE_PATH)) {
            fs.writeFileSync(JSON_STORE_PATH, JSON.stringify([], null, 2), "utf8");
        }
    } catch (err) {
        console.error("[APP RELEASE SERVICE] Failed to initialize JSON store:", err.message);
    }
}

ensureJsonStore();

function readJsonReleases() {
    try {
        if (fs.existsSync(JSON_STORE_PATH)) {
            const raw = fs.readFileSync(JSON_STORE_PATH, "utf8");
            return JSON.parse(raw);
        }
    } catch (err) {
        console.error("[APP RELEASE SERVICE] Error reading JSON store:", err.message);
    }
    return [];
}

function writeJsonReleases(releases) {
    try {
        fs.writeFileSync(JSON_STORE_PATH, JSON.stringify(releases, null, 2), "utf8");
    } catch (err) {
        console.error("[APP RELEASE SERVICE] Error writing JSON store:", err.message);
    }
}

/**
 * Format bytes to readable string (e.g. 24.50 MB)
 */
function formatBytes(bytes, decimals = 2) {
    if (!+bytes || bytes <= 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Calculate SHA-256 checksum of a file
 */
function calculateSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (data) => hash.update(data));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", (err) => reject(err));
    });
}

/**
 * Semantic version comparator:
 * Returns -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
function compareSemver(v1, v2) {
    if (!v1) return -1;
    if (!v2) return 1;
    const clean1 = (v1 + "").replace(/^v/i, "").trim();
    const clean2 = (v2 + "").replace(/^v/i, "").trim();

    const parts1 = clean1.split(".").map((n) => parseInt(n, 10) || 0);
    const parts2 = clean2.split(".").map((n) => parseInt(n, 10) || 0);

    const len = Math.max(parts1.length, parts2.length);
    for (let i = 0; i < len; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

/**
 * Get latest published release
 */
async function getLatestPublishedRelease() {
    if (isDbOnline()) {
        try {
            const res = await pool.query(
                `SELECT * FROM app_releases 
                 WHERE status = 'published' 
                 ORDER BY version_code DESC, id DESC 
                 LIMIT 1`
            );
            if (res.rows.length > 0) {
                return res.rows[0];
            }
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error in getLatestPublishedRelease:", err.message);
        }
    }

    // Fallback to JSON
    const releases = readJsonReleases();
    const published = releases.filter((r) => r.status === "published");
    if (published.length === 0) return null;
    published.sort((a, b) => (Number(b.version_code) || 0) - (Number(a.version_code) || 0));
    return published[0];
}

/**
 * Check if update is available for given client version and code
 */
async function checkUpdate({ clientVersion, clientVersionCode }) {
    const latest = await getLatestPublishedRelease();
    if (!latest) {
        return {
            updateAvailable: false,
            message: "No published app release available"
        };
    }

    const cCode = parseInt(clientVersionCode, 10) || 0;
    const lCode = parseInt(latest.version_code, 10) || 0;

    let updateAvailable = false;
    if (cCode > 0 && lCode > 0) {
        updateAvailable = cCode < lCode;
    } else {
        updateAvailable = compareSemver(clientVersion, latest.version) < 0;
    }

    // Check if mandatory
    let isMandatory = !!latest.is_mandatory;
    if (!isMandatory && latest.min_supported_version && clientVersion) {
        if (compareSemver(clientVersion, latest.min_supported_version) < 0) {
            isMandatory = true;
        }
    }

    return {
        updateAvailable,
        isMandatory,
        currentVersion: clientVersion || "unknown",
        currentVersionCode: cCode,
        latestVersion: latest.version,
        latestVersionCode: latest.version_code,
        releaseTitle: latest.release_title,
        releaseNotes: latest.release_notes || "",
        releaseDate: latest.release_date || latest.published_at,
        downloadUrl: "/api/app/releases/download",
        fileSize: latest.file_size_formatted,
        fileSizeBytes: Number(latest.file_size_bytes) || 0,
        checksumSha256: latest.checksum_sha256,
        minSupportedVersion: latest.min_supported_version || "1.0.0"
    };
}

/**
 * Get all releases (admin list)
 */
async function getAllReleases({ page = 1, limit = 50, status = null, search = "" } = {}) {
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const parsedLimit = parseInt(limit, 10);

    if (isDbOnline()) {
        try {
            let whereClauses = [];
            let params = [];

            if (status && status !== "all") {
                params.push(status);
                whereClauses.push(`status = $${params.length}`);
            }

            if (search && search.trim()) {
                params.push(`%${search.trim()}%`);
                whereClauses.push(`(version ILIKE $${params.length} OR release_title ILIKE $${params.length} OR release_notes ILIKE $${params.length})`);
            }

            const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

            const countRes = await pool.query(`SELECT COUNT(*) FROM app_releases ${whereStr}`, params);
            const total = parseInt(countRes.rows[0].count, 10);

            params.push(parsedLimit);
            const limitParam = `$${params.length}`;
            params.push(offset);
            const offsetParam = `$${params.length}`;

            const listRes = await pool.query(
                `SELECT * FROM app_releases 
                 ${whereStr} 
                 ORDER BY created_at DESC 
                 LIMIT ${limitParam} OFFSET ${offsetParam}`,
                params
            );

            return {
                releases: listRes.rows,
                total,
                page: parseInt(page, 10),
                limit: parsedLimit,
                totalPages: Math.ceil(total / parsedLimit) || 1
            };
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error in getAllReleases:", err.message);
        }
    }

    // JSON fallback
    let list = readJsonReleases();
    if (status && status !== "all") {
        list = list.filter((r) => r.status === status);
    }
    if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter((r) => 
            (r.version && r.version.toLowerCase().includes(q)) ||
            (r.release_title && r.release_title.toLowerCase().includes(q))
        );
    }
    list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const total = list.length;
    const sliced = list.slice(offset, offset + parsedLimit);
    return {
        releases: sliced,
        total,
        page: parseInt(page, 10),
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit) || 1
    };
}

/**
 * Get single release by ID or release_id
 */
async function getReleaseById(id) {
    if (isDbOnline()) {
        try {
            const res = await pool.query(
                `SELECT * FROM app_releases WHERE id::text = $1 OR release_id = $1 LIMIT 1`,
                [String(id)]
            );
            if (res.rows.length > 0) return res.rows[0];
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error in getReleaseById:", err.message);
        }
    }

    const list = readJsonReleases();
    return list.find((r) => String(r.id) === String(id) || r.release_id === String(id)) || null;
}

/**
 * Create a new release
 */
async function createRelease({
    version,
    versionCode,
    releaseTitle,
    releaseNotes,
    minSupportedVersion = "1.0.0",
    isMandatory = false,
    status = "draft",
    apkPath,
    apkFilename,
    fileSizeBytes,
    uploadedBy = "admin"
}) {
    if (!version || !versionCode || !releaseTitle || !apkPath) {
        throw new Error("Missing required release fields: version, versionCode, releaseTitle, and APK file are required.");
    }

    // Calculate SHA-256
    let checksumSha256 = "";
    if (fs.existsSync(apkPath)) {
        checksumSha256 = await calculateSha256(apkPath);
    } else {
        throw new Error(`APK file not found on disk at path: ${apkPath}`);
    }

    const formattedSize = formatBytes(fileSizeBytes);
    const releaseId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();

    const releaseData = {
        release_id: releaseId,
        version: version.trim(),
        version_code: parseInt(versionCode, 10),
        release_title: releaseTitle.trim(),
        release_notes: releaseNotes || "",
        release_date: now,
        apk_path: apkPath,
        apk_filename: apkFilename,
        file_size_bytes: fileSizeBytes,
        file_size_formatted: formattedSize,
        checksum_sha256: checksumSha256,
        min_supported_version: minSupportedVersion || "1.0.0",
        is_mandatory: !!isMandatory,
        status: status || "draft",
        download_count: 0,
        uploaded_by: uploadedBy,
        published_at: status === "published" ? now : null,
        created_at: now,
        updated_at: now
    };

    if (isDbOnline()) {
        try {
            // If publishing directly, unpublish other releases
            if (status === "published") {
                await pool.query(
                    `UPDATE app_releases SET status = 'archived', updated_at = NOW() WHERE status = 'published'`
                );
            }

            const insertRes = await pool.query(
                `INSERT INTO app_releases (
                    release_id, version, version_code, release_title, release_notes, 
                    release_date, apk_path, apk_filename, file_size_bytes, file_size_formatted, 
                    checksum_sha256, min_supported_version, is_mandatory, status, download_count, 
                    uploaded_by, published_at, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
                ) RETURNING *`,
                [
                    releaseData.release_id,
                    releaseData.version,
                    releaseData.version_code,
                    releaseData.release_title,
                    releaseData.release_notes,
                    releaseData.release_date,
                    releaseData.apk_path,
                    releaseData.apk_filename,
                    releaseData.file_size_bytes,
                    releaseData.file_size_formatted,
                    releaseData.checksum_sha256,
                    releaseData.min_supported_version,
                    releaseData.is_mandatory,
                    releaseData.status,
                    releaseData.download_count,
                    releaseData.uploaded_by,
                    releaseData.published_at,
                    releaseData.created_at,
                    releaseData.updated_at
                ]
            );

            const created = insertRes.rows[0];

            // Sync with JSON fallback
            const jsonList = readJsonReleases();
            if (status === "published") {
                jsonList.forEach((r) => { if (r.status === "published") r.status = "archived"; });
            }
            jsonList.unshift(created);
            writeJsonReleases(jsonList);

            if (status === "published") {
                dispatchPublishBroadcast(created);
            }

            return created;
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error creating release:", err.message);
        }
    }

    // Fallback JSON creation
    const jsonList = readJsonReleases();
    if (status === "published") {
        jsonList.forEach((r) => { if (r.status === "published") r.status = "archived"; });
    }
    releaseData.id = Date.now();
    jsonList.unshift(releaseData);
    writeJsonReleases(jsonList);

    if (status === "published") {
        dispatchPublishBroadcast(releaseData);
    }

    return releaseData;
}

/**
 * Publish release and broadcast notification to all customer apps
 */
async function publishRelease(id, adminUser = "admin") {
    const existing = await getReleaseById(id);
    if (!existing) {
        throw new Error("Release not found");
    }

    const now = new Date();

    if (isDbOnline()) {
        try {
            // Unpublish current active releases
            await pool.query(
                `UPDATE app_releases 
                 SET status = 'archived', updated_at = NOW() 
                 WHERE status = 'published' AND id != $1`,
                [existing.id]
            );

            // Set this one as published
            const res = await pool.query(
                `UPDATE app_releases 
                 SET status = 'published', published_at = NOW(), updated_at = NOW() 
                 WHERE id = $1 RETURNING *`,
                [existing.id]
            );

            const updated = res.rows[0];

            // JSON sync
            const jsonList = readJsonReleases();
            jsonList.forEach((r) => {
                if (String(r.id) === String(existing.id)) {
                    r.status = "published";
                    r.published_at = now;
                    r.updated_at = now;
                } else if (r.status === "published") {
                    r.status = "archived";
                }
            });
            writeJsonReleases(jsonList);

            dispatchPublishBroadcast(updated);
            return updated;
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error publishing release:", err.message);
        }
    }

    // JSON fallback
    const jsonList = readJsonReleases();
    let publishedItem = null;
    jsonList.forEach((r) => {
        if (String(r.id) === String(id) || r.release_id === String(id)) {
            r.status = "published";
            r.published_at = now;
            r.updated_at = now;
            publishedItem = r;
        } else if (r.status === "published") {
            r.status = "archived";
        }
    });
    writeJsonReleases(jsonList);

    if (publishedItem) {
        dispatchPublishBroadcast(publishedItem);
    }
    return publishedItem;
}

/**
 * Disable an active or draft release
 */
async function disableRelease(id) {
    const existing = await getReleaseById(id);
    if (!existing) {
        throw new Error("Release not found");
    }

    const now = new Date();

    if (isDbOnline()) {
        try {
            const res = await pool.query(
                `UPDATE app_releases 
                 SET status = 'disabled', updated_at = NOW() 
                 WHERE id = $1 RETURNING *`,
                [existing.id]
            );
            const updated = res.rows[0];

            // JSON sync
            const jsonList = readJsonReleases();
            jsonList.forEach((r) => {
                if (String(r.id) === String(existing.id)) {
                    r.status = "disabled";
                    r.updated_at = now;
                }
            });
            writeJsonReleases(jsonList);

            return updated;
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error disabling release:", err.message);
        }
    }

    const jsonList = readJsonReleases();
    let updatedItem = null;
    jsonList.forEach((r) => {
        if (String(r.id) === String(id) || r.release_id === String(id)) {
            r.status = "disabled";
            r.updated_at = now;
            updatedItem = r;
        }
    });
    writeJsonReleases(jsonList);
    return updatedItem;
}

/**
 * Rollback to a previous release version
 */
async function rollbackRelease(id, adminUser = "admin") {
    const target = await getReleaseById(id);
    if (!target) {
        throw new Error("Target rollback release not found");
    }

    if (!fs.existsSync(target.apk_path)) {
        throw new Error(`Cannot rollback: APK binary for version ${target.version} is missing on server disk.`);
    }

    return await publishRelease(target.id, adminUser);
}

/**
 * Delete a release (only allowed if not currently published)
 */
async function deleteRelease(id) {
    const existing = await getReleaseById(id);
    if (!existing) {
        throw new Error("Release not found");
    }

    if (existing.status === "published") {
        throw new Error("Cannot delete currently published release. Please publish another release or disable it first.");
    }

    // Try deleting APK file from disk if it exists
    if (existing.apk_path && fs.existsSync(existing.apk_path)) {
        try {
            fs.unlinkSync(existing.apk_path);
            console.log(`[APP RELEASE SERVICE] Deleted APK file: ${existing.apk_path}`);
        } catch (err) {
            console.warn(`[APP RELEASE SERVICE] Warning deleting APK file: ${err.message}`);
        }
    }

    if (isDbOnline()) {
        try {
            await pool.query(`DELETE FROM app_releases WHERE id = $1`, [existing.id]);
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error deleting release:", err.message);
        }
    }

    // JSON sync
    const jsonList = readJsonReleases().filter(
        (r) => String(r.id) !== String(existing.id) && r.release_id !== existing.release_id
    );
    writeJsonReleases(jsonList);

    return { success: true, message: `Release ${existing.version} deleted successfully.` };
}

/**
 * Increment download counter for analytics
 */
async function incrementDownloadCount(id) {
    if (!id) return;
    if (isDbOnline()) {
        try {
            await pool.query(
                `UPDATE app_releases 
                 SET download_count = download_count + 1 
                 WHERE id = $1 OR release_id = $1::text`,
                [id]
            );
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error incrementing download count:", err.message);
        }
    }

    const jsonList = readJsonReleases();
    jsonList.forEach((r) => {
        if (String(r.id) === String(id) || r.release_id === String(id)) {
            r.download_count = (r.download_count || 0) + 1;
        }
    });
    writeJsonReleases(jsonList);
}

/**
 * Get comprehensive statistics for admin dashboard
 */
async function getStatistics() {
    let totalDownloads = 0;
    let totalReleases = 0;
    let mandatoryCount = 0;
    let activeRelease = null;
    let latestUpload = null;

    if (isDbOnline()) {
        try {
            const statsRes = await pool.query(`
                SELECT 
                    COUNT(*) as total_releases,
                    COALESCE(SUM(download_count), 0) as total_downloads,
                    COUNT(*) FILTER (WHERE is_mandatory = true) as mandatory_count
                FROM app_releases
            `);
            if (statsRes.rows.length > 0) {
                totalReleases = parseInt(statsRes.rows[0].total_releases, 10) || 0;
                totalDownloads = parseInt(statsRes.rows[0].total_downloads, 10) || 0;
                mandatoryCount = parseInt(statsRes.rows[0].mandatory_count, 10) || 0;
            }

            const activeRes = await pool.query(
                `SELECT * FROM app_releases WHERE status = 'published' ORDER BY version_code DESC, id DESC LIMIT 1`
            );
            if (activeRes.rows.length > 0) activeRelease = activeRes.rows[0];

            const latestRes = await pool.query(
                `SELECT * FROM app_releases ORDER BY created_at DESC LIMIT 1`
            );
            if (latestRes.rows.length > 0) latestUpload = latestRes.rows[0];

            return {
                totalDownloads,
                totalReleases,
                mandatoryCount,
                activeRelease,
                latestUpload
            };
        } catch (err) {
            console.error("[APP RELEASE SERVICE] DB error getting statistics:", err.message);
        }
    }

    // JSON fallback
    const list = readJsonReleases();
    totalReleases = list.length;
    totalDownloads = list.reduce((acc, r) => acc + (parseInt(r.download_count, 10) || 0), 0);
    mandatoryCount = list.filter((r) => r.is_mandatory).length;
    activeRelease = list.find((r) => r.status === "published") || null;
    latestUpload = list[0] || null;

    return {
        totalDownloads,
        totalReleases,
        mandatoryCount,
        activeRelease,
        latestUpload
    };
}

/**
 * Broadcast notification & socket event on publish
 */
function dispatchPublishBroadcast(release) {
    try {
        const io = getIO();
        if (io) {
            io.emit("app:update_published", {
                version: release.version,
                versionCode: release.version_code,
                releaseTitle: release.release_title,
                releaseNotes: release.release_notes,
                isMandatory: release.is_mandatory,
                fileSize: release.file_size_formatted,
                publishedAt: release.published_at || new Date().toISOString()
            });
            console.log(`[APP RELEASE SERVICE] Broadcasted socket event 'app:update_published' for v${release.version}`);
        }
    } catch (err) {
        console.error("[APP RELEASE SERVICE] Socket broadcast error:", err.message);
    }

    try {
        sendNotification({
            userId: null,
            title: `🌱 New Thulirva App Update: v${release.version}`,
            message: release.release_notes 
                ? `Update now: ${release.release_notes.substring(0, 100)}...`
                : `A new version (v${release.version}) of the Thulirva Customer App is now live! Download now for the best experience.`,
            type: "app_update",
            targetId: release.id,
            data: {
                version: release.version,
                versionCode: String(release.version_code),
                isMandatory: String(release.is_mandatory)
            }
        }).catch((e) => console.error("[APP RELEASE SERVICE] FCM broadcast error:", e.message));
    } catch (err) {
        console.error("[APP RELEASE SERVICE] Notification dispatch error:", err.message);
    }
}

module.exports = {
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
    getStatistics,
    calculateSha256,
    formatBytes,
    compareSemver
};

