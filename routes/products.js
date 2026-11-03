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

let MOCK_PRODUCTS = [
    { id: 1, name: "Fresh Cow Milk (500ml)", category: "Milk", category_name: "Dairy", price: 44, compare_price: 50, weight: "500 ml", stock: 120, badge: "Fresh", emoji: "🥛", image: "/assets/images/products/fresh_cow_milk.jpg", status: "active", description: "100% pure cow milk sourced from healthy pasture cows. No hormones, no preservatives." },
    { id: 2, name: "Pure Bilona Cow Ghee (500ml)", category: "Ghee", category_name: "Ghee & Butter", price: 520, compare_price: 600, weight: "500 ml", stock: 45, badge: "Pure", emoji: "🧈", image: "/assets/images/products/pure_cow_ghee.jpg", status: "active", description: "Prepared using traditional Bilona method from curd churned butter. Rich aroma and authentic taste." },
    { id: 3, name: "Fresh Artisanal Paneer (200g)", category: "Paneer", category_name: "Paneer", price: 82, compare_price: 95, weight: "200 g", stock: 60, badge: "Fresh", emoji: "🧀", image: "/assets/images/products/fresh_paneer.jpg", status: "active", description: "Ultra soft, chemical-free cottage cheese made fresh every morning from pure cow milk." },
    { id: 4, name: "Natural Thick Set Curd (500g)", category: "Curd", category_name: "Dairy", price: 48, compare_price: 55, weight: "500 g", stock: 75, badge: "Probiotic", emoji: "🫙", image: "/assets/images/products/product_lineup.jpg", status: "active", description: "Probiotic rich, naturally set cow milk curd with thick, velvety consistency." },
    { id: 5, name: "Fresh Cow Milk (1 Litre)", category: "Milk", category_name: "Dairy", price: 82, compare_price: 90, weight: "1 Litre", stock: 150, badge: "Farm Fresh", emoji: "🥛", image: "/assets/images/products/fresh_cow_milk.jpg", status: "active", description: "Chilled within 45 mins of milking to 4°C. Glass bottled everyday goodness." },
    { id: 6, name: "Traditional Farm Butter (250g)", category: "Ghee", category_name: "Ghee & Butter", price: 140, compare_price: 160, weight: "250 g", stock: 35, badge: "Creamy", emoji: "🧈", image: "/assets/images/products/pure_cow_ghee.jpg", status: "active", description: "Churned from cultured cream, unsalted, creamy, and 100% natural." },
    { id: 7, name: "Cold-Pressed Groundnut Oil (1L)", category: "Oils", category_name: "Oils", price: 280, compare_price: 320, weight: "1 Litre", stock: 40, badge: "Wood Pressed", emoji: "🫗", image: "/assets/images/products/product_lineup.jpg", status: "active", description: "Traditional cold wood-pressed oil retaining natural antioxidants and rich flavor." },
    { id: 8, name: "Artisanal Organic Tofu (250g)", category: "Vegan", category_name: "Vegan", price: 120, compare_price: 140, weight: "250 g", stock: 30, badge: "High Protein", emoji: "🌱", image: "/assets/images/products/fresh_paneer.jpg", status: "active", description: "Soy milk paneer pressed with care. Non-GMO, vegan and protein packed." },
    { id: 9, name: "Pure Wild Forest Honey (350g)", category: "Vegan", category_name: "Vegan", price: 340, compare_price: 400, weight: "350 g", stock: 25, badge: "Raw", emoji: "🍯", image: "/assets/images/products/product_lineup.jpg", status: "active", description: "Unfiltered, unprocessed raw wild honey harvested from natural forest hives." },
    { id: 10, name: "Salem Turmeric Powder (200g)", category: "Masalas", category_name: "Masalas", price: 120, compare_price: 150, weight: "200 g", stock: 50, badge: "High Curcumin", emoji: "🌶️", image: "/assets/images/products/product_lineup.jpg", status: "active", description: "Pure ground turmeric root with high natural curcumin content and deep golden color." },
    { id: 11, name: "Cold-Pressed Sesame Oil (500ml)", category: "Oils", category_name: "Oils", price: 320, compare_price: 360, weight: "500 ml", stock: 30, badge: "Wood Pressed", emoji: "🫗", image: "/assets/images/products/product_lineup.jpg", status: "active", description: "Gingelly oil extracted with organic palm jaggery in traditional wooden chekku." },
    { id: 12, name: "Oat & Almond Milk (1L)", category: "Vegan", category_name: "Vegan", price: 180, compare_price: 210, weight: "1 Litre", stock: 25, badge: "Plant Based", emoji: "🌱", image: "/assets/images/products/fresh_cow_milk.jpg", status: "active", description: "Silky dairy-free beverage enriched with calcium and vitamins." }
];

