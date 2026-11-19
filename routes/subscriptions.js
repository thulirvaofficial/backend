const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const { uploadSubscriptionImage } = require("../middleware/uploadMiddleware");
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

/* ============================================================
   1. SUBSCRIPTION PLANS (CATALOG & DYNAMIC CONFIGURATION)
============================================================ */

function enrichPlanWithConfigs(plan) {
    if (!plan) return plan;
    const basePrice = Number(plan.price) || 1320;
    const origPrice = Number(plan.original_price) || Math.round(basePrice * 1.15);

    const defaultQuantityConfig = {
        enabled: true,
        minimum: 1,
        maximum: 5,
        unit: "Packet",
        options: [
            { value: 1, label: "1 Packet" },
            { value: 2, label: "2 Packets" },
            { value: 3, label: "3 Packets" },
            { value: 4, label: "4 Packets" }
        ],
        default_quantity: 1,
        custom_increments: false
    };

    const defaultDeliverySlotConfig = {
        enabled: true,
        allow_multiple_slots: false,
        default_slot: "Morning: 6:00 AM - 7:00 AM",
        slots: [
            { id: 1, name: "Morning: 5:30 AM - 6:30 AM", type: "morning", start_time: "05:30 AM", end_time: "06:30 AM", is_enabled: true, max_orders: 150 },
            { id: 2, name: "Morning: 6:00 AM - 7:00 AM", type: "morning", start_time: "06:00 AM", end_time: "07:00 AM", is_enabled: true, max_orders: 150 },
            { id: 3, name: "Morning: 7:00 AM - 8:00 AM", type: "morning", start_time: "07:00 AM", end_time: "08:00 AM", is_enabled: true, max_orders: 100 },
            { id: 4, name: "Evening: 5:00 PM - 6:00 PM", type: "evening", start_time: "05:00 PM", end_time: "06:00 PM", is_enabled: true, max_orders: 100 },
            { id: 5, name: "Evening: 6:00 PM - 7:00 PM", type: "evening", start_time: "06:00 PM", end_time: "07:00 PM", is_enabled: true, max_orders: 100 }
        ]
    };

    const defaultStartDateConfig = {
        enabled: true,
        allow_immediate_start: false,
        allow_future_dates: true,
        minimum_advance_notice_hours: 12,
        maximum_advance_days: 30,
        blocked_dates: []
    };

    const defaultScheduleConfig = {
        enabled_schedules: ["Daily", "Alternate Days", "Twice Weekly", "Three Times Weekly", "Weekly", "Monthly"],
        custom_schedule: ""
    };

    const defaultPricingConfig = {
        base_price: basePrice,
        original_price: origPrice,
        discount_percent: Number(plan.discount_percent) || 0,
        quantity_pricing: {},
        frequency_pricing: {},
        deliveries_count: Number(plan.duration_days) || 30
    };

    const parseJson = (val, def) => {
        if (!val) return def;
        if (typeof val === 'object') return val;
        try { return JSON.parse(val); } catch { return def; }
    };

    return {
        ...plan,
        is_active: plan.is_active !== false && plan.status !== 'inactive',
        is_archived: Boolean(plan.is_archived),
        quantity_config: parseJson(plan.quantity_config, defaultQuantityConfig),
        delivery_slot_config: parseJson(plan.delivery_slot_config, defaultDeliverySlotConfig),
        start_date_config: parseJson(plan.start_date_config, defaultStartDateConfig),
        schedule_config: parseJson(plan.schedule_config, defaultScheduleConfig),
        pricing_config: parseJson(plan.pricing_config, defaultPricingConfig)
    };
}

function syncMockPlanWithCatalogProduct(plan) {
    if (!plan) return plan;
    try {
        const prodFile = path.resolve(__dirname, "..", "data", "products.json");
        if (fs.existsSync(prodFile)) {
            const raw = fs.readFileSync(prodFile, "utf-8");
            const prods = JSON.parse(raw);
            if (plan.product_id) {
                const matched = prods.find(pr => Number(pr.id) === Number(plan.product_id));
                if (matched && matched.image && (!plan.product_image || plan.product_image.startsWith('/assets/images/products/'))) {
                    return { ...plan, product_image: matched.image };
                }
            }
        }
    } catch (_) {}
    return plan;
}

