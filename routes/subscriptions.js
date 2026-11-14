const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");
const { notifySubscriptionActivated, notifySubscriptionRenewed, notifyAdminNewOrder, sendSubscriptionNotification, sendNotification, sendPaymentNotification } = require("../services/notificationService");

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
                const fileName = `proof_sub_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
                const filePath = path.join(uploadsDir, fileName);
                fs.writeFileSync(filePath, buffer);
                return `/assets/images/uploads/${fileName}`;
            }
        } catch (err) {
            // Keep base64 data string if filesystem write not permitted
        }
    }
    return image;
}

// Default Seed Subscription Plans (Available Packages for purchase)
let MOCK_PLANS = [
    {
        id: 1,
        product_id: 1,
        product_name: "Fresh Cow Milk (500ml)",
        product_image: "/assets/images/products/fresh_cow_milk.jpg",
        time_period: "Daily Morning (30 Days)",
        frequency: "Daily",
        duration_days: 30,
        price: 1320,
        original_price: 1500,
        discount_percent: 12,
        description: "Pure farm fresh cow milk delivered to your doorstep every morning before 7:00 AM. 100% natural, unadulterated.",
        badge: "Most Popular",
        status: "active"
    },
    {
        id: 2,
        product_id: 5,
        product_name: "Fresh Cow Milk (1 Litre)",
        product_image: "/assets/images/products/fresh_cow_milk.jpg",
        time_period: "Daily Morning (30 Days)",
        frequency: "Daily",
        duration_days: 30,
        price: 2460,
        original_price: 2700,
        discount_percent: 9,
        description: "1 Litre family pack chilled cow milk delivered every single morning. Glass-bottle hygiene guaranteed.",
        badge: "Family Pack",
        status: "active"
    },
    {
        id: 3,
        product_id: 1,
        product_name: "Fresh Cow Milk (500ml)",
        product_image: "/assets/images/products/fresh_cow_milk.jpg",
        time_period: "Alternate Days (15 Days)",
        frequency: "Alternate",
        duration_days: 30,
        price: 660,
        original_price: 750,
        discount_percent: 12,
        description: "Delivered every alternate day. Perfect for light households or couples wanting regular fresh milk.",
        badge: "Flexible Plan",
        status: "active"
    },
    {
        id: 4,
        product_id: 3,
        product_name: "Fresh Artisanal Paneer (200g)",
        product_image: "/assets/images/products/fresh_paneer.jpg",
        time_period: "Twice a Week (8 Deliveries)",
        frequency: "Twice Weekly",
        duration_days: 30,
        price: 656,
        original_price: 760,
        discount_percent: 14,
        description: "Ultra-soft chemical-free cottage cheese delivered every Wednesday and Saturday morning.",
        badge: "Fresh Batch",
        status: "active"
    },
    {
        id: 5,
        product_id: 2,
        product_name: "Pure Bilona Cow Ghee (500ml)",
        product_image: "/assets/images/products/pure_cow_ghee.jpg",
        time_period: "Monthly Delivery (1 Jar/Month)",
        frequency: "Monthly",
        duration_days: 30,
        price: 499,
        original_price: 600,
        discount_percent: 17,
        description: "A fresh 500ml jar of fragrant Bilona churned golden ghee dispatched automatically on the 1st of every month.",
        badge: "Pure Bilona",
        status: "active"
    },
    {
        id: 6,
        product_id: 4,
        product_name: "Natural Thick Set Curd (500g)",
        product_image: "/assets/images/products/product_lineup.jpg",
        time_period: "Daily Morning (30 Days)",
        frequency: "Daily",
        duration_days: 30,
        price: 1440,
        original_price: 1650,
        discount_percent: 13,
        description: "Probiotic rich, smooth thick curd prepared every night and delivered fresh with morning milk.",
        badge: "Probiotic",
        status: "active"
    }
];

// Real-time Customer Subscriptions with disk persistence
const DATA_DIR = path.resolve(__dirname, "..", "data");
const SUBS_FILE = path.join(DATA_DIR, "subscriptions.json");

function loadSubscriptionsFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(SUBS_FILE)) {
            const data = fs.readFileSync(SUBS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.warn("[SUBSCRIPTIONS DISK LOAD WARN]:", e.message);
    }
    return [];
}

function saveSubscriptionsToDisk(subs) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), "utf-8");
    } catch (e) {
        console.warn("[SUBSCRIPTIONS DISK SAVE WARN]:", e.message);
    }
}

let MOCK_SUBSCRIPTIONS = loadSubscriptionsFromDisk();
router.getSubscriptions = () => MOCK_SUBSCRIPTIONS;

function generateSubscriptionId() {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `SUB-${dateStr}-${randomSuffix}`;
}

/* ============================================================
   1. SUBSCRIPTION PLANS (CATALOG)
============================================================ */

/* GET ALL PLANS */
router.get("/plans", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM subscription_plans ORDER BY id ASC"
        );
        if (result.rows.length > 0) {
            return res.json({ success: true, plans: result.rows });
        }
        res.json({ success: true, plans: MOCK_PLANS });
    } catch {
        res.json({ success: true, plans: MOCK_PLANS });
    }
});

/* GET SINGLE PLAN */
router.get("/plans/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const result = await pool.query("SELECT * FROM subscription_plans WHERE id=$1", [id]);
        if (result.rows.length > 0) {
            return res.json({ success: true, plan: result.rows[0] });
        }
        const plan = MOCK_PLANS.find(p => p.id === id) || MOCK_PLANS[0];
        res.json({ success: true, plan });
    } catch {
        const plan = MOCK_PLANS.find(p => p.id === id) || MOCK_PLANS[0];
        res.json({ success: true, plan });
    }
});

/* CREATE PLAN (Admin) */
router.post("/plans", async (req, res) => {
    try {
        const {
            product_id,
            product_name,
            product_image,
            time_period,
            frequency,
            duration_days,
            price,
            original_price,
            discount_percent,
            description,
            badge,
            status
        } = req.body;

        if (!product_name || !time_period || !price) {
            return res.status(400).json({ success: false, message: "Product name, time period, and price are required." });
        }

        const savedImage = saveBase64Image(product_image) || "/assets/images/products/fresh_cow_milk.jpg";

        try {
            const result = await pool.query(`
                INSERT INTO subscription_plans (
                    product_id, product_name, product_image, time_period,
                    frequency, duration_days, price, original_price,
                    discount_percent, description, badge, status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                RETURNING *
            `, [
                product_id || null,
                product_name,
                savedImage,
                time_period,
                frequency || "Daily",
                duration_days || 30,
                Number(price) || 0,
                original_price ? Number(original_price) : null,
                discount_percent ? Number(discount_percent) : 0,
                description || "",
                badge || "Popular",
                status || "active"
            ]);
            return res.json({ success: true, plan: result.rows[0], message: "Subscription plan created successfully" });
        } catch {
            const newId = MOCK_PLANS.length ? Math.max(...MOCK_PLANS.map(p => p.id)) + 1 : 1;
            const newPlan = {
                id: newId,
                product_id: product_id || null,
                product_name,
                product_image: savedImage,
                time_period,
                frequency: frequency || "Daily",
                duration_days: duration_days || 30,
                price: Number(price) || 0,
                original_price: original_price ? Number(original_price) : null,
                discount_percent: discount_percent ? Number(discount_percent) : 0,
                description: description || "",
                badge: badge || "Popular",
                status: status || "active"
            };
            MOCK_PLANS.unshift(newPlan);
            return res.json({ success: true, plan: newPlan, message: "Subscription plan created successfully" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* UPDATE PLAN (Admin) */
router.put("/plans/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const {
            product_id,
            product_name,
            product_image,
            time_period,
            frequency,
            duration_days,
            price,
            original_price,
            discount_percent,
            description,
            badge,
            status
        } = req.body;

        const savedImage = saveBase64Image(product_image);

        try {
            const result = await pool.query(`
                UPDATE subscription_plans
                SET product_id = COALESCE($1, product_id),
                    product_name = COALESCE($2, product_name),
                    product_image = COALESCE($3, product_image),
                    time_period = COALESCE($4, time_period),
                    frequency = COALESCE($5, frequency),
                    duration_days = COALESCE($6, duration_days),
                    price = COALESCE($7, price),
                    original_price = COALESCE($8, original_price),
                    discount_percent = COALESCE($9, discount_percent),
                    description = COALESCE($10, description),
                    badge = COALESCE($11, badge),
                    status = COALESCE($12, status)
                WHERE id = $13
                RETURNING *
            `, [
                product_id,
                product_name,
                savedImage,
                time_period,
                frequency,
                duration_days,
                price !== undefined ? Number(price) : undefined,
                original_price !== undefined ? Number(original_price) : undefined,
                discount_percent !== undefined ? Number(discount_percent) : undefined,
                description,
                badge,
                status,
                id
            ]);
            if (result.rows.length > 0) {
                return res.json({ success: true, plan: result.rows[0], message: "Plan updated successfully" });
            }
        } catch {
            // fallback
        }

        const idx = MOCK_PLANS.findIndex(p => p.id === id);
        if (idx !== -1) {
            MOCK_PLANS[idx] = {
                ...MOCK_PLANS[idx],
                product_id: product_id !== undefined ? product_id : MOCK_PLANS[idx].product_id,
                product_name: product_name !== undefined ? product_name : MOCK_PLANS[idx].product_name,
                product_image: savedImage !== undefined ? savedImage : MOCK_PLANS[idx].product_image,
                time_period: time_period !== undefined ? time_period : MOCK_PLANS[idx].time_period,
                frequency: frequency !== undefined ? frequency : MOCK_PLANS[idx].frequency,
                duration_days: duration_days !== undefined ? duration_days : MOCK_PLANS[idx].duration_days,
                price: price !== undefined ? Number(price) : MOCK_PLANS[idx].price,
                original_price: original_price !== undefined ? Number(original_price) : MOCK_PLANS[idx].original_price,
                discount_percent: discount_percent !== undefined ? Number(discount_percent) : MOCK_PLANS[idx].discount_percent,
                description: description !== undefined ? description : MOCK_PLANS[idx].description,
                badge: badge !== undefined ? badge : MOCK_PLANS[idx].badge,
                status: status !== undefined ? status : MOCK_PLANS[idx].status
            };
            return res.json({ success: true, plan: MOCK_PLANS[idx], message: "Plan updated successfully" });
        }

        res.json({ success: true, message: "Subscription plan updated" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* DELETE PLAN (Admin) */
router.delete("/plans/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query("DELETE FROM subscription_plans WHERE id=$1", [id]);
    } catch {
        // fallback
    }
    MOCK_PLANS = MOCK_PLANS.filter(p => p.id !== id);
    res.json({ success: true, message: "Subscription plan deleted successfully" });
});


/* ============================================================
   2. CUSTOMER SUBSCRIPTIONS (ACTIVE SUBSCRIBERS)
============================================================ */

/* GET ALL SUBSCRIPTIONS (Admin API) */
const getAllSubscriptionsHandler = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM subscriptions ORDER BY created_at DESC"
        );
        const dbRows = result.rows || [];
        const dbIds = new Set(dbRows.map(r => r.id.toString()));
        const memRows = (MOCK_SUBSCRIPTIONS || []).filter(m => !dbIds.has(m.id.toString()));
        return res.json({ success: true, subscriptions: [...dbRows, ...memRows] });
    } catch (err) {
        console.warn("[SUBSCRIPTIONS ADMIN] DB query fallback:", err.message);
        return res.json({ success: true, subscriptions: MOCK_SUBSCRIPTIONS || [] });
    }
};

router.get("/admin/all", getAllSubscriptionsHandler);
router.get("/all", getAllSubscriptionsHandler);
router.get("/", getAllSubscriptionsHandler);

/* ADMIN CREATE / ONBOARD SUBSCRIBER */
router.post("/admin/create", async (req, res) => {
    try {
        const {
            customer_name,
            customer_phone,
            customer_email,
            product_name,
            frequency,
            quantity,
            delivery_slot,
            total_price,
            start_date,
            address,
            city,
            pincode,
            status
        } = req.body;

        if (!customer_name || !customer_phone) {
            return res.status(400).json({ success: false, message: "Customer name and phone are required" });
        }

        const subId = `SUB-${Date.now().toString().slice(-5)}`;
        const newSub = {
            id: subId,
            customer_name,
            customer_phone,
            customer_email: customer_email || "",
            product_name: product_name || "Fresh Cow Milk (1 Litre)",
            time_period: "Daily Morning (30 Days)",
            frequency: frequency || "Daily",
            quantity: parseInt(quantity) || 1,
            delivery_slot: delivery_slot || "6:00 AM - 7:00 AM",
            price_per_delivery: parseFloat(total_price ? (total_price / 30).toFixed(2) : 82),
            total_price: parseFloat(total_price || 2460),
            start_date: start_date || new Date().toISOString().split('T')[0],
            address: address || "Doorstep Address",
            city: city || "Kanchipuram",
            pincode: pincode || "631501",
            payment_method: "Admin Manual Onboarding",
            payment_status: "Verified",
            status: status || "Active",
            transaction_id: `ADMIN-${Date.now().toString().slice(-4)}`,
            created_at: new Date().toISOString()
        };

        try {
            await pool.query(
                `INSERT INTO subscriptions (
                    id, customer_name, customer_phone, customer_email, product_name, time_period,
                    frequency, quantity, delivery_slot, price_per_delivery, total_price,
                    start_date, address, city, pincode, payment_method, payment_status, status,
                    transaction_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
                [
                    newSub.id, newSub.customer_name, newSub.customer_phone, newSub.customer_email,
                    newSub.product_name, newSub.time_period, newSub.frequency, newSub.quantity,
                    newSub.delivery_slot, newSub.price_per_delivery, newSub.total_price,
                    newSub.start_date, newSub.address, newSub.city, newSub.pincode,
                    newSub.payment_method, newSub.payment_status, newSub.status, newSub.transaction_id
                ]
            );
        } catch (_) {}

        MOCK_SUBSCRIPTIONS.unshift(newSub);
        saveSubscriptionsToDisk(MOCK_SUBSCRIPTIONS);
        notifySubscriptionRenewed(newSub).catch(() => {});
        res.json({ success: true, message: "Subscription created successfully", subscription: newSub });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* CORE INTERNAL SUBSCRIPTION CREATOR (Clean separation from Orders) */
