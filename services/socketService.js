const { Server } = require("socket.io");
const { pool } = require("../config/database");

let io = null;

/**
 * Initialize Socket.IO on the HTTP server
 */
function initSocketServer(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]
        },
        pingTimeout: 30000,
        pingInterval: 10000
    });

    io.on("connection", (socket) => {
        console.log(`[SOCKET CONNECTED] ID: ${socket.id}`);

        // Delivery Partner joins private room
        socket.on("join:partner", (data) => {
            const partnerId = typeof data === "object" ? data?.partnerId : data;
            if (partnerId) {
                const room = `partner_${partnerId}`;
                socket.join(room);
                socket.partnerId = partnerId;
                console.log(`[SOCKET ROOM] Partner ${partnerId} joined ${room}`);

                // Broadcast online status to Admin channel
                io.to("admin_channel").emit("partner:status:changed", {
                    partnerId,
                    is_online: true,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Admin joins admin channel
        socket.on("join:admin", () => {
            socket.join("admin_channel");
            console.log(`[SOCKET ROOM] Admin joined admin_channel`);
        });

        // Customer or Admin tracks an order
        socket.on("join:order", (data) => {
            const orderId = typeof data === "object" ? data?.orderId : data;
            if (orderId) {
                const room = `order_${orderId}`;
                socket.join(room);
                console.log(`[SOCKET ROOM] Joined order room: ${room}`);
            }
        });

        // Customer joins user room
        socket.on("join:customer", (data) => {
            const userId = typeof data === "object" ? data?.userId : data;
            if (userId) {
                const room = `customer_${userId}`;
                socket.join(room);
                console.log(`[SOCKET ROOM] Joined customer room: ${room}`);
            }
        });

        // Partner GPS tracking update via WebSocket
        const handleLocationUpdate = async (data) => {
            try {
                if (!data) return;
                const partnerId = data.partnerId || socket.partnerId;
                const latitude = parseFloat(data.latitude);
                const longitude = parseFloat(data.longitude);
                const speed = parseFloat(data.speed || 0);
                const heading = parseFloat(data.heading || 0);
                const accuracy = parseFloat(data.accuracy || 0);

                if (!partnerId || isNaN(latitude) || isNaN(longitude)) return;

                // 1. Update PostgreSQL if connected
                try {
                    await pool.query(`
                        UPDATE delivery_partners 
                        SET current_latitude = $1, current_longitude = $2, location_updated_at = NOW(), updated_at = NOW()
                        WHERE partner_id = $3
                    `, [latitude, longitude, partnerId]);

                    await pool.query(`
                        INSERT INTO partner_location_history (partner_id, latitude, longitude, speed, heading, accuracy)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    `, [partnerId, latitude, longitude, speed, heading, accuracy]);
                } catch (e) {
                    // Ignore DB errors
                }

                // 2. Update persistent JSON store (Single Source of Truth) via gpsService
                try {
                    const { recordLocationUpdate } = require("./gpsService");
                    await recordLocationUpdate({
                        partner_id: partnerId,
                        latitude,
                        longitude,
                        speed,
                        heading,
                        accuracy,
                        active_delivery_id: data.orderId || data.active_delivery_id || null
                    });
                } catch (gpsErr) {
                    try {
                        const { getPartnerById, savePartner } = require("./deliveryPartnerService");
                        const partner = await getPartnerById(partnerId);
                        if (partner) {
                            partner.current_latitude = latitude;
                            partner.current_longitude = longitude;
                            partner.speed = speed;
                            partner.heading = heading;
                            partner.accuracy = accuracy;
                            partner.location_updated_at = new Date().toISOString();
                            partner.last_active_at = new Date().toISOString();
                            await savePartner(partner);
                        }
                    } catch (diskErr) {
                        console.warn("[SOCKET LOCATION DISK SAVE WARN]:", diskErr.message);
                    }
                }

                const updatePayload = {
                    partnerId,
                    partner_id: partnerId,
                    latitude,
                    longitude,
                    speed,
                    heading,
                    accuracy,
                    orderId: data.orderId || data.active_delivery_id || null,
                    active_delivery_id: data.orderId || data.active_delivery_id || null,
                    timestamp: new Date().toISOString()
                };

                // Broadcast live location to Admin channel
                io.to("admin_channel").emit("delivery:location_updated", updatePayload);
                io.to("admin_channel").emit("delivery:location:update", updatePayload);
                io.to("admin_channel").emit("fleet:location:updated", updatePayload);
                io.to("admin_channel").emit("partner:location:updated", updatePayload);
                io.to("admin_channel").emit("partner:location_updated", updatePayload);

                // Broadcast to active order room if specified
                const targetOrderId = data.orderId || data.active_delivery_id;
                if (targetOrderId) {
                    io.to(`order_${targetOrderId}`).emit("delivery:location_updated", updatePayload);
                    io.to(`order_${targetOrderId}`).emit("delivery:location:update", updatePayload);
                    io.to(`order_${targetOrderId}`).emit("partner:location:updated", updatePayload);
                    io.to(`order_${targetOrderId}`).emit("partner:location_updated", updatePayload);
                }

                // Broadcast to partner's own room
                io.to(`partner_${partnerId}`).emit("delivery:location_updated", updatePayload);
            } catch (err) {
                console.error("[SOCKET LOCATION ERROR]", err.message);
            }
        };

        socket.on("delivery:location:update", handleLocationUpdate);
        socket.on("delivery:location_updated", handleLocationUpdate);
        socket.on("partner:location:update", handleLocationUpdate);
        socket.on("partner:location_updated", handleLocationUpdate);

        // Partner availability / status toggle
        const handleStatusUpdate = async (data) => {
            try {
                const partnerId = data?.partnerId || socket.partnerId;
                const isOnline = Boolean(data?.is_online ?? data?.isOnline);
                if (!partnerId) return;

                try {
                    await pool.query(
                        "UPDATE delivery_partners SET is_online = $1, updated_at = NOW() WHERE partner_id = $2",
                        [isOnline, partnerId]
                    );
                } catch {}

                try {
                    const { getPartnerById, savePartner } = require("./deliveryPartnerService");
                    const partner = await getPartnerById(partnerId);
                    if (partner) {
                        partner.is_online = isOnline;
                        partner.last_active_at = new Date().toISOString();
                        await savePartner(partner);
                    }
                } catch (_) {}

                const statusPayload = {
                    partnerId,
                    is_online: isOnline,
                    timestamp: new Date().toISOString()
                };

                io.to("admin_channel").emit("partner:status:changed", statusPayload);
                io.to("admin_channel").emit("partner:status:updated", statusPayload);
            } catch (err) {}
        };

        socket.on("partner:availability", handleStatusUpdate);
        socket.on("partner:status:update", handleStatusUpdate);

        socket.on("disconnect", () => {
            if (socket.partnerId) {
                console.log(`[SOCKET DISCONNECT] Partner ${socket.partnerId} disconnected`);
            }
        });
    });

    console.log("[SOCKET.IO] Real-Time Socket Server initialized successfully");
    return io;
}

function getIO() {
    return io;
}

function emitToPartner(partnerId, event, data) {
    if (io) {
        io.to(`partner_${partnerId}`).emit(event, data);
        console.log(`[SOCKET EMIT] Sent [${event}] to partner_${partnerId}`);
    }
}

function emitToAdmin(event, data) {
    if (io) {
        io.to("admin_channel").emit(event, data);
        console.log(`[SOCKET EMIT] Sent [${event}] to admin_channel`);
    }
}

function emitToOrder(orderId, event, data) {
    if (io) {
        io.to(`order_${orderId}`).emit(event, data);
        console.log(`[SOCKET EMIT] Sent [${event}] to order_${orderId}`);
    }
}

function emitToCustomer(userId, event, data) {
    if (io) {
        io.to(`customer_${userId}`).emit(event, data);
        console.log(`[SOCKET EMIT] Sent [${event}] to customer_${userId}`);
    }
}

module.exports = {
    initSocketServer,
    getIO,
    emitToPartner,
    emitToAdmin,
    emitToOrder,
    emitToCustomer
};

