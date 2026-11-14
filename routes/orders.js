const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const { notifyAdminNewOrder, notifyOrderStatusChange, sendNotification, sendPaymentNotification, sendPickupNotification } = require("../services/notificationService");
const { validatePhone, validateAddress } = require("../utils/validators");

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
                const fileName = `proof_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
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

function generateUniqueOrderNumber() {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `THU-${dateStr}-${randomSuffix}`;
}

const subscriptionsRouter = require("./subscriptions");

// Real-time Mock Orders with disk persistence
const DATA_DIR = path.resolve(__dirname, "..", "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function loadOrdersFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(ORDERS_FILE)) {
            const data = fs.readFileSync(ORDERS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.warn("[ORDERS DISK LOAD WARN]:", e.message);
    }
    return [];
}

function saveOrdersToDisk(orders) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
    } catch (e) {
        console.warn("[ORDERS DISK SAVE WARN]:", e.message);
    }
}

let MOCK_ORDERS = loadOrdersFromDisk();

function getMockOrders() {
    MOCK_ORDERS = loadOrdersFromDisk();
    return MOCK_ORDERS;
}

router.getOrders = () => getMockOrders();

/* CREATE ORDER */
router.post("/", async (req, res) => {
    try {
        const {
            address,
            city,
            state,
            pincode,
            payment_method
        } = req.body;
        let items = req.body.items || [];

        const customer_name = req.body.customer_name || req.body.customerName || "Valued Customer";
        const customer_phone = req.body.customer_phone || req.body.customerPhone || "";
        const customer_email = req.body.customer_email || req.body.customerEmail || "";
        const transaction_id = req.body.transaction_id || req.body.transactionId || req.body.utr || "";
        const payment_proof = req.body.payment_proof || req.body.paymentProof || req.body.proof || "";

        // Authoritative authenticated user ID from JWT token to prevent account impersonation
        let authenticatedUserId = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, process.env.JWT_SECRET || "thulirva_secret_key_2026");
                authenticatedUserId = decoded.id;
            } catch (_) {}
        }
        const user_id = authenticatedUserId || req.body.user_id || req.body.userId || null;
        const order_type = req.body.order_type || (req.body.is_pickup ? "pickup" : "delivery");
        const delivery_zone = req.body.delivery_zone || req.body.deliveryZone || "";
        const coupon_code = req.body.coupon_code || req.body.couponCode || null;
        const discount_amount = Number(req.body.discount_amount || req.body.discount || 0) || 0;

        // Validation
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: "Cart cannot be empty. Please add items." });
        }

        // STRICT SEPARATION: Detect Subscription items vs Normal Order items
        const subscriptionItems = items.filter(it => {
            const cat = (it.category || "").toLowerCase();
            const idStr = String(it.id || it.product_id || "");
            const nameLower = (it.name || it.product_name || "").toLowerCase();
            return cat === "subscription" || idStr.startsWith("SUB_") || it.is_subscription === true || nameLower.includes("(30 days plan)") || nameLower.includes("subscription plan");
        });

        const normalOrderItems = items.filter(it => {
            const cat = (it.category || "").toLowerCase();
            const idStr = String(it.id || it.product_id || "");
            const nameLower = (it.name || it.product_name || "").toLowerCase();
            return cat !== "subscription" && !idStr.startsWith("SUB_") && !it.is_subscription && !nameLower.includes("(30 days plan)") && !nameLower.includes("subscription plan");
        });

        // If subscription items are present, create dedicated subscription records
        let createdSubs = [];
        if (subscriptionItems.length > 0 && typeof subscriptionsRouter.createSubscriptionRecord === "function") {
            for (const subIt of subscriptionItems) {
                const subPlanId = String(subIt.id || "").replace("SUB_", "") || null;
                const createdSub = await subscriptionsRouter.createSubscriptionRecord({
                    user_id: user_id,
                    customer_name: customer_name,
                    customer_phone: customer_phone,
                    customer_email: customer_email,
                    plan_id: subPlanId && !isNaN(Number(subPlanId)) ? Number(subPlanId) : null,
                    product_id: subIt.product_id || null,
                    product_name: subIt.name || subIt.product_name || "Daily Fresh Cow Milk",
                    product_image: subIt.image || subIt.product_image,
                    time_period: subIt.time_period || "Daily Morning (30 Days)",
                    frequency: subIt.frequency || subIt.weight || "Daily",
                    quantity: Number(subIt.quantity) || 1,
                    delivery_slot: req.body.pickup_slot || "6:00 AM - 7:00 AM",
                    total_price: Number(subIt.price || 0) * Number(subIt.quantity || 1),
                    address: address || "Doorstep Address",
                    city: city || "Kanchipuram",
                    pincode: pincode || "631601",
                    payment_method: payment_method || "UPI Direct Payment (7904880944@superyes)",
                    transaction_id: transaction_id,
                    payment_proof: payment_proof,
                    payment_status: transaction_id ? "Verification Pending" : "Pending",
                    status: transaction_id ? "Pending Approval" : "Pending"
                });
                createdSubs.push(createdSub);
            }
        }

        // If the cart contained ONLY subscription items:
        // Return subscription response immediately and DO NOT insert into normal orders!
        if (normalOrderItems.length === 0) {
            return res.json({
                success: true,
                is_subscription: true,
                message: "Subscription created successfully! Pending admin approval.",
                subscription: createdSubs[0],
                subscriptions: createdSubs
            });
        }

        // Otherwise proceed with ONLY normal product items
        items = normalOrderItems;

        // Order Idempotency Guard (Prevents double order submission for same payment reference)
        if (transaction_id && transaction_id.trim().length > 3) {
            const cleanTx = transaction_id.trim().toLowerCase();
            const existingOrder = getMockOrders().find(o => 
                ((o.transaction_id || o.transactionId || "").trim().toLowerCase() === cleanTx)
            );
            if (existingOrder) {
                console.log(`[ORDER DEDUP] Blocked duplicate order for transaction_id '${transaction_id}'. Returning existing order: ${existingOrder.id}`);
                return res.json({
                    success: true,
                    order: existingOrder,
                    message: "Order placed successfully! Pending payment verification."
                });
            }
        }

        let serviceableAreaId = null;
        if (order_type !== "pickup") {
            const addrVal = validateAddress(address);
            if (!addrVal.valid) {
                return res.status(400).json({ success: false, message: addrVal.message });
            }

            // Server-Side Serviceability Validation
            const { checkServiceability } = require("../services/serviceabilityService");
            const sCheck = await checkServiceability({
                latitude: req.body.latitude || req.body.lat,
                longitude: req.body.longitude || req.body.lng,
                pincode: pincode
            });
            if (!sCheck.serviceable) {
                return res.status(400).json({
                    success: false,
                    serviceable: false,
                    message: "Sorry! Thulirva is not available in your area yet. We're working hard to bring fresh dairy products to your doorstep."
                });
            }
            if (sCheck.area) {
                serviceableAreaId = sCheck.area.id;
            }
        }

        if (customer_phone) {
            const phoneVal = validatePhone(customer_phone);
            if (!phoneVal.valid) {
                return res.status(400).json({ success: false, message: phoneVal.message });
            }
        }

        let subtotal = 0;
        for (const item of items) {
            subtotal += Number(item.price || 0) * Number(item.quantity || 1);
        }

        // Validate stock availability in DB if online
        try {
            for (const item of items) {
                const pId = item.id || item.product_id;
                if (pId) {
                    const chk = await pool.query("SELECT id, name, stock FROM products WHERE id = $1", [pId]);
                    if (chk.rows.length) {
                        const curStock = Number(chk.rows[0].stock || 0);
                        const reqQty = Number(item.quantity || 1);
                        if (curStock < reqQty) {
                            return res.status(400).json({
                                success: false,
                                message: `Cannot place order. "${chk.rows[0].name}" only has ${curStock} items available in stock.`
                            });
                        }
                    }
                }
            }
        } catch {}

        const delivery = order_type === "pickup" ? 0 : (subtotal >= 299 ? 0 : 30);
        const total = Math.max(0, subtotal + delivery - discount_amount);

        const savedProof = saveBase64Image(payment_proof);
        const order_number = generateUniqueOrderNumber();
        const pickup_location_id = req.body.pickup_location_id || 1;
        const pickup_location_name = req.body.pickup_location_name || (order_type === "pickup" ? "THULIRVA Farm Store" : null);
        const pickup_slot = req.body.pickup_slot || (order_type === "pickup" ? "7:00 AM - 9:00 AM" : null);

        let createdOrderId = null;
        let dbOrder = null;

        // Resolve valid integer user_id for PostgreSQL foreign key constraint to avoid transaction aborts
        let validUserId = null;
        if (user_id && !isNaN(Number(user_id)) && Number(user_id) > 0) {
            try {
                const uChk = await pool.query("SELECT id FROM users WHERE id = $1", [Number(user_id)]);
                if (uChk.rows.length > 0) validUserId = uChk.rows[0].id;
            } catch (_) {}
        }
        if (!validUserId && customer_email && customer_email.includes("@")) {
            try {
                const uEmail = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1", [customer_email.trim()]);
                if (uEmail.rows.length > 0) validUserId = uEmail.rows[0].id;
            } catch (_) {}
        }
        if (!validUserId && customer_phone && customer_phone.length >= 10) {
            try {
                const cleanPh = customer_phone.replace(/\D/g, "");
                const uPh = await pool.query("SELECT id FROM users WHERE REPLACE(phone, ' ', '') = $1 OR phone = $2 LIMIT 1", [cleanPh, customer_phone]);
                if (uPh.rows.length > 0) validUserId = uPh.rows[0].id;
            } catch (_) {}
        }
        // Auto-provision user account in PostgreSQL if not present so foreign key passes and order history links
        if (!validUserId && (customer_email || customer_phone)) {
            try {
                const newU = await pool.query(
                    `INSERT INTO users (name, email, phone, role) 
                     VALUES ($1, $2, $3, 'customer') 
                     ON CONFLICT (email) DO UPDATE SET phone = COALESCE(users.phone, EXCLUDED.phone) 
                     RETURNING id`,
                    [
                        customer_name || "Valued Customer",
                        customer_email || `user_${Date.now()}@thulirva.local`,
                        customer_phone || ""
                    ]
                );
                if (newU.rows.length > 0) validUserId = newU.rows[0].id;
            } catch (_) {
                validUserId = null;
            }
        }

        // PostgreSQL Transaction: Insert Order, Insert Items, Deduct Stock, Insert Status History
        try {
            const client = await pool.connect();
            try {
                await client.query("BEGIN");

                const orderInsertRes = await client.query(
                    `INSERT INTO orders (
                        order_number, user_id, customer_name, customer_phone, customer_email,
                        address, city, state, pincode, subtotal, delivery_charge, discount_amount, coupon_code, total,
                        payment_method, payment_status, order_status, transaction_id, payment_proof,
                        delivery_type, delivery_zone, pickup_location_id, pickup_location_name, pickup_slot
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
                    RETURNING *`,
                    [
                        order_number, validUserId, customer_name, customer_phone, customer_email,
                        address || (order_type === "pickup" ? "THULIRVA Farm Store, Thimmarajampettai, Kanchipuram" : "Doorstep Address"),
                        city || (order_type === "pickup" ? "Kanchipuram" : "Chennai"),
                        state || "Tamil Nadu",
                        pincode || (order_type === "pickup" ? "631601" : "600001"),
                        subtotal, delivery, discount_amount, coupon_code, total,
                        payment_method || "UPI QR (7904880944@superyes)",
                        transaction_id ? "Verification Pending" : "Awaiting Payment",
                        "pending",
                        transaction_id, savedProof || "",
                        order_type, delivery_zone,
                        pickup_location_id, pickup_location_name, pickup_slot
                    ]
                );

                dbOrder = orderInsertRes.rows[0];
                createdOrderId = dbOrder.id;

                // Insert items & deduct stock atomically
                for (const item of items) {
                    const rawProdId = item.id || item.product_id || null;
                    let validProdId = null;
                    if (rawProdId && !isNaN(Number(rawProdId))) {
                        const prCheck = await client.query("SELECT id FROM products WHERE id = $1", [Number(rawProdId)]).catch(() => ({ rows: [] }));
                        if (prCheck.rows.length > 0) validProdId = prCheck.rows[0].id;
                    }

                    const prodName = item.name || item.product_name || "Farm Fresh Product";
                    const qty = Number(item.quantity || 1);
                    const prc = Number(item.price || 0);
                    const itmTot = qty * prc;

                    await client.query(
                        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, total, weight, image)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [createdOrderId, validProdId, prodName, qty, prc, itmTot, item.weight || "", item.image || ""]
                    );

                    // Automatic stock reduction
                    if (validProdId) {
                        const stockRes = await client.query(
                            `UPDATE products 
                             SET stock = GREATEST(0, stock - $1), updated_at = CURRENT_TIMESTAMP 
                             WHERE id = $2
                             RETURNING id, name, stock`,
                            [qty, validProdId]
                        );
                        if (stockRes.rows.length && Number(stockRes.rows[0].stock) <= 5) {
                            sendNotification({
                                title: "Low Stock Alert ⚠️",
                                message: `"${stockRes.rows[0].name}" stock is low (${stockRes.rows[0].stock} items remaining).`,
                                type: "low_stock",
                                targetId: validProdId.toString(),
                                forAdmin: true
                            }).catch(() => {});
                        }
                    }
                }

                // Initial status history
                await client.query(
                    `INSERT INTO order_status_history (order_id, status, comment)
                     VALUES ($1, 'pending', 'Order placed by customer')`,
                    [createdOrderId]
                );

                await client.query("COMMIT");
                client.release();
            } catch (txErr) {
                await client.query("ROLLBACK");
                client.release();
                console.error("Order Transaction Error:", txErr.message);
                return res.status(500).json({
                    success: false,
                    message: "Database failed to save order: " + txErr.message
                });
            }
        } catch (dbErr) {
            console.error("Database Connection Error on Order:", dbErr.message);
            // Only fall back if database is completely offline/unreachable
        }

        let fallbackId = Date.now();
        const numericIds = (getMockOrders() || []).map(o => Number(o.id)).filter(n => !isNaN(n) && n > 0);
        if (numericIds.length > 0) {
            fallbackId = Math.max(...numericIds) + 1;
        }
        const finalId = createdOrderId || fallbackId;

        const orderData = {
            id: finalId,
            order_number: order_number,
            orderNumber: order_number,
            user_id: validUserId || user_id,
            userId: validUserId || user_id,
            customer_name: customer_name,
            customerName: customer_name,
            customer_phone: customer_phone,
            customerPhone: customer_phone,
            customer_email: customer_email,
            customerEmail: customer_email,
            delivery_type: order_type,
            order_type: order_type,
            delivery_zone: delivery_zone,
            is_pickup: order_type === "pickup",
            pickup_location_id: pickup_location_id,
            pickup_location_name: pickup_location_name,
            pickup_slot: pickup_slot,
            address: address || (order_type === "pickup" ? "THULIRVA Farm Store, Thimmarajampettai, Kanchipuram" : "Doorstep Address"),
            city: city || (order_type === "pickup" ? "Kanchipuram" : "Chennai"),
            state: state || "Tamil Nadu",
            pincode: pincode || (order_type === "pickup" ? "631601" : "600001"),
            latitude: req.body.latitude || req.body.lat || null,
            longitude: req.body.longitude || req.body.lng || null,
            landmark: req.body.landmark || "",
            delivery_instructions: req.body.delivery_instructions || req.body.instructions || "",
            serviceable_area_id: serviceableAreaId,
            subtotal,
            delivery_charge: delivery,
            discount_amount,
            coupon_code,
            total,
            total_price: total,
            totalPrice: total,
            payment_method: payment_method || "UPI QR (7904880944@superyes)",
            payment_status: transaction_id ? "Verification Pending" : "Awaiting Payment",
            transaction_id: transaction_id,
            transactionId: transaction_id,
            payment_proof: savedProof || "",
            paymentProof: savedProof || "",
            order_status: "pending",
            created_at: dbOrder?.created_at ? new Date(dbOrder.created_at).toISOString() : new Date().toISOString(),
            items: items || []
        };

        const curMocks = getMockOrders(); curMocks.unshift(orderData); saveOrdersToDisk(curMocks);

        // Safely increment coupon usage count on successful order placement
        if (coupon_code) {
            pool.query("UPDATE coupons SET usage_count = usage_count + 1 WHERE UPPER(code) = UPPER($1)", [coupon_code.trim()]).catch(() => {});
        }

        // Instant admin notification with sound alert & customer notification
        notifyAdminNewOrder(orderData).catch(() => {});
        sendNotification({
            userId: orderData.user_id,
            title: "Order Placed! 🌾",
            message: `Your Thulirva order #${orderData.order_number || orderData.id} worth ₹${Number(orderData.total || 0).toFixed(0)} has been placed successfully.`,
            type: "order_status",
            targetId: orderData.id,
            forAdmin: false
        }).catch(() => {});

        // Payment notifications if proof or transaction ID is present
        if (transaction_id || savedProof) {
            sendPaymentNotification({
                orderOrSub: orderData,
                status: "verification_required",
                amount: orderData.total,
                forAdmin: true
            }).catch(() => {});
            sendPaymentNotification({
                orderOrSub: orderData,
                status: "pending",
                amount: orderData.total,
                forAdmin: false
            }).catch(() => {});
        }

        res.json({ success: true, order: orderData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* HELPER: Fetch orders with their items from PostgreSQL */
const { getPartnerById } = require("../services/deliveryPartnerService");

async function enrichOrderWithPartner(order) {
    if (!order) return order;
    const partnerId = order.partner_id || order.delivery_partner_id || null;
    if (partnerId) {
        try {
            const partner = await getPartnerById(partnerId);
            if (partner) {
                return {
                    ...order,
                    partner_id: partner.partner_id,
                    partner_name: partner.name,
                    partner_phone: partner.phone,
                    partner_photo: partner.profile_photo || null,
                    partner_vehicle: `${partner.vehicle_type || 'Electric Scooter'} (${partner.vehicle_number || ''})`.trim(),
                    partner_rating: Number(partner.rating) || 5.0,
                    partner_latitude: partner.current_latitude ? Number(partner.current_latitude) : null,
                    partner_longitude: partner.current_longitude ? Number(partner.current_longitude) : null
                };
            }
        } catch (_) {}
    }
    return {
        ...order,
        partner_id: null,
        partner_name: null,
        partner_phone: null,
        partner_photo: null,
        partner_vehicle: null,
        partner_rating: null,
        partner_latitude: null,
        partner_longitude: null
    };
}

async function enrichOrdersWithPartners(orders) {
    if (!Array.isArray(orders)) return [];
    return await Promise.all(orders.map(enrichOrderWithPartner));
}

async function getOrdersWithItems(whereClause = "", params = []) {
    try {
        const sql = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC`;
        const res = await pool.query(sql, params);
        if (res.rows.length === 0) return [];

        const orderIds = res.rows.map(r => r.id);
        const itemsRes = await pool.query(
            `SELECT * FROM order_items WHERE order_id = ANY($1::int[])`,
            [orderIds]
        );

        const itemsMap = {};
        for (const it of itemsRes.rows) {
            if (!itemsMap[it.order_id]) itemsMap[it.order_id] = [];
            itemsMap[it.order_id].push({
                id: it.id,
                product_id: it.product_id,
                name: it.product_name,
                product_name: it.product_name,
                quantity: it.quantity,
                price: Number(it.price),
                total: Number(it.total),
                weight: it.weight || "",
                image: it.image || ""
            });
        }

        return res.rows.map(o => ({
            ...o,
            items: itemsMap[o.id] || []
        }));
    } catch (err) {
        return [];
    }
}

/* GET ALL ORDERS */
router.get("/", async (req, res) => {
    try {
        const includeSubs = req.query.include_subscriptions === "true" || req.query.type === "all";
        const orders = await getOrdersWithItems();
        const dbIds = new Set(orders.map(o => o.id.toString()));
        const memOrders = (getMockOrders() || []).filter(o => !dbIds.has(o.id.toString()));
        
        let allOrders = [...orders, ...memOrders].filter(o => {
            const isSub = (o.delivery_type === "subscription" || o.order_type === "subscription" || (o.id && o.id.toString().startsWith("SUB-")));
            return !isSub;
        }).map(o => ({
            ...o,
            order_type: "product"
        }));

        if (includeSubs) {
            const subsList = await subscriptionsRouter.getDirectSubscriptionsList();
            allOrders = [...allOrders, ...subsList];
        }

        res.json({
            success: true,
            total: allOrders.length,
            orders: allOrders
        });
    } catch (err) {
        const memOrders = (getMockOrders() || []).map(o => ({ ...o, order_type: "product" }));
        res.json({
            success: true,
            total: memOrders.length,
            orders: memOrders
        });
    }
});

/* ADMIN ALL ORDERS */
router.get("/admin/all", async (req, res) => {
    try {
        const includeSubs = req.query.include_subscriptions === "true" || req.query.type === "all";
        const orders = await getOrdersWithItems();
        const dbIds = new Set(orders.map(o => o.id.toString()));
        const memOrders = (getMockOrders() || []).filter(o => !dbIds.has(o.id.toString()));
        
        // Strict Product Orders partition: NEVER include subscriptions unless explicitly requested with include_subscriptions=true
        let allOrders = [...orders, ...memOrders].filter(o => {
            const isSub = (o.delivery_type === "subscription" || o.order_type === "subscription" || (o.id && o.id.toString().startsWith("SUB-")));
            return !isSub;
        }).map(o => ({
            ...o,
            order_type: "product"
        }));

        if (includeSubs) {
            try {
                const subRes = await pool.query("SELECT * FROM subscriptions ORDER BY created_at DESC");
                const subRows = subRes.rows || [];
                const subDbIds = new Set(subRows.map(r => r.id.toString()));
                const subsFilePath = path.resolve(__dirname, "..", "data", "mock_subscriptions.json");
                let memSubs = [];
                if (fs.existsSync(subsFilePath)) {
                    try { memSubs = JSON.parse(fs.readFileSync(subsFilePath, "utf8")); } catch (_) {}
                }
                const extraSubs = (memSubs || []).filter(m => !subDbIds.has(m.id.toString()));
                const mappedSubs = [...subRows, ...extraSubs].map(s => ({
                    id: s.id,
                    user_id: s.user_id,
                    customer_name: s.customer_name,
                    customer_phone: s.customer_phone,
                    customer_email: s.customer_email,
                    total: Number(s.total_price) || 0,
                    delivery_type: "subscription",
                    order_type: "subscription",
                    payment_method: s.payment_method || "UPI Direct",
                    payment_status: s.payment_status || "Pending",
                    order_status: s.status || "Active",
                    transaction_id: s.transaction_id || "",
                    payment_proof: s.payment_proof || "",
                    created_at: s.created_at || s.start_date,
                    items: [{
                        id: s.id,
                        product_name: s.product_name,
                        name: s.product_name,
                        price: Number(s.total_price) || 0,
                        quantity: Number(s.quantity) || 1,
                        weight: `${s.frequency || "Daily"} • ${s.time_period || "Monthly"}`,
                        total: Number(s.total_price) || 0
                    }],
                    subscription_plan_name: s.product_name,
                    subscription_frequency: s.frequency,
                    subscription_quantity: s.quantity,
                    subscription_delivery_slot: s.delivery_slot,
                    address: s.address,
                    city: s.city,
                    raw_subscription: s
                }));
                allOrders = [...allOrders, ...mappedSubs];
            } catch (_) {}
        }

        allOrders.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            if (dateA !== dateB) return dateB - dateA;
            const idA = parseInt(a.id, 10) || 0;
            const idB = parseInt(b.id, 10) || 0;
            return idB - idA;
        });
        const enrichedAll = await enrichOrdersWithPartners(allOrders);
        return res.json({ success: true, orders: enrichedAll });
    } catch (err) {
        const prodMocks = (getMockOrders() || []).filter(o => o.order_type !== "subscription" && !String(o.id).startsWith("SUB-"));
        const enrichedMocks = await enrichOrdersWithPartners(prodMocks);
        res.json({ success: true, orders: enrichedMocks });
    }
});

/* GET ALL PAYMENT VERIFICATIONS & PAYMENT RECORDS (ADMIN) */
router.get("/admin/verifications", async (req, res) => {
    try {
        const orders = await getOrdersWithItems();
        const dbIds = new Set(orders.map(o => o.id.toString()));
        const memOrders = (getMockOrders() || []).filter(o => !dbIds.has(o.id.toString()));
        const allOrders = [...orders, ...memOrders];
        allOrders.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            if (dateA !== dateB) return dateB - dateA;
            const idA = parseInt(a.id, 10) || 0;
            const idB = parseInt(b.id, 10) || 0;
            return idB - idA;
        });
        return res.json({ success: true, orders: allOrders });
    } catch (err) {
        res.json({ success: true, orders: getMockOrders() || [] });
    }
});

/* GET ALL PICKUP ORDERS */
router.get("/admin/pickup", async (req, res) => {
    try {
        const orders = await getOrdersWithItems("WHERE LOWER(COALESCE(delivery_type, '')) = 'pickup'");
        const dbIds = new Set(orders.map(o => o.id.toString()));
        const memPickups = getMockOrders().filter(o => (o.delivery_type === "pickup" || o.is_pickup === true) && !dbIds.has(o.id.toString()));
        return res.json({ success: true, orders: [...orders, ...memPickups] });
    } catch {}

    const pickupList = getMockOrders().filter(o => o.delivery_type === "pickup" || o.is_pickup === true);
    res.json({ success: true, orders: pickupList });
});

/* USER ORDERS (Strict Customer Isolation) */
router.get("/user/:identifier", async (req, res) => {
    const rawIdent = req.params.identifier.trim();
    const ident = rawIdent.toLowerCase();
    const cleanDigits = rawIdent.replace(/\D/g, "");
    const isEmail = ident.includes("@");
    const isPhone = cleanDigits.length >= 10 && /^[6-9]\d{9}$/.test(cleanDigits);
    const isNumericId = !isEmail && !isPhone && !isNaN(Number(ident));

    try {
        let matchedUser = null;
        if (isNumericId) {
            const uRes = await pool.query("SELECT id, email, phone FROM users WHERE id = $1 LIMIT 1", [Number(ident)]).catch(() => ({ rows: [] }));
            if (uRes.rows.length > 0) matchedUser = uRes.rows[0];
        } else if (isEmail) {
            const uRes = await pool.query("SELECT id, email, phone FROM users WHERE LOWER(email) = $1 LIMIT 1", [ident]).catch(() => ({ rows: [] }));
            if (uRes.rows.length > 0) matchedUser = uRes.rows[0];
        } else if (isPhone) {
            const uRes = await pool.query("SELECT id, email, phone FROM users WHERE REPLACE(phone, ' ', '') = $1 OR phone = $2 LIMIT 1", [cleanDigits, rawIdent]).catch(() => ({ rows: [] }));
            if (uRes.rows.length > 0) matchedUser = uRes.rows[0];
        }

        const userNumericId = matchedUser ? matchedUser.id : (isNumericId ? Number(ident) : null);
        const userEmail = matchedUser?.email ? matchedUser.email.toLowerCase().trim() : (isEmail ? ident : null);
        const userPhone = matchedUser?.phone ? matchedUser.phone.replace(/\D/g, "") : (isPhone ? cleanDigits : null);

        let whereClauses = [];
        let params = [];

        if (userNumericId) {
            params.push(userNumericId);
            whereClauses.push(`user_id = $${params.length}`);
        }
        if (userEmail) {
            params.push(userEmail);
            whereClauses.push(`LOWER(customer_email) = $${params.length}`);
        }
        if (userPhone && userPhone.length >= 10) {
            params.push(userPhone);
            whereClauses.push(`REPLACE(customer_phone, ' ', '') = $${params.length}`);
        }

        if (whereClauses.length === 0) {
            params.push(ident);
            whereClauses.push(`LOWER(COALESCE(user_id::text, '')) = $1 OR LOWER(customer_email) = $1`);
        }

        const whereSql = `WHERE (${whereClauses.join(" OR ")}) AND (LOWER(COALESCE(delivery_type, '')) != 'subscription')`;
        const orders = await getOrdersWithItems(whereSql, params);
        
        // Merge in-memory / disk orders safely (strictly product orders only)
        const dbIds = new Set(orders.map(o => o.id.toString()));
        const memOrders = (getMockOrders() || []).filter(o => {
            if (dbIds.has(o.id.toString())) return false;
            if ((o.delivery_type || "").toLowerCase() === "subscription") return false;
            if (o.id && o.id.toString().startsWith("SUB-")) return false;
            const oUid = (o.user_id || o.userId || "").toString().trim();
            const oEmail = (o.customer_email || o.customerEmail || "").toLowerCase().trim();
            const oPhone = (o.customer_phone || o.customerPhone || "").replace(/\D/g, "");

            if (userNumericId && oUid === userNumericId.toString()) return true;
            if (userEmail && oEmail === userEmail) return true;
            if (userPhone && oPhone === userPhone) return true;
            return false;
        });

        const allUserOrders = [...orders, ...memOrders];
        allUserOrders.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            if (dateA !== dateB) return dateB - dateA;
            const idA = parseInt(a.id, 10) || 0;
            const idB = parseInt(b.id, 10) || 0;
            return idB - idA;
        });

        const enrichedUserOrders = await enrichOrdersWithPartners(allUserOrders);
        return res.json({ success: true, orders: enrichedUserOrders });
    } catch (err) {
        console.error("[ORDERS USER QUERY ERROR]", err.message);
        return res.json({ success: true, orders: [] });
    }
});

/* GET SINGLE ORDER BY ID OR ORDER NUMBER */
router.get("/:id", async (req, res) => {
    const idParam = req.params.id;
    try {
        const numId = parseInt(idParam, 10);
        let orders = [];
        if (!isNaN(numId)) {
            orders = await getOrdersWithItems("WHERE id = $1", [numId]);
        }
        if (orders.length === 0) {
            orders = await getOrdersWithItems("WHERE order_number = $1", [idParam]);
        }
        if (orders.length > 0) {
            const histRes = await pool.query(
                "SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC",
                [orders[0].id]
            ).catch(() => ({ rows: [] }));
            const enriched = await enrichOrderWithPartner(orders[0]);
            return res.json({ success: true, order: enriched, history: histRes.rows });
        }
    } catch {}

    const mem = getMockOrders().find(o => o.id == idParam || o.order_number == idParam);
    if (mem) {
        const enriched = await enrichOrderWithPartner(mem);
        return res.json({ success: true, order: enriched, history: [] });
    }
    res.status(404).json({ success: false, message: "Order not found" });
});

async function getOrderForNotification(id) {
    try {
        const res = await pool.query("SELECT * FROM orders WHERE id::text = $1 OR order_number = $1", [id.toString()]);
        if (res.rows.length) return res.rows[0];
    } catch {}
    const diskList = getMockOrders();
    return diskList.find(o => o.id?.toString() === id?.toString() || o.order_number === id?.toString()) || null;
}

/* UPDATE ORDER STATUS (PUT & PATCH supported) */
const { validateTransition, normalizeStatus, recordStatusHistory, broadcastStatusChange } = require("../utils/deliveryStateMachine");

const updateOrderStatusHandler = async (req, res) => {
    const rawId = req.params.id;
    const numId = parseInt(rawId);
    const id = isNaN(numId) ? rawId : numId;
    const status = req.body.status || req.body.order_status;
    const payment_status = req.body.payment_status;
    const comment = req.body.comment || `Status updated to ${status}`;
    const partnerId = req.partner?.partner_id || req.body.partner_id || req.user?.partner_id;

    const currentOrders = getMockOrders();
    let order = currentOrders.find(o => o.id?.toString() === rawId.toString() || o.order_number === rawId.toString());
    if (!order) {
        order = await getOrderForNotification(rawId);
        if (order) currentOrders.unshift(order);
    }

    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
    }

    // Enforce mandatory delivery state machine
    if (status) {
        const check = validateTransition(order.order_status, status, {
            partnerId,
            orderPartnerId: order.partner_id,
            hasProof: Boolean(order.delivery_proof || req.body.imageBase64 || req.body.image),
            isAdmin: Boolean(req.user?.role === "admin" || req.headers["x-admin-key"])
        });

        if (!check.valid) {
            return res.status(check.status).json({
                success: false,
                error_code: check.code,
                message: check.message
            });
        }
    }

    const normStatus = status ? normalizeStatus(status) : order.order_status;

    try {
        if (normStatus && payment_status) {
            await pool.query(
                `UPDATE orders 
                 SET order_status = $1, payment_status = $2,
                     delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE id::text = $3 OR order_number = $3`,
                [normStatus, payment_status, rawId.toString()]
            );
        } else if (normStatus) {
            await pool.query(
                `UPDATE orders 
                 SET order_status = $1, 
                     delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE id::text = $2 OR order_number = $2`,
                [normStatus, rawId.toString()]
            );
        } else if (payment_status) {
            await pool.query(
                `UPDATE orders SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2 OR order_number = $2`,
                [payment_status, rawId.toString()]
            );
        }

        if (normStatus) {
            await recordStatusHistory({
                orderId: order.id || rawId,
                status: normStatus,
                partnerId: partnerId || order.partner_id,
                notes: comment
            });
        }
    } catch (err) {
        console.error("Order status update DB error:", err.message);
    }

    if (status) {
        order.order_status = normStatus;
        order.status = normStatus;
        if (partnerId && !order.partner_id) order.partner_id = partnerId;

        if (normStatus === "delivered") {
            order.delivered_at = new Date().toISOString();
            if (order.partner_id) {
                try {
                    const { getPartnerById, savePartner } = require("../services/deliveryPartnerService");
                    const partner = await getPartnerById(order.partner_id);
                    if (partner) {
                        partner.total_deliveries_count = (partner.total_deliveries_count || 0) + 1;
                        partner.today_deliveries_count = (partner.today_deliveries_count || 0) + 1;
                        await savePartner(partner);
                    }
                } catch (_) {}
            }
        }
    }
    if (payment_status) order.payment_status = payment_status;
    saveOrdersToDisk(currentOrders);

    // Real-time Socket Updates via state machine
    try {
        broadcastStatusChange({
            orderId: rawId,
            status: normStatus,
            partnerId: order.partner_id,
            userId: order.user_id,
            additionalData: { delivered_at: order.delivered_at }
        });
    } catch (_) {}

    if (status) {
        notifyOrderStatusChange(order, normStatus).catch(e => {
            console.error("[NOTIFY STATUS CHANGE ERROR]", e.message);
        });
    }

    res.json({ success: true, message: "Order updated successfully", order });
};

/* VERIFY PAYMENT (ADMIN / PAYMENT STAFF) */
const verifyPaymentHandler = async (req, res) => {
    const rawId = req.params.id;
    if (rawId && rawId.toString().startsWith("SUB-")) {
        return res.status(400).json({
            success: false,
            message: `ID ${rawId} is a subscription. Please use /api/subscriptions/${rawId.toString().replace('SUB-', '')}/verify-payment`
        });
    }
    const numId = parseInt(rawId);
    const id = isNaN(numId) ? -1 : numId;
    const verifiedBy = req.body.verified_by || req.body.staff_name || "THULIRVA Operations";

    try {
        await pool.query(
            `UPDATE orders SET
                payment_status = 'verified',
                order_status = CASE WHEN delivery_type = 'pickup' THEN 'ready_for_pickup' ELSE 'processing' END,
                verified_at = CURRENT_TIMESTAMP,
                verified_by = $1,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 OR order_number = $3`,
            [verifiedBy, id, rawId]
        );
        if (id > 0) {
            await pool.query(
                `INSERT INTO order_status_history (order_id, status, comment)
                 VALUES ($1, 'payment_verified', $2)`,
                [id, `Payment verified by ${verifiedBy}`]
            ).catch(() => {});
        }
    } catch (err) {
        console.error("Verify payment DB error:", err.message);
        await pool.query(
            `UPDATE orders SET payment_status = 'verified', order_status = 'processing' WHERE id = $1`,
            [id]
        ).catch(async () => {
            await pool.query(
                `UPDATE orders SET payment_status = 'verified' WHERE id = $1`,
                [id]
            ).catch(e => console.error("Verify fallback error:", e.message));
        });
    }

    const memOrder = getMockOrders().find(o => o.id == rawId || o.id == id || o.order_number == rawId);
    if (memOrder) {
        memOrder.payment_status = "verified";
        memOrder.order_status = memOrder.delivery_type === "pickup" ? "ready_for_pickup" : "processing";
        memOrder.verified_at = new Date().toISOString();
        memOrder.verified_by = verifiedBy;
    }

    const order = (await getOrderForNotification(id)) || memOrder;
    if (order) {
        order.payment_status = "verified";
        order.order_status = order.delivery_type === "pickup" ? "ready_for_pickup" : "processing";
        order.verified_at = new Date().toISOString();
        order.verified_by = verifiedBy;
        notifyOrderStatusChange(order, order.order_status).catch(e => {
            console.error("[NOTIFY PAYMENT VERIFIED ERROR]", e.message);
        });
        sendPaymentNotification({ orderOrSub: order, status: "verified", amount: order.total }).catch(() => {});
        saveOrdersToDisk(getMockOrders());
    }

    res.json({ success: true, message: "Payment verified successfully", order });
};
router.put("/:id/verify-payment", verifyPaymentHandler);
router.post("/:id/verify-payment", verifyPaymentHandler);

/* REJECT PAYMENT (ADMIN / PAYMENT STAFF) */
const rejectPaymentHandler = async (req, res) => {
    const rawId = req.params.id;
    if (rawId && rawId.toString().startsWith("SUB-")) {
        return res.status(400).json({
            success: false,
            message: `ID ${rawId} is a subscription. Please use /api/subscriptions/${rawId.toString().replace('SUB-', '')}/reject-payment`
        });
    }
    const numId = parseInt(rawId);
    const id = isNaN(numId) ? -1 : numId;
    const reason = req.body.rejection_reason || req.body.reason || "Payment proof mismatch or invalid transaction reference";

    try {
        await pool.query(
            `UPDATE orders SET
                payment_status = 'rejected',
                rejection_reason = $1,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 OR order_number = $3`,
            [reason, id, rawId]
        );
        if (id > 0) {
            await pool.query(
                `INSERT INTO order_status_history (order_id, status, comment)
                 VALUES ($1, 'payment_rejected', $2)`,
                [id, `Payment rejected: ${reason}`]
            ).catch(() => {});
        }
    } catch (err) {
        console.error("Reject payment DB error:", err.message);
        await pool.query(
            `UPDATE orders SET payment_status = 'rejected' WHERE id = $1`,
            [id]
        ).catch(e => console.error("Reject fallback error:", e.message));
    }

    const memOrder = getMockOrders().find(o => o.id == rawId || o.id == id || o.order_number == rawId);
    if (memOrder) {
        memOrder.payment_status = "rejected";
        memOrder.rejection_reason = reason;
    }

    const order = (await getOrderForNotification(id)) || memOrder;
    if (order) {
        order.payment_status = "rejected";
        order.rejection_reason = reason;
        notifyOrderStatusChange(order, "payment_rejected").catch(e => {
            console.error("[NOTIFY PAYMENT REJECTED ERROR]", e.message);
        });
        sendPaymentNotification({ orderOrSub: order, status: "rejected", amount: order.total, reason }).catch(() => {});
        saveOrdersToDisk(getMockOrders());
    }

    res.json({ success: true, message: "Payment rejected", reason, order });
};
router.put("/:id/reject-payment", rejectPaymentHandler);
router.post("/:id/reject-payment", rejectPaymentHandler);

/* CANCEL ORDER (ADMIN & CUSTOMER with Automatic Stock Restoration) */
const cancelOrderHandler = async (req, res) => {
    const id = parseInt(req.params.id);
    const reason = req.body.reason || req.body.cancellation_reason || "Cancelled by customer/admin";

    try {
        const orderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
        if (orderRes.rows.length) {
            const currentOrder = orderRes.rows[0];
            // Restore product stock if not already restored
            if (!currentOrder.stock_restored) {
                const itemsRes = await pool.query("SELECT * FROM order_items WHERE order_id = $1", [id]);
                for (const it of itemsRes.rows) {
                    if (it.product_id) {
                        await pool.query(
                            "UPDATE products SET stock = stock + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                            [Number(it.quantity || 1), it.product_id]
                        );
                    }
                }
            }

            await pool.query(
                `UPDATE orders SET
                    order_status = 'cancelled',
                    cancellation_reason = $1,
                    stock_restored = true,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [reason, id]
            );

            await pool.query(
                `INSERT INTO order_status_history (order_id, status, comment)
                 VALUES ($1, 'cancelled', $2)`,
                [id, `Order cancelled: ${reason}`]
            ).catch(() => {});
        }
    } catch (err) {
        console.error("Cancel order DB error:", err.message);
    }

    const order = await getOrderForNotification(id);
    if (order) {
        order.order_status = "cancelled";
        order.cancellation_reason = reason;
        order.stock_restored = true;
        notifyOrderStatusChange(order, "cancelled").catch(e => {
            console.error("[NOTIFY CANCEL ERROR]", e.message);
        });
        sendNotification({
            title: "Order Cancelled ❌",
            message: `Order #${order.order_number || order.id} has been cancelled (${reason}).`,
            type: "order_cancelled",
            targetId: order.id,
            forAdmin: true
        }).catch(() => {});
    }

    res.json({ success: true, message: "Order cancelled successfully and stock restored.", order });
};
router.put("/:id/cancel", cancelOrderHandler);
router.post("/:id/cancel", cancelOrderHandler);

