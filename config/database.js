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

        // Ensure all required columns exist on users
        const userCols = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(30)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode VARCHAR(20)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ];
        for (const sql of userCols) {
            await pool.query(sql).catch(e => console.warn("User migration warn:", e.message));
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                display_name VARCHAR(150),
                emoji VARCHAR(20),
                description TEXT,
                image VARCHAR(500),
                website_image VARCHAR(500),
                mobile_image VARCHAR(500),
                is_active BOOLEAN DEFAULT true,
                display_order INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Ensure category mobile_image and display_order columns exist
        const catCols = [
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS website_image VARCHAR(500)",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS mobile_image VARCHAR(500)",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true",
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 1"
        ];
        for (const sql of catCols) {
            await pool.query(sql).catch(e => console.warn("Category migration warn:", e.message));
        }

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

        // Ensure all required columns exist on orders
        const orderCols = [
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(150)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof TEXT",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_by VARCHAR(150)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(50) DEFAULT 'delivery'",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(100)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location_id INTEGER",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location_name VARCHAR(150)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_slot VARCHAR(100)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_proof TEXT",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_proof_url TEXT",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_remarks TEXT",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude NUMERIC(10,6)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude NUMERIC(10,6)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS proof_status VARCHAR(50)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_id VARCHAR(50)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_name VARCHAR(150)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_phone VARCHAR(30)",
            `CREATE TABLE IF NOT EXISTS order_status_history (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                status VARCHAR(50),
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS delivery_proofs (
                id SERIAL PRIMARY KEY,
                order_id VARCHAR(100),
                subscription_id VARCHAR(100),
                partner_id VARCHAR(50),
                proof_url TEXT NOT NULL,
                file_path TEXT,
                remarks TEXT,
                latitude NUMERIC(10,6),
                longitude NUMERIC(10,6),
                status VARCHAR(50) DEFAULT 'verified',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];
        for (const sql of orderCols) {
            await pool.query(sql).catch(e => console.warn("Order migration warn:", e.message));
        }

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

        // Ensure all required columns exist on subscriptions
        const subCols = [
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id INTEGER",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS customer_name VARCHAR(150)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(30)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS customer_email VARCHAR(200)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_id INTEGER",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS product_id INTEGER",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS product_name VARCHAR(200)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS product_image VARCHAR(500)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS time_period VARCHAR(100)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS frequency VARCHAR(50)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivery_slot VARCHAR(50)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS price_per_delivery NUMERIC(10,2) DEFAULT 0",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS total_price NUMERIC(10,2) DEFAULT 0",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS start_date VARCHAR(50)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS address TEXT",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS city VARCHAR(100)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pincode VARCHAR(20)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'Pending'",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active'",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(150)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_proof TEXT",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS duration_days INTEGER DEFAULT 30",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expiry_date VARCHAR(50)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS notes TEXT",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS verified_by VARCHAR(150)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivery_proof TEXT",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivery_proof_url TEXT",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivery_remarks TEXT",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivery_latitude NUMERIC(10,6)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivery_longitude NUMERIC(10,6)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS proof_status VARCHAR(50)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS partner_id VARCHAR(50)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS partner_name VARCHAR(150)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS partner_phone VARCHAR(30)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ];
        for (const sql of subCols) {
            await pool.query(sql).catch(e => console.warn("Subscription migration warn:", e.message));
        }

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

        // ============================================================
        // SERVICEABLE AREAS TABLE (Central Dynamic Serviceability System)
        // ============================================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS serviceable_areas (
                id SERIAL PRIMARY KEY,
                area_name VARCHAR(150) NOT NULL,
                city VARCHAR(100) NOT NULL,
                state VARCHAR(100) DEFAULT 'Tamil Nadu',
                pincode VARCHAR(255) NOT NULL,
                boundary_type VARCHAR(50) DEFAULT 'polygon',
                boundary_coordinates JSONB,
                latitude NUMERIC(10,7) NOT NULL,
                longitude NUMERIC(10,7) NOT NULL,
                radius_meters NUMERIC(10,2) DEFAULT 5000,
                is_serviceable BOOLEAN DEFAULT true,
                is_active BOOLEAN DEFAULT true,
                delivery_charge NUMERIC(10,2) DEFAULT 0,
                minimum_order_amount NUMERIC(10,2) DEFAULT 0,
                estimated_delivery_time VARCHAR(100) DEFAULT '30-45 minutes',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migration: ensure address, order, and subscription geo columns exist
        const geoCols = [
            "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS street VARCHAR(255)",
            "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS area VARCHAR(255)",
            "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS landmark VARCHAR(255)",
            "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS delivery_instructions TEXT",
            "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)",
            "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)",
            "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS serviceable_area_id INTEGER",
            "ALTER TABLE addresses ADD COLUMN IF NOT EXISTS is_serviceable BOOLEAN DEFAULT true",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS landmark VARCHAR(255)",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS serviceable_area_id INTEGER",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS landmark VARCHAR(255)",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivery_instructions TEXT",
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS serviceable_area_id INTEGER"
        ];
        for (const sql of geoCols) {
            await pool.query(sql).catch(e => console.warn("Geo migration warn:", e.message));
        }

        // Seed 15 Thulirva Serviceable Areas if table is empty
        try {
            const areaCheck = await pool.query("SELECT COUNT(*) FROM serviceable_areas");
            if (Number(areaCheck.rows[0]?.count || 0) === 0) {
                const initial15 = [
                    ["Oragadam", "Chennai / Kanchipuram", "Tamil Nadu", "603109", 12.8342, 79.9575, 5000, 30, 199, "30-45 minutes"],
                    ["Padapai", "Chennai / Kanchipuram", "Tamil Nadu", "601301", 12.8988, 80.0152, 5000, 30, 199, "35-50 minutes"],
                    ["Sriperumbudur", "Kanchipuram", "Tamil Nadu", "602105", 12.9691, 79.9482, 6000, 30, 199, "30-45 minutes"],
                    ["Valasaravakkam", "Chennai", "Tamil Nadu", "600087", 13.0403, 80.1723, 4000, 0, 149, "25-35 minutes"],
                    ["Porur", "Chennai", "Tamil Nadu", "600116", 13.0382, 80.1565, 4500, 0, 149, "25-35 minutes"],
                    ["Virugambakkam", "Chennai", "Tamil Nadu", "600092", 13.0537, 80.1916, 4000, 0, 149, "20-30 minutes"],
                    ["Vadapalani", "Chennai", "Tamil Nadu", "600026", 13.0500, 80.2121, 3500, 0, 149, "20-30 minutes"],
                    ["Koyambedu", "Chennai", "Tamil Nadu", "600107", 13.0694, 80.1948, 4000, 0, 149, "25-35 minutes"],
                    ["KK Nagar", "Chennai", "Tamil Nadu", "600078", 13.0410, 80.1994, 3500, 0, 149, "20-30 minutes"],
                    ["Alapakkam", "Chennai", "Tamil Nadu", "600116", 13.0475, 80.1601, 3500, 0, 149, "25-35 minutes"],
                    ["Maduravoyal", "Chennai", "Tamil Nadu", "600095", 13.0637, 80.1661, 4000, 0, 149, "25-35 minutes"],
                    ["Anna Nagar", "Chennai", "Tamil Nadu", "600040, 600101, 600102", 13.0850, 80.2100, 4500, 0, 199, "25-40 minutes"],
                    ["T Nagar", "Chennai", "Tamil Nadu", "600017", 13.0418, 80.2341, 4000, 0, 149, "25-35 minutes"],
                    ["Velachery", "Chennai", "Tamil Nadu", "600042", 12.9800, 80.2200, 4500, 0, 149, "25-35 minutes"],
                    ["Adyar", "Chennai", "Tamil Nadu", "600020", 13.0012, 80.2565, 4500, 0, 199, "30-45 minutes"]
                ];

                for (const [name, city, state, pin, lat, lng, rad, charge, minOrd, time] of initial15) {
                    const polygon = [
                        { lat: Number((lat + 0.035).toFixed(6)), lng: Number(lng.toFixed(6)) },
                        { lat: Number((lat + 0.017).toFixed(6)), lng: Number((lng + 0.030).toFixed(6)) },
                        { lat: Number((lat - 0.017).toFixed(6)), lng: Number((lng + 0.030).toFixed(6)) },
                        { lat: Number((lat - 0.035).toFixed(6)), lng: Number(lng.toFixed(6)) },
                        { lat: Number((lat - 0.017).toFixed(6)), lng: Number((lng - 0.030).toFixed(6)) },
                        { lat: Number((lat + 0.017).toFixed(6)), lng: Number((lng - 0.030).toFixed(6)) }
                    ];

                    await pool.query(`
                        INSERT INTO serviceable_areas (
                            area_name, city, state, pincode, boundary_type, boundary_coordinates,
                            latitude, longitude, radius_meters, is_serviceable, is_active,
                            delivery_charge, minimum_order_amount, estimated_delivery_time
                        ) VALUES ($1,$2,$3,$4,'polygon',$5,$6,$7,$8,true,true,$9,$10,$11)
                    `, [name, city, state, pin, JSON.stringify(polygon), lat, lng, rad, charge, minOrd, time]);
                }
                console.log("[+] Initialized 15 default Thulirva Serviceable Areas in database");
            }
        } catch (e) {
            console.warn("Serviceable areas seed warn:", e.message);
        }

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

        // ALTER ORDERS FOR PICKUP & VERIFICATION
        await pool.query(`
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(50);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN DEFAULT false;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(50) DEFAULT 'delivery';
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_pickup BOOLEAN DEFAULT false;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location_id INTEGER;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location_name VARCHAR(150);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_slot VARCHAR(100);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_collected_at TIMESTAMP;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_collected_by VARCHAR(100);
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_by VARCHAR(100);
        `).catch(() => {});

        // Seed default subscription plans into database if empty
        try {
            const planCheck = await pool.query("SELECT COUNT(*) FROM subscription_plans");
            if (Number(planCheck.rows[0]?.count || 0) === 0) {
                await pool.query(`
                    INSERT INTO subscription_plans (id, product_name, product_image, time_period, frequency, duration_days, price, original_price, discount_percent, description, badge, status)
                    VALUES 
                    (1, 'Fresh Cow Milk (500ml)', '/assets/images/products/fresh_cow_milk.jpg', 'Daily Morning (30 Days)', 'Daily', 30, 1320, 1500, 12, 'Pure farm fresh cow milk delivered daily before 7 AM.', 'Most Popular', 'active'),
                    (2, 'Fresh Cow Milk (1 Litre)', '/assets/images/products/fresh_cow_milk.jpg', 'Daily Morning (30 Days)', 'Daily', 30, 2460, 2700, 9, '1 Litre family pack chilled cow milk delivered every single morning.', 'Family Pack', 'active'),
                    (3, 'Fresh Cow Milk (500ml)', '/assets/images/products/fresh_cow_milk.jpg', 'Alternate Days (15 Days)', 'Alternate', 30, 660, 750, 12, 'Delivered every alternate day.', 'Flexible Plan', 'active'),
                    (4, 'Fresh Artisanal Paneer (200g)', '/assets/images/products/fresh_paneer.jpg', 'Twice a Week (8 Deliveries)', 'Twice Weekly', 30, 656, 760, 14, 'Ultra-soft chemical-free cottage cheese.', 'Fresh Batch', 'active'),
                    (5, 'Pure Bilona Cow Ghee (500ml)', '/assets/images/products/pure_cow_ghee.jpg', 'Monthly Delivery (1 Jar/Month)', 'Monthly', 30, 499, 600, 17, 'A fresh 500ml jar of fragrant Bilona churned golden ghee.', 'Pure Bilona', 'active'),
                    (6, 'Natural Thick Set Curd (500g)', '/assets/images/products/product_lineup.jpg', 'Daily Morning (30 Days)', 'Daily', 30, 1440, 1650, 13, 'Probiotic rich, smooth thick curd.', 'Probiotic', 'active')
                    ON CONFLICT (id) DO NOTHING
                `);
            }
        } catch (_) {}

        // Add unique constraint on order_number if not already present
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_number_unique'
                ) THEN
                    ALTER TABLE orders ADD CONSTRAINT orders_order_number_unique UNIQUE (order_number);
                END IF;
            END $$;
        `).catch(() => {});

        // COUPONS TABLE
        await pool.query(`
            CREATE TABLE IF NOT EXISTS coupons (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE,
                discount_type VARCHAR(20) DEFAULT 'percent',
                discount_value NUMERIC(10,2) NOT NULL DEFAULT 10,
                min_order NUMERIC(10,2) DEFAULT 0,
                max_discount NUMERIC(10,2) DEFAULT 200,
                description TEXT,
                headline VARCHAR(150),
                expiry_date VARCHAR(50) DEFAULT '2027-12-31',
                usage_limit INTEGER DEFAULT 1000,
                usage_count INTEGER DEFAULT 0,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed coupons if empty
        const coupCheck = await pool.query("SELECT COUNT(*) FROM coupons");
        if (Number(coupCheck.rows[0].count) === 0) {
            const seedCoupons = [
                ['THULIRVA10', 'percent', 10, 0, 200, '10% OFF on all fresh farm products & subscriptions', 'Farm 10% Welcome Offer'],
                ['FARM50', 'flat', 50, 499, 50, '₹50 flat discount on orders above ₹499', 'Flat ₹50 Savings'],
                ['FARM10', 'percent', 10, 0, 150, '10% Farm discount on dairy essentials', 'Pure Farm 10% Off'],
                ['THULIRVA50', 'flat', 50, 299, 50, 'Flat ₹50 OFF on fresh doorstep orders above ₹299', 'Flat ₹50 Special'],
                ['FREESHIP', 'flat', 30, 250, 30, 'Free doorstep delivery on farm orders', 'Free Home Delivery'],
                ['WELCOME10', 'percent', 10, 0, 150, 'Welcome offer: 10% OFF for all registered families', 'Welcome Family Discount']
            ];
            for (const [code, dtype, dval, minOrd, maxD, desc, head] of seedCoupons) {
                await pool.query(
                    `INSERT INTO coupons (code, discount_type, discount_value, min_order, max_discount, description, headline, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') ON CONFLICT (code) DO NOTHING`,
                    [code, dtype, dval, minOrd, maxD, desc, head]
                );
            }
        }

        // ANNOUNCEMENTS & NEWS TABLE
        await pool.query(`
            CREATE TABLE IF NOT EXISTS announcements (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                message TEXT NOT NULL,
                badge VARCHAR(50) DEFAULT 'Announcement',
                target_role VARCHAR(50) DEFAULT 'all',
                is_published BOOLEAN DEFAULT true,
                created_by VARCHAR(100) DEFAULT 'Admin',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed sample announcement if empty
        const annCheck = await pool.query("SELECT COUNT(*) FROM announcements");
        if (Number(annCheck.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO announcements (title, message, badge, target_role, is_published)
                VALUES (
                    '🌾 Fresh Morning Milking Dispatched Daily',
                    'Direct from our Kanchipuram pasture farms to your doorstep every morning by 7:00 AM. 100% pure, unadulterated & chilled A2 milk.',
                    'Farm Update',
                    'all',
                    true
                )
            `);
        }

        // PICKUP LOCATIONS TABLE
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pickup_locations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                address TEXT NOT NULL,
                city VARCHAR(100) DEFAULT 'Kanchipuram',
                pincode VARCHAR(20) DEFAULT '631601',
                phone VARCHAR(30) DEFAULT '+91 93606 71533',
                timings VARCHAR(100) DEFAULT '7:00 AM - 8:00 PM (All 7 Days)',
                instructions TEXT DEFAULT 'Collect directly from the farm store with order reference ID.',
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed default THULIRVA Farm Store pickup location if empty
        const pickupLocCheck = await pool.query("SELECT COUNT(*) FROM pickup_locations");
        if (Number(pickupLocCheck.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO pickup_locations (name, address, city, pincode, phone, timings, instructions, status)
                VALUES (
                    'THULIRVA Farm Store',
                    'No 1, Mayana Salai, Thimmarajampettai',
                    'Kanchipuram',
                    '631601',
                    '+91 93606 71533',
                    '7:00 AM - 8:00 PM (All 7 Days)',
                    'Show your Order ID or registered mobile number at the farm store counter to collect.',
                    'active'
                )
            `);
        }

        // PICKUP TIME SLOTS TABLE
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pickup_time_slots (
                id SERIAL PRIMARY KEY,
                location_id INTEGER REFERENCES pickup_locations(id) ON DELETE CASCADE,
                slot_time VARCHAR(100) NOT NULL,
                capacity INTEGER DEFAULT 25,
                is_active BOOLEAN DEFAULT true
            );
        `);

        const slotCheck = await pool.query("SELECT COUNT(*) FROM pickup_time_slots");
        if (Number(slotCheck.rows[0].count) === 0) {
            const slots = [
                '7:00 AM - 9:00 AM',
                '9:00 AM - 12:00 PM',
                '12:00 PM - 3:00 PM',
                '3:00 PM - 6:00 PM',
                '6:00 PM - 8:00 PM'
            ];
            for (const s of slots) {
                await pool.query(
                    "INSERT INTO pickup_time_slots (location_id, slot_time, capacity, is_active) VALUES (1, $1, 30, true)",
                    [s]
                );
            }
        }

        // BANNERS TABLE
        await pool.query(`
            CREATE TABLE IF NOT EXISTS banners (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                image VARCHAR(500) NOT NULL,
                button_label VARCHAR(100) DEFAULT 'Shop Now',
                destination VARCHAR(200) DEFAULT '/shop',
                is_active BOOLEAN DEFAULT true,
                sort_order INTEGER DEFAULT 1,
                starts_at TIMESTAMP,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed default home banner
        const bannerCheck = await pool.query("SELECT COUNT(*) FROM banners");
        if (Number(bannerCheck.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO banners (title, description, image, button_label, destination, is_active, sort_order)
                VALUES (
                    'Pure Goodness from Our Farms',
                    'Farm fresh A2 milk, hand-churned ghee and organic dairy directly to your doorstep.',
                    '/assets/images/home_clean_bg.png',
                    'Shop Now',
                    '/shop',
                    true,
                    1
                )
            `);
        }

        // OFFERS TABLE
        await pool.query(`
            CREATE TABLE IF NOT EXISTS offers (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                code VARCHAR(50),
                discount_percent INTEGER DEFAULT 0,
                discount_amount NUMERIC(10,2) DEFAULT 0,
                banner_image VARCHAR(500),
                is_active BOOLEAN DEFAULT true,
                is_published BOOLEAN DEFAULT true,
                starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed default initial offer
        const offerCheck = await pool.query("SELECT COUNT(*) FROM offers");
        if (Number(offerCheck.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO offers (title, description, code, discount_percent, is_active, is_published)
                VALUES (
                    'Welcome to THULIRVA Dairy!',
                    'Get 10% off on your first monthly milk subscription or farm order.',
                    'THULIRVA10',
                    10,
                    true,
                    true
                )
            `);
        }

        // ============================================================
        // PRODUCT VARIANTS TABLE (Dynamic weights, units, and prices)
        // ============================================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_variants (
                id SERIAL PRIMARY KEY,
                product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                weight_value VARCHAR(50),
                unit VARCHAR(20) DEFAULT 'g',
                price NUMERIC(10,2) NOT NULL DEFAULT 0,
                compare_price NUMERIC(10,2),
                stock INTEGER DEFAULT 100,
                is_default BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ALTER ORDER_ITEMS TO STORE VARIANT INFO
        await pool.query(`
            ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INTEGER;
            ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name VARCHAR(100);
            ALTER TABLE order_items ADD COLUMN IF NOT EXISTS weight VARCHAR(50);
            ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image VARCHAR(500);
        `).catch(() => {});

        // ============================================================
        // MULTI-STORE PICKUP MANAGEMENT & SETTINGS
        // ============================================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pickup_settings (
                id SERIAL PRIMARY KEY,
                pickup_enabled BOOLEAN DEFAULT true,
                instructions TEXT DEFAULT 'Collect your packed farm fresh order directly from your selected THULIRVA pickup store.',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        const pSetCheck = await pool.query("SELECT COUNT(*) FROM pickup_settings");
        if (Number(pSetCheck.rows[0].count) === 0) {
            await pool.query("INSERT INTO pickup_settings (pickup_enabled) VALUES (true)");
        }

        // Ensure 3 reference pickup stores exist
        const stores = [
            {
                name: "Thulirva Main Branch",
                address: "No 1, Mayana Salai, Thimmarajampettai",
                city: "Kanchipuram",
                pincode: "631601",
                phone: "+91 93606 71533",
                timings: "7:00 AM - 8:00 PM (All 7 Days)",
                instructions: "Show your Order ID at the main dairy dispatch counter."
            },
            {
                name: "Thulirva Anna Nagar",
                address: "Plot 42, 2nd Avenue, Near Roundtana, Anna Nagar",
                city: "Chennai",
                pincode: "600040",
                phone: "+91 79048 80944",
                timings: "6:30 AM - 9:00 PM (All 7 Days)",
                instructions: "Collect fresh morning & evening batches from customer service desk."
            },
            {
                name: "Thulirva Velachery",
                address: "No 18, Velachery Main Road, Near Vijaya Nagar Bus Stand",
                city: "Chennai",
                pincode: "600042",
                phone: "+91 79048 80944",
                timings: "6:30 AM - 9:00 PM (All 7 Days)",
                instructions: "Express collection counter available for pre-packed orders."
            }
        ];

        for (const st of stores) {
            await pool.query(`
                INSERT INTO pickup_locations (name, address, city, pincode, phone, timings, instructions, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
                ON CONFLICT DO NOTHING
            `, [st.name, st.address, st.city, st.pincode, st.phone, st.timings, st.instructions]).catch(() => {});
        }

        // ============================================================
        // PUSH NOTIFICATIONS & DEVICE TOKENS
        // ============================================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS device_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                token TEXT NOT NULL UNIQUE,
                device_type VARCHAR(20) DEFAULT 'android',
                role VARCHAR(30) DEFAULT 'customer',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(200) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'order',
                target_id VARCHAR(100),
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS notification_preferences (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                order_updates BOOLEAN DEFAULT true,
                offers BOOLEAN DEFAULT true,
                subscription_reminders BOOLEAN DEFAULT true,
                general_alerts BOOLEAN DEFAULT true,
                new_order_alerts BOOLEAN DEFAULT true,
                pickup_alerts BOOLEAN DEFAULT true,
                sound_enabled BOOLEAN DEFAULT true,
                vibration_enabled BOOLEAN DEFAULT true
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_status_history (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                status VARCHAR(50) NOT NULL,
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ============================================================
        // 7. DELIVERY PARTNER ECOSYSTEM TABLES
        // ============================================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS delivery_partners (
                id SERIAL PRIMARY KEY,
                partner_id VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(150) NOT NULL,
                phone VARCHAR(30) UNIQUE NOT NULL,
                email VARCHAR(200),
                password VARCHAR(255) NOT NULL,
                profile_photo TEXT,
                address TEXT,
                city VARCHAR(100) DEFAULT 'Chennai',
                pincode VARCHAR(20),
                assigned_area VARCHAR(150) DEFAULT 'Chennai Central',
                vehicle_type VARCHAR(50) DEFAULT 'Scooter',
                vehicle_number VARCHAR(50) DEFAULT 'TN 21 AB 1234',
                driving_licence TEXT,
                identity_documents TEXT,
                emergency_contact VARCHAR(50),
                registration_status VARCHAR(50) DEFAULT 'pending_approval',
                rejection_reason TEXT,
                is_online BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT false,
                is_blocked BOOLEAN DEFAULT false,
                current_latitude NUMERIC(10,7) DEFAULT 13.0827,
                current_longitude NUMERIC(10,7) DEFAULT 80.2707,
                last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                location_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                active_orders_count INTEGER DEFAULT 0,
                max_active_orders INTEGER DEFAULT 1,
                rating NUMERIC(3,2) DEFAULT 5.0,
                total_deliveries_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migration columns for existing databases
        const dpColumns = [
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS registration_status VARCHAR(50) DEFAULT 'pending_approval'",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Chennai'",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS pincode VARCHAR(20)",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS driving_licence TEXT",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS identity_documents TEXT",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(50)",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(50) DEFAULT 'pending_verification'",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS aadhaar_front_url TEXT",
            "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS aadhaar_back_url TEXT",
            "UPDATE delivery_partners SET registration_status = 'approved', is_active = true WHERE registration_status IS NULL OR registration_status = ''"
        ];
        for (const colSql of dpColumns) {
            try { await pool.query(colSql); } catch {}
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS dispatch_offers (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                subscription_id VARCHAR(50) REFERENCES subscriptions(id) ON DELETE CASCADE,
                delivery_type VARCHAR(50) DEFAULT 'order',
                partner_id VARCHAR(50) REFERENCES delivery_partners(partner_id) ON DELETE CASCADE,
                status VARCHAR(50) DEFAULT 'pending',
                offer_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                response_time TIMESTAMP,
                rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS delivery_assignments (
                id SERIAL PRIMARY KEY,
                assignment_id VARCHAR(50) UNIQUE NOT NULL,
                order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                subscription_id VARCHAR(50) REFERENCES subscriptions(id) ON DELETE CASCADE,
                delivery_type VARCHAR(50) NOT NULL DEFAULT 'order',
                partner_id VARCHAR(50) REFERENCES delivery_partners(partner_id) ON DELETE CASCADE,
                status VARCHAR(50) DEFAULT 'assigned',
                assigned_by VARCHAR(50) DEFAULT 'smart_dispatch',
                pickup_time TIMESTAMP,
                delivered_time TIMESTAMP,
                failed_reason TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_subscription_deliveries (
                id SERIAL PRIMARY KEY,
                daily_id VARCHAR(50) UNIQUE NOT NULL,
                subscription_id VARCHAR(50) REFERENCES subscriptions(id) ON DELETE CASCADE,
                delivery_date DATE NOT NULL,
                partner_id VARCHAR(50) REFERENCES delivery_partners(partner_id) ON DELETE SET NULL,
                customer_name VARCHAR(150) NOT NULL,
                customer_phone VARCHAR(30) NOT NULL,
                address TEXT NOT NULL,
                product_name VARCHAR(200) NOT NULL,
                quantity INTEGER DEFAULT 1,
                delivery_slot VARCHAR(50) DEFAULT '6:00 AM - 7:00 AM',
                status VARCHAR(50) DEFAULT 'pending',
                delivered_at TIMESTAMP,
                failed_reason TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_sub_delivery_date UNIQUE (subscription_id, delivery_date)
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_location_history (
                id SERIAL PRIMARY KEY,
                partner_id VARCHAR(50) NOT NULL,
                latitude NUMERIC(10,7) NOT NULL,
                longitude NUMERIC(10,7) NOT NULL,
                speed NUMERIC(6,2) DEFAULT 0,
                heading NUMERIC(6,2) DEFAULT 0,
                accuracy NUMERIC(6,2) DEFAULT 0,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_audit_logs (
                id SERIAL PRIMARY KEY,
                admin_name VARCHAR(150) DEFAULT 'Admin Operations',
                action VARCHAR(100) NOT NULL,
                details TEXT,
                ip_address VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Financial Ledger & Wallet Balances (Integer Minor Units / Paise)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_wallet_balances (
                partner_id VARCHAR(50) PRIMARY KEY REFERENCES delivery_partners(partner_id) ON DELETE CASCADE,
                lifetime_earned_paise BIGINT DEFAULT 0,
                total_settled_paise BIGINT DEFAULT 0,
                available_payable_paise BIGINT DEFAULT 0,
                reserved_withdrawal_paise BIGINT DEFAULT 0,
                pending_settlement_paise BIGINT DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_earning_ledger (
                id VARCHAR(100) PRIMARY KEY,
                partner_id VARCHAR(50) NOT NULL REFERENCES delivery_partners(partner_id) ON DELETE CASCADE,
                entry_type VARCHAR(50) NOT NULL,
                reference_id VARCHAR(100) NOT NULL,
                amount_paise BIGINT NOT NULL,
                description TEXT,
                is_settled BOOLEAN DEFAULT false,
                settlement_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_ledger_partner_settled ON partner_earning_ledger(partner_id, is_settled);
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_withdrawal_requests (
                id VARCHAR(100) PRIMARY KEY,
                request_id VARCHAR(100) UNIQUE NOT NULL,
                partner_id VARCHAR(50) NOT NULL REFERENCES delivery_partners(partner_id) ON DELETE CASCADE,
                amount_paise BIGINT NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                bank_account_id VARCHAR(100),
                notes TEXT,
                reviewer_notes TEXT,
                utr_number VARCHAR(100),
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP,
                settled_at TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_settlements (
                id VARCHAR(100) PRIMARY KEY,
                settlement_id VARCHAR(100) UNIQUE NOT NULL,
                partner_id VARCHAR(50) NOT NULL REFERENCES delivery_partners(partner_id) ON DELETE CASCADE,
                period_start DATE NOT NULL,
                period_end DATE NOT NULL,
                total_orders_count INT DEFAULT 0,
                total_subs_count INT DEFAULT 0,
                gross_amount_paise BIGINT NOT NULL,
                deductions_paise BIGINT DEFAULT 0,
                net_amount_paise BIGINT NOT NULL,
                payment_mode VARCHAR(100) DEFAULT 'Bank Transfer',
                utr_number VARCHAR(100),
                status VARCHAR(50) DEFAULT 'completed',
                settled_by VARCHAR(150),
                settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                notes TEXT
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_bank_accounts (
                id VARCHAR(100) PRIMARY KEY,
                partner_id VARCHAR(50) NOT NULL REFERENCES delivery_partners(partner_id) ON DELETE CASCADE,
                account_holder_name VARCHAR(150) NOT NULL,
                account_number VARCHAR(50) NOT NULL,
                ifsc_code VARCHAR(20) NOT NULL,
                bank_name VARCHAR(150) DEFAULT 'Bank',
                branch_name VARCHAR(150),
                passbook_url TEXT,
                is_verified BOOLEAN DEFAULT false,
                is_primary BOOLEAN DEFAULT true,
                verified_at TIMESTAMP,
                verified_by VARCHAR(150),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_kyc_history (
                id SERIAL PRIMARY KEY,
                partner_id VARCHAR(50) NOT NULL,
                status VARCHAR(50) NOT NULL,
                rejection_reason TEXT,
                notes TEXT,
                changed_by VARCHAR(150),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS financial_audit_logs (
                id SERIAL PRIMARY KEY,
                action VARCHAR(100) NOT NULL,
                partner_id VARCHAR(50) NOT NULL,
                admin_name VARCHAR(150) DEFAULT 'System',
                amount_paise BIGINT DEFAULT 0,
                before_balance_paise BIGINT DEFAULT 0,
                after_balance_paise BIGINT DEFAULT 0,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS distribution_hubs (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(150) NOT NULL,
                address TEXT NOT NULL,
                city VARCHAR(100) DEFAULT 'Chennai',
                state VARCHAR(100) DEFAULT 'Tamil Nadu',
                pincode VARCHAR(20) NOT NULL,
                latitude NUMERIC(10,7) NOT NULL,
                longitude NUMERIC(10,7) NOT NULL,
                contact_phone VARCHAR(30),
                is_active BOOLEAN DEFAULT true,
                serviceable_radius_km INT DEFAULT 15,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS api_idempotency_keys (
                key VARCHAR(255) PRIMARY KEY,
                response_code INT NOT NULL,
                response_body TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Ensure delivery_partners table exists without injecting fake mock data
        console.log("[+] Database tables ready");
    } catch (error) {
        console.error("[DATABASE ERROR]", error.message);
    }
}

module.exports = {
    pool,
    initializeDatabase
};
