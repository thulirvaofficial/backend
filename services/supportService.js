const fs = require("fs");
const path = require("path");
const { pool, isDbOnline } = require("../config/database");
const { sendNotification } = require("./notificationService");
const { emitToAdmin, emitToUser, emitToPartner } = require("./socketService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const TICKETS_FILE = path.join(DATA_DIR, "support_tickets.json");
const MESSAGES_FILE = path.join(DATA_DIR, "support_ticket_messages.json");
const NOTES_FILE = path.join(DATA_DIR, "support_ticket_internal_notes.json");
const EVENTS_FILE = path.join(DATA_DIR, "support_ticket_events.json");

// Helper to ensure JSON files exist
function ensureJsonStore(filePath, defaultContent = []) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2), "utf-8");
        }
    } catch (e) {
        console.error(`[SUPPORT STORE INIT ERROR] ${filePath}:`, e.message);
    }
}

ensureJsonStore(TICKETS_FILE);
ensureJsonStore(MESSAGES_FILE);
ensureJsonStore(NOTES_FILE);
ensureJsonStore(EVENTS_FILE);

function readJson(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function writeJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.error(`[SUPPORT STORE WRITE ERROR] ${filePath}:`, e.message);
    }
}

/**
 * Generate formatted ticket ID: THU-TKT-YYYYMMDD-XXXX
 */
function generateTicketNumber() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `THU-TKT-${dateStr}-${randomSuffix}`;
}

/**
 * Log an audit event for a ticket
 */
