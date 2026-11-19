const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const { uploadProductImage } = require("../middleware/uploadMiddleware");

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
                const fileName = `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
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

let IN_MEMORY_VARIANTS = {};

function generateDefaultVariants(product) {
    const nameLower = (product.name || "").toLowerCase();
    const basePrice = Number(product.price) || 50;

    if (nameLower.includes("almond")) {
        return [
            { id: 101, product_id: product.id, name: "100g", weight_value: "100", unit: "g", price: 120, compare_price: 140, stock: 50, is_default: true, is_active: true },
            { id: 102, product_id: product.id, name: "250g", weight_value: "250", unit: "g", price: 280, compare_price: 320, stock: 40, is_default: false, is_active: true },
            { id: 103, product_id: product.id, name: "500g", weight_value: "500", unit: "g", price: 520, compare_price: 600, stock: 35, is_default: false, is_active: true },
            { id: 104, product_id: product.id, name: "1kg", weight_value: "1", unit: "kg", price: 990, compare_price: 1150, stock: 20, is_default: false, is_active: true }
        ];
    }
    if (nameLower.includes("cashew")) {
        return [
            { id: 201, product_id: product.id, name: "200g", weight_value: "200", unit: "g", price: 180, compare_price: 210, stock: 45, is_default: true, is_active: true },
            { id: 202, product_id: product.id, name: "500g", weight_value: "500", unit: "g", price: 420, compare_price: 480, stock: 30, is_default: false, is_active: true },
            { id: 203, product_id: product.id, name: "1kg", weight_value: "1", unit: "kg", price: 800, compare_price: 920, stock: 25, is_default: false, is_active: true }
        ];
    }
    if (nameLower.includes("honey")) {
        return [
            { id: 301, product_id: product.id, name: "250ml", weight_value: "250", unit: "ml", price: 150, compare_price: 180, stock: 30, is_default: false, is_active: true },
            { id: 302, product_id: product.id, name: "500ml", weight_value: "500", unit: "ml", price: 280, compare_price: 320, stock: 25, is_default: true, is_active: true },
            { id: 303, product_id: product.id, name: "1 Litre", weight_value: "1", unit: "litre", price: 520, compare_price: 600, stock: 15, is_default: false, is_active: true }
        ];
    }
    if (nameLower.includes("date")) {
        return [
            { id: 401, product_id: product.id, name: "100g", weight_value: "100", unit: "g", price: 90, compare_price: 110, stock: 40, is_default: false, is_active: true },
            { id: 402, product_id: product.id, name: "200g", weight_value: "200", unit: "g", price: 170, compare_price: 200, stock: 35, is_default: true, is_active: true },
            { id: 403, product_id: product.id, name: "400g", weight_value: "400", unit: "g", price: 320, compare_price: 370, stock: 25, is_default: false, is_active: true }
        ];
    }
    if (nameLower.includes("milk")) {
        return [
            { id: 501, product_id: product.id, name: "500 ml", weight_value: "500", unit: "ml", price: basePrice <= 50 ? basePrice : 44, compare_price: 50, stock: 120, is_default: true, is_active: true },
            { id: 502, product_id: product.id, name: "1 Litre", weight_value: "1", unit: "litre", price: basePrice <= 50 ? basePrice * 1.85 : basePrice, compare_price: 90, stock: 150, is_default: false, is_active: true }
        ];
    }
    if (nameLower.includes("ghee")) {
        return [
            { id: 601, product_id: product.id, name: "250 ml", weight_value: "250", unit: "ml", price: 280, compare_price: 320, stock: 40, is_default: false, is_active: true },
            { id: 602, product_id: product.id, name: "500 ml", weight_value: "500", unit: "ml", price: basePrice, compare_price: 600, stock: 45, is_default: true, is_active: true },
            { id: 603, product_id: product.id, name: "1 Litre", weight_value: "1", unit: "litre", price: 990, compare_price: 1150, stock: 20, is_default: false, is_active: true }
        ];
    }
    if (nameLower.includes("paneer") || nameLower.includes("tofu")) {
        return [
            { id: 701, product_id: product.id, name: "200 g", weight_value: "200", unit: "g", price: basePrice, compare_price: 95, stock: 60, is_default: true, is_active: true },
            { id: 702, product_id: product.id, name: "500 g", weight_value: "500", unit: "g", price: Math.round(basePrice * 2.3), compare_price: 230, stock: 40, is_default: false, is_active: true },
            { id: 703, product_id: product.id, name: "1 kg", weight_value: "1", unit: "kg", price: Math.round(basePrice * 4.4), compare_price: 440, stock: 20, is_default: false, is_active: true }
        ];
    }
    if (nameLower.includes("oil")) {
        return [
            { id: 801, product_id: product.id, name: "500 ml", weight_value: "500", unit: "ml", price: Math.round(basePrice * 0.55), compare_price: 180, stock: 35, is_default: false, is_active: true },
            { id: 802, product_id: product.id, name: "1 Litre", weight_value: "1", unit: "litre", price: basePrice, compare_price: 340, stock: 40, is_default: true, is_active: true }
        ];
    }

    // Default single or double variant
    const currentWeight = product.weight || "1 Unit";
    return [
        { id: product.id * 100 + 1, product_id: product.id, name: currentWeight, weight_value: currentWeight, unit: "unit", price: basePrice, compare_price: product.compare_price, stock: product.stock || 50, is_default: true, is_active: true }
    ];
}

async function attachVariantsToProducts(products) {
    for (const p of products) {
        try {
            const res = await pool.query(
                "SELECT * FROM product_variants WHERE product_id = $1 AND is_active = true ORDER BY price ASC",
                [p.id]
            );
            if (res.rows.length > 0) {
                p.variants = res.rows;
            } else if (IN_MEMORY_VARIANTS[p.id] && IN_MEMORY_VARIANTS[p.id].length > 0) {
                p.variants = IN_MEMORY_VARIANTS[p.id].filter(v => v.is_active);
            } else {
                p.variants = generateDefaultVariants(p);
            }
        } catch {
            p.variants = IN_MEMORY_VARIANTS[p.id] || generateDefaultVariants(p);
        }
    }
    return products;
}

const PRODUCTS_JSON_PATH = path.resolve(__dirname, "..", "data", "products.json");
const PRODUCT_CONTENT_PATH = path.resolve(__dirname, "..", "data", "product_content.json");

function loadLocalProducts() {
    try {
        if (fs.existsSync(PRODUCTS_JSON_PATH)) {
            const raw = fs.readFileSync(PRODUCTS_JSON_PATH, "utf-8");
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error("Error reading local products:", e.message);
    }
    return [];
}

function saveLocalProducts(products) {
    try {
        const dir = path.dirname(PRODUCTS_JSON_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PRODUCTS_JSON_PATH, JSON.stringify(products, null, 2), "utf-8");
    } catch (e) {
        console.error("Error writing local products:", e.message);
    }
}

function loadProductContent() {
    try {
        if (fs.existsSync(PRODUCT_CONTENT_PATH)) {
            return JSON.parse(fs.readFileSync(PRODUCT_CONTENT_PATH, "utf-8"));
        }
    } catch (e) {
        console.error("Error reading product content:", e.message);
    }
    return {};
}

function saveProductContent(contentMap) {
    try {
        const dir = path.dirname(PRODUCT_CONTENT_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PRODUCT_CONTENT_PATH, JSON.stringify(contentMap, null, 2), "utf-8");
    } catch (e) {
        console.error("Error writing product content:", e.message);
    }
}

function attachContentToProducts(products) {
    const allContent = loadProductContent();
    for (const p of products) {
        const c = allContent[p.id.toString()] || allContent[p.id] || null;

        // Parse JSON fields if they come from DB as strings
        const parseJsonField = (val, fallback = []) => {
            if (!val) return fallback;
            if (Array.isArray(val) || (typeof val === 'object' && val !== null)) return val;
            try { return JSON.parse(val); } catch { return fallback; }
        };

        p.short_description = p.short_description || (c && c.short_description) || "";
        p.feature_badges = parseJsonField(p.feature_badges, (c && c.feature_badges) || []);
        p.highlights = parseJsonField(p.highlights, (c && c.highlights) || []);
        p.ingredients = parseJsonField(p.ingredients, (c && c.ingredients) || []);
        p.nutritional_info = parseJsonField(p.nutritional_info, (c && c.nutritional_info) || null);
        p.storage_instructions = p.storage_instructions || (c && c.storage_instructions) || "";
        p.usage_instructions = p.usage_instructions || (c && c.usage_instructions) || "";
        p.refund_policy = parseJsonField(p.refund_policy, (c && c.refund_policy) || null);
        p.shelf_life = p.shelf_life || (c && c.shelf_life) || "";
        p.certification = p.certification || (c && c.certification) || "";
        p.seo_title = p.seo_title || (c && c.seo_title) || "";
        p.seo_description = p.seo_description || (c && c.seo_description) || "";

        p.content = {
            product_id: p.id,
            short_description: p.short_description,
            feature_badges: p.feature_badges,
            highlights: p.highlights,
            ingredients: p.ingredients,
            nutritional_info: p.nutritional_info,
            storage_instructions: p.storage_instructions,
            usage_instructions: p.usage_instructions,
            refund_policy: p.refund_policy,
            shelf_life: p.shelf_life,
            certification: p.certification,
            seo_title: p.seo_title,
            seo_description: p.seo_description
        };
    }
    return products;
}

/* GET ALL PRODUCTS WITH DYNAMIC VARIANTS & RICH CONTENT */
router.get("/", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    try {
        let list = [];
        try {
            const result = await pool.query(`
                SELECT p.*, c.name AS category_name
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.status='active'
                ORDER BY p.id DESC
            `);
            list = result.rows || [];
        } catch (_) { }

        if (!list.length) {
            list = loadLocalProducts().filter(p => p.status !== "inactive");
        }

        const productsWithVariants = await attachVariantsToProducts(list);
        const enriched = attachContentToProducts(productsWithVariants);
        return res.json({ success: true, products: enriched });
    } catch (err) {
        const fallback = loadLocalProducts().filter(p => p.status !== "inactive");
        const enriched = attachContentToProducts(fallback);
        return res.json({ success: true, products: enriched });
    }
});

/* GET SINGLE PRODUCT WITH VARIANTS & RICH CONTENT */
router.get("/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    try {
        let product = null;
        try {
            const result = await pool.query(`
                SELECT p.*, c.name AS category_name
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.id = $1
            `, [id]);
            if (result.rows.length > 0) {
                product = result.rows[0];
            }
        } catch (_) { }

        if (!product) {
            const all = loadLocalProducts();
            product = all.find(p => p.id === id);
        }

        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }
        const withVariants = await attachVariantsToProducts([product]);
        const enriched = attachContentToProducts(withVariants);
        res.json({ success: true, product: enriched[0] });
    } catch (err) {
        const all = loadLocalProducts();
        const p = all.find(x => x.id === id);
        if (p) {
            const enriched = attachContentToProducts([p]);
            return res.json({ success: true, product: enriched[0] });
        }
        res.status(500).json({ success: false, message: "Failed to fetch product" });
    }
});

/* ADMIN GET ALL PRODUCTS */
router.get("/admin/all", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    try {
        let list = [];
        try {
            const result = await pool.query(`
                SELECT p.*, c.name AS category_name
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                ORDER BY p.id DESC
            `);
            list = result.rows || [];
        } catch (_) { }

        if (!list.length) {
            list = loadLocalProducts();
        }

        const withVariants = await attachVariantsToProducts(list);
        const enriched = attachContentToProducts(withVariants);
        res.json({ success: true, products: enriched });
    } catch (err) {
        const fallback = loadLocalProducts();
        const enriched = attachContentToProducts(fallback);
        res.json({ success: true, products: enriched });
    }
});

/* ============================================================
   PRODUCT IMAGE UPLOAD (ADMIN)
============================================================ */
router.post(["/upload", "/upload-image"], authenticateToken, adminOnly, uploadProductImage, (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image file provided. Please choose a JPG, PNG, or WEBP file (Max 5MB)."
            });
        }
        const relativeUrl = `/uploads/products/${req.file.filename}`;
        return res.json({
            success: true,
            message: "Product image uploaded successfully",
            image_url: relativeUrl,
            url: relativeUrl,
            filename: req.file.filename,
            size: req.file.size,
            mimetype: req.file.mimetype
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   PRODUCT CONTENT & PRODUCT-SPECIFIC REFUND POLICIES (MODULE 5)
============================================================ */

/* GET PRODUCT CONTENT */
router.get("/:id/content", (req, res) => {
    const id = parseInt(req.params.id);
    const allContent = loadProductContent();
    const content = allContent[id.toString()] || allContent[id];
    if (!content) {
        return res.status(404).json({ success: false, message: "Product content not found" });
    }
    return res.json({ success: true, content });
});

/* UPDATE PRODUCT CONTENT (Admin) */
router.put("/:id/content", authenticateToken, adminOnly, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const allContent = loadProductContent();
        const existing = allContent[id.toString()] || { product_id: id };
        const updated = {
            ...existing,
            ...req.body,
            product_id: id
        };
        allContent[id.toString()] = updated;
        saveProductContent(allContent);
        return res.json({ success: true, content: updated, message: "Product content updated successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   PRODUCT VARIANTS CRUD (ADMIN)
============================================================ */
router.get("/:id/variants", async (req, res) => {
    const productId = parseInt(req.params.id);
    try {
        const result = await pool.query(
            "SELECT * FROM product_variants WHERE product_id = $1 ORDER BY price ASC",
            [productId]
        );
        if (result.rows.length > 0) {
            return res.json({ success: true, variants: result.rows });
        }
    } catch { }

    const prod = MOCK_PRODUCTS.find(p => p.id === productId);
    const variants = IN_MEMORY_VARIANTS[productId] || (prod ? generateDefaultVariants(prod) : []);
    res.json({ success: true, variants });
});

router.post("/:id/variants", authenticateToken, adminOnly, async (req, res) => {
    const productId = parseInt(req.params.id);
    const { name, weight_value, unit, price, compare_price, stock, is_default, is_active } = req.body;

    if (!name || price === undefined) {
        return res.status(400).json({ success: false, message: "Variant name and price are required" });
    }

    try {
        const result = await pool.query(`
            INSERT INTO product_variants (product_id, name, weight_value, unit, price, compare_price, stock, is_default, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [productId, name, weight_value || name, unit || 'g', Number(price), compare_price ? Number(compare_price) : null, stock ? Number(stock) : 50, Boolean(is_default), is_active !== false]);
        return res.json({ success: true, variant: result.rows[0] });
    } catch {
        const newId = Date.now();
        const newVariant = {
            id: newId,
            product_id: productId,
            name,
            weight_value: weight_value || name,
            unit: unit || 'g',
            price: Number(price),
            compare_price: compare_price ? Number(compare_price) : null,
            stock: stock ? Number(stock) : 50,
            is_default: Boolean(is_default),
            is_active: is_active !== false
        };
        if (!IN_MEMORY_VARIANTS[productId]) IN_MEMORY_VARIANTS[productId] = [];
        IN_MEMORY_VARIANTS[productId].push(newVariant);
        return res.json({ success: true, variant: newVariant });
    }
});

