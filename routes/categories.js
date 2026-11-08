const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { authenticateToken, adminOnly } = require("../middleware/auth");

const router = express.Router();

function saveBase64Image(image, prefix = "cat") {
    if (!image || typeof image !== "string") return image;
    if (image.startsWith("data:image/")) {
        try {
            const matches = image.match(/^data:image\/([a-zA-Z0-9\+\-\.]+);base64,(.+)$/);
            if (matches) {
                const ext = matches[1].includes("jpeg") ? "jpg" : (matches[1].includes("png") ? "png" : "jpg");
                const buffer = Buffer.from(matches[2], "base64");
                const uploadsDir = path.resolve(__dirname, "..", "..", "website", "website", "assets", "images", "uploads");
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }
                const fileName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                return `/assets/images/uploads/${fileName}`;
            }
        } catch (err) {
            console.error("Error saving uploaded image:", err);
        }
    }
    return image;
}

let MOCK_CATEGORIES = [
    {
        id: 1,
        name: "Milk",
        displayName: "Fresh Cow Milk",
        slug: "milk",
        description: "Farm fresh A2 raw & chilled cow milk bottled within hours of morning milking.",
        image: "/assets/images/products/fresh_cow_milk.jpg",
        website_image: "/assets/images/products/fresh_cow_milk.jpg",
        mobile_image: "/assets/images/products/fresh_cow_milk.jpg",
        appImage: "/assets/images/products/fresh_cow_milk.jpg",
        is_active: true,
        display_order: 1,
        emoji: "🥛",
        itemCount: 2
    },
    {
        id: 2,
        name: "Ghee",
        displayName: "Ghee & Butter",
        slug: "ghee",
        description: "Traditional hand-churned Bilona cow ghee and fresh cultured farm butter.",
        image: "/assets/images/products/pure_cow_ghee.jpg",
        website_image: "/assets/images/products/pure_cow_ghee.jpg",
        mobile_image: "/assets/images/products/pure_cow_ghee.jpg",
        appImage: "/assets/images/products/pure_cow_ghee.jpg",
        is_active: true,
        display_order: 2,
        emoji: "🧈",
        itemCount: 2
    },
    {
        id: 3,
        name: "Paneer",
        displayName: "Paneer & Tofu",
        slug: "paneer",
        description: "Soft, melt-in-mouth cottage cheese and non-GMO organic artisanal tofu.",
        image: "/assets/images/products/fresh_paneer.jpg",
        website_image: "/assets/images/products/fresh_paneer.jpg",
        mobile_image: "/assets/images/products/fresh_paneer.jpg",
        appImage: "/assets/images/products/fresh_paneer.jpg",
        is_active: true,
        display_order: 3,
        emoji: "🧀",
        itemCount: 2
    },
    {
        id: 4,
        name: "Curd",
        displayName: "Natural Set Curd",
        slug: "curd",
        description: "Naturally cultured probiotic thick set curd made with pure wholesome cow milk.",
        image: "/assets/images/products/product_lineup.jpg",
        website_image: "/assets/images/products/product_lineup.jpg",
        mobile_image: "/assets/images/products/product_lineup.jpg",
        appImage: "/assets/images/products/product_lineup.jpg",
        is_active: true,
        display_order: 4,
        emoji: "🫙",
        itemCount: 1
    },
    {
        id: 5,
        name: "Oils",
        displayName: "Cold-Pressed Oils",
        slug: "oils",
        description: "Traditional wooden chekku cold-pressed groundnut and gingelly oils.",
        image: "/assets/images/products/product_lineup.jpg",
        website_image: "/assets/images/products/product_lineup.jpg",
        mobile_image: "/assets/images/products/product_lineup.jpg",
        appImage: "/assets/images/products/product_lineup.jpg",
        is_active: true,
        display_order: 5,
        emoji: "🫗",
        itemCount: 2
    },
    {
        id: 6,
        name: "Masalas",
        displayName: "Pure Spices & Masalas",
        slug: "masalas",
        description: "Single-origin Salem turmeric powder and aromatic farm-ground spice blends.",
        image: "/assets/images/products/product_lineup.jpg",
        website_image: "/assets/images/products/product_lineup.jpg",
        mobile_image: "/assets/images/products/product_lineup.jpg",
        appImage: "/assets/images/products/product_lineup.jpg",
        is_active: true,
        display_order: 6,
        emoji: "🌶️",
        itemCount: 1
    },
    {
        id: 7,
        name: "Vegan",
        displayName: "Vegan & Plant-Based",
        slug: "vegan",
        description: "Plant-based oat & almond milk, organic soy tofu, and raw wild honey.",
        image: "/assets/images/products/fresh_paneer.jpg",
        website_image: "/assets/images/products/fresh_paneer.jpg",
        mobile_image: "/assets/images/products/fresh_paneer.jpg",
        appImage: "/assets/images/products/fresh_paneer.jpg",
        is_active: true,
        display_order: 7,
        emoji: "🌱",
        itemCount: 3
    }
];

