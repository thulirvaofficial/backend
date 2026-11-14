const { pool } = require("../config/database");
const { emitToAdmin, emitToCustomer, emitToPartner, emitToOrder, getIO } = require("../services/socketService");

/**
 * Strict Delivery Lifecycle States:
 * 1. PLACED
 * 2. CONFIRMED
 * 3. PREPARING
 * 4. ASSIGNED
 * 5. PICKED_UP
 * 6. OUT_FOR_DELIVERY
 * 7. DELIVERED
 */

function normalizeStatus(raw) {
    if (!raw) return "placed";
    const s = raw.toString().trim().toLowerCase().replace(/[\s\-]/g, "_");
    if (s === "placed") return "placed";
    if (s === "confirmed" || s === "order_confirmed") return "confirmed";
    if (s === "preparing" || s === "processing") return "preparing";
    if (s === "assigned" || s === "rider_assigned" || s === "partner_assigned") return "assigned";
    if (s === "picked_up" || s === "pickup_confirmed" || s === "pickup" || s === "hub_pickup") return "picked_up";
    if (s === "out_for_delivery" || s === "in_transit" || s === "transit" || s === "delivering" || s === "shipped") return "out_for_delivery";
    if (s === "delivered" || s === "completed" || s === "doorstep_delivered") return "delivered";
    if (s === "cancelled" || s === "canceled") return "cancelled";
    if (s === "failed" || s === "delivery_failed") return "failed";
    return s;
}

/**
 * Validate Transition along the mandatory lifecycle:
 * PLACED -> CONFIRMED -> PREPARING -> ASSIGNED -> PICKED_UP -> OUT_FOR_DELIVERY -> DELIVERED
 */
function validateTransition(currentStatusRaw, targetStatusRaw, { partnerId, orderPartnerId, hasProof = false, isAdmin = false } = {}) {
    const current = normalizeStatus(currentStatusRaw);
    const target = normalizeStatus(targetStatusRaw);

    // 1. Check if order is permanently locked
    if (current === "delivered") {
        return {
            valid: false,
            code: "ORDER_LOCKED",
            status: 400,
            message: "Order has already been delivered and locked. Status cannot be modified."
        };
    }

    // 2. Partner Authorization check
    if (!isAdmin && orderPartnerId && partnerId) {
        if (orderPartnerId.toString().toLowerCase() !== partnerId.toString().toLowerCase()) {
            return {
                valid: false,
                code: "UNAUTHORIZED_PARTNER",
                status: 403,
                message: `You are not authorized to update this order. Order is assigned to partner ${orderPartnerId}.`
            };
        }
    }

    // Admins have override privileges for exceptional dispatch corrections
    if (isAdmin) {
        return { valid: true, current, target };
    }

    // Same state idempotent update is allowed
    if (current === target) {
        return { valid: true, current, target };
    }

    // Cancellation / failure allowed from active stages
    if (target === "cancelled" || target === "failed") {
        return { valid: true, current, target };
    }

    // Step-by-step state transition rules
    if (target === "confirmed") {
        if (current === "placed") return { valid: true, current, target };
    }

    if (target === "preparing") {
        if (current === "placed" || current === "confirmed") return { valid: true, current, target };
    }

    if (target === "assigned") {
        if (current === "placed" || current === "confirmed" || current === "preparing") return { valid: true, current, target };
    }

    // PICKED_UP: From assigned, preparing, or confirmed
    if (target === "picked_up") {
        if (current === "assigned" || current === "preparing" || current === "confirmed") {
            return { valid: true, current, target };
        }
        return {
            valid: false,
            code: "INVALID_TRANSITION",
            status: 400,
            message: `Cannot confirm pickup from current status "${currentStatusRaw}". Order must be assigned first.`
        };
    }

    // OUT_FOR_DELIVERY: From picked_up (or assigned)
    if (target === "out_for_delivery") {
        if (current === "picked_up" || current === "assigned") {
            return { valid: true, current, target };
        }
        return {
            valid: false,
            code: "PICKUP_REQUIRED",
            status: 400,
            message: "Cannot start delivery: order must be picked up from hub/store first."
        };
    }

    // DELIVERED: From out_for_delivery (requires mandatory delivery proof)
    if (target === "delivered") {
        if (current !== "out_for_delivery" && current !== "picked_up") {
            return {
                valid: false,
                code: "TRANSIT_REQUIRED",
                status: 400,
                message: "Cannot mark delivered: order must be out for delivery first."
            };
        }
        if (!hasProof) {
            return {
                valid: false,
                code: "PROOF_REQUIRED",
                status: 400,
                message: "Cannot complete delivery: mandatory delivery proof photo is required."
            };
        }
        return { valid: true, current, target };
    }

    return {
        valid: false,
        code: "INVALID_TRANSITION",
        status: 400,
        message: `Invalid state transition from "${currentStatusRaw}" to "${targetStatusRaw}".`
    };
}

/**
 * Record status history in PostgreSQL database and order timeline object
 */
