const fs = require("fs");
const path = require("path");
const { getIO } = require("./socketService");
const { sendNotification } = require("./notificationService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const CHATS_FILE = path.join(DATA_DIR, "order_chats.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function loadChats() {
    try {
        if (!fs.existsSync(CHATS_FILE)) {
            fs.writeFileSync(CHATS_FILE, JSON.stringify({}, null, 2), "utf-8");
            return {};
        }
        const raw = fs.readFileSync(CHATS_FILE, "utf-8");
        return JSON.parse(raw || "{}");
    } catch (_) {
        return {};
    }
}

function saveChats(chats) {
    try {
        const dir = path.dirname(CHATS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2), "utf-8");
    } catch (e) {
        console.error("[ChatService] Failed to save chats:", e.message);
    }
}

function getOrder(orderId) {
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
            return orders.find(o => o.id?.toString() === orderId.toString() || o.order_number === orderId.toString()) || null;
        }
    } catch (_) {}
    return null;
}

async function getChatMessages(orderId) {
    if (!orderId) return [];
    const chats = loadChats();
    const idKey = orderId.toString();
    const list = chats[idKey] || [];

    if (list.length === 0) {
        // Welcome system message
        const welcomeMsg = {
            id: `sys-${idKey}-0`,
            order_id: idKey,
            sender: "system",
            sender_name: "Thulirva Support",
            text: "Chat connected with your delivery partner. You can send delivery notes or questions directly here.",
            status: "delivered",
            is_read: true,
            timestamp: new Date().toISOString()
        };
        chats[idKey] = [welcomeMsg];
        saveChats(chats);
        return [welcomeMsg];
    }
    return list;
}

async function saveChatMessage(orderId, { sender = "customer", sender_name, text = "", role }) {
    if (!orderId || !text.trim()) {
        throw new Error("Order ID and message text are required");
    }
    const idKey = orderId.toString();
    const order = getOrder(idKey);

    // Lifecycle enforcement: chat is closed for completed / cancelled orders
    if (order) {
        const s = (order.order_status || order.status || "").toLowerCase();
        if (s === "delivered" || s === "completed" || s === "cancelled" || s === "failed") {
            throw new Error("Chat is closed because this delivery has already been completed.");
        }
    }

    const chats = loadChats();
    if (!chats[idKey]) chats[idKey] = [];

    const effectiveRole = (role || sender).toLowerCase();
    const isPartner = effectiveRole.includes("partner") || effectiveRole.includes("driver") || effectiveRole.includes("rider");
    const senderType = isPartner ? "partner" : (effectiveRole === "admin" ? "admin" : "customer");

    const newMsg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        order_id: idKey,
        sender: senderType, // 'customer', 'partner', 'admin', 'system'
        sender_name: sender_name || (senderType === "partner" ? "Delivery Partner" : "Customer"),
        text: text.trim(),
        status: "sent",
        is_read: false,
        read_at: null,
        timestamp: new Date().toISOString()
    };

    chats[idKey].push(newMsg);
    saveChats(chats);

    // 1. Emit Socket.IO event to order room and admin channel
    try {
        const io = getIO();
        if (io) {
            io.to(`order_${idKey}`).emit("chat:message", newMsg);
            io.to("admin_channel").emit("chat:message", newMsg);
            console.log(`[SOCKET CHAT EMIT] Message sent to order_${idKey}:`, newMsg.text);
        }
    } catch (e) {
        console.warn("[ChatService] Socket broadcast warning:", e.message);
    }

    // 2. Push Notification to recipient
    try {
        if (senderType === "customer") {
            // Notify partner
            const partnerId = order?.partner_id;
            sendNotification({
                title: `💬 New Message from ${sender_name || 'Customer'}`,
                message: text.trim(),
                type: "chat_message",
                targetId: idKey,
                forAdmin: false
            }).catch(() => {});
        } else if (senderType === "partner") {
            // Notify customer
            const customerUserId = order?.user_id;
            if (customerUserId) {
                sendNotification({
                    userId: customerUserId,
                    title: `💬 New Message from Delivery Partner`,
                    message: text.trim(),
                    type: "chat_message",
                    targetId: idKey
                }).catch(() => {});
            }
        }
    } catch (_) {}

    return newMsg;
}

async function markChatAsRead(orderId, readerRole = "customer") {
    if (!orderId) return { updated: 0 };
    const idKey = orderId.toString();
    const chats = loadChats();
    const list = chats[idKey] || [];
    let updatedCount = 0;

    const isPartner = readerRole.toLowerCase().includes("partner");
    const targetSender = isPartner ? "customer" : "partner";

    const now = new Date().toISOString();
    list.forEach(m => {
        if (m.sender === targetSender && !m.is_read) {
            m.is_read = true;
            m.read_at = now;
            m.status = "read";
            updatedCount++;
        }
    });

    if (updatedCount > 0) {
        saveChats(chats);
        try {
            const io = getIO();
            if (io) {
                io.to(`order_${idKey}`).emit("chat:read", {
                    order_id: idKey,
                    reader: readerRole,
                    read_at: now
                });
            }
        } catch (_) {}
    }

    return { updated: updatedCount };
}

module.exports = {
    getChatMessages,
    saveChatMessage,
    markChatAsRead
};