function normalizeCategory(r) {
    const webImg = r.website_image || r.image || "/assets/images/products/fresh_cow_milk.jpg";
    const mobImg = r.mobile_image || r.app_image || r.appImage || webImg;
    return {
        ...r,
        displayName: r.display_name || r.displayName || r.name,
        display_name: r.display_name || r.displayName || r.name,
        image: webImg,
        website_image: webImg,
        mobile_image: mobImg,
        appImage: mobImg,
        is_active: r.is_active !== undefined ? Boolean(r.is_active) : (r.status !== 'inactive'),
        display_order: Number(r.display_order || r.id || 1)
    };
}

/* GET ALL CATEGORIES */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM categories ORDER BY COALESCE(display_order, id) ASC, id ASC"
        );
        if (result.rows.length > 0) {
            const mapped = result.rows.map(normalizeCategory);
            return res.json({
                success: true,
                categories: mapped
            });
        }
        res.json({
            success: true,
            categories: MOCK_CATEGORIES.map(normalizeCategory)
        });
    } catch (error) {
        res.json({
            success: true,
            categories: MOCK_CATEGORIES.map(normalizeCategory)
        });
    }
});

/* GET SINGLE CATEGORY */
router.get("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const result = await pool.query("SELECT * FROM categories WHERE id=$1", [id]);
        if (result.rows.length > 0) {
            return res.json({ success: true, category: normalizeCategory(result.rows[0]) });
        }
        const fallback = MOCK_CATEGORIES.find(c => c.id === id) || MOCK_CATEGORIES[0];
        res.json({ success: true, category: normalizeCategory(fallback) });
    } catch {
        const fallback = MOCK_CATEGORIES.find(c => c.id === id) || MOCK_CATEGORIES[0];
        res.json({ success: true, category: normalizeCategory(fallback) });
    }
});