/* MARK PICKUP READY */
router.put("/:id/ready-pickup", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await pool.query(`UPDATE orders SET order_status = 'ready_for_pickup', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    } catch {}

    const order = await getOrderForNotification(id);
    if (order) {
        order.order_status = "ready_for_pickup";
        notifyOrderStatusChange(order, "ready_for_pickup").catch(e => {
            console.error("[NOTIFY READY PICKUP ERROR]", e.message);
        });
    }

    res.json({
        success: true,
        message: "Order marked ready for pickup. Customer notified.",
        order
    });
});

/* MARK PICKUP COLLECTED */
router.put("/:id/collect-pickup", async (req, res) => {
    const id = parseInt(req.params.id);
    const collectedBy = req.body.collected_by || req.body.staff_name || "Farm Store Staff";

    try {
        await pool.query(
            `UPDATE orders SET
                order_status = 'collected',
                pickup_collected_at = CURRENT_TIMESTAMP,
                pickup_collected_by = $1,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [collectedBy, id]
        );
    } catch {}

    const order = await getOrderForNotification(id);
    if (order) {
        order.order_status = "collected";
        order.pickup_collected_at = new Date().toISOString();
        order.pickup_collected_by = collectedBy;
        notifyOrderStatusChange(order, "collected").catch(e => {
            console.error("[NOTIFY COLLECTED ERROR]", e.message);
        });
    }

    res.json({
        success: true,
        message: "Order successfully marked as collected",
        order
    });
});

