const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    createTicket,
    addTicketMessage,
    addInternalNote,
    getUserTickets,
    getTicketDetails,
    getAdminTickets,
    updateTicketStatus,
    assignTicketAgent
} = require("./services/supportService");

const DATA_DIR = path.resolve(__dirname, "data");
const TICKETS_FILE = path.join(DATA_DIR, "support_tickets.json");
const MESSAGES_FILE = path.join(DATA_DIR, "support_ticket_messages.json");

const TEST_CUSTOMER_ID = "CUST-SUP-001";
const TEST_PARTNER_ID = "PARTNER-SUP-001";

async function runSupportTests() {
    console.log("=== THULIRVA CUSTOMER CARE & SUPPORT TICKET SYSTEM TEST ===");

    // Clean test data before running
    const cleanData = () => {
        try {
            [TICKETS_FILE, MESSAGES_FILE].forEach(file => {
                if (fs.existsSync(file)) {
                    let items = JSON.parse(fs.readFileSync(file, "utf-8"));
                    items = items.filter(x => x.user_id !== TEST_CUSTOMER_ID && x.user_id !== TEST_PARTNER_ID);
                    fs.writeFileSync(file, JSON.stringify(items, null, 2));
                }
            });
        } catch (_) {}
    };

    cleanData();

    try {
        // Test 1: Customer Ticket Creation
        console.log("[1] Creating customer support ticket linked to an order...");
        const custTicket = await createTicket({
            userId: TEST_CUSTOMER_ID,
            userType: "customer",
            userName: "Ananya Sharma",
            userPhone: "9876543210",
            category: "Delivery Delay",
            priority: "HIGH",
            subject: "Order #ORD-7788 delivery delay inquiry",
            description: "My farm fresh milk bottle has not arrived within the morning delivery slot.",
            orderId: "ORD-7788",
            attachmentUrl: "/uploads/support/delay_screen.jpg"
        });
        assert(custTicket, "Customer ticket must be created");
        assert(custTicket.ticket_number, "Ticket must have ticket_number");
        assert.strictEqual(custTicket.status, "OPEN");
        assert.strictEqual(custTicket.category, "Delivery Delay");
        console.log(`✓ Customer ticket #${custTicket.ticket_number} created with status OPEN.`);

        // Test 2: Delivery Partner Ticket Creation
        console.log("[2] Creating delivery partner support ticket...");
        const partnerTicket = await createTicket({
            userId: TEST_PARTNER_ID,
            userType: "delivery_partner",
            userName: "Karthik Raja",
            userPhone: "9123456780",
            category: "COD Remittance",
            priority: "MEDIUM",
            subject: "UPI reference mismatch on cash remittance",
            description: "Bank transfer reference UTR123456 was entered incorrectly.",
            attachmentUrl: null
        });
        assert(partnerTicket, "Partner ticket must be created");
        assert.strictEqual(partnerTicket.category, "COD Remittance");
        console.log(`✓ Partner ticket #${partnerTicket.ticket_number} created.`);

        // Test 3: List User Tickets
        console.log("[3] Fetching tickets for customer...");
        const custTickets = await getUserTickets(TEST_CUSTOMER_ID, "customer");
        assert(custTickets.length >= 1, "Must find created customer ticket");
        assert(custTickets.some(t => t.ticket_number === custTicket.ticket_number));
        console.log("✓ Customer ticket list retrieval verified.");

        // Test 4: Customer Message Reply
        console.log("[4] Adding customer reply to ticket thread...");
        const replyMsg = await addTicketMessage({
            ticketId: custTicket.ticket_number,
            senderId: TEST_CUSTOMER_ID,
            senderRole: "customer",
            senderName: "Ananya Sharma",
            message: "I checked the gate again, still not delivered. Please check with partner.",
            attachmentUrl: null
        });
        assert(replyMsg, "Message reply must be added");
        assert.strictEqual(replyMsg.sender_role, "customer");
        console.log("✓ Customer reply appended to conversation thread.");

        // Test 5: Admin Support Agent Assignment & In Progress status
        console.log("[5] Assigning support staff and updating status to IN_PROGRESS...");
        await assignTicketAgent(custTicket.ticket_number, "ADMIN-01", "Priya Senior Support");
        await updateTicketStatus(custTicket.ticket_number, "IN_PROGRESS", "ADMIN-01", "Priya Senior Support");

        // Verify status in details
        const detailsAfterAssign = await getTicketDetails(custTicket.ticket_number, true);
        assert.strictEqual(detailsAfterAssign.ticket.status, "IN_PROGRESS");
        assert.strictEqual(detailsAfterAssign.ticket.assigned_admin_name, "Priya Senior Support");
        console.log("✓ Agent assignment and IN_PROGRESS status verified.");

        // Test 6: Admin Internal Note vs Public Reply
        console.log("[6] Admin adds internal note and customer-facing reply...");
        await addInternalNote({
            ticketId: custTicket.ticket_number,
            adminId: "ADMIN-01",
            adminName: "Priya Senior Support",
            note: "Called partner DP-001, he had a flat tyre, ETA 15 mins."
        });
        await addTicketMessage({
            ticketId: custTicket.ticket_number,
            senderId: "ADMIN-01",
            senderRole: "admin",
            senderName: "Priya Senior Support",
            message: "Dear Ananya, our delivery executive had a brief delay and is 10 minutes away from your location.",
            attachmentUrl: null
        });

        // Customer view: Internal notes must NOT be visible!
        const custView = await getTicketDetails(custTicket.ticket_number, false);
        assert(!custView.internal_notes, "Internal notes must NEVER be exposed to customer!");

        // Admin view: Internal notes must be visible
        const adminView = await getTicketDetails(custTicket.ticket_number, true);
        assert(adminView.internal_notes && adminView.internal_notes.length >= 1, "Internal notes must be visible to admin");
        console.log("✓ Strict authorization between internal notes and customer replies verified.");

        // Test 7: Resolve and Close Ticket
        console.log("[7] Resolving and closing ticket...");
        await updateTicketStatus(custTicket.ticket_number, "RESOLVED", "ADMIN-01", "Priya Senior Support");
        let resolvedDetails = await getTicketDetails(custTicket.ticket_number, true);
        assert.strictEqual(resolvedDetails.ticket.status, "RESOLVED");

        await updateTicketStatus(custTicket.ticket_number, "CLOSED", "ADMIN-01", "Priya Senior Support");
        let closedDetails = await getTicketDetails(custTicket.ticket_number, true);
        assert.strictEqual(closedDetails.ticket.status, "CLOSED");
        console.log("✓ Ticket resolution and closure lifecycle verified.");

        console.log("\n=======================================================");
        console.log("✓ ALL SUPPORT TICKET SYSTEM TESTS PASSED (7/7)");
        console.log("=======================================================\n");
    } finally {
        cleanData();
    }
}

runSupportTests().catch(err => {
    console.error("SUPPORT TEST FAILED:", err);
    process.exit(1);
});
