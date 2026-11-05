const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const { notifyAdminNewOrder, notifyOrderStatusChange, sendNotification } = require("../services/notificationService");
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

let MOCK_ORDERS = [];

router.getOrders = () => MOCK_ORDERS;

/* CREATE ORDER */
router.post("/", async (req, res) => {
    try {
        const {
            address,
            city,
            state,
            pincode,
            items,
            payment_method
        } = req.body;

        const customer_name = req.body.customer_name || req.body.customerName || "Valued Customer";
        const customer_phone = req.body.customer_phone || req.body.customerPhone || "";
        const customer_email = req.body.customer_email || req.body.customerEmail || "";
        const transaction_id = req.body.transaction_id || req.body.transactionId || req.body.utr || "";
        const payment_proof = req.body.payment_proof || req.body.paymentProof || req.body.proof || "";
        const user_id = req.body.user_id || req.body.userId || null;
        const order_type = req.body.order_type || (req.body.is_pickup ? "pickup" : "delivery");
        const delivery_zone = req.body.delivery_zone || req.body.deliveryZone || "";
        const coupon_code = req.body.coupon_code || req.body.couponCode || null;
        const discount_amount = Number(req.body.discount_amount || req.body.discount || 0) || 0;

        // Validation
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: "Cart cannot be empty. Please add items." });
        }

        if (order_type !== "pickup") {
            const addrVal = validateAddress(address);
            if (!addrVal.valid) {
                return res.status(400).json({ success: false, message: addrVal.message });
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
                        order_number, user_id, customer_name, customer_phone, customer_email,
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
                    const prodId = item.id || item.product_id || null;
                    const prodName = item.name || item.product_name || "Farm Fresh Product";
                    const qty = Number(item.quantity || 1);
                    const prc = Number(item.price || 0);
                    const itmTot = qty * prc;

                    await client.query(
                        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, total, weight, image)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [createdOrderId, prodId, prodName, qty, prc, itmTot, item.weight || "", item.image || ""]
                    );

                    // Automatic stock reduction
                    if (prodId) {
                        await client.query(
                            `UPDATE products 
                             SET stock = GREATEST(0, stock - $1), updated_at = CURRENT_TIMESTAMP 
                             WHERE id = $2`,
                            [qty, prodId]
                        );
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
            }
        } catch (dbErr) {
            console.error("Database Connection Error on Order:", dbErr.message);
        }

        const finalId = createdOrderId || (MOCK_ORDERS.length ? Math.max(...MOCK_ORDERS.map(o => o.id)) + 1 : 1001);

        const orderData = {
            id: finalId,
            order_number: order_number,
            orderNumber: order_number,
            user_id: user_id,
            userId: user_id,
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
            created_at: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            items: items || []
        };

        MOCK_ORDERS.unshift(orderData);

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

        res.json({ success: true, order: orderData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* HELPER: Fetch orders with their items from PostgreSQL */
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

/* ADMIN ALL ORDERS */
router.get("/admin/all", async (req, res) => {
    try {
        const orders = await getOrdersWithItems();
        if (orders.length > 0) {
            return res.json({ success: true, orders });
        }
    } catch {}
    res.json({ success: true, orders: MOCK_ORDERS });
});

/* GET ALL PAYMENT VERIFICATIONS & PAYMENT RECORDS (ADMIN) */
router.get("/admin/verifications", async (req, res) => {
    try {
        const orders = await getOrdersWithItems();
        if (orders.length > 0) {
            return res.json({ success: true, orders });
        }
    } catch {}
    res.json({ success: true, orders: MOCK_ORDERS });
});

/* GET ALL PICKUP ORDERS */
router.get("/admin/pickup", async (req, res) => {
    try {
        const orders = await getOrdersWithItems("WHERE LOWER(COALESCE(delivery_type, '')) = 'pickup'");
        const dbIds = new Set(orders.map(o => o.id.toString()));
        const memPickups = MOCK_ORDERS.filter(o => (o.delivery_type === "pickup" || o.is_pickup === true) && !dbIds.has(o.id.toString()));
        return res.json({ success: true, orders: [...orders, ...memPickups] });
    } catch {}

    const pickupList = MOCK_ORDERS.filter(o => o.delivery_type === "pickup" || o.is_pickup === true);
    res.json({ success: true, orders: pickupList });
});

/* USER ORDERS */
router.get("/user/:identifier", async (req, res) => {
    const ident = req.params.identifier.trim().toLowerCase();
    const cleanPhone = ident.replace(/\D/g, "");
    try {
        const orders = await getOrdersWithItems(
            `WHERE LOWER(COALESCE(user_id::text, ''))=$1 OR LOWER(customer_email)=$1 OR customer_phone=$1 OR ($2 != '' AND REPLACE(customer_phone, ' ', '') LIKE $3)`,
            [ident, cleanPhone, `%${cleanPhone}%`]
        );
        if (orders.length > 0) {
            return res.json({ success: true, orders });
        }
    } catch {}

    const userOrders = MOCK_ORDERS.filter(o => {
        const oUid = (o.user_id || o.userId || "").toString().toLowerCase().trim();
        const oEmail = (o.customer_email || o.customerEmail || "").toLowerCase().trim();
        const oPhone = (o.customer_phone || o.customerPhone || "").replace(/\D/g, "");
        return (
            (oUid && oUid === ident) ||
            (oEmail && oEmail === ident) ||
            (cleanPhone && oPhone && (oPhone === cleanPhone || oPhone.endsWith(cleanPhone) || cleanPhone.endsWith(oPhone)))
        );
    });
    res.json({
        success: true,
        orders: userOrders
    });
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
            return res.json({ success: true, order: orders[0], history: histRes.rows });
        }
    } catch {}

    const mem = MOCK_ORDERS.find(o => o.id == idParam || o.order_number == idParam);
    if (mem) {
        return res.json({ success: true, order: mem, history: [] });
    }
    res.status(404).json({ success: false, message: "Order not found" });
});

