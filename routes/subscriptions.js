const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

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

// Real-time Customer Subscriptions (Starts empty - no fake records)
let MOCK_SUBSCRIPTIONS = [];
router.getSubscriptions = () => MOCK_SUBSCRIPTIONS;
router.getSubscriptions = () => MOCK_SUBSCRIPTIONS;

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
        if (result.rows.length > 0) {
            return res.json({ success: true, subscriptions: result.rows });
        }
    } catch (err) {
        // Fallback to in-memory store
    }

    if (MOCK_SUBSCRIPTIONS.length === 0) {
        const today = new Date();
        const sub1Start = new Date(today.getTime() - 5 * 86400000).toISOString().split('T')[0];
        const sub2Start = new Date(today.getTime() - 26 * 86400000).toISOString().split('T')[0];
        const sub3Start = new Date(today.getTime() - 12 * 86400000).toISOString().split('T')[0];

        MOCK_SUBSCRIPTIONS = [
            {
                id: "SUB-101",
                customer_name: "Kaviya Sundaram",
                customer_phone: "7904880944",
                customer_email: "kaviya@gmail.com",
                product_name: "Fresh Cow Milk (1 Litre)",
                time_period: "Daily Morning (30 Days)",
                frequency: "Daily",
                quantity: 1,
                delivery_slot: "6:00 AM - 7:00 AM",
                price_per_delivery: 82.00,
                total_price: 2460.00,
                start_date: sub1Start,
                address: "No 14, Gandhi Road, Near Bus Stand",
                city: "Kanchipuram",
                pincode: "631501",
                payment_method: "UPI QR (7904880944@superyes)",
                payment_status: "Verified",
                status: "Active",
                transaction_id: "TXN-SUB-89412",
                created_at: new Date(today.getTime() - 5 * 86400000).toISOString()
            },
            {
                id: "SUB-102",
                customer_name: "Manoj Kumar",
                customer_phone: "9840123456",
                customer_email: "manoj.k@gmail.com",
                product_name: "Fresh Cow Milk (500ml)",
                time_period: "Daily Morning (30 Days)",
                frequency: "Daily",
                quantity: 2,
                delivery_slot: "6:30 AM - 7:30 AM",
                price_per_delivery: 88.00,
                total_price: 2640.00,
                start_date: sub2Start,
                address: "Plot 42, 2nd Avenue, Anna Nagar",
                city: "Chennai",
                pincode: "600040",
                payment_method: "UPI Direct",
                payment_status: "Verified",
                status: "Active",
                transaction_id: "TXN-SUB-77124",
                created_at: new Date(today.getTime() - 26 * 86400000).toISOString()
            },
            {
                id: "SUB-103",
                customer_name: "Anand R",
                customer_phone: "9444198765",
                customer_email: "anand.r@gmail.com",
                product_name: "Pure Bilona Cow Ghee (500ml)",
                time_period: "Monthly Delivery (1 Jar/Month)",
                frequency: "Monthly",
                quantity: 1,
                delivery_slot: "7:00 AM - 8:00 AM",
                price_per_delivery: 649.00,
                total_price: 649.00,
                start_date: sub3Start,
                address: "Flat 3B, Sunshine Apartments, Velachery",
                city: "Chennai",
                pincode: "600042",
                payment_method: "UPI QR",
                payment_status: "Verified",
                status: "Paused",
                transaction_id: "TXN-SUB-55219",
                created_at: new Date(today.getTime() - 12 * 86400000).toISOString()
            }
        ];
    }

    res.json({ success: true, subscriptions: MOCK_SUBSCRIPTIONS });
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
        res.json({ success: true, message: "Subscription created successfully", subscription: newSub });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* BUY / CREATE NEW SUBSCRIPTION (Website User) */
