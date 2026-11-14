const fs = require("fs");
const path = require("path");
const { getIO } = require("./socketService");

const CHATS_FILE = path.join(__dirname, "../data/order_chats.json");

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
            timestamp: new Date().toISOString()
        };
        chats[idKey] = [welcomeMsg];
        saveChats(chats);
        return [welcomeMsg];
    }
    return list;
}

async function saveChatMessage(orderId, { sender = "customer", sender_name, text = "" }) {
    if (!orderId || !text.trim()) {
        throw new Error("Order ID and message text are required");
    }
    const idKey = orderId.toString();
    const chats = loadChats();
    if (!chats[idKey]) chats[idKey] = [];

    const newMsg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        order_id: idKey,
        sender: sender.toLowerCase(), // 'customer', 'partner', 'admin', 'system'
        sender_name: sender_name || (sender.toLowerCase() === "partner" ? "Delivery Partner" : "Customer"),
        text: text.trim(),
        timestamp: new Date().toISOString()
    };

    chats[idKey].push(newMsg);
    saveChats(chats);

    // Emit Socket.IO event to order room and admin channel
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

    return newMsg;
}

module.exports = {
    getChatMessages,
    saveChatMessage
};