async function createSubscriptionInternal(inputData) {
    const user_id = inputData.user_id || inputData.userId || null;
    const customer_name = inputData.customer_name || inputData.customerName || "Valued Customer";
    const customer_phone = inputData.customer_phone || inputData.customerPhone || "";
    const customer_email = inputData.customer_email || inputData.customerEmail || "";
    const product_name = inputData.product_name || inputData.productName || "Fresh Cow Milk (500ml)";
    const time_period = inputData.time_period || inputData.timePeriod || "Daily Morning (30 Days)";
    const total_price = Number(inputData.total_price || inputData.totalPrice || inputData.total) || 1320;
    const transaction_id = inputData.transaction_id || inputData.transactionId || inputData.utr || "";
    const payment_proof = inputData.payment_proof || inputData.paymentProof || inputData.proof || "";

    // =========================================================================
    // DEDUPLICATION & IDEMPOTENCY GUARD (Prevents Double-Click / Duplicate Subs)
    // =========================================================================
    const cleanTx = (transaction_id || "").toString().trim().toLowerCase();
    
    // 1. Transaction ID / UTR Deduplication (If UTR already recorded, return existing subscription)
    if (cleanTx.length > 3) {
        const existingByTx = (MOCK_SUBSCRIPTIONS || []).find(s => 
            ((s.transaction_id || s.transactionId || "").toString().trim().toLowerCase() === cleanTx)
        );
        if (existingByTx) {
            console.log(`[SUBSCRIPTION DEDUP] Blocked duplicate submission for transaction_id '${transaction_id}'. Returning existing subscription: ${existingByTx.id}`);
            return existingByTx;
        }

        try {
            const dbTxCheck = await pool.query(
                "SELECT * FROM subscriptions WHERE LOWER(TRIM(transaction_id)) = $1 LIMIT 1",
                [cleanTx]
            );
            if (dbTxCheck.rows.length > 0) {
                console.log(`[SUBSCRIPTION DEDUP] Found existing DB subscription with transaction_id '${transaction_id}'. Returning ${dbTxCheck.rows[0].id}`);
                return dbTxCheck.rows[0];
            }
        } catch (_) {}
    }

    // 2. Rapid Double-Click Guard (within 60 seconds for same customer & product)
    const now = Date.now();
    const existingRecent = (MOCK_SUBSCRIPTIONS || []).find(s => {
        const sUser = (s.user_id || s.userId || "").toString().trim();
        const sPhone = (s.customer_phone || s.customerPhone || "").toString().replace(/\D/g, "");
        const sEmail = (s.customer_email || s.customerEmail || "").toString().toLowerCase().trim();
        
        const inUser = (user_id || "").toString().trim();
        const inPhone = (customer_phone || "").toString().replace(/\D/g, "");
        const inEmail = (customer_email || "").toString().toLowerCase().trim();

        const isUserMatch = (inUser && sUser && inUser === sUser) ||
                            (inPhone && sPhone && inPhone.length >= 10 && inPhone === sPhone) ||
                            (inEmail && sEmail && inEmail.length > 3 && inEmail === sEmail);

        if (!isUserMatch) return false;

        const isProdMatch = (s.product_name || "").toString().toLowerCase().trim() === product_name.toString().toLowerCase().trim() ||
                            (s.plan_id && inputData.plan_id && s.plan_id.toString() === inputData.plan_id.toString());

        if (!isProdMatch) return false;

        if (s.created_at) {
            const createdMs = new Date(s.created_at).getTime();
            if (!isNaN(createdMs) && (now - createdMs < 60000)) {
                return true;
            }
        }
        return false;
    });

    if (existingRecent) {
        console.log(`[SUBSCRIPTION DEDUP] Blocked rapid duplicate click within 60s for customer '${customer_name}' (${product_name}). Returning existing: ${existingRecent.id}`);
        return existingRecent;
    }

    const duration_days = Number(inputData.duration_days || inputData.durationDays) || (time_period.includes("15") ? 15 : 30);
    const start_date = inputData.start_date || inputData.startDate || new Date().toISOString().split("T")[0];
    const startDateObj = new Date(start_date);
    const expiryDateObj = new Date(startDateObj.getTime() + duration_days * 24 * 60 * 60 * 1000);
    const expiry_date = inputData.expiry_date || inputData.expiryDate || expiryDateObj.toISOString().split("T")[0];

    const savedProof = saveBase64Image(payment_proof);
    const subId = inputData.id && inputData.id.startsWith("SUB-") ? inputData.id : generateSubscriptionId();

    const payment_status = inputData.payment_status || (transaction_id ? "Verification Pending" : "Pending");
    const status = inputData.status || (transaction_id ? "Pending Approval" : "Pending");

    const subData = {
        id: subId,
        user_id: user_id,
        userId: user_id,
        customer_name: customer_name,
        customerName: customer_name,
        customer_phone: customer_phone,
        customerPhone: customer_phone,
        customer_email: customer_email,
        customerEmail: customer_email,
        plan_id: inputData.plan_id || null,
        product_id: inputData.product_id || null,
        product_name: product_name,
        productName: product_name,
        product_image: inputData.product_image || inputData.productImage || "/assets/images/products/fresh_cow_milk.jpg",
        productImage: inputData.product_image || inputData.productImage || "/assets/images/products/fresh_cow_milk.jpg",
        time_period: time_period,
        timePeriod: time_period,
        frequency: inputData.frequency || "Daily",
        duration_days: duration_days,
        durationDays: duration_days,
        quantity: Number(inputData.quantity) || 1,
        delivery_slot: inputData.delivery_slot || inputData.deliverySlot || "6:00 AM - 7:00 AM",
        deliverySlot: inputData.delivery_slot || inputData.deliverySlot || "6:00 AM - 7:00 AM",
        price_per_delivery: Number(inputData.price_per_delivery) || 44,
        total_price: total_price,
        totalPrice: total_price,
        total: total_price,
        start_date: start_date,
        startDate: start_date,
        expiry_date: expiry_date,
        expiryDate: expiry_date,
        address: inputData.address || "Doorstep Address, Kanchipuram",
        city: inputData.city || "Kanchipuram",
        pincode: inputData.pincode || "631601",
        latitude: inputData.latitude || inputData.lat || null,
        longitude: inputData.longitude || inputData.lng || null,
        landmark: inputData.landmark || "",
        delivery_instructions: inputData.delivery_instructions || inputData.instructions || "",
        payment_method: inputData.payment_method || "UPI Direct Payment (7904880944@superyes)",
        payment_status: payment_status,
        paymentStatus: payment_status,
        transaction_id: transaction_id,
        transactionId: transaction_id,
        payment_proof: savedProof || "",
        paymentProof: savedProof || "",
        status: status,
        created_at: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };

    try {
        let validUserId = null;
        if (subData.user_id && !isNaN(Number(subData.user_id))) {
            const uCheck = await pool.query("SELECT id FROM users WHERE id = $1", [Number(subData.user_id)]).catch(() => ({ rows: [] }));
            if (uCheck.rows.length > 0) validUserId = Number(subData.user_id);
        }

        let validPlanId = null;
        if (subData.plan_id && !isNaN(Number(subData.plan_id))) {
            const pCheck = await pool.query("SELECT id FROM subscription_plans WHERE id = $1", [Number(subData.plan_id)]).catch(() => ({ rows: [] }));
            if (pCheck.rows.length > 0) validPlanId = Number(subData.plan_id);
        }

        let validProductId = null;
        if (subData.product_id && !isNaN(Number(subData.product_id))) {
            const prCheck = await pool.query("SELECT id FROM products WHERE id = $1", [Number(subData.product_id)]).catch(() => ({ rows: [] }));
            if (prCheck.rows.length > 0) validProductId = Number(subData.product_id);
        }

        await pool.query(`
            INSERT INTO subscriptions (
                id, user_id, customer_name, customer_phone, customer_email,
                plan_id, product_id, product_name, product_image, time_period,
                frequency, quantity, delivery_slot, price_per_delivery, total_price,
                start_date, expiry_date, duration_days, address, city, pincode,
                payment_method, payment_status, status, transaction_id, payment_proof
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        `, [
            subData.id, validUserId, subData.customer_name, subData.customer_phone, subData.customer_email,
            validPlanId, validProductId, subData.product_name, subData.product_image, subData.time_period,
            subData.frequency, subData.quantity, subData.delivery_slot, subData.price_per_delivery, subData.total_price,
            subData.start_date, subData.expiry_date, subData.duration_days, subData.address, subData.city, subData.pincode,
            subData.payment_method, subData.payment_status, subData.status, subData.transaction_id, subData.payment_proof
        ]);
        console.log(`✓ [SUBSCRIPTION SAVED TO DB] ID: ${subData.id}`);
    } catch (dbErr) {
        console.warn("[SUBSCRIPTION DB INSERT ERROR, trying minimal insert]:", dbErr.message);
        await pool.query(`
            INSERT INTO subscriptions (
                id, customer_name, customer_phone, product_name, frequency,
                quantity, total_price, start_date, address, payment_status, status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [
            subData.id, subData.customer_name, subData.customer_phone, subData.product_name,
            subData.frequency, subData.quantity, subData.total_price, subData.start_date,
            subData.address, subData.payment_status, subData.status
        ]).catch(e => console.error("Minimal subscription insert error:", e.message));
    }

    MOCK_SUBSCRIPTIONS.unshift(subData);
    saveSubscriptionsToDisk(MOCK_SUBSCRIPTIONS);

    notifyAdminNewOrder({
        id: subData.id,
        customer_name: subData.customer_name,
        total: subData.total_price,
        delivery_type: 'subscription'
    }).catch(() => {});

    if (transaction_id || savedProof) {
        sendPaymentNotification({
            orderOrSub: subData,
            status: "verification_required",
            amount: subData.total_price,
            forAdmin: true
        }).catch(() => {});
        sendPaymentNotification({
            orderOrSub: subData,
            status: "pending",
            amount: subData.total_price,
            forAdmin: false
        }).catch(() => {});
    }

    return subData;
}
router.createSubscriptionRecord = createSubscriptionInternal;

/* BUY / CREATE NEW SUBSCRIPTION (Customer / App Checkout) */
router.post("/", async (req, res) => {
    try {
        let authenticatedUserId = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, process.env.JWT_SECRET || "thulirva_secret_key_2026");
                authenticatedUserId = decoded.id;
            } catch (_) {}
        }

        const subData = await createSubscriptionInternal({
            ...req.body,
            user_id: authenticatedUserId || req.body.user_id || req.body.userId || null
        });

        res.json({
            success: true,
            subscription: subData,
            message: "Subscription created successfully! Pending admin approval."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* UPDATE SUBSCRIPTION STATUS (Pause, Resume, Cancel, Payment) */
const updateSubStatusHandler = async (req, res) => {
    const id = req.params.id;
    const { status, payment_status } = req.body;

    if (!status && !payment_status) {
        return res.status(400).json({ success: false, message: "Status or payment_status is required" });
    }

    try {
        if (status && payment_status) {
            await pool.query("UPDATE subscriptions SET status=$1, payment_status=$2 WHERE id=$3", [status, payment_status, id]);
        } else if (status) {
            await pool.query("UPDATE subscriptions SET status=$1 WHERE id=$2", [status, id]);
        } else if (payment_status) {
            await pool.query("UPDATE subscriptions SET payment_status=$1 WHERE id=$2", [payment_status, id]);
        }
    } catch {}

    const sub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (sub) {
        if (status) sub.status = status;
        if (payment_status) sub.payment_status = payment_status;
        if (status) {
            sendSubscriptionNotification({ subscription: sub, event: status.toLowerCase() }).catch(() => {});
        }
    }

    res.json({
        success: true,
        message: `Subscription updated successfully`,
        subscription: sub
    });
};

/* CANCEL SUBSCRIPTION (Admin & Customer) */
const cancelSubHandler = async (req, res) => {
    const id = req.params.id;
    let sub = null;
    try {
        const result = await pool.query("UPDATE subscriptions SET status='Cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *", [id]);
        if (result.rows.length) sub = result.rows[0];
    } catch {}

    const memSub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (memSub) memSub.status = "Cancelled";
    sub = sub || memSub || { id, status: "Cancelled" };

    sendSubscriptionNotification({ subscription: sub, event: "cancelled" }).catch(() => {});

    res.json({
        success: true,
        message: "Subscription cancelled successfully",
        subscription: sub
    });
};

/* PAUSE SUBSCRIPTION (Admin & Customer) */
const pauseSubHandler = async (req, res) => {
    const id = req.params.id;
    let sub = null;
    try {
        const result = await pool.query("UPDATE subscriptions SET status='Paused' WHERE id=$1 RETURNING *", [id]);
        if (result.rows.length) sub = result.rows[0];
    } catch {}

    const memSub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (memSub) memSub.status = "Paused";
    sub = sub || memSub || { id, status: "Paused" };

    sendSubscriptionNotification({ subscription: sub, event: "paused" }).catch(() => {});

    res.json({
        success: true,
        message: "Subscription paused successfully",
        subscription: sub
    });
};

/* RESUME SUBSCRIPTION (Admin & Customer) */
const resumeSubHandler = async (req, res) => {
    const id = req.params.id;
    let sub = null;
    try {
        const chk = await pool.query("SELECT * FROM subscriptions WHERE id = $1", [id]);
        if (chk.rows.length) {
            const currentStatus = (chk.rows[0].status || "").toLowerCase();
            if (currentStatus === "cancelled") {
                return res.status(400).json({
                    success: false,
                    message: "Cannot resume a cancelled subscription. Cancelled subscriptions are permanently stopped."
                });
            }
            if (currentStatus === "expired") {
                return res.status(400).json({
                    success: false,
                    message: "Cannot resume an expired subscription. Please renew or purchase a new subscription plan."
                });
            }
        }
        const result = await pool.query("UPDATE subscriptions SET status='Active', updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *", [id]);
        if (result.rows.length) sub = result.rows[0];
    } catch {}

    const memSub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (memSub) {
        if ((memSub.status || "").toLowerCase() === "cancelled") {
            return res.status(400).json({
                success: false,
                message: "Cannot resume a cancelled subscription."
            });
        }
        memSub.status = "Active";
    }
    sub = sub || memSub || { id, status: "Active" };

    sendSubscriptionNotification({ subscription: sub, event: "resumed" }).catch(() => {});

    res.json({
        success: true,
        message: "Subscription reactivated and active for morning deliveries",
        subscription: sub
    });
};

/* DELETE SUBSCRIPTION (Admin) */
const deleteSubHandler = async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query("DELETE FROM subscriptions WHERE id=$1", [id]);
    } catch {}

    MOCK_SUBSCRIPTIONS = MOCK_SUBSCRIPTIONS.filter(s => s.id != id);
    res.json({
        success: true,
        message: "Subscription record removed"
    });
};

/* APPROVE / VERIFY SUBSCRIPTION PAYMENT (Admin) */
const verifyPaymentHandler = async (req, res) => {
    const id = req.params.id;
    if (id && (id.toString().startsWith("THU-") || id.toString().startsWith("ORD-"))) {
        return res.status(400).json({
            success: false,
            message: `ID ${id} is a product order. Please use /api/orders/${id}/verify-payment`
        });
    }
    const verifiedBy = req.user?.name || req.body?.admin_name || "Admin Operations";
    let sub = null;
    try {
        const result = await pool.query(
            "UPDATE subscriptions SET payment_status='verified', status='Active', verified_at=NOW(), verified_by=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
            [verifiedBy, id]
        );
        if (result.rows.length) sub = result.rows[0];
    } catch (e) {
        console.error("[VERIFY SUB PAYMENT DB ERROR]", e.message);
    }

    const memSub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (memSub) {
        memSub.payment_status = "verified";
        memSub.status = "Active";
        memSub.verified_at = new Date().toISOString();
        memSub.verified_by = verifiedBy;
        memSub.updated_at = new Date().toISOString();
    }
    saveSubscriptionsToDisk(MOCK_SUBSCRIPTIONS);
    sub = sub || memSub || { id, payment_status: "verified", status: "Active", verified_at: new Date().toISOString(), verified_by: verifiedBy };

    // Send push notification to customer with sound
    sendNotification({
        userId: sub.user_id || sub.userId,
        title: "Subscription Payment Approved! 🥛",
        message: `Your payment for ${sub.product_name || 'milk subscription'} has been verified! Daily morning deliveries are now active.`,
        type: "subscription_activated",
        targetId: id
    }).catch(() => {});

    res.json({
        success: true,
        message: "Subscription payment approved and activated successfully!",
        subscription: sub
    });
};

/* REJECT SUBSCRIPTION PAYMENT (Admin) */
const rejectPaymentHandler = async (req, res) => {
    const id = req.params.id;
    if (id && (id.toString().startsWith("THU-") || id.toString().startsWith("ORD-"))) {
        return res.status(400).json({
            success: false,
            message: `ID ${id} is a product order. Please use /api/orders/${id}/reject-payment`
        });
    }
    const { reason } = req.body || {};
    const rejectionReason = reason || "Payment verification failed or receipt was invalid";
    let sub = null;
    try {
        const result = await pool.query(
            "UPDATE subscriptions SET payment_status='rejected', status='Rejected', rejection_reason=$1, notes=COALESCE(notes, '') || ' | Rejected: ' || $1, updated_at=NOW() WHERE id=$2 RETURNING *",
            [rejectionReason, id]
        );
        if (result.rows.length) sub = result.rows[0];
    } catch (e) {
        console.error("[REJECT SUB PAYMENT DB ERROR]", e.message);
    }

    const memSub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (memSub) {
        memSub.payment_status = "rejected";
        memSub.status = "Rejected";
        memSub.rejection_reason = rejectionReason;
        memSub.notes = (memSub.notes || "") + ` | Rejected: ${rejectionReason}`;
        memSub.updated_at = new Date().toISOString();
    }
    saveSubscriptionsToDisk(MOCK_SUBSCRIPTIONS);
    sub = sub || memSub || { id, payment_status: "rejected", status: "Rejected", rejection_reason: rejectionReason };

    // Send push notification to customer
    sendNotification({
        userId: sub.user_id || sub.userId,
        title: "Subscription Payment Rejected ⚠️",
        message: `Payment for subscription #${id} could not be verified: ${rejectionReason}. Please contact support or update payment.`,
        type: "subscription_payment_rejected",
        targetId: id
    }).catch(() => {});

    res.json({
        success: true,
        message: "Subscription payment marked as rejected",
        subscription: sub
    });
};

