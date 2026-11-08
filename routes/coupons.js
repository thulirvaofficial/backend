const express = require("express");
const { pool } = require("../config/database");
const { sendNotification } = require("../services/notificationService");

const router = express.Router();

let MOCK_COUPONS = [
    {
        id: 1,
        code: "THULIRVA10",
        discount_type: "percent",
        discount_value: 10,
        min_order: 0,
        max_discount: 200,
        description: "10% OFF on all fresh farm products & subscriptions",
        headline: "Farm 10% Welcome Offer",
        expiry_date: "2027-12-31",
        usage_limit: 1000,
        usage_count: 34,
        status: "active"
    },
    {
        id: 2,
        code: "FARM50",
        discount_type: "flat",
        discount_value: 50,
        min_order: 499,
        max_discount: 50,
        description: "₹50 flat discount on orders above ₹499",
        headline: "Flat ₹50 Savings",
        expiry_date: "2027-12-31",
        usage_limit: 500,
        usage_count: 18,
        status: "active"
    },
    {
        id: 3,
        code: "FARM10",
        discount_type: "percent",
        discount_value: 10,
        min_order: 0,
        max_discount: 150,
        description: "10% Farm discount on dairy essentials",
        headline: "Pure Farm 10% Off",
        expiry_date: "2027-12-31",
        usage_limit: 1000,
        usage_count: 52,
        status: "active"
    },
    {
        id: 4,
        code: "THULIRVA50",
        discount_type: "flat",
        discount_value: 50,
        min_order: 299,
        max_discount: 50,
        description: "Flat ₹50 OFF on fresh doorstep orders above ₹299",
        headline: "Flat ₹50 Special",
        expiry_date: "2027-12-31",
        usage_limit: 500,
        usage_count: 41,
        status: "active"
    },
    {
        id: 5,
        code: "FREESHIP",
        discount_type: "flat",
        discount_value: 30,
        min_order: 250,
        max_discount: 30,
        description: "Free doorstep delivery on farm orders",
        headline: "Free Home Delivery",
        expiry_date: "2027-12-31",
        usage_limit: 500,
        usage_count: 67,
        status: "active"
    },
    {
        id: 6,
        code: "WELCOME10",
        discount_type: "percent",
        discount_value: 10,
        min_order: 0,
        max_discount: 150,
        description: "Welcome offer: 10% OFF for all registered families",
        headline: "Welcome Family Discount",
        expiry_date: "2027-12-31",
        usage_limit: 1000,
        usage_count: 85,
        status: "active"
    }
];

/* GET ACTIVE COUPONS (Public for cart & website) */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM coupons WHERE status = 'active' ORDER BY id ASC"
        );
        if (result.rows.length) {
            return res.json({ success: true, coupons: result.rows });
        }
    } catch {}

    const activeCoupons = MOCK_COUPONS.filter(c => c.status === "active");
    res.json({
        success: true,
        coupons: activeCoupons
    });
});

/* GET ALL COUPONS (Admin view) */
router.get("/admin", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM coupons ORDER BY id ASC");
        if (result.rows.length) {
            return res.json({ success: true, coupons: result.rows });
        }
    } catch {}

    res.json({
        success: true,
        coupons: MOCK_COUPONS
    });
});

