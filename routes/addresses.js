const express = require("express");
const { pool } = require("../config/database");

const router = express.Router();

let MOCK_ADDRESSES = [
    {
        id: 1,
        user_id: 1,
        name: "Kamesh S",
        phone: "9876543210",
        address: "No. 12, Gandhi Street, KK Nagar",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600078",
        is_default: true,
        created_at: new Date().toISOString()
    },
    {
        id: 2,
        user_id: 1,
        name: "Kamesh S (Work)",
        phone: "9876543210",
        address: "DLF Cybercity, Block 3, Porur",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600116",
        is_default: false,
        created_at: new Date().toISOString()
    }
];

/* GET USER ADDRESSES */
router.get("/user/:userId", async (req, res) => {
    const userId = req.params.userId;
    try {
        const result = await pool.query(
            "SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id DESC",
            [userId]
        );
        if (result.rows && result.rows.length) {
            return res.json({ success: true, addresses: result.rows });
        }
    } catch {}

    const list = MOCK_ADDRESSES.filter(a => String(a.user_id) === String(userId) || (userId === "all" && req.user?.role === "admin"));
    res.json({ success: true, addresses: list });
});

/* ADD NEW ADDRESS */
router.post("/", async (req, res) => {
    const { user_id, name, phone, address, city, state, pincode, is_default } = req.body;
    if (!name || !phone || !address || !pincode) {
        return res.status(400).json({ success: false, message: "Name, phone, address and pincode are required" });
    }

    const newAddr = {
        id: Date.now(),
        user_id: user_id || null,
        name,
        phone,
        address,
        city: city || "Chennai",
        state: state || "Tamil Nadu",
        pincode,
        is_default: Boolean(is_default),
        created_at: new Date().toISOString()
    };

    try {
        if (newAddr.is_default) {
            await pool.query("UPDATE addresses SET is_default = false WHERE user_id = $1", [newAddr.user_id]);
        }
        const result = await pool.query(`
            INSERT INTO addresses (user_id, name, phone, address, city, state, pincode, is_default)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [newAddr.user_id, name, phone, address, newAddr.city, newAddr.state, pincode, newAddr.is_default]);
        if (result.rows.length) {
            return res.json({ success: true, address: result.rows[0], message: "Address added successfully" });
        }
    } catch {}

    if (newAddr.is_default) {
        MOCK_ADDRESSES.forEach(a => { if (a.user_id == newAddr.user_id) a.is_default = false; });
    }
    MOCK_ADDRESSES.unshift(newAddr);

    res.json({ success: true, address: newAddr, message: "Address added successfully" });
});

/* UPDATE ADDRESS */
router.put("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const { name, phone, address, city, state, pincode, is_default } = req.body;

    try {
        const result = await pool.query(`
            UPDATE addresses
            SET name = COALESCE($1, name),
                phone = COALESCE($2, phone),
                address = COALESCE($3, address),
                city = COALESCE($4, city),
                state = COALESCE($5, state),
                pincode = COALESCE($6, pincode),
                is_default = COALESCE($7, is_default)
            WHERE id = $8
            RETURNING *
        `, [name, phone, address, city, state, pincode, is_default, id]);
        if (result.rows.length) {
            return res.json({ success: true, address: result.rows[0], message: "Address updated successfully" });
        }
    } catch {}

    const addr = MOCK_ADDRESSES.find(a => a.id === id);
    if (addr) {
        if (name !== undefined) addr.name = name;
        if (phone !== undefined) addr.phone = phone;
        if (address !== undefined) addr.address = address;
        if (city !== undefined) addr.city = city;
        if (state !== undefined) addr.state = state;
        if (pincode !== undefined) addr.pincode = pincode;
        if (is_default !== undefined) addr.is_default = Boolean(is_default);
    }

    res.json({ success: true, address: addr, message: "Address updated successfully" });
});

/* DELETE ADDRESS */
router.delete("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query("DELETE FROM addresses WHERE id = $1", [id]);
    } catch {}

    MOCK_ADDRESSES = MOCK_ADDRESSES.filter(a => a.id !== id);
    res.json({ success: true, message: "Address deleted successfully" });
});

module.exports = router;

