const { pool } = require('./config/database');

async function checkColumns() {
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'delivery_partners'");
        console.log("delivery_partners columns count:", res.rows.length);
        console.log("delivery_partners columns:", res.rows.map(r => r.column_name));
        const hasPhoto = res.rows.some(r => r.column_name === 'profile_photo');
        console.log("Has profile_photo column:", hasPhoto);
        if (!hasPhoto) {
            console.log("Adding profile_photo column...");
            await pool.query("ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS profile_photo TEXT;");
            console.log("Added profile_photo column successfully.");
        }
    } catch (e) {
        console.error("DB check error:", e);
    } finally {
        try { await pool.end(); } catch(_) {}
    }
}

checkColumns();