async function recordStatusHistory({ orderId, status, partnerId, notes, latitude, longitude }) {
    const timestamp = new Date().toISOString();
    const actor = partnerId ? `Partner ${partnerId}` : "System / Operations";

    try {
        await pool.query(`
            INSERT INTO order_status_history (order_id, status, notes, changed_by, created_at)
            VALUES ($1, $2, $3, $4, NOW())
        `, [String(orderId), status, notes || `Stage advanced to ${status}`, actor]);
    } catch (_) {}

    return {
        status,
        timestamp,
        actor,
        notes: notes || `Stage advanced to ${status}`,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null
    };
}

/**
 * Broadcast real-time Socket.IO events for each stage
 */
function broadcastStatusChange({ orderId, status, partnerId, userId, additionalData = {} }) {
    const norm = normalizeStatus(status);

    const payload = {
        order_id: String(orderId),
        orderId: String(orderId),
        status: norm,
        order_status: norm,
        raw_status: status,
        partner_id: partnerId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        ...additionalData
    };

    // 1. Broadcast to Admin Channel
    emitToAdmin("order:updated", payload);
    emitToAdmin("order:status_updated", payload);
    emitToAdmin("delivery:status:update", payload);
    emitToAdmin(`order:${norm}`, payload);

    // Explicit delivery lifecycle events specified in master tracking protocol
    if (norm === "assigned") emitToAdmin("delivery:assigned", payload);
    if (norm === "accepted") emitToAdmin("delivery:accepted", payload);
    if (norm === "arrived") emitToAdmin("delivery:arrived", payload);
    if (norm === "picked_up") emitToAdmin("delivery:picked_up", payload);
    if (norm === "out_for_delivery" || norm === "in_transit") emitToAdmin("delivery:in_transit", payload);
    if (norm === "delivered") emitToAdmin("delivery:delivered", payload);

    // 2. Broadcast to Order-specific room (Customer App & Live Tracking)
    emitToOrder(orderId, "order:status_updated", payload);
    emitToOrder(orderId, "order:status", payload);
    emitToOrder(orderId, "order:updated", payload);
    emitToOrder(orderId, `order:${norm}`, payload);
    if (norm === "assigned") emitToOrder(orderId, "delivery:assigned", payload);
    if (norm === "accepted") emitToOrder(orderId, "delivery:accepted", payload);
    if (norm === "arrived") emitToOrder(orderId, "delivery:arrived", payload);
    if (norm === "picked_up") emitToOrder(orderId, "delivery:picked_up", payload);
    if (norm === "out_for_delivery" || norm === "in_transit") emitToOrder(orderId, "delivery:in_transit", payload);
    if (norm === "delivered") emitToOrder(orderId, "delivery:delivered", payload);

    // 3. Broadcast to Delivery Partner
    if (partnerId) {
        emitToPartner(partnerId, "order:status_updated", payload);
        emitToPartner(partnerId, `order:${norm}`, payload);
        if (norm === "assigned") emitToPartner(partnerId, "delivery:assigned", payload);
        if (norm === "accepted") emitToPartner(partnerId, "delivery:accepted", payload);
        if (norm === "arrived") emitToPartner(partnerId, "delivery:arrived", payload);
        if (norm === "picked_up") emitToPartner(partnerId, "delivery:picked_up", payload);
        if (norm === "out_for_delivery" || norm === "in_transit") emitToPartner(partnerId, "delivery:in_transit", payload);
        if (norm === "delivered") emitToPartner(partnerId, "delivery:delivered", payload);
    }

    // 4. Broadcast to Customer
    if (userId) {
        emitToCustomer(userId, "order:status_updated", payload);
        emitToCustomer(userId, "customer:delivery:updated", payload);
        emitToCustomer(userId, `order:${norm}`, payload);
        if (norm === "out_for_delivery" || norm === "in_transit") emitToCustomer(userId, "delivery:in_transit", payload);
        if (norm === "delivered") emitToCustomer(userId, "delivery:delivered", payload);
    }

    // 5. Global broadcast across all sockets for active views
    try {
        const io = getIO();
        if (io) {
            io.emit("order:status_updated", payload);
            io.emit("delivery:status:update", payload);
            io.emit(`order:${norm}`, payload);
            if (norm === "assigned") io.emit("delivery:assigned", payload);
            if (norm === "accepted") io.emit("delivery:accepted", payload);
            if (norm === "arrived") io.emit("delivery:arrived", payload);
            if (norm === "picked_up") {
                io.emit("delivery:picked_up", payload);
                io.emit("order:pickup_confirmed", payload);
            }
            if (norm === "out_for_delivery" || norm === "in_transit") {
                io.emit("delivery:in_transit", payload);
                io.emit("order:in_transit", payload);
            }
            if (norm === "delivered") io.emit("delivery:delivered", payload);
        }
    } catch (_) {}
}

module.exports = {
    normalizeStatus,
    validateTransition,
    recordStatusHistory,
    broadcastStatusChange
};