async function getOrderForNotification(id) {
    try {
        const res = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
        if (res.rows.length) return res.rows[0];
    } catch {}
    return MOCK_ORDERS.find(o => o.id === id) || null;
}

/* UPDATE ORDER STATUS (PUT & PATCH supported) */
const updateOrderStatusHandler = async (req, res) => {
    const id = parseInt(req.params.id);
    const status = req.body.status || req.body.order_status;
    const payment_status = req.body.payment_status;
    const comment = req.body.comment || `Status updated to ${status}`;

    try {
        if (status && payment_status) {
            await pool.query(
                `UPDATE orders SET order_status = $1, payment_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
                [status, payment_status, id]
            );
        } else if (status) {
            await pool.query(
                `UPDATE orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [status, id]
            );
        } else if (payment_status) {
            await pool.query(
                `UPDATE orders SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [payment_status, id]
            );
        }

        if (status) {
            await pool.query(
                `INSERT INTO order_status_history (order_id, status, comment) VALUES ($1, $2, $3)`,
                [id, status, comment]
            ).catch(() => {});
        }
    } catch (err) {
        console.error("Order status update DB error:", err.message);
    }

    const order = await getOrderForNotification(id);
    if (order) {
        if (status) order.order_status = status;
        if (payment_status) order.payment_status = payment_status;
        if (status) {
            notifyOrderStatusChange(order, status).catch(e => {
                console.error("[NOTIFY STATUS CHANGE ERROR]", e.message);
            });
        }
    }

    res.json({ success: true, message: "Order updated successfully", order });
};

/* VERIFY PAYMENT (ADMIN / PAYMENT STAFF) */
const verifyPaymentHandler = async (req, res) => {
    const id = parseInt(req.params.id);
    const verifiedBy = req.body.verified_by || req.body.staff_name || "Admin";

    try {
        await pool.query(
            `UPDATE orders SET
                payment_status = 'verified',
                order_status = CASE WHEN delivery_type = 'pickup' THEN 'ready_for_pickup' ELSE 'processing' END,
                verified_at = CURRENT_TIMESTAMP,
                verified_by = $1,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [verifiedBy, id]
        );
        await pool.query(
            `INSERT INTO order_status_history (order_id, status, comment)
             VALUES ($1, 'payment_verified', $2)`,
            [id, `Payment verified by ${verifiedBy}`]
        ).catch(() => {});
    } catch (err) {
        console.error("Verify payment DB error:", err.message);
    }

    const order = await getOrderForNotification(id);
    if (order) {
        order.payment_status = "verified";
        order.order_status = order.delivery_type === "pickup" ? "ready_for_pickup" : "processing";
        order.verified_at = new Date().toISOString();
        order.verified_by = verifiedBy;
        notifyOrderStatusChange(order, order.order_status).catch(e => {
            console.error("[NOTIFY PAYMENT VERIFIED ERROR]", e.message);
        });
    }

    res.json({ success: true, message: "Payment verified successfully", order });
};
router.put("/:id/verify-payment", verifyPaymentHandler);
router.post("/:id/verify-payment", verifyPaymentHandler);

/* REJECT PAYMENT (ADMIN / PAYMENT STAFF) */
const rejectPaymentHandler = async (req, res) => {
    const id = parseInt(req.params.id);
    const reason = req.body.rejection_reason || req.body.reason || "Payment proof mismatch or invalid transaction reference";

    try {
        await pool.query(
            `UPDATE orders SET
                payment_status = 'rejected',
                rejection_reason = $1,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [reason, id]
        );
        await pool.query(
            `INSERT INTO order_status_history (order_id, status, comment)
             VALUES ($1, 'payment_rejected', $2)`,
            [id, `Payment rejected: ${reason}`]
        ).catch(() => {});
    } catch (err) {
        console.error("Reject payment DB error:", err.message);
    }

    const order = await getOrderForNotification(id);
    if (order) {
        order.payment_status = "rejected";
        order.rejection_reason = reason;
        notifyOrderStatusChange(order, "payment_rejected").catch(e => {
            console.error("[NOTIFY PAYMENT REJECTED ERROR]", e.message);
        });
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

router.put("/:id/status", updateOrderStatusHandler);
router.patch("/:id/status", updateOrderStatusHandler);

module.exports = router;