/* VALIDATE & APPLY COUPON */
router.post("/validate", async (req, res) => {
    const { code, total, order_amount, amount } = req.body;
    if (!code || typeof code !== 'string') {
        return res.status(400).json({
            success: false,
            valid: false,
            message: "Please enter a valid coupon code"
        });
    }

    const cleanCode = code.trim().toUpperCase();
    let coupon = null;

    // Check DB
    try {
        const result = await pool.query(
            "SELECT * FROM coupons WHERE UPPER(code) = $1 AND status = 'active' LIMIT 1",
            [cleanCode]
        );
        if (result.rows.length) {
            coupon = result.rows[0];
        }
    } catch {}

    if (!coupon) {
        coupon = MOCK_COUPONS.find(c => c.code.toUpperCase() === cleanCode && c.status === "active");
    }

    if (!coupon) {
        return res.status(404).json({
            success: false,
            valid: false,
            message: `Coupon code "${cleanCode}" is invalid or expired`
        });
    }

    // 1. Expiry Check
    if (coupon.expiry_date) {
        const exp = new Date(coupon.expiry_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (exp < today) {
            return res.status(400).json({
                success: false,
                valid: false,
                message: `Coupon "${coupon.code}" has expired on ${coupon.expiry_date}`
            });
        }
    }

    // 2. Usage Limit Check
    if (coupon.usage_limit && Number(coupon.usage_count) >= Number(coupon.usage_limit)) {
        return res.status(400).json({
            success: false,
            valid: false,
            message: `Coupon "${coupon.code}" usage limit has been reached.`
        });
    }

    // 3. Minimum Order Check
    const numericTotal = Number(total !== undefined ? total : (order_amount !== undefined ? order_amount : (amount !== undefined ? amount : 0))) || 0;
    const minOrd = Number(coupon.min_order || 0);
    if (minOrd > 0 && numericTotal < minOrd) {
        return res.status(400).json({
            success: false,
            valid: false,
            message: `Minimum order amount of ₹${minOrd} is required to apply "${coupon.code}"`
        });
    }

    // 4. Calculate Discount
    let discount = 0;
    const dVal = Number(coupon.discount_value || 0);
    const maxD = Number(coupon.max_discount || 0);

    if (coupon.discount_type === "percent") {
        discount = Math.round((numericTotal * dVal) / 100);
        if (maxD > 0 && discount > maxD) {
            discount = maxD;
        }
    } else {
        discount = dVal;
    }

    if (discount > numericTotal) {
        discount = numericTotal;
    }

    const newTotal = Math.max(0, numericTotal - discount);

    res.json({
        success: true,
        valid: true,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        discount: discount,
        original_total: numericTotal,
        new_total: newTotal,
        message: `✓ Coupon ${coupon.code} applied! Saved ₹${discount}.`
    });
});

/* CREATE NEW COUPON */
router.post("/", async (req, res) => {
    const { code, discount_type, discount_value, min_order, max_discount, description, headline, expiry_date, usage_limit } = req.body;
    if (!code || discount_value === undefined) {
        return res.status(400).json({ success: false, message: "Coupon code and discount value are required" });
    }

    const cleanCode = code.trim().toUpperCase();

    try {
        const result = await pool.query(
            `INSERT INTO coupons (code, discount_type, discount_value, min_order, max_discount, description, headline, expiry_date, usage_limit, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
             RETURNING *`,
            [cleanCode, discount_type || 'percent', Number(discount_value), Number(min_order || 0), Number(max_discount || 200), description || '', headline || '', expiry_date || '2027-12-31', Number(usage_limit || 1000)]
        );
        const createdCoupon = result.rows[0];
        sendNotification({
            title: `Special Offer: Use Code ${cleanCode} 🎁`,
            message: headline || description || `Special Offer! Enjoy ${cleanCode} on your pure dairy farm orders.`,
            type: "coupon",
            targetId: cleanCode,
            forAdmin: false
        }).catch(() => {});
        return res.json({ success: true, coupon: createdCoupon });
    } catch (err) {
        const newCoupon = {
            id: MOCK_COUPONS.length + 1,
            code: cleanCode,
            discount_type: discount_type || 'percent',
            discount_value: Number(discount_value),
            min_order: Number(min_order || 0),
            max_discount: Number(max_discount || 200),
            description: description || '',
            headline: headline || '',
            expiry_date: expiry_date || '2027-12-31',
            usage_limit: Number(usage_limit || 1000),
            usage_count: 0,
            status: 'active'
        };
        MOCK_COUPONS.push(newCoupon);
        sendNotification({
            title: `Special Offer: Use Code ${cleanCode} 🎁`,
            message: headline || description || `Special Offer! Enjoy ${cleanCode} on your pure dairy farm orders.`,
            type: "coupon",
            targetId: cleanCode,
            forAdmin: false
        }).catch(() => {});
        return res.json({ success: true, coupon: newCoupon });
    }
});

/* DELETE COUPON */
router.delete("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query("DELETE FROM coupons WHERE id = $1", [id]);
    } catch {
        MOCK_COUPONS = MOCK_COUPONS.filter(c => c.id !== id);
    }
    res.json({ success: true, message: "Coupon removed" });
});

module.exports = router;
