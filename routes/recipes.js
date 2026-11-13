const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const router = express.Router();
const DATA_FILE = path.resolve(__dirname, "..", "data", "recipes.json");

function loadRecipesFromDisk() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, "utf-8");
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn("[RECIPES DISK LOAD WARN]:", e.message);
    }
    return [];
}

function saveRecipesToDisk(recipes) {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(recipes, null, 2), "utf-8");
    } catch (e) {
        console.warn("[RECIPES DISK SAVE WARN]:", e.message);
    }
}

let MEMORY_RECIPES = loadRecipesFromDisk();

/**
 * GET /api/recipes
 * Public list of published farm recipes
 */
router.get("/", async (req, res) => {
    try {
        const category = req.query.category;
        let recipes = loadRecipesFromDisk();
        
        // Filter published for public view
        recipes = recipes.filter(r => r.status === "published" || !r.status);
        if (category) {
            recipes = recipes.filter(r => (r.category || "").toLowerCase() === category.toLowerCase());
        }

        return res.json({
            success: true,
            total: recipes.length,
            recipes
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/recipes/admin/all
 * Admin list with all statuses (published + draft)
 */
router.get("/admin/all", async (req, res) => {
    try {
        const recipes = loadRecipesFromDisk();
        return res.json({
            success: true,
            total: recipes.length,
            recipes
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/recipes/:id
 */
router.get("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const recipes = loadRecipesFromDisk();
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) {
        return res.status(404).json({ success: false, message: "Recipe not found." });
    }
    return res.json({ success: true, recipe });
});

/**
 * POST /api/recipes
 * Create a new farm recipe
 */
router.post("/", async (req, res) => {
    try {
        const {
            title,
            category,
            category_name,
            preparation_time,
            difficulty,
            servings,
            ingredients,
            instructions,
            description,
            image_url,
            status
        } = req.body;

        if (!title || !ingredients) {
            return res.status(400).json({ success: false, message: "Title and ingredients are required." });
        }

        const recipes = loadRecipesFromDisk();
        const nextId = recipes.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
        const nowIso = new Date().toISOString();

        const newRecipe = {
            id: nextId,
            title: title.trim(),
            category: (category || "curry").toLowerCase(),
            category_name: category_name || "Curries & Mains",
            preparation_time: preparation_time || "25 Mins",
            difficulty: difficulty || "Easy",
            servings: servings || "4 Servings",
            ingredients: ingredients.trim(),
            instructions: instructions ? instructions.trim() : "",
            description: description ? description.trim() : "",
            image_url: image_url || "/assets/images/products/fresh_cow_milk.jpg",
            status: status || "published",
            created_at: nowIso,
            updated_at: nowIso
        };

        recipes.unshift(newRecipe);
        saveRecipesToDisk(recipes);

        return res.status(201).json({ success: true, message: "Recipe published successfully.", recipe: newRecipe });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PUT /api/recipes/:id
 * Update recipe
 */
router.put("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const recipes = loadRecipesFromDisk();
        const idx = recipes.findIndex(r => r.id === id);
        if (idx === -1) {
            return res.status(404).json({ success: false, message: "Recipe not found." });
        }

        const existing = recipes[idx];
        const fields = [
            "title", "category", "category_name", "preparation_time", "difficulty",
            "servings", "ingredients", "instructions", "description", "image_url", "status"
        ];

        fields.forEach(f => {
            if (req.body[f] !== undefined) existing[f] = req.body[f];
        });
        existing.updated_at = new Date().toISOString();

        recipes[idx] = existing;
        saveRecipesToDisk(recipes);

        return res.json({ success: true, message: "Recipe updated successfully.", recipe: existing });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/recipes/:id/toggle
 * Toggle publish / draft status
 */
router.patch("/:id/toggle", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const recipes = loadRecipesFromDisk();
        const idx = recipes.findIndex(r => r.id === id);
        if (idx === -1) {
            return res.status(404).json({ success: false, message: "Recipe not found." });
        }

        const nextStatus = recipes[idx].status === "published" ? "draft" : "published";
        recipes[idx].status = nextStatus;
        recipes[idx].updated_at = new Date().toISOString();
        saveRecipesToDisk(recipes);

        return res.json({ success: true, recipe: recipes[idx] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * DELETE /api/recipes/:id
 */
router.delete("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        let recipes = loadRecipesFromDisk();
        const initialCount = recipes.length;
        recipes = recipes.filter(r => r.id !== id);
        if (recipes.length === initialCount) {
            return res.status(404).json({ success: false, message: "Recipe not found." });
        }
        saveRecipesToDisk(recipes);

        return res.json({ success: true, message: "Recipe deleted successfully." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