router.put("/variants/:variantId", authenticateToken, adminOnly, async (req, res) => {
    const variantId = parseInt(req.params.variantId);
    const { name, weight_value, unit, price, compare_price, stock, is_default, is_active } = req.body;

    try {
        const result = await pool.query(`
            UPDATE product_variants SET
                name = COALESCE($1, name),
                weight_value = COALESCE($2, weight_value),
                unit = COALESCE($3, unit),
                price = COALESCE($4, price),
                compare_price = COALESCE($5, compare_price),
                stock = COALESCE($6, stock),
                is_default = COALESCE($7, is_default),
                is_active = COALESCE($8, is_active),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
            RETURNING *
        `, [name, weight_value, unit, price !== undefined ? Number(price) : null, compare_price !== undefined ? Number(compare_price) : null, stock !== undefined ? Number(stock) : null, is_default, is_active, variantId]);
        if (result.rows.length) return res.json({ success: true, variant: result.rows[0] });
    } catch { }

    for (const pid in IN_MEMORY_VARIANTS) {
        const idx = IN_MEMORY_VARIANTS[pid].findIndex(v => v.id === variantId);
        if (idx !== -1) {
            IN_MEMORY_VARIANTS[pid][idx] = { ...IN_MEMORY_VARIANTS[pid][idx], ...req.body };
            return res.json({ success: true, variant: IN_MEMORY_VARIANTS[pid][idx] });
        }
    }

    res.json({ success: true, message: "Variant updated" });
});

