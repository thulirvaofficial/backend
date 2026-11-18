const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authenticateToken, adminOnly } = require("../middleware/auth");
const {
    createTicket,
    addTicketMessage,
    addInternalNote,
    getUserTickets,
    getTicketDetails,
    getAdminTickets,
    updateTicketStatus,
    updateTicketPriority,
    assignTicketAgent
} = require("../services/supportService");

const router = express.Router();

// Multer storage for support screenshots/attachments
const uploadDir = path.resolve(__dirname, "..", "public", "uploads", "support");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `support_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
            cb(null, true);
        } else {
            cb(new Error("Only images (PNG, JPG, WebP) and PDF documents are allowed."));
        }
    }
});

/* =========================================================================
   1. CUSTOMER & DELIVERY PARTNER SUPPORT ENDPOINTS
   Base mount: /api/support
========================================================================= */

/**
 * POST /api/support/tickets
 * Create a new support ticket
 */
router.post("/tickets", authenticateToken, upload.single("attachment"), async (req, res) => {
    try {
        const { category, subject, description, order_id, orderId, priority } = req.body;
        if (!category || !subject || !description) {
            return res.status(400).json({
                success: false,
                message: "Category, subject, and description are required to raise a ticket."
            });
        }

        const userId = req.user.partner_id || req.user.id;
        const userName = req.user.name || "Thulirva User";
        const userPhone = req.user.phone || "";
        const userEmail = req.user.email || "";
        const userType = req.user.role === "delivery_partner" ? "delivery_partner" : "customer";

        const attachmentUrl = req.file ? `/uploads/support/${req.file.filename}` : null;

        const ticket = await createTicket({
            userId,
            userName,
            userPhone,
            userEmail,
            userType,
            category,
            subject,
            description,
            orderId: order_id || orderId || null,
            priority: priority || "NORMAL",
            attachmentUrl
        });

        return res.status(201).json({
            success: true,
            message: "Support ticket created successfully.",
            ticket
        });
    } catch (err) {
        console.error("[SUPPORT CREATE ERROR]:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to create support ticket: " + (err.message || "Unknown error")
        });
    }
});

/**
 * GET /api/support/tickets
 * List all tickets for the authenticated customer or partner
 */
router.get("/tickets", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.partner_id || req.user.id;
        const userType = req.user.role === "delivery_partner" ? "delivery_partner" : "customer";

        const tickets = await getUserTickets(userId, userType);
        return res.json({
            success: true,
            count: tickets.length,
            tickets
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch support tickets: " + err.message
        });
    }
});

/**
 * GET /api/support/tickets/:ticketId
 * View ticket details and conversation thread
 */
router.get("/tickets/:ticketId", authenticateToken, async (req, res) => {
    try {
        const { ticketId } = req.params;
        const userId = req.user.partner_id || req.user.id;
        const isAdmin = req.user.role === "admin" || req.user.role === "super_admin";

        const details = await getTicketDetails(ticketId, isAdmin);
        if (!details || !details.ticket) {
            return res.status(404).json({ success: false, message: "Ticket not found." });
        }

        // Strict authorization: Non-admins can only view their own tickets
        if (!isAdmin && String(details.ticket.user_id) !== String(userId)) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: You do not have permission to view this ticket."
            });
        }

        return res.json({
            success: true,
            ...details
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch ticket details: " + err.message
        });
    }
});

/**
 * POST /api/support/tickets/:ticketId/messages
 * User reply to a support ticket
 */
router.post("/tickets/:ticketId/messages", authenticateToken, upload.single("attachment"), async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { message } = req.body;
        const attachmentUrl = req.file ? `/uploads/support/${req.file.filename}` : null;

        if (!message && !attachmentUrl) {
            return res.status(400).json({ success: false, message: "Message or attachment is required." });
        }

        const userId = req.user.partner_id || req.user.id;
        const userName = req.user.name || "User";
        const userRole = req.user.role === "delivery_partner" ? "delivery_partner" : "customer";

        // Verify ticket access
        const details = await getTicketDetails(ticketId, false);
        if (!details || !details.ticket) {
            return res.status(404).json({ success: false, message: "Ticket not found." });
        }
        if (String(details.ticket.user_id) !== String(userId)) {
            return res.status(403).json({ success: false, message: "Unauthorized access to this ticket." });
        }

        const msg = await addTicketMessage({
            ticketId: details.ticket.ticket_number,
            senderId: userId,
            senderName: userName,
            senderRole: userRole,
            message: message || "Attachment uploaded.",
            attachmentUrl
        });

        return res.status(201).json({
            success: true,
            message: "Reply sent successfully.",
            data: msg
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Failed to send reply: " + err.message
        });
    }
});

/* =========================================================================
   2. ADMIN SUPPORT ENDPOINTS
   Base mount: /api/admin/support
========================================================================= */

const adminRouter = express.Router();
adminRouter.use(authenticateToken, adminOnly);

/**
 * GET /api/admin/support/tickets
 * Admin ticket roster with metrics, filtering & pagination
 */
adminRouter.get("/tickets", async (req, res) => {
    try {
        const { status, priority, category, user_type, search, page, limit } = req.query;
        const data = await getAdminTickets({
            status,
            priority,
            category,
            userType: user_type,
            search,
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20
        });
        return res.json({ success: true, ...data });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error fetching admin tickets: " + err.message });
    }
});

/**
 * GET /api/admin/support/tickets/:ticketId
 * Full ticket view including internal notes
 */
adminRouter.get("/tickets/:ticketId", async (req, res) => {
    try {
        const { ticketId } = req.params;
        const details = await getTicketDetails(ticketId, true);
        if (!details || !details.ticket) {
            return res.status(404).json({ success: false, message: "Ticket not found." });
        }
        return res.json({ success: true, ...details });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error fetching ticket: " + err.message });
    }
});

/**
 * POST /api/admin/support/tickets/:ticketId/reply
 * Admin replies to customer/partner
 */
adminRouter.post("/tickets/:ticketId/reply", upload.single("attachment"), async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { message } = req.body;
        const attachmentUrl = req.file ? `/uploads/support/${req.file.filename}` : null;

        if (!message && !attachmentUrl) {
            return res.status(400).json({ success: false, message: "Message or attachment is required." });
        }

        const details = await getTicketDetails(ticketId, true);
        if (!details || !details.ticket) {
            return res.status(404).json({ success: false, message: "Ticket not found." });
        }

        const adminName = req.user.name || "Customer Support Specialist";
        const msg = await addTicketMessage({
            ticketId: details.ticket.ticket_number,
            senderId: req.user.id || 1,
            senderName: adminName,
            senderRole: "admin",
            message: message || "Attachment provided.",
            attachmentUrl
        });

        return res.status(201).json({
            success: true,
            message: "Support reply sent successfully.",
            data: msg
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to send support reply: " + err.message });
    }
});

/**
 * PATCH /api/admin/support/tickets/:ticketId/status
 * Update ticket lifecycle status
 */
adminRouter.patch("/tickets/:ticketId/status", async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, message: "Status is required." });
        }

        const adminName = req.user.name || "Super Admin";
        const result = await updateTicketStatus(ticketId, status, req.user.id, adminName);
        return res.json({ success: true, message: "Ticket status updated.", ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/admin/support/tickets/:ticketId/priority
 * Update ticket priority
 */
adminRouter.patch("/tickets/:ticketId/priority", async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { priority } = req.body;
        if (!priority) {
            return res.status(400).json({ success: false, message: "Priority is required." });
        }

        const adminName = req.user.name || "Super Admin";
        const result = await updateTicketPriority(ticketId, priority, req.user.id, adminName);
        return res.json({ success: true, message: "Ticket priority updated.", ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PATCH /api/admin/support/tickets/:ticketId/assign
 * Assign agent to ticket
 */
adminRouter.patch("/tickets/:ticketId/assign", async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { admin_id, admin_name } = req.body;
        if (!admin_id || !admin_name) {
            return res.status(400).json({ success: false, message: "admin_id and admin_name are required." });
        }

        const result = await assignTicketAgent(ticketId, admin_id, admin_name);
        return res.json({ success: true, message: "Support agent assigned.", ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/support/tickets/:ticketId/internal-notes
 * Add private internal note (never shown to customer/partner)
 */
adminRouter.post("/tickets/:ticketId/internal-notes", async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { note } = req.body;
        if (!note || !note.trim()) {
            return res.status(400).json({ success: false, message: "Note text is required." });
        }

        const adminName = req.user.name || "Support Admin";
        const internalNote = await addInternalNote({
            ticketId,
            adminId: req.user.id || 1,
            adminName,
            note: note.trim()
        });

        return res.status(201).json({
            success: true,
            message: "Internal note recorded.",
            note: internalNote
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Failed to record internal note: " + err.message });
    }
});

module.exports = {
    supportRouter: router,
    adminSupportRouter: adminRouter
};

