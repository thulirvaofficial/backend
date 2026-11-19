const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const { uploadCategoryImage, CATEGORY_UPLOADS_DIR } = require("../middleware/uploadMiddleware");

const router = express.Router();

const CATEGORIES_FILE = path.resolve(__dirname, "..", "data", "categories.json");

function ensureDirectoryExists() {
    const dir = path.dirname(CATEGORIES_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadLocalCategories() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(CATEGORIES_FILE)) {
            const raw = fs.readFileSync(CATEGORIES_FILE, "utf-8");
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
        }
    } catch (_) {}
    return [];
}

function saveLocalCategories(cats) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(cats, null, 2), "utf-8");
    } catch (err) {
        console.error("[CATEGORIES] Error writing to disk:", err);
    }
}

function saveBase64Image(image, prefix = "cat") {
    if (!image || typeof image !== "string") return image;
    if (image.startsWith("data:image/")) {
        try {
            const matches = image.match(/^data:image\/([a-zA-Z0-9\+\-\.]+);base64,(.+)$/);
            if (matches) {
                const ext = matches[1].includes("jpeg") ? "jpg" : (matches[1].includes("png") ? "png" : "jpg");
                const buffer = Buffer.from(matches[2], "base64");
                const uploadsDir = path.resolve(__dirname, "..", "public", "uploads", "categories");
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }
                const fileName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                return `/uploads/categories/${fileName}`;
            }
        } catch (err) {
            console.error("Error saving uploaded image:", err);
        }
    }
    return image;
}

function cleanupOldCategoryImage(oldPath, newPath = null, excludeCatId = null) {
    if (!oldPath || typeof oldPath !== "string") return;
    if (newPath && oldPath === newPath) return; // Same image, do not delete
    // Only cleanup files within /uploads/categories/
    if (!oldPath.includes("/uploads/categories/")) return;

    try {
        const rawFile = oldPath.split("?")[0];
        const filename = path.basename(rawFile);
        // Prevent directory traversal or deleting non-category files
        if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) return;

        // Check if any other category in local database still references this filename
        const local = loadLocalCategories();
        const isInUseByOther = local.some(c => {
            if (excludeCatId && (Number(c.id) === Number(excludeCatId) || Number(c.category_id) === Number(excludeCatId))) {
                return false;
            }
            const imgs = [c.image, c.category_image, c.website_image, c.mobile_image, c.appImage];
            return imgs.some(img => img && typeof img === "string" && img.includes(filename) && (newPath ? !newPath.includes(filename) : true));
        });

        if (!isInUseByOther) {
            const fullPath = path.join(CATEGORY_UPLOADS_DIR, filename);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
                console.log(`[CATEGORIES] Cleaned up orphaned category image: ${filename}`);
            }
        }
    } catch (err) {
        console.warn("[CATEGORIES] Could not delete orphaned image:", err.message);
    }
}

function normalizeCategory(r) {
    const catId = Number(r.category_id || r.id);
    const catName = (r.category_name || r.name || r.displayName || r.display_name || "").trim();
    const dispName = (r.display_name || r.displayName || catName).trim();
    const catKey = (r.category_key || r.slug || catName.toLowerCase().replace(/[^a-z0-9]/g, "_")).trim();
    
    // Description must be exactly what is stored, or null if empty/deleted
    let desc = r.category_description !== undefined ? r.category_description : r.description;
    if (desc !== null && desc !== undefined) {
        desc = desc.toString().trim();
        if (desc.length === 0) desc = null;
    } else {
        desc = null;
    }

    const webImg = r.category_image || r.website_image || r.image || "/assets/images/products/fresh_cow_milk.jpg";
    const mobImg = r.mobile_image || r.app_image || r.appImage || r.category_image || webImg;
    const catIcon = r.category_icon || r.emoji || "🥛";
    const isActive = r.is_active !== undefined ? Boolean(r.is_active) : (r.status !== 'inactive');
    const displayOrder = Number(r.display_order ?? r.id ?? 1);
    const updatedAt = r.updated_at || new Date().toISOString();
    const itemCount = Number(r.itemCount || r.item_count || 0);

    return {
        id: catId,
        category_id: catId,
        category_key: catKey,
        name: catName,
        category_name: catName,
        displayName: dispName,
        display_name: dispName,
        slug: catKey,
        description: desc,
        category_description: desc,
        image: webImg,
        category_image: mobImg,
        website_image: webImg,
        mobile_image: mobImg,
        appImage: mobImg,
        emoji: catIcon,
        category_icon: catIcon,
        is_active: isActive,
        display_order: displayOrder,
        updated_at: updatedAt,
        itemCount: itemCount
    };
}

/* =========================================================================
   PUBLIC / CUSTOMER CATEGORIES APIs
========================================================================= */