/* CUSTOMER DELIVERY PARTNER RATING */
router.post("/:id/rate", async (req, res) => {
    try {
        const orderId = req.params.id;
        const { rating, feedback, tags } = req.body;

        const ratingNum = Number(rating);
        if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({ success: false, message: "Valid rating between 1 and 5 stars is required." });
        }

        // Find order from disk/DB
        let order = (getMockOrders() || []).find(o => o.id?.toString() === orderId.toString() || o.order_number === orderId);
        try {
            const dbRes = await pool.query("SELECT * FROM orders WHERE id = $1 OR order_number = $1", [orderId]);
            if (dbRes.rows.length > 0) order = dbRes.rows[0];
        } catch (_) {}

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        if (order.order_status !== "delivered") {
            return res.status(400).json({ success: false, message: "Ratings can only be submitted for delivered orders." });
        }

        if (order.rating) {
            return res.status(400).json({ success: false, message: "This order has already been rated." });
        }

        const partnerId = order.partner_id || "THU-DP-0001";
        const ratedAt = new Date().toISOString();

        // Update order with rating
        order.rating = ratingNum;
        order.feedback = feedback || "";
        order.rating_tags = tags || [];
        order.rated_at = ratedAt;
        saveOrdersToDisk(getMockOrders());

        try {
            await pool.query(`
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2);
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS feedback TEXT;
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating_tags TEXT[];
                ALTER TABLE orders ADD COLUMN IF NOT EXISTS rated_at TIMESTAMP;
                UPDATE orders SET rating = $1, feedback = $2, rated_at = NOW() WHERE id = $3;
            `, [ratingNum, feedback || "", order.id]);
        } catch (_) {}

        // Recalculate partner's real average rating across all their delivered rated orders
        const partnersFile = path.resolve(__dirname, "..", "data", "delivery_partners.json");
        let partners = [];
        try {
            if (fs.existsSync(partnersFile)) {
                partners = JSON.parse(fs.readFileSync(partnersFile, "utf-8"));
            }
        } catch (_) {}

        const partner = partners.find(p => p.partner_id === partnerId);
        let newAverage = ratingNum;
        let ratingsCount = 1;

        if (partner) {
            const allPartnerOrders = (getMockOrders() || []).filter(o => o.partner_id === partnerId && o.rating > 0);
            if (allPartnerOrders.length > 0) {
                const sum = allPartnerOrders.reduce((acc, curr) => acc + Number(curr.rating), 0);
                newAverage = Number((sum / allPartnerOrders.length).toFixed(2));
                ratingsCount = allPartnerOrders.length;
            }
            partner.rating = newAverage;
            partner.ratings_count = ratingsCount;
            fs.writeFileSync(partnersFile, JSON.stringify(partners, null, 2), "utf-8");

            try {
                await pool.query(
                    "UPDATE delivery_partners SET rating = $1 WHERE partner_id = $2",
                    [newAverage, partnerId]
                );
            } catch (_) {}
        }

        // Real-time broadcast
        try {
            const { emitToAdmin, emitToPartner } = require("../services/socketService");
            if (typeof emitToAdmin === "function") {
                emitToAdmin("partner_rating_updated", {
                    order_id: orderId,
                    partner_id: partnerId,
                    rating: newAverage,
                    ratings_count: ratingsCount,
                    feedback: feedback || ""
                });
            }
            if (typeof emitToPartner === "function") {
                emitToPartner(partnerId, "rating_received", {
                    order_id: orderId,
                    rating: ratingNum,
                    new_average: newAverage,
                    feedback: feedback || ""
                });
            }
        } catch (_) {}

        return res.json({
            success: true,
            message: "Thank you for rating your delivery partner!",
            rating: ratingNum,
            partner_average: newAverage
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.put("/:id/status", updateOrderStatusHandler);
router.patch("/:id/status", updateOrderStatusHandler);
router.post("/:id/status", updateOrderStatusHandler);

/* ============================================================
   DELIVERY PROOF & COMPLETION ENDPOINTS
============================================================ */
const {
    saveDeliveryProof,
    completeDelivery,
    getDeliveryDetails,
    verifyDeliveryProof,
    flagDeliveryProof,
    reportDeliveryIssue
} = require("../services/deliveryProofService");
const { uploadDeliveryProof } = require("../middleware/uploadMiddleware");

router.post("/:orderId/delivery-proof", uploadDeliveryProof, async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { image, photo, proof, remarks, latitude, longitude, partner_id, sub_id } = req.body || {};
        let resolvedPartnerId = partner_id || req.user?.partner_id || req.partner?.partner_id || req.headers["x-partner-id"];
        if (!resolvedPartnerId && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
            try {
                const token = req.headers.authorization.split(" ")[1];
                const decoded = jwt.decode(token);
                if (decoded) resolvedPartnerId = decoded.partner_id || decoded.id;
            } catch (_) {}
        }
        const result = await saveDeliveryProof({
            orderId,
            subId: sub_id,
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

router.get("/:orderId/delivery-proof", async (req, res) => {
    try {
        const details = await getDeliveryDetails(req.params.orderId);
        if (!details) return res.status(404).json({ success: false, message: "Order not found" });
        return res.json({
            success: true,
            order_id: req.params.orderId,
            delivery_proof: details.delivery_proof,
            delivery_proof_urls: details.delivery_proof_urls,
            proof_status: details.proof_status
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/:orderId/delivery-details", async (req, res) => {
    try {
        const details = await getDeliveryDetails(req.params.orderId);
        if (!details) return res.status(404).json({ success: false, message: "Delivery details not found" });
        return res.json({ success: true, delivery: details, order: details });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/:orderId/complete-delivery", uploadDeliveryProof, async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { image, photo, proof, remarks, latitude, longitude, partner_id, sub_id } = req.body || {};
        const result = await completeDelivery({
            orderId,
            subId: sub_id,
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

router.post("/:orderId/issues", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { customer_id, issue_category, description, image } = req.body;
        const result = await reportDeliveryIssue({
            orderId,
            customerId: customer_id || req.user?.id,
            issueCategory: issue_category,
            description,
            imageBase64: image
        });
        return res.status(201).json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = router;
