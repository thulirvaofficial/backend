const { pool } = require("../config/database");
const { emitToAdmin, emitToCustomer, emitToPartner } = require("../services/socketService");

/**
 * Normalized Delivery Lifecycle States:
 * 1. PLACED / CONFIRMED / ASSIGNED
 * 2. PICKUP_CONFIRMED
 * 3. IN_TRANSIT
 * 4. DELIVERED
 */

function normalizeStatus(raw) {
    if (!raw) return "assigned";
    const s = raw.toString().trim().toLowerCase().replace(/[\s\-]/g, "_");
    if (s === "pickup" || s === "hub_pickup" || s === "picked_up" || s === "pickup_confirmed") {
        return "pickup_confirmed";
    }
    if (s === "in_transit" || s === "out_for_delivery" || s === "transit" || s === "delivering") {
        return "in_transit";
    }
    if (s === "delivered" || s === "completed" || s === "doorstep_delivered") {
        return "delivered";
    }
    if (s === "assigned" || s === "processing" || s === "placed" || s === "confirmed" || s === "accepted" || s === "ready_for_pickup") {
        return "assigned";
    }
    return s;
}

/**
 * Validate Transition along the mandatory lifecycle:
 * ASSIGNED -> PICKUP_CONFIRMED -> IN_TRANSIT -> DELIVERED
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
    if (target === "cancelled" || target === "failed" || target === "delivery_failed") {
        return { valid: true, current, target };
    }

    // 3. Stage 1 -> Stage 2: ASSIGNED -> PICKUP_CONFIRMED
    if (target === "pickup_confirmed") {
        if (current !== "assigned") {
            return {
                valid: false,
                code: "INVALID_TRANSITION",
                status: 400,
                message: `Cannot confirm pickup from current status "${currentStatusRaw}".`
            };
        }
        return { valid: true, current, target };
    }

    // 4. Stage 2 -> Stage 3: PICKUP_CONFIRMED -> IN_TRANSIT
    if (target === "in_transit") {
        if (current !== "pickup_confirmed") {
            return {
                valid: false,
                code: "PICKUP_REQUIRED",
                status: 400,
                message: "Cannot start delivery: order must be picked up from hub/store first."
            };
        }
        return { valid: true, current, target };
    }

    // 5. Stage 3 -> Stage 4: IN_TRANSIT -> DELIVERED
    if (target === "delivered") {
        if (current !== "in_transit") {
            return {
                valid: false,
                code: "TRANSIT_REQUIRED",
                status: 400,
                message: "Cannot mark delivered: order must be in transit before completing delivery."
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
        `, [orderId, status, notes || `Stage advanced to ${status}`, actor]);
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
        order_id: orderId,
        status: norm,
        raw_status: status,
        partner_id: partnerId,
        timestamp: new Date().toISOString(),
        ...additionalData
    };

    // Generic updates
    emitToAdmin("order:updated", payload);
    emitToAdmin("delivery:status:update", payload);

    // Stage-specific socket events required by UI
    if (norm === "pickup_confirmed") {
        emitToAdmin("order:pickup_confirmed", payload);
        if (partnerId) emitToPartner(partnerId, "order:pickup_confirmed", payload);
        if (userId) emitToCustomer(userId, "order:pickup_confirmed", payload);
    } else if (norm === "in_transit") {
        emitToAdmin("order:in_transit", payload);
        if (partnerId) emitToPartner(partnerId, "order:in_transit", payload);
        if (userId) emitToCustomer(userId, "order:in_transit", payload);
    } else if (norm === "delivered") {
        emitToAdmin("order:delivered", payload);
        emitToAdmin("order:delivery:completed", payload);
        if (partnerId) emitToPartner(partnerId, "delivery:completed", payload);
        if (userId) emitToCustomer(userId, "order:delivered", payload);
    }

    if (partnerId) {
        emitToPartner(partnerId, "order:status_updated", payload);
    }
    if (userId) {
        emitToCustomer(userId, "order:status_updated", payload);
        emitToCustomer(userId, "customer:delivery:updated", payload);
    }
}

module.exports = {
    normalizeStatus,
    validateTransition,
    recordStatusHistory,
    broadcastStatusChange
};