// GET ALL CATEGORIES
router.get(["/", "/all", "/list"], async (req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    try {
        let categories = [];
        try {
            const dbResult = await pool.query(
                "SELECT * FROM categories ORDER BY COALESCE(display_order, id) ASC, id ASC"
            );
            if (dbResult.rows && dbResult.rows.length > 0) {
                categories = dbResult.rows.map(normalizeCategory);
            }
        } catch (_) {}

        if (!categories.length) {
            categories = loadLocalCategories().map(normalizeCategory);
        }

        // Public filter: only return active categories unless explicitly requested with ?all=true
        const includeInactive = req.query.all === "true" || req.query.include_inactive === "true";
        const filtered = includeInactive ? categories : categories.filter(c => c.is_active !== false);

        // Ensure sorted by display_order ASC
        filtered.sort((a, b) => a.display_order - b.display_order || a.id - b.id);

        return res.json({
            success: true,
            total: filtered.length,
            categories: filtered
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// GET SINGLE CATEGORY
router.get("/:id", async (req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    const id = parseInt(req.params.id, 10);
    const key = req.params.id.toString().trim();

    try {
        let category = null;
        try {
            const result = await pool.query(
                "SELECT * FROM categories WHERE id=$1 OR slug=$2 OR name ILIKE $2 LIMIT 1",
                [isNaN(id) ? -1 : id, key]
            );
            if (result.rows.length > 0) {
                category = normalizeCategory(result.rows[0]);
            }
        } catch (_) {}

        if (!category) {
            const local = loadLocalCategories();
            const found = local.find(c => c.id === id || c.category_id === id || c.category_key === key || c.name === key);
            if (found) category = normalizeCategory(found);
        }

        if (category) {
            return res.json({ success: true, category });
        }
        return res.status(404).json({ success: false, message: `Category not found for '${req.params.id}'` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* =========================================================================
   ADMIN CATEGORY MANAGEMENT APIs (Create, Update, Delete, Upload)
========================================================================= */

// UPLOAD CATEGORY IMAGE (Admin Only)
router.post(["/upload", "/upload-image"], authenticateToken, adminOnly, uploadCategoryImage, (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image file provided. Please choose a JPG, PNG, or WEBP file (Max 5MB)."
            });
        }

        const relativeUrl = `/uploads/categories/${req.file.filename}`;
        return res.json({
            success: true,
            message: "Category image uploaded successfully",
            image_url: relativeUrl,
            url: relativeUrl,
            filename: req.file.filename,
            original_name: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// CREATE CATEGORY (Admin Only)
router.post(["/", "/create"], authenticateToken, adminOnly, async (req, res) => {
    try {
        const body = req.body || {};
        const name = (body.name || body.category_name || body.displayName || body.display_name || "").trim();
        if (!name) {
            return res.status(400).json({ success: false, message: "Category name is required" });
        }

        const displayName = (body.displayName || body.display_name || name).trim();
        const categoryKey = (body.category_key || body.slug || name.toLowerCase().replace(/[^a-z0-9]/g, "_")).trim();
        const description = (body.category_description !== undefined ? body.category_description : body.description)?.toString().trim() || null;
        const icon = body.category_icon || body.emoji || "🏷️";
        const orderNum = parseInt(body.display_order, 10) || 1;
        const active = body.is_active !== undefined ? Boolean(body.is_active) : true;
        const now = new Date().toISOString();

        const savedWebImg = saveBase64Image(body.website_image || body.category_image || body.image, "cat_web") || "/assets/images/products/fresh_cow_milk.jpg";
        const savedMobImg = saveBase64Image(body.mobile_image || body.appImage || body.category_image, "cat_mob") || savedWebImg;

        let createdCategory = null;

        // 1. Try DB insertion
        try {
            const dbRes = await pool.query(
                `INSERT INTO categories (name, display_name, description, slug, image, website_image, mobile_image, emoji, display_order, is_active, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                 RETURNING *`,
                [name, displayName, description, categoryKey, savedWebImg, savedWebImg, savedMobImg, icon, orderNum, active]
            );
            if (dbRes.rows && dbRes.rows.length > 0) {
                createdCategory = normalizeCategory(dbRes.rows[0]);
            }
        } catch (_) {}

        // 2. Persist to disk categories.json
        const local = loadLocalCategories();
        const nextId = createdCategory ? createdCategory.id : (local.length ? Math.max(...local.map(c => Number(c.id || 0))) + 1 : 1);

        if (!createdCategory) {
            createdCategory = normalizeCategory({
                id: nextId,
                category_id: nextId,
                category_key: categoryKey,
                name,
                category_name: name,
                displayName,
                display_name: displayName,
                slug: categoryKey,
                description,
                category_description: description,
                image: savedWebImg,
                category_image: savedMobImg,
                website_image: savedWebImg,
                mobile_image: savedMobImg,
                appImage: savedMobImg,
                emoji: icon,
                category_icon: icon,
                display_order: orderNum,
                is_active: active,
                updated_at: now,
                itemCount: 0
            });
        }

        local.push(createdCategory);
        local.sort((a, b) => a.display_order - b.display_order || a.id - b.id);
        saveLocalCategories(local);

        return res.json({
            success: true,
            message: "Category created successfully",
            category: createdCategory
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// UPDATE CATEGORY (Admin Only)
router.put(["/:id", "/update/:id"], authenticateToken, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const body = req.body || {};
        const now = new Date().toISOString();

        const local = loadLocalCategories();
        const idx = local.findIndex(c => Number(c.id) === id || Number(c.category_id) === id);

        if (idx === -1) {
            return res.status(404).json({ success: false, message: `Category #${id} not found.` });
        }

        const existing = local[idx];

        // Process fields explicitly so empty string ("") properly clears the description
        let updatedDescription = existing.description;
        if (body.category_description !== undefined) {
            const raw = body.category_description;
            updatedDescription = (raw !== null && raw !== undefined && raw.toString().trim().length > 0) ? raw.toString().trim() : null;
        } else if (body.description !== undefined) {
            const raw = body.description;
            updatedDescription = (raw !== null && raw !== undefined && raw.toString().trim().length > 0) ? raw.toString().trim() : null;
        }

        const updatedName = (body.name || body.category_name || existing.name).trim();
        const updatedDisplayName = (body.displayName || body.display_name || body.name || existing.displayName || existing.name).trim();
        const updatedKey = (body.category_key || body.slug || existing.category_key || existing.slug || updatedName.toLowerCase().replace(/[^a-z0-9]/g, "_")).trim();
        const updatedOrder = body.display_order !== undefined ? parseInt(body.display_order, 10) : existing.display_order;
        const updatedActive = body.is_active !== undefined ? Boolean(body.is_active) : existing.is_active;
        const updatedIcon = body.category_icon || body.emoji || existing.category_icon || existing.emoji || "🥛";

        const prevWebImg = existing.website_image || existing.image;
        const prevMobImg = existing.mobile_image || existing.appImage || existing.category_image;

        let savedWebImg = existing.website_image || existing.image;
        if (body.website_image !== undefined || body.category_image !== undefined || body.image !== undefined) {
            savedWebImg = saveBase64Image(body.website_image || body.category_image || body.image, "cat_web");
        }
        let savedMobImg = existing.mobile_image || existing.appImage || savedWebImg;
        if (body.mobile_image !== undefined || body.appImage !== undefined || body.category_image !== undefined) {
            savedMobImg = saveBase64Image(body.mobile_image || body.appImage || body.category_image, "cat_mob");
        }

        // 1. Try DB update
        try {
            await pool.query(
                `UPDATE categories
                 SET name = $1,
                     display_name = $2,
                     description = $3,
                     slug = $4,
                     image = $5,
                     website_image = $5,
                     mobile_image = $6,
                     emoji = $7,
                     display_order = $8,
                     is_active = $9,
                     updated_at = NOW()
                 WHERE id = $10`,
                [updatedName, updatedDisplayName, updatedDescription, updatedKey, savedWebImg, savedMobImg, updatedIcon, updatedOrder, updatedActive, id]
            );
        } catch (_) {}

        // 2. Persist to disk
        local[idx] = normalizeCategory({
            ...existing,
            id,
            category_id: id,
            name: updatedName,
            category_name: updatedName,
            displayName: updatedDisplayName,
            display_name: updatedDisplayName,
            category_key: updatedKey,
            slug: updatedKey,
            description: updatedDescription,
            category_description: updatedDescription,
            image: savedWebImg,
            category_image: savedMobImg,
            website_image: savedWebImg,
            mobile_image: savedMobImg,
            appImage: savedMobImg,
            emoji: updatedIcon,
            category_icon: updatedIcon,
            display_order: updatedOrder,
            is_active: updatedActive,
            updated_at: now
        });

        local.sort((a, b) => a.display_order - b.display_order || a.id - b.id);
        saveLocalCategories(local);

        // Cleanup orphaned category image files if replaced or removed
        if (prevWebImg && prevWebImg !== savedWebImg && prevWebImg !== savedMobImg) {
            cleanupOldCategoryImage(prevWebImg, savedWebImg);
        }
        if (prevMobImg && prevMobImg !== savedMobImg && prevMobImg !== savedWebImg && prevMobImg !== prevWebImg) {
            cleanupOldCategoryImage(prevMobImg, savedMobImg);
        }

        return res.json({
            success: true,
            message: "Category updated successfully",
            category: local[idx]
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE CATEGORY (Admin Only)
router.delete("/:id", authenticateToken, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        try {
            await pool.query("DELETE FROM categories WHERE id=$1", [id]);
        } catch (_) {}

        const local = loadLocalCategories();
        const toDelete = local.find(c => Number(c.id) === id || Number(c.category_id) === id);
        const updated = local.filter(c => Number(c.id) !== id && Number(c.category_id) !== id);
        saveLocalCategories(updated);

        if (toDelete) {
            const img1 = toDelete.website_image || toDelete.image;
            const img2 = toDelete.mobile_image || toDelete.category_image;
            if (img1) cleanupOldCategoryImage(img1, null, id);
            if (img2 && img2 !== img1) cleanupOldCategoryImage(img2, null, id);
        }

        return res.json({ success: true, message: "Category deleted successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