async function logTicketEvent({ ticketId, eventType, actorId, actorName, actorRole, eventData = {} }) {
    const event = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        ticket_id: String(ticketId),
        event_type: eventType,
        actor_id: String(actorId),
        actor_name: actorName || "System",
        actor_role: actorRole || "system",
        event_data: eventData,
        created_at: new Date().toISOString()
    };

    // Try DB
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            await pool.query(`
                INSERT INTO support_ticket_events (ticket_id, event_type, actor_id, actor_name, actor_role, event_data, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, [ticketId, eventType, actorId, actorName, actorRole, JSON.stringify(eventData)]);
        }
    } catch (_) {}

    // Fallback disk store
    try {
        const events = readJson(EVENTS_FILE);
        events.push(event);
        writeJson(EVENTS_FILE, events);
    } catch (_) {}

    return event;
}

/**
 * Create a new support ticket (Customer or Delivery Partner)
 */
async function createTicket({
    userId,
    userName,
    userPhone,
    userEmail,
    userType,
    category,
    subject,
    description,
    orderId = null,
    priority = "NORMAL",
    attachmentUrl = null
}) {
    const ticketNumber = generateTicketNumber();
    const nowIso = new Date().toISOString();

    const ticket = {
        ticket_number: ticketNumber,
        user_id: String(userId),
        user_name: userName || "Thulirva User",
        user_phone: userPhone || "",
        user_email: userEmail || "",
        user_type: userType || "customer",
        category,
        subject,
        description,
        order_id: orderId ? String(orderId) : null,
        priority: priority.toUpperCase(),
        status: "OPEN",
        assigned_admin_id: null,
        assigned_admin_name: null,
        created_at: nowIso,
        updated_at: nowIso,
        resolved_at: null,
        closed_at: null
    };

    let insertedId = null;

    // 1. Try PostgreSQL
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            const res = await pool.query(`
                INSERT INTO support_tickets (
                    ticket_number, user_id, user_name, user_phone, user_email,
                    user_type, category, subject, description, order_id,
                    priority, status, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'OPEN', NOW(), NOW())
                RETURNING id, ticket_number, created_at
            `, [
                ticket.ticket_number,
                ticket.user_id,
                ticket.user_name,
                ticket.user_phone,
                ticket.user_email,
                ticket.user_type,
                ticket.category,
                ticket.subject,
                ticket.description,
                ticket.order_id,
                ticket.priority
            ]);
            if (res.rows && res.rows[0]) {
                insertedId = res.rows[0].id;
                ticket.id = insertedId;
            }
        }
    } catch (dbErr) {
        console.warn("[SUPPORT DB INSERT WARN]:", dbErr.message);
    }

    if (!ticket.id) {
        ticket.id = Date.now();
    }

    // 2. Add initial conversation message if description or attachment provided
    await addTicketMessage({
        ticketId: ticket.ticket_number,
        senderId: ticket.user_id,
        senderName: ticket.user_name,
        senderRole: ticket.user_type,
        message: description,
        attachmentUrl
    });

    // 3. Save to disk JSON store
    const tickets = readJson(TICKETS_FILE);
    tickets.unshift(ticket);
    writeJson(TICKETS_FILE, tickets);

    // 4. Log creation event
    await logTicketEvent({
        ticketId: ticket.ticket_number,
        eventType: "CREATED",
        actorId: ticket.user_id,
        actorName: ticket.user_name,
        actorRole: ticket.user_type,
        eventData: { category, priority, order_id: orderId }
    });

    // 5. Notify Admins in real-time
    try {
        emitToAdmin("support:ticket:new", ticket);
        emitToAdmin("support:ticket:created", ticket);
        sendNotification({
            title: `New Support Ticket [${ticket.ticket_number}]`,
            message: `${ticket.user_name} (${ticket.user_type}): ${subject}`,
            type: "support_ticket_created",
            targetId: ticket.ticket_number,
            forAdmin: true
        }).catch(() => {});
    } catch (_) {}

    return ticket;
}

/**
 * Add a message to a ticket conversation
 */
async function addTicketMessage({
    ticketId,
    senderId,
    senderName,
    senderRole,
    message,
    attachmentUrl = null
}) {
    const msg = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        ticket_id: String(ticketId),
        ticket_number: String(ticketId),
        sender_id: String(senderId),
        sender_name: senderName || (senderRole === "admin" ? "Customer Support" : "User"),
        sender_role: senderRole || "customer",
        message: message || "",
        attachment_url: attachmentUrl,
        created_at: new Date().toISOString(),
        read_at: null
    };

    // Try DB
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            const res = await pool.query(`
                INSERT INTO support_ticket_messages (
                    ticket_id, ticket_number, sender_id, sender_name, sender_role, message, attachment_url, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                RETURNING id, created_at
            `, [
                msg.ticket_id,
                msg.ticket_number,
                msg.sender_id,
                msg.sender_name,
                msg.sender_role,
                msg.message,
                msg.attachment_url
            ]);
            if (res.rows && res.rows[0]) {
                msg.id = res.rows[0].id;
            }
        }
    } catch (_) {}

    // Save to disk JSON
    const messages = readJson(MESSAGES_FILE);
    messages.push(msg);
    writeJson(MESSAGES_FILE, messages);

    // Update ticket updated_at and status if customer replied
    await updateTicketActivity(ticketId, senderRole);

    // Real-time broadcast
    try {
        const payload = { ticketId: String(ticketId), message: msg };
        emitToAdmin("support:message:new", payload);
        if (senderRole === "admin") {
            emitToUser(senderId, "support:message:new", payload);
            emitToPartner(senderId, "support:message:new", payload);
        }
    } catch (_) {}

    return msg;
}

/**
 * Update ticket timestamp and adjust status on customer/admin reply
 */
async function updateTicketActivity(ticketId, senderRole) {
    const nowIso = new Date().toISOString();
    let newStatus = null;

    if (senderRole === "admin") {
        newStatus = "WAITING_FOR_CUSTOMER";
    } else if (senderRole === "customer" || senderRole === "delivery_partner") {
        newStatus = "IN_PROGRESS";
    }

    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            let sql = "UPDATE support_tickets SET updated_at = NOW()";
            const params = [String(ticketId)];
            if (newStatus) {
                sql += `, status = $2 WHERE (ticket_number = $1 OR id::text = $1) AND status != 'CLOSED'`;
                params.push(newStatus);
            } else {
                sql += ` WHERE ticket_number = $1 OR id::text = $1`;
            }
            await pool.query(sql, params);
        }
    } catch (_) {}

    try {
        const tickets = readJson(TICKETS_FILE);
        const t = tickets.find(x => String(x.ticket_number) === String(ticketId) || String(x.id) === String(ticketId));
        if (t) {
            t.updated_at = nowIso;
            if (newStatus && t.status !== "CLOSED") {
                t.status = newStatus;
            }
            writeJson(TICKETS_FILE, tickets);
        }
    } catch (_) {}
}

/**
 * Add private internal note (Admin only - never exposed to users)
 */
async function addInternalNote({ ticketId, adminId, adminName, note }) {
    const internalNote = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        ticket_id: String(ticketId),
        admin_id: String(adminId),
        admin_name: adminName || "Support Supervisor",
        note,
        created_at: new Date().toISOString()
    };

    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            await pool.query(`
                INSERT INTO support_ticket_internal_notes (ticket_id, admin_id, admin_name, note, created_at)
                VALUES ($1, $2, $3, $4, NOW())
            `, [internalNote.ticket_id, internalNote.admin_id, internalNote.admin_name, internalNote.note]);
        }
    } catch (_) {}

    const notes = readJson(NOTES_FILE);
    notes.push(internalNote);
    writeJson(NOTES_FILE, notes);

    await logTicketEvent({
        ticketId,
        eventType: "INTERNAL_NOTE_ADDED",
        actorId: adminId,
        actorName: adminName,
        actorRole: "admin",
        eventData: { preview: note.substring(0, 60) }
    });

    return internalNote;
}

/**
 * Get tickets for a customer or delivery partner
 */
async function getUserTickets(userId, userType) {
    let tickets = [];

    // Try DB
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            const res = await pool.query(`
                SELECT * FROM support_tickets 
                WHERE user_id = $1 AND (user_type = $2 OR user_type ILIKE $2)
                ORDER BY created_at DESC
            `, [String(userId), String(userType)]);
            if (res.rows && res.rows.length > 0) {
                tickets = res.rows;
            }
        }
    } catch (_) {}

    // Fallback disk store
    if (tickets.length === 0) {
        const diskTickets = readJson(TICKETS_FILE);
        tickets = diskTickets.filter(t => 
            String(t.user_id) === String(userId) && 
            (!userType || (t.user_type || "").toLowerCase() === (userType || "").toLowerCase())
        );
    }

    return tickets;
}

/**
 * Get ticket details with messages (and optional internal notes for admin)
 */
async function getTicketDetails(ticketId, isAdmin = false) {
    let ticket = null;

    // 1. Fetch ticket
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            const res = await pool.query(`
                SELECT * FROM support_tickets 
                WHERE ticket_number = $1 OR id::text = $1
                LIMIT 1
            `, [String(ticketId)]);
            if (res.rows && res.rows.length > 0) {
                ticket = res.rows[0];
            }
        }
    } catch (_) {}

    if (!ticket) {
        const diskTickets = readJson(TICKETS_FILE);
        ticket = diskTickets.find(t => String(t.ticket_number) === String(ticketId) || String(t.id) === String(ticketId));
    }

    if (!ticket) return null;

    // 2. Fetch messages
    let messages = [];
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            const res = await pool.query(`
                SELECT * FROM support_ticket_messages 
                WHERE ticket_id = $1 OR ticket_number = $1
                ORDER BY created_at ASC
            `, [String(ticket.ticket_number)]);
            if (res.rows && res.rows.length > 0) {
                messages = res.rows;
            }
        }
    } catch (_) {}

    if (messages.length === 0) {
        const diskMsgs = readJson(MESSAGES_FILE);
        messages = diskMsgs.filter(m => 
            String(m.ticket_id) === String(ticket.ticket_number) || 
            String(m.ticket_number) === String(ticket.ticket_number) ||
            String(m.ticket_id) === String(ticket.id)
        );
        messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }

    // 3. Fetch internal notes (ADMIN ONLY - strict privacy guard)
    let internalNotes = [];
    if (isAdmin) {
        try {
            if (pool && typeof isDbOnline === "function" && isDbOnline()) {
                const res = await pool.query(`
                    SELECT * FROM support_ticket_internal_notes 
                    WHERE ticket_id = $1
                    ORDER BY created_at ASC
                `, [String(ticket.ticket_number)]);
                if (res.rows && res.rows.length > 0) {
                    internalNotes = res.rows;
                }
            }
        } catch (_) {}

        if (internalNotes.length === 0) {
            const diskNotes = readJson(NOTES_FILE);
            internalNotes = diskNotes.filter(n => 
                String(n.ticket_id) === String(ticket.ticket_number) ||
                String(n.ticket_id) === String(ticket.id)
            );
        }
    }

    return {
        ticket,
        messages,
        ...(isAdmin ? { internal_notes: internalNotes } : {})
    };
}

/**
 * Get all tickets for Admin with metrics, filtering, and pagination
 */
async function getAdminTickets({ status, priority, category, userType, search, page = 1, limit = 20 } = {}) {
    let tickets = [];

    // Try DB
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            let sql = "SELECT * FROM support_tickets WHERE 1=1";
            const params = [];

            if (status && status !== "ALL") {
                params.push(status);
                sql += ` AND status = $${params.length}`;
            }
            if (priority && priority !== "ALL") {
                params.push(priority);
                sql += ` AND priority = $${params.length}`;
            }
            if (category && category !== "ALL") {
                params.push(category);
                sql += ` AND category = $${params.length}`;
            }
            if (userType && userType !== "ALL") {
                params.push(userType);
                sql += ` AND user_type = $${params.length}`;
            }
            if (search) {
                params.push(`%${search.toLowerCase()}%`);
                sql += ` AND (LOWER(ticket_number) LIKE $${params.length} OR LOWER(subject) LIKE $${params.length} OR LOWER(user_name) LIKE $${params.length} OR LOWER(user_phone) LIKE $${params.length})`;
            }

            sql += " ORDER BY CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, created_at DESC";
            
            const res = await pool.query(sql, params);
            if (res.rows) {
                tickets = res.rows;
            }
        }
    } catch (_) {}

    // Fallback disk store
    if (tickets.length === 0) {
        tickets = readJson(TICKETS_FILE);
        if (status && status !== "ALL") {
            tickets = tickets.filter(t => t.status === status);
        }
        if (priority && priority !== "ALL") {
            tickets = tickets.filter(t => t.priority === priority);
        }
        if (category && category !== "ALL") {
            tickets = tickets.filter(t => t.category === category);
        }
        if (userType && userType !== "ALL") {
            tickets = tickets.filter(t => (t.user_type || "").toLowerCase() === userType.toLowerCase());
        }
        if (search) {
            const q = search.toLowerCase();
            tickets = tickets.filter(t => 
                (t.ticket_number || "").toLowerCase().includes(q) ||
                (t.subject || "").toLowerCase().includes(q) ||
                (t.user_name || "").toLowerCase().includes(q) ||
                (t.user_phone || "").includes(q)
            );
        }
    }

    // Calculate metrics across all tickets
    const all = readJson(TICKETS_FILE);
    const metrics = {
        total: all.length,
        new: all.filter(t => t.status === "OPEN").length,
        open: all.filter(t => t.status === "OPEN").length,
        in_progress: all.filter(t => t.status === "IN_PROGRESS").length,
        waiting_customer: all.filter(t => t.status === "WAITING_FOR_CUSTOMER").length,
        waiting_partner: all.filter(t => t.status === "WAITING_FOR_PARTNER").length,
        resolved: all.filter(t => t.status === "RESOLVED").length,
        closed: all.filter(t => t.status === "CLOSED").length,
        urgent: all.filter(t => t.priority === "URGENT" && t.status !== "CLOSED").length
    };

    // Pagination
    const totalCount = tickets.length;
    const startIndex = (page - 1) * limit;
    const paginatedTickets = tickets.slice(startIndex, startIndex + limit);

    return {
        metrics,
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalCount / limit) || 1,
        tickets: paginatedTickets
    };
}

/**
 * Update ticket status (Admin action)
 */
async function updateTicketStatus(ticketId, newStatus, adminId, adminName) {
    const validStatuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "WAITING_FOR_PARTNER", "RESOLVED", "CLOSED"];
    if (!validStatuses.includes(newStatus)) {
        throw new Error(`Invalid ticket status: ${newStatus}`);
    }

    const nowIso = new Date().toISOString();
    const resolvedAt = (newStatus === "RESOLVED" || newStatus === "CLOSED") ? nowIso : null;
    const closedAt = (newStatus === "CLOSED") ? nowIso : null;

    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            await pool.query(`
                UPDATE support_tickets 
                SET status = $1, updated_at = NOW(),
                    resolved_at = COALESCE($2, resolved_at),
                    closed_at = COALESCE($3, closed_at)
                WHERE ticket_number = $4 OR id::text = $4
            `, [newStatus, resolvedAt, closedAt, String(ticketId)]);
        }
    } catch (_) {}

    const tickets = readJson(TICKETS_FILE);
    const t = tickets.find(x => String(x.ticket_number) === String(ticketId) || String(x.id) === String(ticketId));
    if (t) {
        t.status = newStatus;
        t.updated_at = nowIso;
        if (resolvedAt) t.resolved_at = resolvedAt;
        if (closedAt) t.closed_at = closedAt;
        writeJson(TICKETS_FILE, tickets);

        // Notify User
        try {
            sendNotification({
                userId: t.user_id,
                title: `Ticket Status Updated: ${newStatus}`,
                message: `Your support ticket [${t.ticket_number}] is now ${newStatus.replace(/_/g, " ")}.`,
                type: "support_status_update",
                targetId: t.ticket_number
            }).catch(() => {});
        } catch (_) {}
    }

    await logTicketEvent({
        ticketId,
        eventType: "STATUS_CHANGED",
        actorId: adminId,
        actorName: adminName,
        actorRole: "admin",
        eventData: { newStatus }
    });

    return { success: true, ticketId, status: newStatus };
}

/**
 * Update ticket priority
 */
async function updateTicketPriority(ticketId, newPriority, adminId, adminName) {
    const validPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
    if (!validPriorities.includes(newPriority)) {
        throw new Error(`Invalid priority: ${newPriority}`);
    }

    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            await pool.query(`
                UPDATE support_tickets 
                SET priority = $1, updated_at = NOW()
                WHERE ticket_number = $2 OR id::text = $2
            `, [newPriority, String(ticketId)]);
        }
    } catch (_) {}

    const tickets = readJson(TICKETS_FILE);
    const t = tickets.find(x => String(x.ticket_number) === String(ticketId) || String(x.id) === String(ticketId));
    if (t) {
        t.priority = newPriority;
        t.updated_at = new Date().toISOString();
        writeJson(TICKETS_FILE, tickets);
    }

    await logTicketEvent({
        ticketId,
        eventType: "PRIORITY_CHANGED",
        actorId: adminId,
        actorName: adminName,
        actorRole: "admin",
        eventData: { newPriority }
    });

    return { success: true, ticketId, priority: newPriority };
}

/**
 * Assign support agent to ticket
 */
async function assignTicketAgent(ticketId, adminId, adminName) {
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            await pool.query(`
                UPDATE support_tickets 
                SET assigned_admin_id = $1, assigned_admin_name = $2, updated_at = NOW()
                WHERE ticket_number = $3 OR id::text = $3
            `, [String(adminId), adminName, String(ticketId)]);
        }
    } catch (_) {}

    const tickets = readJson(TICKETS_FILE);
    const t = tickets.find(x => String(x.ticket_number) === String(ticketId) || String(x.id) === String(ticketId));
    if (t) {
        t.assigned_admin_id = String(adminId);
        t.assigned_admin_name = adminName;
        t.updated_at = new Date().toISOString();
        writeJson(TICKETS_FILE, tickets);
    }

    await logTicketEvent({
        ticketId,
        eventType: "ASSIGNED",
        actorId: adminId,
        actorName: adminName,
        actorRole: "admin",
        eventData: { assignedTo: adminName }
    });

    return { success: true, ticketId, assigned_admin_name: adminName };
}

module.exports = {
    createTicket,
    addTicketMessage,
    addInternalNote,
    getUserTickets,
    getTicketDetails,
    getAdminTickets,
    updateTicketStatus,
    updateTicketPriority,
    assignTicketAgent
};