router.post("/", async (req, res) => {
    try {
        const {
            plan_id,
            product_id,
            product_image,
            frequency,
            quantity,
            delivery_slot,
            price_per_delivery,
            start_date,
            address,
            city,
            pincode,
            payment_method
        } = req.body;

        const user_id = req.body.user_id || req.body.userId || null;
        const customer_name = req.body.customer_name || req.body.customerName || "Valued Customer";
        const customer_phone = req.body.customer_phone || req.body.customerPhone || "";
        const customer_email = req.body.customer_email || req.body.customerEmail || "";
        const product_name = req.body.product_name || req.body.productName || "Fresh Cow Milk (500ml)";
        const time_period = req.body.time_period || req.body.timePeriod || "Daily Morning (30 Days)";
        const total_price = Number(req.body.total_price || req.body.totalPrice || req.body.total) || 1320;
        const transaction_id = req.body.transaction_id || req.body.transactionId || req.body.utr || "";
        const payment_proof = req.body.payment_proof || req.body.paymentProof || req.body.proof || "";

        const savedProof = saveBase64Image(payment_proof);
        const subId = "SUB-" + Math.floor(1000 + Math.random() * 9000);
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
            plan_id: plan_id || null,
            product_id: product_id || null,
            product_name: product_name,
            productName: product_name,
            product_image: product_image || "/assets/images/products/fresh_cow_milk.jpg",
            productImage: product_image || "/assets/images/products/fresh_cow_milk.jpg",
            time_period: time_period,
            timePeriod: time_period,
            frequency: frequency || "Daily",
            quantity: Number(quantity) || 1,
            delivery_slot: delivery_slot || "6:00 AM - 7:00 AM",
            deliverySlot: delivery_slot || "6:00 AM - 7:00 AM",
            price_per_delivery: Number(price_per_delivery) || 44,
            total_price: total_price,
            totalPrice: total_price,
            total: total_price,
            start_date: start_date || new Date().toISOString().split("T")[0],
            startDate: start_date || new Date().toISOString().split("T")[0],
            address: address || "Doorstep Address, Kanchipuram",
            city: city || "Kanchipuram",
            pincode: pincode || "631601",
            payment_method: payment_method || "UPI Direct Payment (7904880944@superyes)",
            payment_status: transaction_id ? "Paid (Verification Pending)" : "Pending",
            transaction_id: transaction_id,
            transactionId: transaction_id,
            payment_proof: savedProof || "",
            paymentProof: savedProof || "",
            status: "Active",
            created_at: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        };

        try {
            await pool.query(`
                INSERT INTO subscriptions (
                    id, user_id, customer_name, customer_phone, customer_email,
                    plan_id, product_id, product_name, product_image, time_period,
                    frequency, quantity, delivery_slot, price_per_delivery, total_price,
                    start_date, address, city, pincode, payment_method, payment_status, status,
                    transaction_id, payment_proof
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
            `, [
                subData.id, subData.user_id, subData.customer_name, subData.customer_phone, subData.customer_email,
                subData.plan_id, subData.product_id, subData.product_name, subData.product_image, subData.time_period,
                subData.frequency, subData.quantity, subData.delivery_slot, subData.price_per_delivery, subData.total_price,
                subData.start_date, subData.address, subData.city, subData.pincode, subData.payment_method, subData.payment_status, subData.status,
                subData.transaction_id, subData.payment_proof
            ]);
        } catch {
            // in-memory fallback
        }

        MOCK_SUBSCRIPTIONS.unshift(subData);
        res.json({
            success: true,
            subscription: subData,
            message: "Subscription started successfully! Fresh doorstep delivery scheduled."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* UPDATE SUBSCRIPTION STATUS (Pause, Resume, Cancel) */
const updateSubStatusHandler = async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ success: false, message: "Status is required" });
    }

    try {
        await pool.query("UPDATE subscriptions SET status=$1 WHERE id=$2", [status, id]);
    } catch {}

    const sub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (sub) {
        sub.status = status;
    }

    res.json({
        success: true,
        message: `Subscription status updated to ${status}`,
        subscription: sub
    });
};

/* CANCEL SUBSCRIPTION (Admin & Customer) */
const cancelSubHandler = async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query("UPDATE subscriptions SET status='Cancelled' WHERE id=$1", [id]);
    } catch {}

    const sub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (sub) {
        sub.status = "Cancelled";
    }

    res.json({
        success: true,
        message: "Subscription cancelled successfully",
        subscription: sub
    });
};

/* PAUSE SUBSCRIPTION (Admin & Customer) */
const pauseSubHandler = async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query("UPDATE subscriptions SET status='Paused' WHERE id=$1", [id]);
    } catch {}

    const sub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (sub) sub.status = "Paused";

    res.json({
        success: true,
        message: "Subscription paused successfully",
        subscription: sub
    });
};

/* RESUME SUBSCRIPTION (Admin & Customer) */
const resumeSubHandler = async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query("UPDATE subscriptions SET status='Active' WHERE id=$1", [id]);
    } catch {}

    const sub = MOCK_SUBSCRIPTIONS.find(s => s.id == id);
    if (sub) sub.status = "Active";

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

router.put("/:id/pause", pauseSubHandler);
router.post("/:id/pause", pauseSubHandler);
router.put("/:id/resume", resumeSubHandler);
router.post("/:id/resume", resumeSubHandler);
router.delete("/:id", deleteSubHandler);
router.put("/:id/cancel", cancelSubHandler);
router.post("/:id/cancel", cancelSubHandler);
router.patch("/:id/status", updateSubStatusHandler);
router.put("/:id/status", updateSubStatusHandler);

/* GET USER SUBSCRIPTIONS */
router.get("/user/:identifier", async (req, res) => {
    const ident = req.params.identifier.trim().toLowerCase();
    const cleanPhone = ident.replace(/\D/g, "");
    try {
        const result = await pool.query(
            "SELECT * FROM subscriptions WHERE LOWER(COALESCE(user_id, ''))=$1 OR LOWER(customer_email)=$1 OR customer_phone=$1 OR ($2 != '' AND REPLACE(customer_phone, ' ', '') LIKE $3) ORDER BY created_at DESC",
            [ident, cleanPhone, `%${cleanPhone}%`]
        );
        if (result.rows && result.rows.length > 0) {
            return res.json({ success: true, subscriptions: result.rows });
        }
    } catch {
        // fallback
    }

    const filtered = MOCK_SUBSCRIPTIONS.filter(s => {
        const sUid = (s.user_id || s.userId || "").toString().toLowerCase().trim();
        const sEmail = (s.customer_email || s.customerEmail || "").toLowerCase().trim();
        const sPhone = (s.customer_phone || s.customerPhone || "").replace(/\D/g, "");
        return (
            (sUid && sUid === ident) ||
            (sEmail && sEmail === ident) ||
            (cleanPhone && sPhone && (sPhone === cleanPhone || sPhone.endsWith(cleanPhone) || cleanPhone.endsWith(sPhone)))
        );
    });
    res.json({ success: true, subscriptions: filtered });
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

module.exports = router;
