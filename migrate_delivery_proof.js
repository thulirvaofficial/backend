const { pool } = require('./config/database');

async function run() {
    console.log("Running delivery proof PostgreSQL migration...");
    const queries = [
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
        "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS profile_photo TEXT",
        "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(100)",
        "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(100)",
        "ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS assigned_area VARCHAR(100)",
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

    for (const sql of queries) {
        try {
            await pool.query(sql);
        } catch (e) {
            console.warn("SQL Warn:", e.message);
        }
    }
    console.log("✓ Delivery proof PostgreSQL migration completed successfully!");
    process.exit(0);
}

run();

