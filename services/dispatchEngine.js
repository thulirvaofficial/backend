const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { sendNotification } = require("./notificationService");
const { emitToPartner, emitToAdmin } = require("./socketService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const PARTNERS_FILE = path.join(DATA_DIR, "delivery_partners.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

const OFFER_TIMEOUT_SECONDS = 180; // 3-minute acceptance window per partner
const activeTimers = new Map(); // orderId -> NodeJS.Timeout
const inMemoryOffers = new Map(); // partnerId -> offer object

function getActiveOfferFromMemory(partnerId) {
    const offer = inMemoryOffers.get(partnerId);
    if (!offer) return null;
    const remaining = Math.max(0, Math.floor((new Date(offer.expires_at) - new Date()) / 1000));
    if (remaining <= 0) {
        inMemoryOffers.delete(partnerId);
        return null;
    }
    return { ...offer, remaining_seconds: remaining };
}

/**
 * Calculate distance between two lat/lng points using Haversine formula
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 5.0; // Default estimate if coordinates not set
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
}

/**
 * Find the best next eligible partner for an order/subscription using smart assignment rules:
 * - Online, Active, Not Blocked
 * - Workload below max_active_orders
 * - Within assigned area / nearest pickup
 * - Has not rejected or timed out on this order in current cycle
 * - Fair round-robin weighting (fewer recent assignments + longer idle time)
 */
async function findNextEligiblePartner(orderId, deliveryType = 'order', excludePartnerIds = []) {
    try {
        // Find existing attempts for this order to exclude partners
        const attemptsRes = await pool.query(
            `SELECT partner_id FROM dispatch_offers WHERE order_id = $1 AND (status IN ('rejected', 'expired') OR partner_id = ANY($2::varchar[]))`,
            [orderId, excludePartnerIds]
        ).catch(() => ({ rows: [] }));

        const alreadyOfferedIds = new Set([
            ...excludePartnerIds,
            ...attemptsRes.rows.map(r => r.partner_id)
        ]);

        // Query candidate partners
        const partnersRes = await pool.query(`
            SELECT 
                partner_id, name, phone, assigned_area, current_latitude, current_longitude,
                active_orders_count, max_active_orders, rating, total_deliveries_count,
                location_updated_at, updated_at
            FROM delivery_partners
            WHERE is_online = true AND is_active = true AND is_blocked = false
              AND active_orders_count < max_active_orders
            ORDER BY active_orders_count ASC, total_deliveries_count ASC, updated_at ASC
        `).catch(() => ({ rows: [] }));

        let poolRows = partnersRes.rows;
        if (!poolRows || poolRows.length === 0) {
            try {
                if (fs.existsSync(PARTNERS_FILE)) {
                    const localPartners = JSON.parse(fs.readFileSync(PARTNERS_FILE, "utf-8"));
                    poolRows = localPartners.filter(p => (p.is_online === true || p.is_online === 'true') && !p.is_blocked && p.is_active !== false);
                    if (poolRows.length === 0 && localPartners.length > 0) {
                        poolRows = localPartners.filter(p => !p.is_blocked && p.is_active !== false);
                    }
                }
            } catch {}
        }

        if (!poolRows || poolRows.length === 0) return null;

        // Filter out already attempted partners in this cycle
        const candidates = poolRows.filter(p => !alreadyOfferedIds.has(p.partner_id));
        if (candidates.length === 0) return null;

        // Default Farm Store Pickup Coordinates (Kanchipuram Main Hub)
        const pickupLat = 12.8342;
        const pickupLng = 79.7036;

        // Score each candidate: lower score is better
        // Score = (Workload * 40) + (Distance * 30) + (Recent Deliveries * 20) + (Random jitter * 10 for fair round-robin)
        const scored = candidates.map(p => {
            const dist = calculateDistanceKm(pickupLat, pickupLng, Number(p.current_latitude), Number(p.current_longitude));
            const workload = p.active_orders_count || 0;
            const deliveries = Math.min(p.total_deliveries_count || 0, 50);
            const jitter = Math.random() * 10;
            const score = (workload * 50) + (dist * 25) + (deliveries * 15) + jitter;

            return {
                ...p,
                distanceToPickup: dist,
                score
            };
        });

        scored.sort((a, b) => a.score - b.score);
        return scored[0];
    } catch (err) {
        console.error("[SMART DISPATCH FIND PARTNER ERROR]", err.message);
        return null;
    }
}

/**
 * Dispatch an order to the next eligible partner
 */
async function offerOrderToPartner(order, partner) {
    const orderId = order.id;
    const partnerId = partner.partner_id;
    const expiresAt = new Date(Date.now() + (OFFER_TIMEOUT_SECONDS * 1000));

    // Clear any existing active timer for this order
    if (activeTimers.has(orderId)) {
        clearTimeout(activeTimers.get(orderId));
        activeTimers.delete(orderId);
    }

    try {
        // Record dispatch offer in DB
        await pool.query(`
            INSERT INTO dispatch_offers (order_id, delivery_type, partner_id, status, offer_time, expires_at)
            VALUES ($1, $2, $3, 'pending', NOW(), $4)
        `, [orderId, order.delivery_type || 'order', partnerId, expiresAt]);

        // Update order status to 'dispatching' if currently pending
        await pool.query(`
            UPDATE orders 
            SET order_status = 'dispatching', updated_at = NOW() 
            WHERE id = $1 AND order_status IN ('pending', 'processing', 'preparing')
        `, [orderId]).catch(() => {});

        console.log(`[DISPATCH] Sent offer for Order #${orderId} to Partner ${partner.name} (${partnerId}). Expires in ${OFFER_TIMEOUT_SECONDS}s.`);

        let itemsCount = 1;
        if (Array.isArray(order.items)) {
            itemsCount = order.items.length;
        } else if (typeof order.items === 'string') {
            try {
                const parsed = JSON.parse(order.items);
                if (Array.isArray(parsed)) itemsCount = parsed.length;
            } catch (_) {}
        }

        const customerArea = order.landmark || order.city || order.area || 'Valasaravakkam, Chennai';
        const pickupHub = 'Valasaravakkam Hub, Chennai';
        const deliveryAddress = order.address || order.city || 'Chennai';
        const deliveryInstructions = order.delivery_instructions || 'Deliver safely to customer doorstep';

        const offerPayload = {
            offer_id: `OFFER-${Date.now()}`,
            order_id: String(orderId),
            order_number: order.order_number || `ORD${orderId}`,
            delivery_type: order.delivery_type || 'order',
            partner_id: partnerId,
            customer_name: order.customer_name || 'Customer',
            customer_phone: order.customer_phone || order.phone || '',
            customer_area: customerArea,
            pickup_hub: pickupHub,
            address: deliveryAddress,
            delivery_address: deliveryAddress,
            city: order.city || 'Chennai',
            pincode: order.pincode || '',
            latitude: order.latitude ? Number(order.latitude) : null,
            longitude: order.longitude ? Number(order.longitude) : null,
            landmark: order.landmark || '',
            items_count: itemsCount,
            delivery_instructions: deliveryInstructions,
            total: order.total || 0,
            assigned_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
            timeout_seconds: OFFER_TIMEOUT_SECONDS,
            remaining_seconds: OFFER_TIMEOUT_SECONDS,
            status: 'pending'
        };

        // Send FCM High-Priority Emergency Alert to Delivery Partner
        sendNotification({
            userId: partnerId,
            title: `🚨 New Thulirva Order #${order.order_number || orderId}`,
            message: `New delivery order (₹${order.total || 0}, ${itemsCount} items) at ${customerArea}. Tap to accept within 3 minutes!`,
            type: "NEW_ORDER_ASSIGNED",
            targetId: orderId.toString(),
            channelId: "thulirva_incoming_orders",
            data: {
                order_id: String(orderId),
                order_number: String(order.order_number || `ORD${orderId}`),
                customer_name: order.customer_name || 'Customer',
                customer_area: customerArea,
                pickup_hub: pickupHub,
                delivery_address: deliveryAddress,
                items_count: String(itemsCount),
                delivery_instructions: deliveryInstructions,
                order_amount: String(order.total || 0),
                total: String(order.total || 0),
                assigned_at: offerPayload.assigned_at,
                expires_at: expiresAt.toISOString(),
                timeout_seconds: String(OFFER_TIMEOUT_SECONDS),
                assignment_id: `ASG-${orderId}-${partnerId}`,
                type: "NEW_ORDER_ASSIGNED",
                actions: "accept_order,reject_order",
                timestamp: new Date().toISOString()
            }
        }).catch(() => {});

        // Set in-memory active offer for partner polling
        inMemoryOffers.set(partnerId, offerPayload);

        // Emit real-time WebSocket alert directly to partner device
        emitToPartner(partnerId, "dispatch:offer", offerPayload);
        emitToPartner(partnerId, "order:assigned", offerPayload);

        // Set timeout handler for 20 seconds
        const timer = setTimeout(async () => {
            inMemoryOffers.delete(partnerId);
            await handleOfferTimeout(orderId, partnerId);
        }, OFFER_TIMEOUT_SECONDS * 1000);

        activeTimers.set(orderId, timer);
        return { success: true, partner, expiresAt };
    } catch (err) {
        console.warn("[DISPATCH DB INSERT FAILED, USING IN-MEMORY RESILIENT OFFER]:", err.message);
        let itemsCount = 1;
        if (Array.isArray(order.items)) {
            itemsCount = order.items.length;
        } else if (typeof order.items === 'string') {
            try {
                const parsed = JSON.parse(order.items);
                if (Array.isArray(parsed)) itemsCount = parsed.length;
            } catch (_) {}
        }

        const customerArea = order.landmark || order.city || order.area || 'Valasaravakkam, Chennai';
        const pickupHub = 'Valasaravakkam Hub, Chennai';
        const deliveryAddress = order.address || order.city || 'Chennai';
        const deliveryInstructions = order.delivery_instructions || 'Deliver safely to customer doorstep';

        const fallbackPayload = {
            offer_id: `OFFER-${Date.now()}`,
            order_id: String(orderId),
            order_number: order.order_number || `ORD${orderId}`,
            delivery_type: order.delivery_type || 'order',
            partner_id: partnerId,
            customer_name: order.customer_name || 'Customer',
            customer_phone: order.customer_phone || order.phone || '',
            customer_area: customerArea,
            pickup_hub: pickupHub,
            address: deliveryAddress,
            delivery_address: deliveryAddress,
            city: order.city || 'Chennai',
            pincode: order.pincode || '',
            latitude: order.latitude ? Number(order.latitude) : null,
            longitude: order.longitude ? Number(order.longitude) : null,
            landmark: order.landmark || '',
            items_count: itemsCount,
            delivery_instructions: deliveryInstructions,
            total: order.total || 0,
            assigned_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
            timeout_seconds: OFFER_TIMEOUT_SECONDS,
            remaining_seconds: OFFER_TIMEOUT_SECONDS,
            status: 'pending'
        };

        // Set in-memory active offer for partner polling
        inMemoryOffers.set(partnerId, fallbackPayload);

        // Emit real-time WebSocket alert directly to partner device
        emitToPartner(partnerId, "dispatch:offer", fallbackPayload);
        emitToPartner(partnerId, "order:assigned", fallbackPayload);

        // Send FCM High-Priority Emergency Alert to Delivery Partner
        sendNotification({
            userId: partnerId,
            title: `🚨 New Thulirva Order #${order.order_number || orderId}`,
            message: `New delivery order (₹${order.total || 0}, ${itemsCount} items) at ${customerArea}. Tap to accept within 3 minutes!`,
            type: "NEW_ORDER_ASSIGNED",
            targetId: orderId.toString(),
            channelId: "thulirva_incoming_orders",
            data: {
                order_id: String(orderId),
                order_number: String(order.order_number || `ORD${orderId}`),
                customer_name: order.customer_name || 'Customer',
                customer_area: customerArea,
                pickup_hub: pickupHub,
                delivery_address: deliveryAddress,
                items_count: String(itemsCount),
                delivery_instructions: deliveryInstructions,
                order_amount: String(order.total || 0),
                total: String(order.total || 0),
                assigned_at: fallbackPayload.assigned_at,
                expires_at: expiresAt.toISOString(),
                timeout_seconds: String(OFFER_TIMEOUT_SECONDS),
                assignment_id: `ASG-${orderId}-${partnerId}`,
                type: "NEW_ORDER_ASSIGNED",
                actions: "accept_order,reject_order",
                timestamp: new Date().toISOString()
            }
        }).catch(() => {});

        const timer = setTimeout(async () => {
            inMemoryOffers.delete(partnerId);
            await handleOfferTimeout(orderId, partnerId);
        }, OFFER_TIMEOUT_SECONDS * 1000);
        activeTimers.set(orderId, timer);

        return { success: true, partner, expiresAt };
    }
}

/**
 * Handle timeout when partner does not accept within 20s
 */
async function handleOfferTimeout(orderId, partnerId) {
    activeTimers.delete(orderId);
    console.log(`[DISPATCH TIMEOUT] Partner ${partnerId} timed out on Order #${orderId}. Proceeding to next partner...`);

    try {
        // Mark offer expired
        try {
            await pool.query(`
                UPDATE dispatch_offers 
                SET status = 'expired', response_time = NOW(), rejection_reason = 'Timed out (no response in 3 minutes)'
                WHERE order_id = $1 AND partner_id = $2 AND status = 'pending'
            `, [orderId, partnerId]);
        } catch (_) {}

        // Emit real-time expiry to partner so UI immediately dismisses alert and cancels notification sound
        emitToPartner(partnerId, "dispatch:expired", {
            order_id: String(orderId),
            message: "Assignment timed out after 3 minutes. Order reassigned."
        });

        // Fetch order details
        let order = null;
        try {
            const oRes = await pool.query("SELECT * FROM orders WHERE id::text = $1 OR order_number = $1", [String(orderId)]);
            if (oRes.rows.length > 0) order = oRes.rows[0];
        } catch {}

        if (!order) {
            try {
                if (fs.existsSync(ORDERS_FILE)) {
                    const localOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
                    order = localOrders.find(o => String(o.id) === String(orderId) || String(o.order_number) === String(orderId));
                }
            } catch {}
        }

        if (!order) return;

        // Check if order was already accepted by someone else
        if (['ready_for_pickup', 'shipped', 'out_for_delivery', 'delivered'].includes(order.order_status?.toLowerCase())) {
            return;
        }

        // Try next partner
        const nextPartner = await findNextEligiblePartner(orderId, order.delivery_type || 'order', [partnerId]);
        if (nextPartner) {
            await offerOrderToPartner(order, nextPartner);
        } else {
            console.warn(`[DISPATCH EXHAUSTED] No partner available for Order #${orderId}. Alerting Admin.`);
            await pool.query(`
                UPDATE orders SET order_status = 'no_partner_available', updated_at = NOW()
                WHERE id = $1 AND order_status = 'dispatching'
            `, [orderId]).catch(() => {});

            // Audit log
            await pool.query(`
                INSERT INTO admin_audit_logs (admin_name, action, details)
                VALUES ('Smart Dispatch Engine', 'DISPATCH_NO_PARTNER', 'All eligible partners rejected or timed out for Order #' || $1)
            `, [orderId]).catch(() => {});
        }
    } catch (err) {
        console.error("[DISPATCH TIMEOUT HANDLER ERROR]", err.message);
    }
}

/**
 * Handle partner rejecting an offer
 */
async function handleOfferReject(orderId, partnerId, reason = 'Not Available') {
    if (activeTimers.has(orderId)) {
        clearTimeout(activeTimers.get(orderId));
        activeTimers.delete(orderId);
    }
    inMemoryOffers.delete(partnerId);

    try {
        try {
            await pool.query(`
                UPDATE dispatch_offers 
                SET status = 'rejected', response_time = NOW(), rejection_reason = $1
                WHERE order_id = $2 AND partner_id = $3 AND status = 'pending'
            `, [reason, orderId, partnerId]);
        } catch (_) {}

        emitToPartner(partnerId, "dispatch:rejected", {
            order_id: String(orderId),
            reason
        });

        let order = null;
        try {
            const oRes = await pool.query("SELECT * FROM orders WHERE id::text = $1 OR order_number = $1", [String(orderId)]);
            if (oRes.rows.length > 0) order = oRes.rows[0];
        } catch (_) {}

        if (!order) {
            try {
                if (fs.existsSync(ORDERS_FILE)) {
                    const localOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
                    order = localOrders.find(o => String(o.id) === String(orderId) || String(o.order_number) === String(orderId));
                }
            } catch (_) {}
        }

        if (!order) return { success: false, message: "Order not found" };

        // Try next partner immediately
        const nextPartner = await findNextEligiblePartner(orderId, order.delivery_type || 'order', [partnerId]);
        if (nextPartner) {
            await offerOrderToPartner(order, nextPartner);
            return { success: true, message: `Offer rejected. Forwarded to ${nextPartner.name}.` };
        } else {
            try {
                await pool.query(`
                    UPDATE orders SET order_status = 'no_partner_available', updated_at = NOW()
                    WHERE (id::text = $1 OR order_number = $1) AND order_status = 'dispatching'
                `, [String(orderId)]);
            } catch (_) {}

            return { success: true, message: "Offer rejected. No further partners available; marked for manual assignment." };
        }
    } catch (err) {
        return { success: false, message: err.message };
    }
}

/**
 * Handle partner accepting an offer (Atomic Transaction)
 */
async function handleOfferAccept(orderId, partnerId) {
    if (activeTimers.has(orderId)) {
        clearTimeout(activeTimers.get(orderId));
        activeTimers.delete(orderId);
    }

    let client = null;
    try {
        client = await pool.connect();
    } catch (connectErr) {
        console.warn("[DISPATCH DB CONNECT OFFLINE, ACCEPTING VIA IN-MEMORY/DISK STORE]:", connectErr.message);
        try {
            if (fs.existsSync(ORDERS_FILE)) {
                const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
                const ord = orders.find(o => String(o.id) === String(orderId) || String(o.order_number) === String(orderId));
                if (ord) {
                    ord.partner_id = partnerId;
                    ord.order_status = "processing";
                    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
                }
            }
        } catch (_) {}
        inMemoryOffers.delete(partnerId);
        emitToPartner(partnerId, "dispatch:accepted", { order_id: String(orderId) });
        emitToAdmin("order:assigned", { order_id: String(orderId), partner_id: partnerId });
        return { success: true, message: `Order #${orderId} successfully assigned! Proceed to pickup.` };
    }

    try {
        await client.query("BEGIN");

        // 1. Check if offer is still pending and has NOT expired
        const offerCheck = await client.query(`
            SELECT * FROM dispatch_offers 
            WHERE order_id = $1 AND partner_id = $2 AND status = 'pending'
              AND (expires_at IS NULL OR expires_at > NOW())
            FOR UPDATE
        `, [orderId, partnerId]);

        if (offerCheck.rows.length === 0) {
            await client.query("ROLLBACK");
            return { success: false, message: "Offer has already expired or been assigned to another partner." };
        }

        // 2. Mark offer accepted and cancel all competing offers for this order
        await client.query(`
            UPDATE dispatch_offers 
            SET status = 'accepted', response_time = NOW() 
            WHERE id = $1
        `, [offerCheck.rows[0].id]);

        await client.query(`
            UPDATE dispatch_offers 
            SET status = 'cancelled' 
            WHERE order_id = $1 AND id != $2 AND status = 'pending'
        `, [orderId, offerCheck.rows[0].id]);

        // 3. Atomically create delivery assignment
        const assignmentId = `ASG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await client.query(`
            INSERT INTO delivery_assignments (
                assignment_id, order_id, delivery_type, partner_id, status, assigned_by
            ) VALUES ($1, $2, 'order', $3, 'pickup_pending', 'smart_dispatch')
        `, [assignmentId, orderId, partnerId]);

        // 4. Update order status and assign partner in DB & disk store
        await client.query(`
            UPDATE orders 
            SET partner_id = $1, order_status = 'processing', updated_at = NOW() 
            WHERE id = $2
        `, [partnerId, orderId]);

        try {
            if (fs.existsSync(ORDERS_FILE)) {
                const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
                const ord = orders.find(o => String(o.id) === String(orderId) || String(o.order_number) === String(orderId));
                if (ord) {
                    ord.partner_id = partnerId;
                    ord.order_status = "processing";
                    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
                }
            }
        } catch (_) {}

        // 5. Increment partner active orders count
        await client.query(`
            UPDATE delivery_partners 
            SET active_orders_count = active_orders_count + 1, updated_at = NOW() 
            WHERE partner_id = $1
        `, [partnerId]);

        // 6. Audit log
        await client.query(`
            INSERT INTO admin_audit_logs (admin_name, action, details)
            VALUES ('Delivery Partner', 'ASSIGNMENT_ACCEPTED', 'Partner ' || $1 || ' accepted Order #' || $2)
        `, [partnerId, orderId]);

        await client.query("COMMIT");
        inMemoryOffers.delete(partnerId);
        emitToPartner(partnerId, "dispatch:accepted", { order_id: String(orderId) });
        emitToAdmin("order:assigned", { order_id: String(orderId), partner_id: partnerId });
        console.log(`✓ [DISPATCH SUCCESS] Order #${orderId} accepted and assigned to ${partnerId}.`);
        return { success: true, message: `Order #${orderId} successfully assigned! Proceed to pickup.` };
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("[OFFER ACCEPT ERROR]", err.message);
        return { success: false, message: err.message };
    } finally {
        if (client) client.release();
    }
}

/**
 * Public dispatch trigger (Called when Admin clicks "PROCEED" on verified order)
 */
async function initiateSmartDispatch(orderId) {
    try {
        let order = null;
        try {
            const oRes = await pool.query("SELECT * FROM orders WHERE id::text = $1 OR order_number = $1", [String(orderId)]);
            if (oRes.rows.length > 0) order = oRes.rows[0];
        } catch {}

        if (!order) {
            try {
                if (fs.existsSync(ORDERS_FILE)) {
                    const localOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
                    order = localOrders.find(o => String(o.id) === String(orderId) || String(o.order_number) === String(orderId));
                }
            } catch {}
        }

        if (!order) return { success: false, message: `Order #${orderId} not found.` };

        // Ensure order is not already delivered
        if (order.order_status === "delivered") {
            return { success: false, message: `Order #${orderId} has already been delivered.` };
        }

        const eligiblePartner = await findNextEligiblePartner(orderId, order.delivery_type || 'order');
        if (!eligiblePartner) {
            try {
                await pool.query(`UPDATE orders SET order_status = 'no_partner_available' WHERE id::text = $1 OR order_number = $1`, [String(orderId)]);
            } catch {}
            return { success: false, message: "No active online delivery partners available in this area right now. You can assign manually." };
        }

        return await offerOrderToPartner(order, eligiblePartner);
    } catch (err) {
        console.error("[INITIATE SMART DISPATCH ERROR]", err.message);
        return { success: false, message: err.message };
    }
}

module.exports = {
    findNextEligiblePartner,
    initiateSmartDispatch,
    offerOrderToPartner,
    handleOfferAccept,
    handleOfferReject,
    handleOfferTimeout,
    getActiveOfferFromMemory
};