/* GET ALL PRODUCTS */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, c.name AS category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.status='active'
            ORDER BY p.id DESC
        `);
        if (result.rows.length > 0) {
            return res.json({ success: true, products: result.rows });
        }
        return res.json({ success: true, products: MOCK_PRODUCTS });
    } catch {
        res.json({ success: true, products: MOCK_PRODUCTS });
    }
});

/* GET SINGLE PRODUCT */
router.get("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const result = await pool.query(`
            SELECT p.*, c.name AS category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = $1
        `, [id]);
        if (result.rows.length > 0) {
            return res.json({ success: true, product: result.rows[0] });
        }
        const fallback = MOCK_PRODUCTS.find(p => p.id === id) || MOCK_PRODUCTS[0];
        res.json({ success: true, product: fallback });
    } catch {
        const fallback = MOCK_PRODUCTS.find(p => p.id === id) || MOCK_PRODUCTS[0];
        res.json({ success: true, product: fallback });
    }
});

/* ADMIN GET ALL */
router.get("/admin/all", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, c.name AS category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            ORDER BY p.id DESC
        `);
        res.json({ success: true, products: result.rows.length ? result.rows : MOCK_PRODUCTS });
    } catch {
        res.json({ success: true, products: MOCK_PRODUCTS });
    }
});

/* CREATE PRODUCT */
router.post("/", async (req, res) => {
    try {
        const { name, description, category, category_id, price, compare_price, sku, stock, weight, image, badge } = req.body;
        const savedImage = saveBase64Image(image);
        
        try {
            const result = await pool.query(`
                INSERT INTO products (name, description, category_id, price, compare_price, sku, stock, weight, image)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                RETURNING *
            `, [name, description, category_id || null, price || 0, compare_price || null, sku || null, stock || 0, weight || null, savedImage || null]);
            return res.json({ success: true, product: result.rows[0] });
        } catch {
            // In-memory fallback
            const newId = MOCK_PRODUCTS.length ? Math.max(...MOCK_PRODUCTS.map(p => p.id)) + 1 : 1;
            const newProduct = {
                id: newId,
                name: name || "New Product",
                category: category || "Dairy",
                category_name: category || "Dairy",
                price: Number(price) || 0,
                compare_price: compare_price ? Number(compare_price) : null,
                weight: weight || "500 ml",
                stock: stock ? Number(stock) : 50,
                badge: badge || "New",
                emoji: "🥛",
                image: savedImage || "/assets/images/products/product_lineup.jpg",
                status: "active",
                description: description || "Fresh farm quality product."
            };
            MOCK_PRODUCTS.unshift(newProduct);
            return res.json({ success: true, product: newProduct });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* UPDATE PRODUCT */
router.put("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, description, category, category_id, price, compare_price, sku, stock, weight, image, status, badge } = req.body;
        const savedImage = saveBase64Image(image);
        
        try {
            const result = await pool.query(`
                UPDATE products
                SET name=$1, description=$2, category_id=$3, price=$4, compare_price=$5, sku=$6, stock=$7, weight=$8, image=$9, status=$10, updated_at=CURRENT_TIMESTAMP
                WHERE id=$11
                RETURNING *
            `, [name, description, category_id || null, price || 0, compare_price || null, sku || null, stock || 0, weight || null, savedImage || null, status || "active", id]);
            if (result.rows.length) return res.json({ success: true, product: result.rows[0] });
        } catch {
            // In-memory update
            const idx = MOCK_PRODUCTS.findIndex(p => p.id === id);
            if (idx !== -1) {
                MOCK_PRODUCTS[idx] = {
                    ...MOCK_PRODUCTS[idx],
                    name: name !== undefined ? name : MOCK_PRODUCTS[idx].name,
                    category: category !== undefined ? category : MOCK_PRODUCTS[idx].category,
                    price: price !== undefined ? Number(price) : MOCK_PRODUCTS[idx].price,
                    compare_price: compare_price !== undefined ? Number(compare_price) : MOCK_PRODUCTS[idx].compare_price,
                    stock: stock !== undefined ? Number(stock) : MOCK_PRODUCTS[idx].stock,
                    weight: weight !== undefined ? weight : MOCK_PRODUCTS[idx].weight,
                    image: savedImage !== undefined ? savedImage : MOCK_PRODUCTS[idx].image,
                    status: status !== undefined ? status : MOCK_PRODUCTS[idx].status,
                    description: description !== undefined ? description : MOCK_PRODUCTS[idx].description,
                    badge: badge !== undefined ? badge : MOCK_PRODUCTS[idx].badge
                };
                return res.json({ success: true, product: MOCK_PRODUCTS[idx] });
            }
        }
        res.json({ success: true, message: "Product updated" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* DELETE PRODUCT */
router.delete("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query("DELETE FROM products WHERE id=$1", [id]);
    } catch {
        MOCK_PRODUCTS = MOCK_PRODUCTS.filter(p => p.id !== id);
    }
    res.json({ success: true, message: "Product deleted" });
});

module.exports = router;
