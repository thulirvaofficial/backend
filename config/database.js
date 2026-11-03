const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 1500
});

pool.on("error", (err) => {
    console.error("PostgreSQL error:", err);
});

async function initializeDatabase() {
    try {
        await pool.query("SELECT 1;");

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                email VARCHAR(200) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                phone VARCHAR(30),
                address TEXT,
                role VARCHAR(30) DEFAULT 'customer',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                display_name VARCHAR(150),
                emoji VARCHAR(20),
                description TEXT,
                image VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed categories if empty
        const catCheck = await pool.query("SELECT COUNT(*) FROM categories");
        if (Number(catCheck.rows[0].count) === 0) {
            const defaultCats = [
                ["Milk", "Fresh Cow Milk", "🥛", "Farm fresh A2 raw & chilled cow milk bottled within hours of morning milking.", "/assets/images/products/fresh_cow_milk.jpg"],
                ["Ghee", "Ghee & Butter", "🧈", "Traditional hand-churned Bilona cow ghee and fresh cultured farm butter.", "/assets/images/products/pure_cow_ghee.jpg"],
                ["Paneer", "Paneer & Tofu", "🧀", "Soft, melt-in-mouth cottage cheese and non-GMO organic artisanal tofu.", "/assets/images/products/fresh_paneer.jpg"],
                ["Curd", "Natural Set Curd", "🫙", "Naturally cultured probiotic thick set curd made with pure wholesome cow milk.", "/assets/images/products/product_lineup.jpg"],
                ["Oils", "Cold-Pressed Oils", "🫗", "Traditional wooden chekku cold-pressed groundnut and gingelly oils.", "/assets/images/products/product_lineup.jpg"],
                ["Masalas", "Pure Spices & Masalas", "🌶️", "Single-origin Salem turmeric powder and aromatic farm-ground spice blends.", "/assets/images/products/product_lineup.jpg"],
                ["Vegan", "Vegan & Plant-Based", "🌱", "Plant-based oat & almond milk, organic soy tofu, and raw wild honey.", "/assets/images/products/fresh_paneer.jpg"]
            ];
            for (const [name, display_name, emoji, desc, img] of defaultCats) {
                await pool.query(
                    "INSERT INTO categories (name, display_name, emoji, description, image) VALUES ($1,$2,$3,$4,$5)",
                    [name, display_name, emoji, desc, img]
                );
            }
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                description TEXT,
                category_id INTEGER REFERENCES categories(id)
                    ON DELETE SET NULL,
                price NUMERIC(10,2) NOT NULL DEFAULT 0,
                compare_price NUMERIC(10,2),
                sku VARCHAR(100),
                stock INTEGER DEFAULT 0,
                weight VARCHAR(50),
                image VARCHAR(500),
                badge VARCHAR(50),
                status VARCHAR(30) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS addresses (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id)
                    ON DELETE CASCADE,
                name VARCHAR(150),
                phone VARCHAR(30),
                address TEXT,
                city VARCHAR(100),
                state VARCHAR(100),
                pincode VARCHAR(20),
                is_default BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id)
                    ON DELETE SET NULL,
                customer_name VARCHAR(150),
                customer_phone VARCHAR(30),
                customer_email VARCHAR(200),
                address TEXT,
                city VARCHAR(100),
                state VARCHAR(100),
                pincode VARCHAR(20),
                subtotal NUMERIC(10,2) DEFAULT 0,
                delivery_charge NUMERIC(10,2) DEFAULT 30,
                total NUMERIC(10,2) DEFAULT 0,
                payment_method VARCHAR(100),
                payment_status VARCHAR(50) DEFAULT 'pending',
                order_status VARCHAR(50) DEFAULT 'pending',
                transaction_id VARCHAR(150),
                payment_proof TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Ensure columns exist if table was already created
        await pool.query(`
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(150);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof TEXT;
        `).catch(() => {});

        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id)
                    ON DELETE CASCADE,
                product_id INTEGER REFERENCES products(id)
                    ON DELETE SET NULL,
                product_name VARCHAR(200),
                quantity INTEGER NOT NULL,
                price NUMERIC(10,2) NOT NULL,
                total NUMERIC(10,2) NOT NULL
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS subscription_plans (
                id SERIAL PRIMARY KEY,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                product_name VARCHAR(200) NOT NULL,
                product_image VARCHAR(500),
                time_period VARCHAR(100) NOT NULL,
                frequency VARCHAR(50) DEFAULT 'Daily',
                duration_days INTEGER DEFAULT 30,
                price NUMERIC(10,2) NOT NULL,
                original_price NUMERIC(10,2),
                discount_percent INTEGER DEFAULT 0,
                description TEXT,
                badge VARCHAR(50) DEFAULT 'Popular',
                status VARCHAR(30) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id VARCHAR(50) PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                customer_name VARCHAR(150) NOT NULL,
                customer_phone VARCHAR(30) NOT NULL,
                customer_email VARCHAR(200),
                plan_id INTEGER REFERENCES subscription_plans(id) ON DELETE SET NULL,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                product_name VARCHAR(200) NOT NULL,
                product_image VARCHAR(500),
                time_period VARCHAR(100) NOT NULL,
                frequency VARCHAR(50) DEFAULT 'Daily',
                quantity INTEGER DEFAULT 1,
                delivery_slot VARCHAR(50) DEFAULT '6:00 AM - 7:00 AM',
                price_per_delivery NUMERIC(10,2) NOT NULL,
                total_price NUMERIC(10,2) NOT NULL,
                start_date VARCHAR(50) NOT NULL,
                address TEXT NOT NULL,
                city VARCHAR(100) DEFAULT 'Kanchipuram',
                pincode VARCHAR(20) DEFAULT '631601',
                payment_method VARCHAR(100) DEFAULT 'UPI QR (7904880944@superyes)',
                payment_status VARCHAR(50) DEFAULT 'Pending',
                status VARCHAR(50) DEFAULT 'Active',
                transaction_id VARCHAR(150),
                payment_proof TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Ensure columns exist on subscriptions
        await pool.query(`
            ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(150);
            ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_proof TEXT;
        `).catch(() => {});

        // DELIVERY LOCATIONS TABLE
        await pool.query(`
            CREATE TABLE IF NOT EXISTS delivery_locations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                pincode VARCHAR(20),
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed 11 delivery locations specified by the user
        const locCheck = await pool.query("SELECT COUNT(*) FROM delivery_locations");
        if (Number(locCheck.rows[0].count) === 0) {
            const locations = [
                ["Oragadam", "603109"],
                ["Padapai", "601301"],
                ["Sriperumbudur", "602105"],
                ["Valasaravakkam", "600087"],
                ["Porur", "600116"],
                ["Virugambakkam", "600092"],
                ["Vadapalani", "600026"],
                ["Koyambedu", "600107"],
                ["KK Nagar", "600078"],
                ["Alapakkam", "600116"],
                ["Maduravoyal", "600095"]
            ];
            for (const [name, pin] of locations) {
                await pool.query(
                    "INSERT INTO delivery_locations (name, pincode, status) VALUES ($1,$2,'active') ON CONFLICT (name) DO NOTHING",
                    [name, pin]
                );
            }
        }

        console.log("[+] Database tables ready");
    } catch (error) {
        console.error("[DATABASE ERROR]", error.message);
    }
}

module.exports = {
    pool,
    initializeDatabase
};