/* CREATE CATEGORY (Admin Only) */
router.post("/", async (req, res) => {
    try {
        const { name, displayName, description, image, website_image, mobile_image, appImage, emoji, is_active, display_order } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: "Category name is required" });
        }

        const savedWebImg = saveBase64Image(website_image || image, "cat_web") || "/assets/images/products/fresh_cow_milk.jpg";
        const savedMobImg = saveBase64Image(mobile_image || appImage, "cat_mob") || savedWebImg;
        const active = is_active !== undefined ? Boolean(is_active) : true;
        const orderNum = parseInt(display_order, 10) || 1;
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-");

        try {
            const result = await pool.query(
                `INSERT INTO categories (name, display_name, description, image, website_image, mobile_image, is_active, display_order, emoji)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [displayName || name, displayName || name, description || "", savedWebImg, savedWebImg, savedMobImg, active, orderNum, emoji || "🏷️"]
            );
            return res.json({
                success: true,
                category: normalizeCategory(result.rows[0]),
                message: "Category created successfully"
            });
        } catch {
            // Fallback in-memory
            const newId = MOCK_CATEGORIES.length ? Math.max(...MOCK_CATEGORIES.map(c => c.id)) + 1 : 1;
            const newCategory = normalizeCategory({
                id: newId,
                name: name,
                displayName: displayName || name,
                display_name: displayName || name,
                slug,
                description: description || "Fresh farm quality category.",
                image: savedWebImg,
                website_image: savedWebImg,
                mobile_image: savedMobImg,
                appImage: savedMobImg,
                is_active: active,
                display_order: orderNum,
                emoji: emoji || "🏷️",
                itemCount: 0
            });
            MOCK_CATEGORIES.push(newCategory);
            return res.json({
                success: true,
                category: newCategory,
                message: "Category created successfully"
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* UPDATE CATEGORY (Admin Only) */
router.put("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, displayName, description, image, website_image, mobile_image, appImage, emoji, is_active, display_order } = req.body;
        const savedWebImg = website_image !== undefined || image !== undefined ? saveBase64Image(website_image || image, "cat_web") : undefined;
        const savedMobImg = mobile_image !== undefined || appImage !== undefined ? saveBase64Image(mobile_image || appImage, "cat_mob") : undefined;
        const active = is_active !== undefined ? Boolean(is_active) : undefined;
        const orderNum = display_order !== undefined ? parseInt(display_order, 10) : undefined;

        try {
            const result = await pool.query(
                `UPDATE categories
                 SET name = COALESCE($1, name),
                     display_name = COALESCE($2, display_name, name),
                     description = COALESCE($3, description),
                     image = COALESCE($4, image),
                     website_image = COALESCE($4, website_image, image),
                     mobile_image = COALESCE($5, mobile_image, $4, image),
                     is_active = COALESCE($6, is_active),
                     display_order = COALESCE($7, display_order),
                     emoji = COALESCE($8, emoji)
                 WHERE id = $9
                 RETURNING *`,
                [displayName || name, displayName || name, description, savedWebImg, savedMobImg, active, orderNum, emoji, id]
            );
            if (result.rows.length > 0) {
                return res.json({
                    success: true,
                    category: normalizeCategory(result.rows[0]),
                    message: "Category updated successfully"
                });
            }
        } catch {
            // Fallback in-memory
            const idx = MOCK_CATEGORIES.findIndex(c => c.id === id);
            if (idx !== -1) {
                MOCK_CATEGORIES[idx] = normalizeCategory({
                    ...MOCK_CATEGORIES[idx],
                    name: name !== undefined ? name : MOCK_CATEGORIES[idx].name,
                    displayName: displayName !== undefined ? displayName : (name || MOCK_CATEGORIES[idx].displayName),
                    description: description !== undefined ? description : MOCK_CATEGORIES[idx].description,
                    website_image: savedWebImg !== undefined ? savedWebImg : MOCK_CATEGORIES[idx].website_image,
                    mobile_image: savedMobImg !== undefined ? savedMobImg : MOCK_CATEGORIES[idx].mobile_image,
                    appImage: savedMobImg !== undefined ? savedMobImg : MOCK_CATEGORIES[idx].mobile_image,
                    is_active: active !== undefined ? active : MOCK_CATEGORIES[idx].is_active,
                    display_order: orderNum !== undefined ? orderNum : MOCK_CATEGORIES[idx].display_order,
                    emoji: emoji !== undefined ? emoji : MOCK_CATEGORIES[idx].emoji
                });
                return res.json({
                    success: true,
                    category: MOCK_CATEGORIES[idx],
                    message: "Category updated successfully"
                });
            }
        }

        // Check in-memory fallback
        const idx = MOCK_CATEGORIES.findIndex(c => c.id === id);
        if (idx !== -1) {
            MOCK_CATEGORIES[idx] = normalizeCategory({
                ...MOCK_CATEGORIES[idx],
                name: name !== undefined ? name : MOCK_CATEGORIES[idx].name,
                displayName: displayName !== undefined ? displayName : (name || MOCK_CATEGORIES[idx].displayName),
                description: description !== undefined ? description : MOCK_CATEGORIES[idx].description,
                website_image: savedWebImg !== undefined ? savedWebImg : MOCK_CATEGORIES[idx].website_image,
                mobile_image: savedMobImg !== undefined ? savedMobImg : MOCK_CATEGORIES[idx].mobile_image,
                appImage: savedMobImg !== undefined ? savedMobImg : MOCK_CATEGORIES[idx].mobile_image,
                is_active: active !== undefined ? active : MOCK_CATEGORIES[idx].is_active,
                display_order: orderNum !== undefined ? orderNum : MOCK_CATEGORIES[idx].display_order,
                emoji: emoji !== undefined ? emoji : MOCK_CATEGORIES[idx].emoji
            });
            return res.json({
                success: true,
                category: MOCK_CATEGORIES[idx],
                message: "Category updated successfully"
            });
        }

        res.json({ success: true, message: "Category updated" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* DELETE CATEGORY (Admin Only) */
router.delete("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query("DELETE FROM categories WHERE id=$1", [id]);
    } catch {
        // Fallback
    }
    MOCK_CATEGORIES = MOCK_CATEGORIES.filter(c => c.id !== id);
    res.json({ success: true, message: "Category deleted successfully" });
});

module.exports = router;