router.delete("/variants/:variantId", authenticateToken, adminOnly, async (req, res) => {
    const variantId = parseInt(req.params.variantId);
    try {
        await pool.query("DELETE FROM product_variants WHERE id = $1", [variantId]);
    } catch { }

    for (const pid in IN_MEMORY_VARIANTS) {
        IN_MEMORY_VARIANTS[pid] = IN_MEMORY_VARIANTS[pid].filter(v => v.id !== variantId);
    }

    res.json({ success: true, message: "Variant deleted" });
});

/* CREATE PRODUCT */
router.post("/", authenticateToken, adminOnly, async (req, res) => {
    try {
        const {
            name, description, short_description, category, category_id,
            price, compare_price, sku, stock, weight, image, badge, status,
            feature_badges, highlights, ingredients, storage_instructions, usage_instructions,
            seo_title, seo_description
        } = req.body;
        const savedImage = saveBase64Image(image);
        let newProd = null;

        const featureBadgesJson = JSON.stringify(Array.isArray(feature_badges) ? feature_badges : []);
        const highlightsJson = JSON.stringify(Array.isArray(highlights) ? highlights : []);
        const ingredientsJson = JSON.stringify(Array.isArray(ingredients) ? ingredients : []);

        try {
            const result = await pool.query(`
                INSERT INTO products (
                    name, description, short_description, category_id, price, compare_price,
                    sku, stock, weight, image, badge, status,
                    feature_badges, highlights, ingredients, storage_instructions, usage_instructions,
                    seo_title, seo_description
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
                RETURNING *
            `, [
                name || "Product",
                description || "",
                short_description || "",
                category_id || null,
                Number(price) || 0,
                compare_price ? Number(compare_price) : null,
                sku || null,
                stock !== undefined ? Number(stock) : 0,
                weight || null,
                savedImage || null,
                badge || null,
                status || "active",
                featureBadgesJson,
                highlightsJson,
                ingredientsJson,
                storage_instructions || "",
                usage_instructions || "",
                seo_title || null,
                seo_description || null
            ]);
            newProd = result.rows[0];
        } catch (dbErr) {
            console.warn("[CREATE PRODUCT DB WARN]:", dbErr.message);
        }

        const localList = loadLocalProducts();
        const nextId = newProd?.id || (localList.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1);
        if (!newProd) {
            newProd = {
                id: nextId,
                name: name || "Product",
                description: description || "",
                short_description: short_description || "",
                category: category || "General",
                category_name: category || "General",
                category_id: category_id || 1,
                price: Number(price) || 0,
                compare_price: compare_price ? Number(compare_price) : null,
                weight: weight || "1 Unit",
                stock: stock !== undefined ? Number(stock) : 50,
                image: savedImage || "/assets/images/products/fresh_cow_milk.jpg",
                badge: badge || null,
                status: status || "active",
                feature_badges: Array.isArray(feature_badges) ? feature_badges : [],
                highlights: Array.isArray(highlights) ? highlights : [],
                ingredients: Array.isArray(ingredients) ? ingredients : [],
                storage_instructions: storage_instructions || "",
                usage_instructions: usage_instructions || "",
                seo_title: seo_title || "",
                seo_description: seo_description || ""
            };
        }

        // Keep local products and content in sync
        localList.unshift(newProd);
        saveLocalProducts(localList);

        const allContent = loadProductContent();
        allContent[newProd.id.toString()] = {
            product_id: newProd.id,
            short_description: short_description || newProd.short_description || "",
            feature_badges: Array.isArray(feature_badges) ? feature_badges : (newProd.feature_badges || []),
            highlights: Array.isArray(highlights) ? highlights : (newProd.highlights || []),
            ingredients: Array.isArray(ingredients) ? ingredients : (newProd.ingredients || []),
            storage_instructions: storage_instructions || newProd.storage_instructions || "",
            usage_instructions: usage_instructions || newProd.usage_instructions || "",
            seo_title: seo_title || newProd.seo_title || "",
            seo_description: seo_description || newProd.seo_description || ""
        };
        saveProductContent(allContent);

        // Synchronize updated image with linked subscription plans
        const finalImage = savedImage || (req.body.image && typeof req.body.image === 'string' && req.body.image.trim() ? req.body.image.trim() : (updatedProd ? updatedProd.image : null));
        if (finalImage) {
            try {
                await pool.query(
                    "UPDATE subscription_plans SET product_image = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2",
                    [finalImage, id]
                );
            } catch (_) {}
        }

        const enriched = attachContentToProducts([newProd]);
        return res.json({ success: true, product: enriched[0] });
    } catch (error) {
        console.error("Create product error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/* UPDATE PRODUCT */
router.put("/:id", authenticateToken, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const {
            name, description, short_description, category, category_id,
            price, compare_price, sku, stock, weight, image, status, badge,
            feature_badges, highlights, ingredients, storage_instructions, usage_instructions,
            seo_title, seo_description
        } = req.body;
        const savedImage = saveBase64Image(image);
        let updatedProd = null;

        const featureBadgesJson = feature_badges !== undefined ? JSON.stringify(feature_badges) : null;
        const highlightsJson = highlights !== undefined ? JSON.stringify(highlights) : null;
        const ingredientsJson = ingredients !== undefined ? JSON.stringify(ingredients) : null;

        try {
            const result = await pool.query(`
                UPDATE products
                SET name=COALESCE($1, name),
                    description=COALESCE($2, description),
                    short_description=COALESCE($3, short_description),
                    category_id=COALESCE($4, category_id),
                    price=COALESCE($5, price),
                    compare_price=COALESCE($6, compare_price),
                    sku=COALESCE($7, sku),
                    stock=COALESCE($8, stock),
                    weight=COALESCE($9, weight),
                    image=COALESCE($10, image),
                    status=COALESCE($11, status),
                    badge=COALESCE($12, badge),
                    feature_badges=COALESCE($13::jsonb, feature_badges),
                    highlights=COALESCE($14::jsonb, highlights),
                    ingredients=COALESCE($15::jsonb, ingredients),
                    storage_instructions=COALESCE($16, storage_instructions),
                    usage_instructions=COALESCE($17, usage_instructions),
                    seo_title=COALESCE($18, seo_title),
                    seo_description=COALESCE($19, seo_description),
                    updated_at=CURRENT_TIMESTAMP
                WHERE id=$20
                RETURNING *
            `, [
                name, description, short_description, category_id,
                price !== undefined ? Number(price) : null,
                compare_price !== undefined ? Number(compare_price) : null,
                sku, stock !== undefined ? Number(stock) : null,
                weight, savedImage, status, badge,
                featureBadgesJson, highlightsJson, ingredientsJson,
                storage_instructions, usage_instructions,
                seo_title, seo_description,
                id
            ]);
            if (result.rows.length > 0) updatedProd = result.rows[0];
        } catch (dbErr) {
            console.warn("[UPDATE PRODUCT DB WARN]:", dbErr.message);
        }

        const localList = loadLocalProducts();
        const idx = localList.findIndex(p => p.id === id);
        if (idx !== -1) {
            localList[idx] = Object.assign({}, localList[idx], {
                name: name !== undefined ? name : localList[idx].name,
                description: description !== undefined ? description : localList[idx].description,
                short_description: short_description !== undefined ? short_description : localList[idx].short_description,
                category: category !== undefined ? category : localList[idx].category,
                category_name: category !== undefined ? category : localList[idx].category_name,
                price: price !== undefined ? Number(price) : localList[idx].price,
                compare_price: compare_price !== undefined ? Number(compare_price) : localList[idx].compare_price,
                weight: weight !== undefined ? weight : localList[idx].weight,
                stock: stock !== undefined ? Number(stock) : localList[idx].stock,
                image: savedImage || localList[idx].image,
                badge: badge !== undefined ? badge : localList[idx].badge,
                status: status !== undefined ? status : localList[idx].status,
                feature_badges: feature_badges !== undefined ? feature_badges : localList[idx].feature_badges,
                highlights: highlights !== undefined ? highlights : localList[idx].highlights,
                ingredients: ingredients !== undefined ? ingredients : localList[idx].ingredients,
                storage_instructions: storage_instructions !== undefined ? storage_instructions : localList[idx].storage_instructions,
                usage_instructions: usage_instructions !== undefined ? usage_instructions : localList[idx].usage_instructions,
                seo_title: seo_title !== undefined ? seo_title : localList[idx].seo_title,
                seo_description: seo_description !== undefined ? seo_description : localList[idx].seo_description
            });
            updatedProd = localList[idx];
            saveLocalProducts(localList);
        }

        // Update product_content.json
        const allContent = loadProductContent();
        const existingContent = allContent[id.toString()] || {};
        allContent[id.toString()] = {
            ...existingContent,
            product_id: id,
            short_description: short_description !== undefined ? short_description : existingContent.short_description,
            feature_badges: feature_badges !== undefined ? feature_badges : existingContent.feature_badges,
            highlights: highlights !== undefined ? highlights : existingContent.highlights,
            ingredients: ingredients !== undefined ? ingredients : existingContent.ingredients,
            storage_instructions: storage_instructions !== undefined ? storage_instructions : existingContent.storage_instructions,
            usage_instructions: usage_instructions !== undefined ? usage_instructions : existingContent.usage_instructions,
            seo_title: seo_title !== undefined ? seo_title : existingContent.seo_title,
            seo_description: seo_description !== undefined ? seo_description : existingContent.seo_description
        };
        saveProductContent(allContent);

        // Synchronize updated image with linked subscription plans
        const finalImage = savedImage || (req.body.image && typeof req.body.image === 'string' && req.body.image.trim() ? req.body.image.trim() : (updatedProd ? updatedProd.image : null));
        if (finalImage) {
            try {
                await pool.query(
                    "UPDATE subscription_plans SET product_image = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2",
                    [finalImage, id]
                );
            } catch (_) {}
        }

        const enriched = attachContentToProducts([updatedProd || req.body]);
        return res.json({ success: true, product: enriched[0] });
    } catch (error) {
        console.error("Update product error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/* DELETE PRODUCT */
router.delete("/:id", authenticateToken, adminOnly, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        try {
            await pool.query("DELETE FROM products WHERE id=$1", [id]);
        } catch (_) { }
        const localList = loadLocalProducts().filter(p => p.id !== id);
        saveLocalProducts(localList);
        const allContent = loadProductContent();
        delete allContent[id.toString()];
        saveProductContent(allContent);
        res.json({ success: true, message: "Product deleted" });
    } catch (error) {
        console.error("Delete product error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
