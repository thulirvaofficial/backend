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
                const fileName = `prod_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
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

/* GET ALL PRODUCTS WITH DYNAMIC VARIANTS */
router.get("/", async (req, res) => {
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
        } catch (_) {}

        if (!list.length) {
            list = loadLocalProducts().filter(p => p.status !== "inactive");
        }

        const productsWithVariants = await attachVariantsToProducts(list);
        return res.json({ success: true, products: productsWithVariants });
    } catch (err) {
        const fallback = loadLocalProducts().filter(p => p.status !== "inactive");
        return res.json({ success: true, products: fallback });
    }
});

/* GET SINGLE PRODUCT WITH VARIANTS */
router.get("/:id", async (req, res) => {
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
        } catch (_) {}

        if (!product) {
            const all = loadLocalProducts();
            product = all.find(p => p.id === id);
        }

        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }
        const withVariants = await attachVariantsToProducts([product]);
        res.json({ success: true, product: withVariants[0] });
    } catch (err) {
        const all = loadLocalProducts();
        const p = all.find(x => x.id === id);
        if (p) return res.json({ success: true, product: p });
        res.status(500).json({ success: false, message: "Failed to fetch product" });
    }
});

/* ADMIN GET ALL PRODUCTS */
router.get("/admin/all", async (req, res) => {
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
        } catch (_) {}

        if (!list.length) {
            list = loadLocalProducts();
        }

        const withVariants = await attachVariantsToProducts(list);
        res.json({ success: true, products: withVariants });
    } catch (err) {
        const fallback = loadLocalProducts();
        res.json({ success: true, products: fallback });
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
    } catch {}

    const prod = MOCK_PRODUCTS.find(p => p.id === productId);
    const variants = IN_MEMORY_VARIANTS[productId] || (prod ? generateDefaultVariants(prod) : []);
    res.json({ success: true, variants });
});

router.post("/:id/variants", async (req, res) => {
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

router.put("/variants/:variantId", async (req, res) => {
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
    } catch {}

    for (const pid in IN_MEMORY_VARIANTS) {
        const idx = IN_MEMORY_VARIANTS[pid].findIndex(v => v.id === variantId);
        if (idx !== -1) {
            IN_MEMORY_VARIANTS[pid][idx] = { ...IN_MEMORY_VARIANTS[pid][idx], ...req.body };
            return res.json({ success: true, variant: IN_MEMORY_VARIANTS[pid][idx] });
        }
    }

    res.json({ success: true, message: "Variant updated" });
});

router.delete("/variants/:variantId", async (req, res) => {
    const variantId = parseInt(req.params.variantId);
    try {
        await pool.query("DELETE FROM product_variants WHERE id = $1", [variantId]);
    } catch {}

    for (const pid in IN_MEMORY_VARIANTS) {
        IN_MEMORY_VARIANTS[pid] = IN_MEMORY_VARIANTS[pid].filter(v => v.id !== variantId);
    }

    res.json({ success: true, message: "Variant deleted" });
});

/* CREATE PRODUCT */
router.post("/", async (req, res) => {
    try {
        const { name, description, category, category_id, price, compare_price, sku, stock, weight, image, badge, status } = req.body;
        const savedImage = saveBase64Image(image);
        let newProd = null;

        try {
            const result = await pool.query(`
                INSERT INTO products (name, description, category_id, price, compare_price, sku, stock, weight, image, badge, status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                RETURNING *
            `, [
                name || "Product",
                description || "",
                category_id || null,
                Number(price) || 0,
                compare_price ? Number(compare_price) : null,
                sku || null,
                stock !== undefined ? Number(stock) : 0,
                weight || null,
                savedImage || null,
                badge || null,
                status || "active"
            ]);
            newProd = result.rows[0];
        } catch (_) {}

        const localList = loadLocalProducts();
        const nextId = newProd?.id || (localList.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1);
        if (!newProd) {
            newProd = {
                id: nextId,
                name: name || "Product",
                description: description || "",
                category: category || "General",
                category_name: category || "General",
                category_id: category_id || 1,
                price: Number(price) || 0,
                compare_price: compare_price ? Number(compare_price) : null,
                weight: weight || "1 Unit",
                stock: stock !== undefined ? Number(stock) : 50,
                image: savedImage || "/assets/images/products/fresh_cow_milk.jpg",
                badge: badge || null,
                status: status || "active"
            };
        }
        localList.unshift(newProd);
        saveLocalProducts(localList);

        return res.json({ success: true, product: newProd });
    } catch (error) {
        console.error("Create product error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/* UPDATE PRODUCT */
router.put("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, description, category, category_id, price, compare_price, sku, stock, weight, image, status, badge } = req.body;
        const savedImage = saveBase64Image(image);
        let updatedProd = null;

        try {
            const result = await pool.query(`
                UPDATE products
                SET name=COALESCE($1, name),
                    description=COALESCE($2, description),
                    category_id=COALESCE($3, category_id),
                    price=COALESCE($4, price),
                    compare_price=COALESCE($5, compare_price),
                    sku=COALESCE($6, sku),
                    stock=COALESCE($7, stock),
                    weight=COALESCE($8, weight),
                    image=COALESCE($9, image),
                    status=COALESCE($10, status),
                    badge=COALESCE($11, badge),
                    updated_at=CURRENT_TIMESTAMP
                WHERE id=$12
                RETURNING *
            `, [name, description, category_id, price !== undefined ? Number(price) : null, compare_price !== undefined ? Number(compare_price) : null, sku, stock !== undefined ? Number(stock) : null, weight, savedImage, status, badge, id]);
            if (result.rows.length > 0) updatedProd = result.rows[0];
        } catch (_) {}

        const localList = loadLocalProducts();
        const idx = localList.findIndex(p => p.id === id);
        if (idx !== -1) {
            localList[idx] = Object.assign({}, localList[idx], {
                name: name || localList[idx].name,
                description: description !== undefined ? description : localList[idx].description,
                category: category || localList[idx].category,
                category_name: category || localList[idx].category_name,
                price: price !== undefined ? Number(price) : localList[idx].price,
                compare_price: compare_price !== undefined ? Number(compare_price) : localList[idx].compare_price,
                weight: weight || localList[idx].weight,
                stock: stock !== undefined ? Number(stock) : localList[idx].stock,
                image: savedImage || localList[idx].image,
                badge: badge !== undefined ? badge : localList[idx].badge,
                status: status || localList[idx].status
            });
            updatedProd = localList[idx];
            saveLocalProducts(localList);
        }

        return res.json({ success: true, product: updatedProd || req.body });
    } catch (error) {
        console.error("Update product error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/* DELETE PRODUCT */
router.delete("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        try {
            await pool.query("DELETE FROM products WHERE id=$1", [id]);
        } catch (_) {}
        const localList = loadLocalProducts().filter(p => p.id !== id);
        saveLocalProducts(localList);
        res.json({ success: true, message: "Product deleted" });
    } catch (error) {
        console.error("Delete product error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
