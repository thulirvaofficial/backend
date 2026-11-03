const express = require("express");
const { pool } = require("../config/database");

const router = express.Router();

let MOCK_LOCATIONS = [
    { id: 1, name: "Oragadam", pincode: "603109", status: "active" },
    { id: 2, name: "Padapai", pincode: "601301", status: "active" },
    { id: 3, name: "Sriperumbudur", pincode: "602105", status: "active" },
    { id: 4, name: "Valasaravakkam", pincode: "600087", status: "active" },
    { id: 5, name: "Porur", pincode: "600116", status: "active" },
    { id: 6, name: "Virugambakkam", pincode: "600092", status: "active" },
    { id: 7, name: "Vadapalani", pincode: "600026", status: "active" },
    { id: 8, name: "Koyambedu", pincode: "600107", status: "active" },
    { id: 9, name: "KK Nagar", pincode: "600078", status: "active" },
    { id: 10, name: "Alapakkam", pincode: "600116", status: "active" },
    { id: 11, name: "Maduravoyal", pincode: "600095", status: "active" }
];

/* GET ALL DELIVERY LOCATIONS */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM delivery_locations ORDER BY name ASC"
        );
        if (result.rows && result.rows.length > 0) {
            return res.json({ success: true, locations: result.rows });
        }
        res.json({ success: true, locations: MOCK_LOCATIONS });
    } catch {
        res.json({ success: true, locations: MOCK_LOCATIONS });
    }
});

/* ADD NEW DELIVERY LOCATION (Admin) */
router.post("/", async (req, res) => {
    const { name, pincode, status } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: "Location name is required." });
    }

    const cleanName = name.trim();
    const cleanPin = (pincode || "").trim();
    const cleanStatus = status || "active";

    try {
        const result = await pool.query(
            "INSERT INTO delivery_locations (name, pincode, status) VALUES ($1,$2,$3) RETURNING *",
            [cleanName, cleanPin, cleanStatus]
        );
        const loc = result.rows[0];
        MOCK_LOCATIONS.push(loc);
        return res.json({ success: true, location: loc, message: "Delivery location added successfully" });
    } catch {
        const newId = MOCK_LOCATIONS.length ? Math.max(...MOCK_LOCATIONS.map(l => l.id)) + 1 : 1;
        const newLoc = { id: newId, name: cleanName, pincode: cleanPin, status: cleanStatus };
        MOCK_LOCATIONS.push(newLoc);
        res.json({ success: true, location: newLoc, message: "Delivery location added successfully" });
    }
});

/* UPDATE DELIVERY LOCATION (Admin) */
router.put("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const { name, pincode, status } = req.body;

    try {
        await pool.query(
            "UPDATE delivery_locations SET name=COALESCE($1, name), pincode=COALESCE($2, pincode), status=COALESCE($3, status) WHERE id=$4",
            [name, pincode, status, id]
        );
    } catch {}

    const loc = MOCK_LOCATIONS.find(l => l.id === id);
    if (loc) {
        if (name) loc.name = name;
        if (pincode !== undefined) loc.pincode = pincode;
        if (status) loc.status = status;
    }

    res.json({ success: true, message: "Delivery location updated" });
});

/* DELETE DELIVERY LOCATION (Admin) */
router.delete("/:id", async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        await pool.query("DELETE FROM delivery_locations WHERE id=$1", [id]);
    } catch {}

    MOCK_LOCATIONS = MOCK_LOCATIONS.filter(l => l.id !== id);
    res.json({ success: true, message: "Delivery location deleted" });
});

module.exports = router;
