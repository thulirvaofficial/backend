const express = require("express");
const { pool } = require("../config/database");

const router = express.Router();

let MOCK_COUPONS = [
    {
        id: 1,
        code: "FARM10",
        discount_type: "percent",
        discount_value: 10,
        min_order: 0,
        max_discount: 200,
        description: "10% OFF on all fresh farm products & subscriptions",
        headline: "Pure Farm 10% Discount",
        expiry_date: "2027-12-31",
        status: "active",
        usage_count: 34
    },
    {
        id: 2,
        code: "THULIRVA50",
        discount_type: "flat",
        discount_value: 50,
        min_order: 299,
        max_discount: 50,
        description: "Flat ₹50 OFF on fresh doorstep orders above ₹299",
        headline: "Flat ₹50 Savings",
        expiry_date: "2027-12-31",
        status: "active",
        usage_count: 18
    },
    {
        id: 3,
        code: "PUREMILK",
        discount_type: "flat",
        discount_value: 100,
        min_order: 999,
        max_discount: 100,
        description: "Flat ₹100 OFF on Monthly Milk Subscriptions",
        headline: "Monthly Milk ₹100 Special",
        expiry_date: "2027-12-31",
        status: "active",
        usage_count: 27
    },
    {
        id: 4,
        code: "SUPER20",
        discount_type: "percent",
        discount_value: 20,
        min_order: 500,
        max_discount: 300,
        description: "Super 20% OFF on organic oils, ghee & milk",
        headline: "Mega 20% Farm Deal",
        expiry_date: "2027-12-31",
        status: "active",
        usage_count: 12
    },
    {
        id: 5,
        code: "WELCOME10",
        discount_type: "percent",
        discount_value: 10,
        min_order: 0,
        max_discount: 150,
        description: "Welcome offer: 10% OFF for all registered families",
        headline: "Welcome 10% OFF",
        expiry_date: "2027-12-31",
        status: "active",
        usage_count: 42
    }
];

/* GET ACTIVE COUPONS (Public for offer banner & website) */
router.get("/", (req, res) => {
    const activeCoupons = MOCK_COUPONS.filter(c => c.status === "active");
    res.json({
        success: true,
        coupons: activeCoupons
    });
});

/* GET ALL COUPONS (Admin view) */
router.get("/admin", (req, res) => {
    res.json({
        success: true,
        coupons: MOCK_COUPONS
    });
});

/* VALIDATE & APPLY COUPON */
router.post("/validate", (req, res) => {
    const { code, total, order_amount, amount } = req.body;
    if (!code) {
        return res.status(400).json({
            success: false,
            valid: false,
            message: "Please enter a promo code"
        });
    }

    const cleanCode = code.trim().toUpperCase();
    const coupon = MOCK_COUPONS.find(c => c.code.toUpperCase() === cleanCode && c.status === "active");

    if (!coupon) {
        return res.status(404).json({
            success: false,
            valid: false,
            message: `Promo code "${cleanCode}" is invalid or expired`
        });
    }

    const numericTotal = Number(total !== undefined ? total : (order_amount !== undefined ? order_amount : (amount !== undefined ? amount : 0))) || 0;
    if (coupon.min_order && numericTotal < coupon.min_order) {
        return res.status(400).json({
            success: false,
            valid: false,
            message: `Minimum order of ₹${coupon.min_order} required for coupon ${coupon.code}`
        });
    }

    let discount = 0;
    if (coupon.discount_type === "percent") {
        discount = Math.round((numericTotal * coupon.discount_value) / 100);
        if (coupon.max_discount && discount > coupon.max_discount) {
            discount = coupon.max_discount;
        }
    } else {
        discount = Number(coupon.discount_value) || 0;
    }

    if (discount > numericTotal) {
        discount = numericTotal;
    }

    const newTotal = Math.max(0, numericTotal - discount);
    coupon.usage_count = (coupon.usage_count || 0) + 1;

    res.json({
        success: true,
        valid: true,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        discount: discount,
        original_total: numericTotal,
        new_total: newTotal,
        message: `✓ Promo code ${coupon.code} applied! You saved ₹${discount}.`
    });
});

/* CREATE NEW COUPON */
router.post("/", (req, res) => {
    const { code, discount_type, discount_value, min_order, max_discount, description, headline, expiry_date, status } = req.body;
    if (!code || !discount_value) {
        return res.status(400).json({ success: false, message: "Code and discount value are required" });
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = MOCK_COUPONS.find(c => c.code.toUpperCase() === cleanCode);
    if (existing) {
        return res.status(400).json({ success: false, message: `Promo code "${cleanCode}" already exists` });
    }

    const newCoupon = {
        id: Date.now(),
        code: cleanCode,
        discount_type: discount_type === "flat" ? "flat" : "percent",
        discount_value: Number(discount_value),
        min_order: Number(min_order) || 0,
        max_discount: max_discount ? Number(max_discount) : null,
        description: description || `${cleanCode} special discount`,
        headline: headline || `${cleanCode} Promo Offer`,
        expiry_date: expiry_date || "2027-12-31",
        status: status || "active",
        usage_count: 0
    };

    MOCK_COUPONS.unshift(newCoupon);
    res.json({
        success: true,
        coupon: newCoupon,
        message: `Promo code ${cleanCode} created successfully`
    });
});

/* UPDATE COUPON */
router.put("/:id", (req, res) => {
    const id = req.params.id;
    const idx = MOCK_COUPONS.findIndex(c => String(c.id) === String(id));
    if (idx === -1) {
        return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    const { code, discount_type, discount_value, min_order, max_discount, description, headline, expiry_date, status } = req.body;
    MOCK_COUPONS[idx] = {
        ...MOCK_COUPONS[idx],
        code: code ? code.trim().toUpperCase() : MOCK_COUPONS[idx].code,
        discount_type: discount_type || MOCK_COUPONS[idx].discount_type,
        discount_value: discount_value !== undefined ? Number(discount_value) : MOCK_COUPONS[idx].discount_value,
        min_order: min_order !== undefined ? Number(min_order) : MOCK_COUPONS[idx].min_order,
        max_discount: max_discount !== undefined ? (max_discount ? Number(max_discount) : null) : MOCK_COUPONS[idx].max_discount,
        description: description !== undefined ? description : MOCK_COUPONS[idx].description,
        headline: headline !== undefined ? headline : MOCK_COUPONS[idx].headline,
        expiry_date: expiry_date !== undefined ? expiry_date : MOCK_COUPONS[idx].expiry_date,
        status: status !== undefined ? status : MOCK_COUPONS[idx].status
    };

    res.json({
        success: true,
        coupon: MOCK_COUPONS[idx],
        message: `Coupon updated successfully`
    });
});

/* DELETE COUPON */
router.delete("/:id", (req, res) => {
    const id = req.params.id;
    MOCK_COUPONS = MOCK_COUPONS.filter(c => String(c.id) !== String(id));
    res.json({
        success: true,
        message: "Promo code deleted successfully"
    });
});

module.exports = router;