router.put("/:id/pause", pauseSubHandler);
router.post("/:id/pause", pauseSubHandler);
router.put("/:id/resume", resumeSubHandler);
router.post("/:id/resume", resumeSubHandler);
router.delete("/:id", deleteSubHandler);
router.put("/:id/cancel", cancelSubHandler);
router.post("/:id/cancel", cancelSubHandler);
router.post("/:id/verify-payment", verifyPaymentHandler);
router.put("/:id/verify-payment", verifyPaymentHandler);
router.post("/:id/approve-payment", verifyPaymentHandler);
router.post("/:id/reject-payment", rejectPaymentHandler);
router.put("/:id/reject-payment", rejectPaymentHandler);
router.patch("/:id/status", updateSubStatusHandler);
router.put("/:id/status", updateSubStatusHandler);

/* GET USER SUBSCRIPTIONS (Strict Customer Isolation) */
router.get("/user/:identifier", async (req, res) => {
    const rawIdent = req.params.identifier.trim();
    const ident = rawIdent.toLowerCase();
    const cleanDigits = rawIdent.replace(/\D/g, "");
    const isEmail = ident.includes("@");
    const isPhone = cleanDigits.length === 10 && /^[6-9]\d{9}$/.test(cleanDigits);
    const isNumericId = !isEmail && !isPhone && !isNaN(Number(ident));

    try {
        let whereSql = "";
        let params = [];

        if (isNumericId) {
            whereSql = "WHERE user_id = $1 ORDER BY created_at DESC";
            params = [Number(ident)];
        } else if (isEmail) {
            whereSql = "WHERE LOWER(COALESCE(customer_email, '')) = $1 ORDER BY created_at DESC";
            params = [ident];
        } else if (isPhone) {
            whereSql = "WHERE REPLACE(customer_phone, ' ', '') = $1 OR customer_phone = $1 ORDER BY created_at DESC";
            params = [cleanDigits];
        } else {
            whereSql = "WHERE LOWER(COALESCE(user_id::text, '')) = $1 OR LOWER(COALESCE(customer_email, '')) = $1 ORDER BY created_at DESC";
            params = [ident];
        }

        const result = await pool.query(
            `SELECT * FROM subscriptions ${whereSql}`,
            params
        );
        const dbRows = result.rows || [];
        const dbIds = new Set(dbRows.map(r => r.id.toString()));
        const memRows = (MOCK_SUBSCRIPTIONS || []).filter(m => {
            if (dbIds.has(m.id.toString())) return false;
            const mUser = (m.user_id || m.userId || '').toString().trim();
            const mEmail = (m.customer_email || m.customerEmail || '').toLowerCase().trim();
            const mPhone = (m.customer_phone || m.customerPhone || '').replace(/\D/g, "");

            if (isNumericId) return mUser === ident;
            if (isEmail) return mEmail === ident;
            if (isPhone) return mPhone === cleanDigits;
            return mUser === ident || mEmail === ident;
        });
        return res.json({ success: true, subscriptions: [...dbRows, ...memRows] });
    } catch (err) {
        console.error("[USER SUBSCRIPTIONS ERROR]", err.message);
        const memRows = (MOCK_SUBSCRIPTIONS || []).filter(m => {
            const mUser = (m.user_id || m.userId || '').toString().trim();
            const mEmail = (m.customer_email || m.customerEmail || '').toLowerCase().trim();
            const mPhone = (m.customer_phone || m.customerPhone || '').replace(/\D/g, "");

            if (isNumericId) return mUser === ident;
            if (isEmail) return mEmail === ident;
            if (isPhone) return mPhone === cleanDigits;
            return mUser === ident || mEmail === ident;
        });
        return res.json({ success: true, subscriptions: memRows });
    }
});

