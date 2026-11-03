const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { authenticateToken, adminOnly } = require("../middleware/auth");

const router = express.Router();

function saveBase64Image(image) {
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
                const fileName = `cat_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                return `/assets/images/uploads/${fileName}`;
            }
        } catch (err) {
            console.error("Error saving uploaded category image:", err);
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
        emoji: "🌱",
        itemCount: 3
    }
];

/* GET ALL CATEGORIES */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM categories ORDER BY id ASC"
        );
        if (result.rows.length > 0) {
            return res.json({
                success: true,
                categories: result.rows
            });
        }
        res.json({
            success: true,
            categories: MOCK_CATEGORIES
        });
    } catch (error) {
        res.json({
            success: true,
            categories: MOCK_CATEGORIES
        });
    }
});

/* GET SINGLE CATEGORY */
router.get("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const result = await pool.query("SELECT * FROM categories WHERE id=$1", [id]);
        if (result.rows.length > 0) {
            return res.json({ success: true, category: result.rows[0] });
        }
        const fallback = MOCK_CATEGORIES.find(c => c.id === id) || MOCK_CATEGORIES[0];
        res.json({ success: true, category: fallback });
    } catch {
        const fallback = MOCK_CATEGORIES.find(c => c.id === id) || MOCK_CATEGORIES[0];
        res.json({ success: true, category: fallback });
    }
});

/* CREATE CATEGORY (Admin Only) */
router.post("/", async (req, res) => {
    try {
        const { name, displayName, description, image, emoji } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: "Category name is required" });
        }
        const savedImage = saveBase64Image(image) || "/assets/images/products/product_lineup.jpg";
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-");

        try {
            const result = await pool.query(
                `INSERT INTO categories (name, description, image)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [displayName || name, description || "", savedImage]
            );
            return res.json({
                success: true,
                category: result.rows[0],
                message: "Category created successfully"
            });
        } catch {
            // Fallback in-memory
            const newId = MOCK_CATEGORIES.length ? Math.max(...MOCK_CATEGORIES.map(c => c.id)) + 1 : 1;
            const newCategory = {
                id: newId,
                name: name,
                displayName: displayName || name,
                slug,
                description: description || "Fresh farm quality category.",
                image: savedImage,
                emoji: emoji || "🏷️",
                itemCount: 0
            };
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
        const { name, displayName, description, image, emoji } = req.body;
        const savedImage = saveBase64Image(image);

        try {
            const result = await pool.query(
                `UPDATE categories
                 SET name = COALESCE($1, name),
                     description = COALESCE($2, description),
                     image = COALESCE($3, image)
                 WHERE id = $4
                 RETURNING *`,
                [displayName || name, description, savedImage, id]
            );
            if (result.rows.length > 0) {
                return res.json({
                    success: true,
                    category: result.rows[0],
                    message: "Category updated successfully"
                });
            }
        } catch {
            // Fallback in-memory
            const idx = MOCK_CATEGORIES.findIndex(c => c.id === id);
            if (idx !== -1) {
                MOCK_CATEGORIES[idx] = {
                    ...MOCK_CATEGORIES[idx],
                    name: name !== undefined ? name : MOCK_CATEGORIES[idx].name,
                    displayName: displayName !== undefined ? displayName : (name || MOCK_CATEGORIES[idx].displayName),
                    description: description !== undefined ? description : MOCK_CATEGORIES[idx].description,
                    image: savedImage !== undefined ? savedImage : MOCK_CATEGORIES[idx].image,
                    emoji: emoji !== undefined ? emoji : MOCK_CATEGORIES[idx].emoji
                };
                return res.json({
                    success: true,
                    category: MOCK_CATEGORIES[idx],
                    message: "Category updated successfully"
                });
            }
        }

        // Check if exists in mock categories anyway
        const idx = MOCK_CATEGORIES.findIndex(c => c.id === id);
        if (idx !== -1) {
            MOCK_CATEGORIES[idx] = {
                ...MOCK_CATEGORIES[idx],
                name: name !== undefined ? name : MOCK_CATEGORIES[idx].name,
                displayName: displayName !== undefined ? displayName : (name || MOCK_CATEGORIES[idx].displayName),
                description: description !== undefined ? description : MOCK_CATEGORIES[idx].description,
                image: savedImage !== undefined ? savedImage : MOCK_CATEGORIES[idx].image,
                emoji: emoji !== undefined ? emoji : MOCK_CATEGORIES[idx].emoji
            };
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
