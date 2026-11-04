const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const { notifyAdminNewOrder, notifyOrderStatusChange, sendNotification } = require("../services/notificationService");

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

        let subtotal = 0;
        if (Array.isArray(items)) {
            for (const item of items) {
                subtotal += Number(item.price || 0) * Number(item.quantity || 1);
            }
        }
        const delivery = order_type === "pickup" ? 0 : (subtotal >= 299 ? 0 : 30);
        const total = subtotal + delivery;

        const savedProof = saveBase64Image(payment_proof);
        const newId = MOCK_ORDERS.length ? Math.max(...MOCK_ORDERS.map(o => o.id)) + 1 : 1001;
        const pickup_location_id = req.body.pickup_location_id || 1;
        const pickup_location_name = req.body.pickup_location_name || (order_type === "pickup" ? "THULIRVA Farm Store" : null);
        const pickup_slot = req.body.pickup_slot || (order_type === "pickup" ? "7:00 AM - 9:00 AM" : null);

        const orderData = {
            id: newId,
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

        // Try postgres insert
        try {
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                await client.query(
                    `INSERT INTO orders (customer_name, customer_phone, customer_email, address, city, state, pincode, subtotal, delivery_charge, total, payment_method, payment_status, order_status, transaction_id, payment_proof, delivery_type, pickup_location_id, pickup_location_name, pickup_slot)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
                    [
                        orderData.customer_name, orderData.customer_phone, orderData.customer_email,
                        orderData.address, orderData.city, orderData.state, orderData.pincode,
                        orderData.subtotal, orderData.delivery_charge, orderData.total,
                        orderData.payment_method, orderData.payment_status, orderData.order_status,
                        orderData.transaction_id, orderData.payment_proof,
                        orderData.delivery_type, orderData.pickup_location_id, orderData.pickup_location_name, orderData.pickup_slot
                    ]
                );
                await client.query("COMMIT");
                client.release();
            } catch {
                await client.query("ROLLBACK");
                client.release();
            }
        } catch {
            // DB offline, fall through to in-memory order
        }

        MOCK_ORDERS.unshift(orderData);

        // Dispatch instant notifications to Admin & Customer
        notifyAdminNewOrder(orderData).catch(() => {});
        sendNotification({
            userId: orderData.user_id,
            title: "Order Placed! 🌾",
            message: `Your Thulirva order #${orderData.id} worth ₹${Number(orderData.total || 0).toFixed(0)} has been placed successfully.`,
            type: "order_status",
            targetId: orderData.id,
            forAdmin: false
        }).catch(() => {});

        res.json({ success: true, order: orderData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* ADMIN ORDERS */
router.get("/admin/all", async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC`);
        if (result.rows.length) {
            return res.json({ success: true, orders: result.rows });
        }
        res.json({ success: true, orders: MOCK_ORDERS });
    } catch {
        res.json({ success: true, orders: MOCK_ORDERS });
    }
});

/* USER ORDERS */
router.get("/user/:identifier", async (req, res) => {
    const ident = req.params.identifier.trim().toLowerCase();
    const cleanPhone = ident.replace(/\D/g, "");
    try {
        const result = await pool.query(
            `SELECT * FROM orders WHERE LOWER(COALESCE(user_id, ''))=$1 OR LOWER(customer_email)=$1 OR customer_phone=$1 OR ($2 != '' AND REPLACE(customer_phone, ' ', '') LIKE $3) ORDER BY created_at DESC`,
            [ident, cleanPhone, `%${cleanPhone}%`]
        );
        if (result.rows && result.rows.length > 0) {
            return res.json({ success: true, orders: result.rows });
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

/* UPDATE ORDER STATUS (PUT & PATCH supported) */
const updateOrderStatusHandler = async (req, res) => {
    const id = parseInt(req.params.id);
    const status = req.body.status || req.body.order_status;
    const payment_status = req.body.payment_status;

    try {
        if (status) await pool.query(`UPDATE orders SET order_status=$1 WHERE id=$2`, [status, id]);
        if (payment_status) await pool.query(`UPDATE orders SET payment_status=$1 WHERE id=$2`, [payment_status, id]);
    } catch {
        // fallback
    }

    const order = MOCK_ORDERS.find(o => o.id === id);
    if (order) {
        if (status) order.order_status = status;
        if (payment_status) order.payment_status = payment_status;
        if (status) notifyOrderStatusChange(order, status).catch(() => {});
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
                order_status = CASE WHEN delivery_type = 'pickup' THEN 'preparing' ELSE 'processing' END,
                verified_at = CURRENT_TIMESTAMP,
                verified_by = $1
             WHERE id = $2`,
            [verifiedBy, id]
        );
    } catch {}

    const order = MOCK_ORDERS.find(o => o.id === id);
    if (order) {
        order.payment_status = "verified";
        order.order_status = order.delivery_type === "pickup" ? "preparing" : "processing";
        order.verified_at = new Date().toISOString();
        order.verified_by = verifiedBy;
        notifyOrderStatusChange(order, order.order_status).catch(() => {});
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
                rejection_reason = $1
             WHERE id = $2`,
            [reason, id]
        );
    } catch {}

    const order = MOCK_ORDERS.find(o => o.id === id);
    if (order) {
        order.payment_status = "rejected";
        order.rejection_reason = reason;
    }

    res.json({ success: true, message: "Payment rejected", reason, order });
};
router.put("/:id/reject-payment", rejectPaymentHandler);
router.post("/:id/reject-payment", rejectPaymentHandler);

/* CANCEL ORDER (ADMIN & CUSTOMER) */
const cancelOrderHandler = async (req, res) => {
    const id = parseInt(req.params.id);
    const reason = req.body.reason || req.body.cancellation_reason || "Cancelled by customer/admin";

    try {
        await pool.query(
            `UPDATE orders SET order_status = 'cancelled', cancellation_reason = $1 WHERE id = $2`,
            [reason, id]
        );
    } catch {}

    const order = MOCK_ORDERS.find(o => o.id === id);
    if (order) {
        order.order_status = "cancelled";
        order.cancellation_reason = reason;
        notifyOrderStatusChange(order, "cancelled").catch(() => {});
    }

    res.json({ success: true, message: "Order cancelled successfully", order });
};
router.put("/:id/cancel", cancelOrderHandler);
router.post("/:id/cancel", cancelOrderHandler);

/* MARK PICKUP READY */
router.put("/:id/ready-pickup", async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        await pool.query(
            `UPDATE orders SET order_status = 'ready_for_pickup' WHERE id = $1`,
            [id]
        );
    } catch {}

    const order = MOCK_ORDERS.find(o => o.id === id);
    if (order) {
        order.order_status = "ready_for_pickup";
        notifyOrderStatusChange(order, "ready_for_pickup").catch(() => {});
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
                pickup_collected_by = $1
             WHERE id = $2`,
            [collectedBy, id]
        );
    } catch {}

    const order = MOCK_ORDERS.find(o => o.id === id);
    if (order) {
        order.order_status = "collected";
        order.pickup_collected_at = new Date().toISOString();
        order.pickup_collected_by = collectedBy;
    }

    res.json({
        success: true,
        message: "Order successfully marked as collected",
        order
    });
});

/* GET ALL PAYMENT VERIFICATIONS & PAYMENT RECORDS (ADMIN) */
router.get("/admin/verifications", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM orders ORDER BY created_at DESC`
        );
        if (result.rows.length) {
            return res.json({ success: true, orders: result.rows });
        }
    } catch {}

    res.json({ success: true, orders: MOCK_ORDERS });
});

/* GET ALL PICKUP ORDERS */
router.get("/admin/pickup", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM orders WHERE delivery_type = 'pickup' OR is_pickup = true ORDER BY created_at DESC`
        );
        if (result.rows.length) {
            return res.json({ success: true, orders: result.rows });
        }
    } catch {}

    const pickupList = MOCK_ORDERS.filter(o => o.delivery_type === "pickup" || o.is_pickup === true);
    res.json({ success: true, orders: pickupList });
});

router.put("/:id/status", updateOrderStatusHandler);
router.patch("/:id/status", updateOrderStatusHandler);

module.exports = router;
