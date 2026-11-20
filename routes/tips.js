const express = require("express");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const {
    createTip,
    getPartnerTips,
    getAdminTips,
    settleTip,
    getOrderTip
} = require("../services/tipService");

const router = express.Router();
const adminTipRouter = express.Router();

/**
 * POST /api/tips
 * Customer submits an optional tip for a delivered order
 */
router.post("/", async (req, res) => {
    try {
        const {
            order_id,
            orderId,
            tip_amount,
            tipAmount,
            amount,
            payment_method,
            paymentMethod,
            transaction_ref,
            transactionRef,
            customer_name,
            customerName
        } = req.body;

        const resolvedOrderId = order_id || orderId;
        const resolvedAmount = tip_amount || tipAmount || amount;

        if (!resolvedOrderId) {
            return res.status(400).json({ success: false, message: "order_id is required." });
        }
        if (!resolvedAmount) {
            return res.status(400).json({ success: false, message: "tip_amount is required." });
        }

        const customerId = req.user ? req.user.id : (req.body.customer_id || null);
        const resolvedCustName = customer_name || customerName || (req.user ? req.user.name : null);

        const result = await createTip({
            orderId: resolvedOrderId,
            customerId,
            customerName: resolvedCustName,
            tipAmount: resolvedAmount,
            paymentMethod: payment_method || paymentMethod || "UPI",
            transactionRef: transaction_ref || transactionRef
        });

        return res.status(201).json(result);
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err.message || "Failed to submit tip."
        });
    }
});

/**
 * GET /api/tips/order/:orderId
 * Check if order already has a tip
 */
router.get("/order/:orderId", async (req, res) => {
    try {
        const { orderId } = req.params;
        const tip = await getOrderTip(orderId);
        return res.json({
            success: true,
            has_tipped: Boolean(tip),
            tip
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/tips/partner
 * Delivery partner retrieves their own tips & earnings breakdown
 */
router.get("/partner", async (req, res) => {
    try {
        let partnerId = req.partner?.partner_id || req.user?.id || req.query.partner_id || req.query.partnerId;
        if (!partnerId && req.headers["x-partner-id"]) {
            partnerId = req.headers["x-partner-id"];
        }

        if (!partnerId) {
            return res.status(400).json({ success: false, message: "partner_id is required." });
        }

        const data = await getPartnerTips(partnerId);
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/tips/partner/:partnerId
 * Delivery partner tips by partnerId
 */
router.get("/partner/:partnerId", async (req, res) => {
    try {
        const { partnerId } = req.params;
        const data = await getPartnerTips(partnerId);
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* =========================================================================
   ADMIN TIP MANAGEMENT
========================================================================= */

adminTipRouter.use(authenticateToken, adminOnly);

/**
 * GET /api/admin/tips
 * Admin views all tips across delivery partners and orders
 */
adminTipRouter.get("/", async (req, res) => {
    try {
        const { partner_id, partnerId, order_id, orderId, status, date, page, limit } = req.query;
        const data = await getAdminTips({
            partnerId: partner_id || partnerId,
            orderId: order_id || orderId,
            settlementStatus: status,
            date,
            page,
            limit
        });
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/tips/:tipId/settle
 * Admin marks a tip as settled
 */
adminTipRouter.post("/:tipId/settle", async (req, res) => {
    try {
        const { tipId } = req.params;
        const adminId = req.user ? req.user.id : 1;
        const adminName = req.user ? (req.user.name || "Super Admin") : "Super Admin";

        const result = await settleTip(tipId, adminId, adminName);
        return res.json(result);
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = {
    tipRouter: router,
    adminTipRouter
};