/* UPDATE SUBSCRIPTION STATUS (Pause, Resume, Cancel) */
router.put("/:id/status", async (req, res) => {
    const id = req.params.id;
    const { status, payment_status } = req.body;
    try {
        if (status) await pool.query("UPDATE subscriptions SET status=$1 WHERE id=$2", [status, id]);
        if (payment_status) await pool.query("UPDATE subscriptions SET payment_status=$1 WHERE id=$2", [payment_status, id]);
    } catch {
        // fallback
    }

    const sub = MOCK_SUBSCRIPTIONS.find(s => s.id === id);
    if (sub) {
        if (status) sub.status = status;
        if (payment_status) sub.payment_status = payment_status;
    }

    res.json({
        success: true,
        message: `Subscription updated successfully`,
        subscription: sub
    });
});

/* ============================================================
   SUBSCRIPTION DELIVERY PROOF & COMPLETION ENDPOINTS
============================================================ */
const {
    saveDeliveryProof,
    completeDelivery,
    getDeliveryDetails
} = require("../services/deliveryProofService");
const { uploadDeliveryProof } = require("../middleware/uploadMiddleware");

router.post("/:id/delivery-proof", uploadDeliveryProof, async (req, res) => {
    try {
        const id = req.params.id;
        const { image, photo, proof, remarks, latitude, longitude, partner_id } = req.body || {};
        const result = await saveDeliveryProof({
            subId: id,
            partnerId: partner_id || req.user?.partner_id,
            file: req.file,
            imageBase64: image || photo || proof,
            remarks,
            latitude,
            longitude,
            markDelivered: true
        });
        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

router.get("/:id/delivery-details", async (req, res) => {
    try {
        const details = await getDeliveryDetails(`SUB-${req.params.id}`);
        if (!details) return res.status(404).json({ success: false, message: "Subscription delivery details not found" });
        return res.json({ success: true, delivery: details });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/:id/complete-delivery", uploadDeliveryProof, async (req, res) => {
    try {
        const id = req.params.id;
        const { image, photo, proof, remarks, latitude, longitude, partner_id } = req.body || {};
        const result = await completeDelivery({
            subId: id,
            partnerId: partner_id || req.user?.partner_id,
            remarks,
            latitude,
            longitude,
            file: req.file,
            imageBase64: image || photo || proof
        });
        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;