/* ============================================================
   SUBSCRIPTION PLAN IMAGE UPLOAD (ADMIN)
============================================================ */
router.post(["/upload", "/upload-image", "/plans/upload", "/plans/upload-image"], authenticateToken, adminOnly, uploadSubscriptionImage, (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image file provided. Please choose a JPG, PNG, or WEBP file (Max 5MB)."
            });
        }
        const relativeUrl = `/uploads/subscriptions/${req.file.filename}`;
        return res.json({
            success: true,
            message: "Subscription image uploaded successfully",
            image_url: relativeUrl,
            url: relativeUrl,
            filename: req.file.filename,
            size: req.file.size,
            mimetype: req.file.mimetype
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* GET ALL PLANS (STOREFRONT) */
router.get("/plans", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    try {
        let plans = [];
        try {
            const result = await pool.query(`
                SELECT p.*,
                       COALESCE(NULLIF(p.product_image, ''), pr.image, '/assets/images/products/fresh_cow_milk.jpg') AS product_image
                FROM subscription_plans p
                LEFT JOIN products pr ON pr.id = p.product_id
                WHERE p.is_archived = false AND (p.status = 'active' OR p.is_active = true)
                ORDER BY p.id ASC
            `);
            plans = result.rows;
        } catch (_) {}

        if (plans.length === 0) {
            plans = MOCK_PLANS.filter(p => !p.is_archived && p.status !== 'inactive').map(syncMockPlanWithCatalogProduct);
        }

        return res.json({
            success: true,
            plans: plans.map(enrichPlanWithConfigs)
        });
    } catch {
        return res.json({
            success: true,
            plans: MOCK_PLANS.filter(p => !p.is_archived && p.status !== 'inactive').map(syncMockPlanWithCatalogProduct).map(enrichPlanWithConfigs)
        });
    }
});

/* GET ALL PLANS FOR ADMIN (WITH SUBSCRIBER COUNTS) */
router.get("/plans/admin/all", authenticateToken, adminOnly, async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    try {
        let plans = [];
        try {
            const result = await pool.query(`
                SELECT p.*,
                       COALESCE(NULLIF(p.product_image, ''), pr.image, '/assets/images/products/fresh_cow_milk.jpg') AS product_image,
                       COALESCE((
                           SELECT COUNT(*)
                           FROM subscriptions s
                           WHERE s.plan_id = p.id
                             AND LOWER(COALESCE(s.status, '')) IN ('active', 'approved')
                       ), 0) AS active_subscribers
                FROM subscription_plans p
                LEFT JOIN products pr ON pr.id = p.product_id
                ORDER BY p.is_archived ASC, p.id ASC
            `);
            plans = result.rows;
        } catch (_) {}

        if (plans.length === 0) {
            plans = MOCK_PLANS.map(syncMockPlanWithCatalogProduct).map(p => ({
                ...p,
                active_subscribers: (MOCK_SUBSCRIPTIONS || []).filter(s => s.plan_id == p.id && (s.status || '').toLowerCase() === 'active').length
            }));
        }

        return res.json({
            success: true,
            plans: plans.map(p => ({
                ...enrichPlanWithConfigs(p),
                active_subscribers: Number(p.active_subscribers || 0)
            }))
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* GET SINGLE PLAN */
router.get("/plans/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    const id = parseInt(req.params.id);
    try {
        let plan = null;
        try {
            const result = await pool.query(`
                SELECT p.*,
                       COALESCE(NULLIF(p.product_image, ''), pr.image, '/assets/images/products/fresh_cow_milk.jpg') AS product_image
                FROM subscription_plans p
                LEFT JOIN products pr ON pr.id = p.product_id
                WHERE p.id = $1
            `, [id]);
            if (result.rows.length > 0) plan = result.rows[0];
        } catch (_) {}
        if (!plan) plan = syncMockPlanWithCatalogProduct(MOCK_PLANS.find(p => p.id === id) || MOCK_PLANS[0]);
        return res.json({ success: true, plan: enrichPlanWithConfigs(plan) });
    } catch {
        const plan = syncMockPlanWithCatalogProduct(MOCK_PLANS.find(p => p.id === id) || MOCK_PLANS[0]);
        res.json({ success: true, plan: enrichPlanWithConfigs(plan) });
    }
});

/* CREATE PLAN (Admin) */
router.post("/plans", authenticateToken, adminOnly, async (req, res) => {
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
            status,
            is_active,
            is_archived,
            quantity_config,
            delivery_slot_config,
            start_date_config,
            schedule_config,
            pricing_config,
            delivery_instructions
        } = req.body;

        if (!product_name || !price) {
            return res.status(400).json({ success: false, message: "Product name and price are required." });
        }

        const savedImage = saveBase64Image(product_image) || "/assets/images/products/fresh_cow_milk.jpg";

        const enriched = enrichPlanWithConfigs({
            product_id: product_id ? Number(product_id) : null,
            product_name,
            product_image: savedImage,
            time_period: time_period || "Daily Morning (30 Days)",
            frequency: frequency || "Daily",
            duration_days: duration_days ? Number(duration_days) : 30,
            price: Number(price),
            original_price: original_price ? Number(original_price) : null,
            discount_percent: discount_percent ? Number(discount_percent) : 0,
            description: description || "",
            badge: badge || "Popular",
            status: status || "active",
            is_active: is_active !== false,
            is_archived: Boolean(is_archived),
            quantity_config,
            delivery_slot_config,
            start_date_config,
            schedule_config,
            pricing_config,
            delivery_instructions
        });

        let newPlan = null;
        try {
            const result = await pool.query(`
                INSERT INTO subscription_plans (
                    product_id, product_name, product_image, time_period,
                    frequency, duration_days, price, original_price,
                    discount_percent, description, badge, status,
                    is_active, is_archived, quantity_config, delivery_slot_config,
                    start_date_config, schedule_config, pricing_config, delivery_instructions
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                RETURNING *
            `, [
                enriched.product_id,
                enriched.product_name,
                enriched.product_image,
                enriched.time_period,
                enriched.frequency,
                enriched.duration_days,
                enriched.price,
                enriched.original_price,
                enriched.discount_percent,
                enriched.description,
                enriched.badge,
                enriched.status,
                enriched.is_active,
                enriched.is_archived,
                JSON.stringify(enriched.quantity_config),
                JSON.stringify(enriched.delivery_slot_config),
                JSON.stringify(enriched.start_date_config),
                JSON.stringify(enriched.schedule_config),
                JSON.stringify(enriched.pricing_config),
                enriched.delivery_instructions || null
            ]);
            newPlan = result.rows[0];
        } catch (dbErr) {
            console.warn("[CREATE PLAN DB WARN]:", dbErr.message);
        }

        const nextId = newPlan?.id || (MOCK_PLANS.length ? Math.max(...MOCK_PLANS.map(p => p.id || 0)) + 1 : 1);
        if (!newPlan) {
            newPlan = { id: nextId, ...enriched };
        }
        MOCK_PLANS.unshift(newPlan);

        return res.json({ success: true, plan: enrichPlanWithConfigs(newPlan), message: "Subscription plan created successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* UPDATE PLAN (Admin) */
router.put("/plans/:id", authenticateToken, adminOnly, async (req, res) => {
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
            status,
            is_active,
            is_archived,
            quantity_config,
            delivery_slot_config,
            start_date_config,
            schedule_config,
            pricing_config,
            delivery_instructions
        } = req.body;

        const savedImage = saveBase64Image(product_image);

        let updatedPlan = null;
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
                    status = COALESCE($12, status),
                    is_active = COALESCE($13, is_active),
                    is_archived = COALESCE($14, is_archived),
                    quantity_config = COALESCE($15::jsonb, quantity_config),
                    delivery_slot_config = COALESCE($16::jsonb, delivery_slot_config),
                    start_date_config = COALESCE($17::jsonb, start_date_config),
                    schedule_config = COALESCE($18::jsonb, schedule_config),
                    pricing_config = COALESCE($19::jsonb, pricing_config),
                    delivery_instructions = COALESCE($20, delivery_instructions),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $21
                RETURNING *
            `, [
                product_id ? Number(product_id) : null,
                product_name,
                savedImage,
                time_period,
                frequency,
                duration_days ? Number(duration_days) : null,
                price !== undefined ? Number(price) : null,
                original_price !== undefined ? Number(original_price) : null,
                discount_percent !== undefined ? Number(discount_percent) : null,
                description,
                badge,
                status,
                is_active,
                is_archived,
                quantity_config !== undefined ? JSON.stringify(quantity_config) : null,
                delivery_slot_config !== undefined ? JSON.stringify(delivery_slot_config) : null,
                start_date_config !== undefined ? JSON.stringify(start_date_config) : null,
                schedule_config !== undefined ? JSON.stringify(schedule_config) : null,
                pricing_config !== undefined ? JSON.stringify(pricing_config) : null,
                delivery_instructions,
                id
            ]);
            if (result.rows.length > 0) updatedPlan = result.rows[0];
        } catch (dbErr) {
            console.warn("[UPDATE PLAN DB WARN]:", dbErr.message);
        }

        const idx = MOCK_PLANS.findIndex(p => p.id === id);
        if (idx !== -1) {
            MOCK_PLANS[idx] = enrichPlanWithConfigs({
                ...MOCK_PLANS[idx],
                ...req.body,
                product_image: savedImage || product_image || MOCK_PLANS[idx].product_image,
                id: id
            });
            updatedPlan = updatedPlan || MOCK_PLANS[idx];
        }

        return res.json({ success: true, plan: enrichPlanWithConfigs(updatedPlan || req.body), message: "Plan updated successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* DUPLICATE PLAN (Admin) */
router.post("/plans/:id/duplicate", authenticateToken, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        let src = null;
        try {
            const resDb = await pool.query("SELECT * FROM subscription_plans WHERE id = $1", [id]);
            if (resDb.rows.length) src = resDb.rows[0];
        } catch (_) {}
        src = src || MOCK_PLANS.find(p => p.id === id);
        if (!src) return res.status(404).json({ success: false, message: "Source plan not found" });

        const enriched = enrichPlanWithConfigs(src);
        const dupName = `${enriched.product_name} (Copy)`;

        let newPlan = null;
        try {
            const result = await pool.query(`
                INSERT INTO subscription_plans (
                    product_id, product_name, product_image, time_period,
                    frequency, duration_days, price, original_price,
                    discount_percent, description, badge, status,
                    is_active, is_archived, quantity_config, delivery_slot_config,
                    start_date_config, schedule_config, pricing_config, delivery_instructions
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                RETURNING *
            `, [
                enriched.product_id, dupName, enriched.product_image, enriched.time_period,
                enriched.frequency, enriched.duration_days, enriched.price, enriched.original_price,
                enriched.discount_percent, enriched.description, enriched.badge, 'active',
                true, false,
                JSON.stringify(enriched.quantity_config),
                JSON.stringify(enriched.delivery_slot_config),
                JSON.stringify(enriched.start_date_config),
                JSON.stringify(enriched.schedule_config),
                JSON.stringify(enriched.pricing_config),
                enriched.delivery_instructions
            ]);
            newPlan = result.rows[0];
        } catch (_) {}

        const nextId = newPlan?.id || (MOCK_PLANS.length ? Math.max(...MOCK_PLANS.map(p => p.id || 0)) + 1 : 1);
        if (!newPlan) {
            newPlan = { ...enriched, id: nextId, product_name: dupName };
        }
        MOCK_PLANS.unshift(newPlan);

        return res.json({ success: true, plan: enrichPlanWithConfigs(newPlan), message: `Plan duplicated as '${dupName}'` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ARCHIVE PLAN (Admin) */
router.put("/plans/:id/archive", authenticateToken, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        try {
            await pool.query("UPDATE subscription_plans SET is_archived = true, is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
        } catch (_) {}
        const p = MOCK_PLANS.find(x => x.id === id);
        if (p) { p.is_archived = true; p.is_active = false; }
        return res.json({ success: true, message: "Subscription plan archived successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* DELETE PLAN (Admin with Subscriber Protection) */
router.delete("/plans/:id", authenticateToken, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        let activeSubsCount = 0;
        try {
            const countRes = await pool.query(
                "SELECT COUNT(*) FROM subscriptions WHERE plan_id = $1 AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'completed', 'rejected', 'expired')",
                [id]
            );
            activeSubsCount = Number(countRes.rows[0].count);
        } catch (_) {
            activeSubsCount = (MOCK_SUBSCRIPTIONS || []).filter(s => s.plan_id == id && !['cancelled', 'completed', 'rejected', 'expired'].includes((s.status || '').toLowerCase())).length;
        }

        if (activeSubsCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete plan with ${activeSubsCount} active subscriber(s). Please archive the plan instead to protect customer subscription terms.`
            });
        }

        try {
            await pool.query("DELETE FROM subscription_plans WHERE id = $1", [id]);
        } catch (_) {}
        MOCK_PLANS = MOCK_PLANS.filter(p => p.id !== id);

        return res.json({ success: true, message: "Subscription plan deleted successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* GET PLAN ACTIVE SUBSCRIBERS (Admin) */
router.get("/plans/:id/subscribers", authenticateToken, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        let subscribers = [];
        try {
            const result = await pool.query(
                "SELECT * FROM subscriptions WHERE plan_id = $1 ORDER BY created_at DESC",
                [id]
            );
            subscribers = result.rows;
        } catch (_) {}

        if (subscribers.length === 0) {
            subscribers = (MOCK_SUBSCRIPTIONS || []).filter(s => s.plan_id == id);
        }

        return res.json({ success: true, subscribers, count: subscribers.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   1.5 DYNAMIC QUANTITY-BASED PRICING & DELIVERY SLOTS (MODULE 9)
============================================================ */

const SLOTS_FILE = path.join(DATA_DIR, "delivery_slots.json");

function loadDeliverySlotsFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (fs.existsSync(SLOTS_FILE)) {
            return JSON.parse(fs.readFileSync(SLOTS_FILE, "utf-8"));
        }
    } catch (e) {
        console.warn("[DELIVERY SLOTS LOAD WARN]:", e.message);
    }
    return [
        { id: 1, slot_name: "Morning Slot", slot_type: "morning", start_time: "06:00 AM", end_time: "07:30 AM", display_text: "Morning (6:00 AM - 7:30 AM)", cutoff_time: "10:00 PM", max_orders_per_slot: 150, is_active: true },
        { id: 2, slot_name: "Evening Slot", slot_type: "evening", start_time: "05:30 PM", end_time: "07:00 PM", display_text: "Evening (5:30 PM - 7:00 PM)", cutoff_time: "02:00 PM", max_orders_per_slot: 100, is_active: true },
        { id: 3, slot_name: "Both Morning & Evening", slot_type: "both", start_time: "06:00 AM & 05:30 PM", end_time: "07:30 AM & 07:00 PM", display_text: "Twice Daily (Morning & Evening)", cutoff_time: "10:00 PM", max_orders_per_slot: 50, is_active: true }
    ];
}

function saveDeliverySlotsToDisk(slots) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SLOTS_FILE, JSON.stringify(slots, null, 2), "utf-8");
    } catch (e) {
        console.warn("[DELIVERY SLOTS SAVE WARN]:", e.message);
    }
}

function calculateSubscriptionPricing({ plan_id, quantity, frequency, duration_days, slot_type, planOverride }) {
    const qty = Math.max(1, parseInt(quantity) || 1);
    const planIdNum = parseInt(plan_id);
    const plan = planOverride || MOCK_PLANS.find(p => p.id === planIdNum) || MOCK_PLANS[0];

    const effectiveFrequency = (frequency || plan?.frequency || "Daily").trim();
    const effectiveDuration = parseInt(duration_days) || plan?.duration_days || plan?.deliveries_count || 30;
    const effectiveSlotType = (slot_type || "morning").toLowerCase().trim();

    // Determine baseline deliveries for frequency
    let deliveries = 30;
    const freqLower = effectiveFrequency.toLowerCase();
    if (freqLower.includes("daily")) {
        deliveries = effectiveDuration;
    } else if (freqLower.includes("alternate")) {
        deliveries = Math.ceil(effectiveDuration / 2);
    } else if (freqLower.includes("twice")) {
        deliveries = Math.floor(effectiveDuration / 7) * 2;
    } else if (freqLower.includes("weekly")) {
        deliveries = Math.max(1, Math.floor(effectiveDuration / 7));
    } else if (freqLower.includes("monthly")) {
        deliveries = Math.max(1, Math.floor(effectiveDuration / 30));
    } else {
        deliveries = effectiveDuration;
    }

    if (effectiveSlotType === "both" || effectiveSlotType.includes("twice")) {
        deliveries = deliveries * 2;
    }

    // Determine per-delivery unit price
    let planDeliveries = plan?.deliveries_count || plan?.duration_days || 30;
    const pFreqLower = (plan?.frequency || "Daily").toLowerCase();
    if (pFreqLower.includes("alternate")) planDeliveries = Math.ceil(planDeliveries / 2);
    else if (pFreqLower.includes("twice")) planDeliveries = Math.floor(planDeliveries / 7) * 2;
    else if (pFreqLower.includes("monthly")) planDeliveries = Math.max(1, Math.floor(planDeliveries / 30));
    else if (pFreqLower.includes("weekly")) planDeliveries = Math.max(1, Math.floor(planDeliveries / 7));

    const baseUnitConfig = Number(plan?.pricing_config?.base_price_per_delivery);
    const unitPrice = !isNaN(baseUnitConfig) && baseUnitConfig > 0 
        ? baseUnitConfig 
        : parseFloat(((Number(plan?.price) || 1320) / planDeliveries).toFixed(2));

    const configDiscount = Number(plan?.pricing_config?.discount_percent);
    let discountPercent = !isNaN(configDiscount) ? configDiscount : 0;
    if (discountPercent === 0) {
        if (qty === 2) discountPercent = 3;
        else if (qty === 3) discountPercent = 6;
        else if (qty === 4) discountPercent = 9;
        else if (qty >= 5) discountPercent = 12;
    }

    const grossTotal = Math.round(unitPrice * deliveries * qty);
    const discountAmount = Math.round(grossTotal * (discountPercent / 100));
    const totalPrice = grossTotal - discountAmount;
    const pricePerDelivery = deliveries > 0 ? parseFloat((totalPrice / deliveries).toFixed(2)) : totalPrice;

    return {
        plan_id: plan?.id || planIdNum || 1,
        product_name: plan?.product_name || "Fresh Farm Milk",
        quantity: qty,
        frequency: effectiveFrequency,
        duration_days: effectiveDuration,
        slot_type: effectiveSlotType,
        total_deliveries: deliveries,
        base_unit_price: unitPrice,
        gross_total: grossTotal,
        tier_discount_percent: discountPercent,
        discount_amount: discountAmount,
        total_price: totalPrice,
        price_per_delivery: pricePerDelivery
    };
}

router.calculatePricing = calculateSubscriptionPricing;

/* POST /api/subscriptions/calculate-price */
router.post("/calculate-price", async (req, res) => {
    try {
        const { plan_id, quantity, frequency, duration_days, slot_type, delivery_slot } = req.body || {};
        let plan = null;
        if (plan_id) {
            const pIdNum = parseInt(plan_id);
            try {
                const dbRes = await pool.query("SELECT * FROM subscription_plans WHERE id = $1", [pIdNum]);
                if (dbRes.rows.length) plan = enrichPlanWithConfigs(dbRes.rows[0]);
            } catch (_) {}
            if (!plan) plan = MOCK_PLANS.find(p => p.id === pIdNum);
        }
        if (!plan) plan = enrichPlanWithConfigs(MOCK_PLANS[0]);

        const effSlot = (delivery_slot || slot_type || "morning");
        const result = calculateSubscriptionPricing({
            plan_id: plan.id,
            quantity,
            frequency,
            duration_days,
            slot_type: effSlot.toLowerCase().includes("both") ? "both" : (effSlot.toLowerCase().includes("evening") ? "evening" : "morning"),
            planOverride: plan
        });
        return res.json({
            success: true,
            total_price: result.total_price,
            calculated_price: result.total_price,
            price_per_delivery: result.price_per_delivery,
            data: result
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

/* GET DELIVERY SLOTS */
const getDeliverySlotsHandler = (req, res) => {
    const slots = loadDeliverySlotsFromDisk().filter(s => s.is_active !== false);
    return res.json({ success: true, slots });
};
router.get("/slots", getDeliverySlotsHandler);
router.get("/delivery-slots", getDeliverySlotsHandler);

/* ADMIN CREATE DELIVERY SLOT */
router.post("/slots", authenticateToken, adminOnly, (req, res) => {
    try {
        const { slot_name, slot_type, start_time, end_time, display_text, cutoff_time, max_orders_per_slot } = req.body || {};
        if (!slot_name || !start_time || !end_time) {
            return res.status(400).json({ success: false, message: "Slot name, start time, and end time are required" });
        }
        const slots = loadDeliverySlotsFromDisk();
        const nextId = slots.length > 0 ? Math.max(...slots.map(s => s.id || 0)) + 1 : 1;
        const newSlot = {
            id: nextId,
            slot_name,
            slot_type: slot_type || "morning",
            start_time,
            end_time,
            display_text: display_text || `${slot_name} (${start_time} - ${end_time})`,
            cutoff_time: cutoff_time || "10:00 PM",
            max_orders_per_slot: Number(max_orders_per_slot) || 100,
            is_active: true
        };
        slots.push(newSlot);
        saveDeliverySlotsToDisk(slots);
        return res.json({ success: true, slot: newSlot, message: "Delivery slot created successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ADMIN UPDATE DELIVERY SLOT */
router.put("/slots/:id", authenticateToken, adminOnly, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const slots = loadDeliverySlotsFromDisk();
        const idx = slots.findIndex(s => s.id === id);
        if (idx === -1) {
            return res.status(404).json({ success: false, message: "Delivery slot not found" });
        }
        slots[idx] = {
            ...slots[idx],
            ...req.body,
            id: id // Ensure ID doesn't change
        };
        saveDeliverySlotsToDisk(slots);
        return res.json({ success: true, slot: slots[idx], message: "Delivery slot updated successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* ADMIN DELETE DELIVERY SLOT */
router.delete("/slots/:id", authenticateToken, adminOnly, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        let slots = loadDeliverySlotsFromDisk();
        slots = slots.filter(s => s.id !== id);
        saveDeliverySlotsToDisk(slots);
        return res.json({ success: true, message: "Delivery slot deleted successfully" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
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
        const diskSubs = loadSubscriptionsFromDisk();
        const memRows = diskSubs.filter(m => !dbIds.has(m.id.toString()));
        return res.json({ success: true, subscriptions: [...dbRows, ...memRows] });
    } catch (err) {
        console.warn("[SUBSCRIPTIONS ADMIN] DB query fallback:", err.message);
        return res.json({ success: true, subscriptions: loadSubscriptionsFromDisk() });
    }
};

router.get("/admin/all", authenticateToken, adminOnly, getAllSubscriptionsHandler);
router.get("/all", authenticateToken, adminOnly, getAllSubscriptionsHandler);
router.get("/", authenticateToken, adminOnly, getAllSubscriptionsHandler);

/* ADMIN CREATE / ONBOARD SUBSCRIBER */
router.post("/admin/create", authenticateToken, adminOnly, async (req, res) => {
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

    // Fetch and validate against target plan
    let plan = null;
    if (inputData.plan_id) {
        const pId = parseInt(inputData.plan_id);
        try {
            const pRes = await pool.query("SELECT * FROM subscription_plans WHERE id = $1", [pId]);
            if (pRes.rows.length) plan = pRes.rows[0];
        } catch (_) {}
        if (!plan) plan = MOCK_PLANS.find(p => p.id === pId);
    }
    if (!plan && MOCK_PLANS.length) plan = MOCK_PLANS[0];

    const enrichedPlan = enrichPlanWithConfigs(plan);

    // Rule 1: Check plan active status
    if (enrichedPlan && (enrichedPlan.is_active === false || enrichedPlan.is_archived === true || enrichedPlan.status === 'inactive')) {
        throw new Error("The selected subscription plan is currently inactive or archived and not accepting new subscriptions.");
    }

    // Rule 2: Quantity Configuration Validation
    const qConfig = enrichedPlan?.quantity_config || { enabled: true, minimum: 1, maximum: 5, default_quantity: 1 };
    let reqQty = parseInt(inputData.quantity) || qConfig.default_quantity || 1;
    if (qConfig.enabled === false) {
        reqQty = qConfig.default_quantity || 1;
    } else {
        if (reqQty < (qConfig.minimum || 1) || reqQty > (qConfig.maximum || 10)) {
            throw new Error(`Quantity ${reqQty} is outside allowable range (${qConfig.minimum || 1} to ${qConfig.maximum || 10}) for this plan.`);
        }
        if (Array.isArray(qConfig.options) && qConfig.options.length > 0) {
            const allowedValues = qConfig.options.map(o => {
                if (typeof o === 'object' && o !== null) {
                    return Number(o.quantity !== undefined ? o.quantity : (o.value !== undefined ? o.value : 1));
                }
                return Number(o);
            }).filter(v => !isNaN(v));
            if (allowedValues.length > 0 && !allowedValues.includes(reqQty)) {
                const err = new Error(`Selected quantity (${reqQty}) is not an enabled option for this plan.`);
                err.statusCode = 400;
                throw err;
            }
        }
    }

    // Rule 3: Delivery Slot Configuration Validation
    const slotConfig = enrichedPlan?.delivery_slot_config || { enabled: true, allow_multiple_slots: false };
    let reqSlot = (inputData.delivery_slot || inputData.deliverySlot || slotConfig.default_slot || "Morning: 6:00 AM - 7:00 AM").trim();
    if (slotConfig.enabled === false) {
        reqSlot = slotConfig.default_slot || "Morning: 6:00 AM - 7:00 AM";
    } else {
        const isBoth = reqSlot.toLowerCase().includes("both") || reqSlot.toLowerCase().includes("twice");
        if (isBoth && !slotConfig.allow_multiple_slots) {
            const err = new Error("Both Morning & Evening delivery is disabled for this plan.");
            err.statusCode = 400;
            throw err;
        }
        if (Array.isArray(slotConfig.slots) && slotConfig.slots.length > 0) {
            const enabledSlotNames = slotConfig.slots
                .filter(s => s.enabled !== false && s.is_enabled !== false)
                .map(s => (s.name || '').toLowerCase().trim());
            const matched = enabledSlotNames.some(sn => sn && (reqSlot.toLowerCase().includes(sn) || sn.includes(reqSlot.toLowerCase())));
            if (!matched && !isBoth) {
                const err = new Error(`Selected delivery slot '${reqSlot}' is currently disabled or unavailable.`);
                err.statusCode = 400;
                throw err;
            }
        }
    }

    // Rule 4: Start Date Configuration Validation
    const dateConfig = enrichedPlan?.start_date_config || { enabled: true, maximum_advance_days: 30 };
    let reqStartDate = inputData.start_date || inputData.startDate;
    const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    if (dateConfig.enabled === false || !reqStartDate) {
        reqStartDate = tomorrowStr;
    } else {
        const todayStr = new Date().toISOString().split("T")[0];
        if (reqStartDate === todayStr && !dateConfig.allow_immediate_start) {
            const err = new Error("Immediate same-day start is not permitted. Subscriptions must start tomorrow or later.");
            err.statusCode = 400;
            throw err;
        }
        const blocked = Array.isArray(dateConfig.blocked_dates)
            ? dateConfig.blocked_dates
            : (typeof dateConfig.blocked_dates === 'string' ? dateConfig.blocked_dates.split(',').map(s => s.trim()) : []);
        if (blocked.includes(reqStartDate)) {
            const err = new Error(`Selected start date '${reqStartDate}' is blocked for deliveries.`);
            err.statusCode = 400;
            throw err;
        }
    }

    // Rule 5: Schedule Configuration Validation
    const schedConfig = enrichedPlan?.schedule_config || { enabled_schedules: ["Daily", "Alternate Days", "Twice Weekly", "Three Times Weekly", "Weekly", "Monthly"] };
    const reqFrequency = (inputData.frequency || enrichedPlan?.frequency || "Daily").trim();
    if (Array.isArray(schedConfig.enabled_schedules) && schedConfig.enabled_schedules.length > 0) {
        const isFreqAllowed = schedConfig.enabled_schedules.some(s => s.toLowerCase() === reqFrequency.toLowerCase());
        if (!isFreqAllowed) {
            throw new Error(`Selected delivery schedule '${reqFrequency}' is not enabled for this plan.`);
        }
    }

    const duration_days = Number(inputData.duration_days || inputData.durationDays) || enrichedPlan?.duration_days || (time_period.includes("15") ? 15 : 30);
    const startDateObj = new Date(reqStartDate);
    const expiryDateObj = new Date(startDateObj.getTime() + duration_days * 24 * 60 * 60 * 1000);
    const expiry_date = inputData.expiry_date || inputData.expiryDate || expiryDateObj.toISOString().split("T")[0];

    const savedProof = saveBase64Image(payment_proof);
    const subId = inputData.id && inputData.id.startsWith("SUB-") ? inputData.id : generateSubscriptionId();

    const payment_status = inputData.payment_status || (transaction_id ? "Verification Pending" : "Pending");
    const status = inputData.status || (transaction_id ? "Pending Approval" : "Pending");

    // Dynamic Server Price Calculation
    const calculatedPricing = calculateSubscriptionPricing({
        plan_id: enrichedPlan?.id || inputData.plan_id,
        quantity: reqQty,
        frequency: reqFrequency,
        duration_days: duration_days,
        slot_type: reqSlot.toLowerCase().includes("evening") ? "evening" : (reqSlot.toLowerCase().includes("both") ? "both" : "morning")
    });

    const verifiedTotalPrice = calculatedPricing.total_price;
    const verifiedPricePerDelivery = calculatedPricing.price_per_delivery;

    // Snapshot of terms to protect existing subscriptions
    const termsSnapshot = {
        plan_id: enrichedPlan?.id,
        plan_name: enrichedPlan?.product_name || product_name,
        quantity: reqQty,
        quantity_unit: qConfig.unit || "Packet",
        unit_price: calculatedPricing.base_unit_price || enrichedPlan?.price_per_delivery || 92,
        delivery_slot: reqSlot,
        start_date: reqStartDate,
        expiry_date: expiry_date,
        frequency: reqFrequency,
        duration_days: duration_days,
        total_deliveries: calculatedPricing.total_deliveries,
        price_per_delivery: verifiedPricePerDelivery,
        total_price: verifiedTotalPrice,
        original_price: calculatedPricing.gross_total,
        discount_amount: calculatedPricing.discount_amount,
        snapshot_created_at: new Date().toISOString()
    };

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
        plan_id: enrichedPlan?.id || inputData.plan_id || null,
        product_id: inputData.product_id || enrichedPlan?.product_id || null,
        product_name: enrichedPlan?.product_name || product_name,
        productName: enrichedPlan?.product_name || product_name,
        product_image: inputData.product_image || inputData.productImage || enrichedPlan?.product_image || "/assets/images/products/fresh_cow_milk.jpg",
        productImage: inputData.product_image || inputData.productImage || enrichedPlan?.product_image || "/assets/images/products/fresh_cow_milk.jpg",
        time_period: enrichedPlan?.time_period || time_period,
        timePeriod: enrichedPlan?.time_period || time_period,
        frequency: reqFrequency,
        duration_days: duration_days,
        durationDays: duration_days,
        quantity: reqQty,
        delivery_slot: reqSlot,
        deliverySlot: reqSlot,
        price_per_delivery: verifiedPricePerDelivery,
        total_price: verifiedTotalPrice,
        totalPrice: verifiedTotalPrice,
        total: verifiedTotalPrice,
        start_date: reqStartDate,
        startDate: reqStartDate,
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
        terms_snapshot: termsSnapshot,
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
                payment_method, payment_status, status, transaction_id, payment_proof,
                terms_snapshot
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
        `, [
            subData.id, validUserId, subData.customer_name, subData.customer_phone, subData.customer_email,
            validPlanId, validProductId, subData.product_name, subData.product_image, subData.time_period,
            subData.frequency, subData.quantity, subData.delivery_slot, subData.price_per_delivery, subData.total_price,
            subData.start_date, subData.expiry_date, subData.duration_days, subData.address, subData.city, subData.pincode,
            subData.payment_method, subData.payment_status, subData.status, subData.transaction_id, subData.payment_proof,
            JSON.stringify(subData.terms_snapshot)
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
        res.status(error.statusCode || 400).json({ success: false, message: error.message });
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
        recipientRole: "customer",
        appType: "customer",
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
        recipientRole: "customer",
        appType: "customer",
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
router.post("/:id/verify-payment", authenticateToken, adminOnly, verifyPaymentHandler);
router.put("/:id/verify-payment", authenticateToken, adminOnly, verifyPaymentHandler);
router.post("/:id/approve-payment", authenticateToken, adminOnly, verifyPaymentHandler);
router.post("/:id/reject-payment", authenticateToken, adminOnly, rejectPaymentHandler);
router.put("/:id/reject-payment", authenticateToken, adminOnly, rejectPaymentHandler);
router.patch("/:id/status", updateSubStatusHandler);
router.put("/:id/status", updateSubStatusHandler);

/* GET SINGLE SUBSCRIPTION BY ID */
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    try {
        let sub = null;
        try {
            const result = await pool.query("SELECT * FROM subscriptions WHERE id::text = $1 LIMIT 1", [id]);
            if (result.rows.length) sub = result.rows[0];
        } catch (_) {}
        if (!sub) {
            sub = (MOCK_SUBSCRIPTIONS || []).find(s => String(s.id) === String(id));
        }
        if (!sub) {
            return res.status(404).json({ success: false, message: "Subscription not found" });
        }
        return res.json({ success: true, subscription: sub });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

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
   DAILY SUBSCRIPTION MANIFEST & SCHEDULED DELIVERIES
============================================================ */
const SUB_DELIVERIES_FILE = path.join(DATA_DIR, "subscription_deliveries.json");

function loadSubDeliveriesFromDisk() {
    try {
        if (fs.existsSync(SUB_DELIVERIES_FILE)) {
            return JSON.parse(fs.readFileSync(SUB_DELIVERIES_FILE, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function saveSubDeliveriesToDisk(records) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SUB_DELIVERIES_FILE, JSON.stringify(records, null, 2), "utf-8");
    } catch (_) {}
}

function isSubscriptionScheduledForDate(sub, targetDateStr) {
    if (!sub) return false;
    const status = (sub.status || "").toLowerCase();
    if (status === "cancelled" || status === "paused" || status === "rejected") return false;

    // Start date check
    const startStr = sub.start_date ? sub.start_date.split("T")[0] : null;
    if (startStr && startStr > targetDateStr) return false;

    // End date check if available
    let endStr = sub.end_date ? sub.end_date.split("T")[0] : null;
    if (!endStr && startStr) {
        const days = Number(sub.duration_days || (sub.time_period && sub.time_period.includes("30") ? 30 : 60)) || 30;
        const d = new Date(startStr);
        d.setDate(d.getDate() + days);
        endStr = d.toISOString().split("T")[0];
    }
    if (endStr && endStr < targetDateStr) return false;

    // Frequency check
    const freq = (sub.frequency || "daily").toLowerCase();
    if (freq === "daily") return true;

    const targetDate = new Date(targetDateStr);
    const dayOfWeek = targetDate.getDay();

    if (freq.includes("weekday")) {
        return dayOfWeek >= 1 && dayOfWeek <= 5;
    }
    if (freq.includes("alternate") && startStr) {
        const diffMs = targetDate.getTime() - new Date(startStr).getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return diffDays % 2 === 0;
    }
    if (freq.includes("weekly") && startStr) {
        const startDay = new Date(startStr).getDay();
        return dayOfWeek === startDay;
    }

    return true;
}

async function getSubscriptionDeliveriesHandler(req, res) {
    try {
        const targetDate = req.query.date || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        const existingDeliveries = loadSubDeliveriesFromDisk();

        let allSubs = [];
        try {
            const dbRes = await pool.query("SELECT * FROM subscriptions ORDER BY created_at DESC");
            allSubs = dbRes.rows || [];
        } catch (_) {}
        const dbIds = new Set(allSubs.map(s => s.id.toString()));
        const diskSubs = loadSubscriptionsFromDisk();
        const extraMem = diskSubs.filter(m => !dbIds.has(m.id.toString()));
        allSubs = [...allSubs, ...extraMem];

        const scheduledDeliveries = [];
        const seenKeys = new Set();

        for (const sub of allSubs) {
            if (!isSubscriptionScheduledForDate(sub, targetDate)) continue;

            const dedupeKey = `${sub.id}_${targetDate}`;
            if (seenKeys.has(dedupeKey)) continue;
            seenKeys.add(dedupeKey);

            const expectedDailyId = `DLY-${sub.id}-${targetDate.replace(/-/g, '')}`;
            const existing = existingDeliveries.find(
                d => d.id === expectedDailyId || d.daily_id === expectedDailyId || ((d.subscription_id == sub.id || d.subscription_id == `SUB-${sub.id}`) && d.delivery_date === targetDate)
            );

            if (existing) {
                scheduledDeliveries.push({
                    id: existing.id || expectedDailyId,
                    daily_id: existing.daily_id || expectedDailyId,
                    subscription_id: sub.id,
                    delivery_date: targetDate,
                    customer_name: existing.customer_name || sub.customer_name || "Valued Subscriber",
                    customer_phone: existing.customer_phone || sub.customer_phone || "",
                    address: existing.address || sub.address || "",
                    city: existing.city || sub.city || "Chennai",
                    pincode: existing.pincode || sub.pincode || "603103",
                    product_name: existing.product_name || sub.product_name || "Daily Farm Fresh Milk (1 Litre)",
                    quantity: existing.quantity || sub.quantity || 1,
                    delivery_slot: existing.delivery_slot || sub.delivery_slot || "06:00 AM - 07:30 AM",
                    status: existing.status || "pending",
                    partner_id: existing.partner_id || sub.assigned_partner_id || sub.partner_id || null,
                    partner_name: existing.partner_name || sub.assigned_partner_name || sub.partner_name || null,
                    created_at: existing.created_at || new Date().toISOString(),
                    delivered_at: existing.delivered_at || null,
                    notes: existing.notes || ""
                });
            } else {
                scheduledDeliveries.push({
                    id: `DLY-${sub.id}-${targetDate.replace(/-/g, '')}`,
                    daily_id: `DLY-${sub.id}-${targetDate.replace(/-/g, '')}`,
                    subscription_id: sub.id,
                    delivery_date: targetDate,
                    customer_name: sub.customer_name || "Valued Subscriber",
                    customer_phone: sub.customer_phone || "",
                    address: sub.address || "",
                    city: sub.city || "Chennai",
                    pincode: sub.pincode || "603103",
                    product_name: sub.product_name || "Daily Farm Fresh Milk (1 Litre)",
                    quantity: sub.quantity || 1,
                    delivery_slot: sub.delivery_slot || "06:00 AM - 07:30 AM",
                    status: "pending",
                    partner_id: sub.assigned_partner_id || sub.partner_id || null,
                    partner_name: sub.assigned_partner_name || sub.partner_name || null,
                    created_at: new Date().toISOString()
                });
            }
        }

        const totalDeliveries = scheduledDeliveries.length;
        const delivered = scheduledDeliveries.filter(d => (d.status || '').toLowerCase() === 'delivered').length;
        const outForDelivery = scheduledDeliveries.filter(d => ['out_for_delivery', 'in_transit', 'shipped'].includes((d.status || '').toLowerCase())).length;
        const pending = scheduledDeliveries.filter(d => !['delivered', 'cancelled'].includes((d.status || '').toLowerCase())).length;
        const totalQuantity = scheduledDeliveries.reduce((sum, d) => sum + (Number(d.quantity) || 1), 0);

        const stats = {
            total_deliveries: totalDeliveries,
            delivered,
            out_for_delivery: outForDelivery,
            pending,
            total_quantity: totalQuantity
        };

        return res.json({
            success: true,
            selected_date: targetDate,
            stats,
            total: totalDeliveries,
            deliveries: scheduledDeliveries
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

router.get(["/deliveries", "/daily-manifest", "/admin/daily-manifest"], authenticateToken, adminOnly, getSubscriptionDeliveriesHandler);

router.put(["/deliveries/:id/status", "/daily-manifest/:id/status"], async (req, res) => {
    try {
        const id = req.params.id;
        const { status, partner_id, notes } = req.body;
        const records = loadSubDeliveriesFromDisk();
        let record = records.find(r => r.id == id || r.daily_id == id);
        if (!record) {
            record = {
                id: id,
                daily_id: id,
                status: status || "delivered",
                updated_at: new Date().toISOString()
            };
            records.push(record);
        }
        record.status = status;
        if (partner_id) record.partner_id = partner_id;
        if (notes) record.notes = notes;
        if (status === "delivered") record.delivered_at = new Date().toISOString();
        saveSubDeliveriesToDisk(records);
        return res.json({ success: true, message: `Subscription delivery #${id} updated to ${status}.`, delivery: record });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
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
        let resolvedPartnerId = partner_id || req.user?.partner_id || req.partner?.partner_id || req.headers["x-partner-id"];
        if (!resolvedPartnerId && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
            try {
                const token = req.headers.authorization.split(" ")[1];
                const jwt = require("jsonwebtoken");
                const decoded = jwt.decode(token);
                if (decoded) resolvedPartnerId = decoded.partner_id || decoded.id;
            } catch (_) {}
        }
        const result = await saveDeliveryProof({
            subId: id,
            partnerId: resolvedPartnerId,
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
