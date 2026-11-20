/**
 * Master Verification Test Suite for:
 * 1. Customer Care Ticket Workflow (Test A)
 * 2. Delivery Partner Care Workflow (Test B)
 * 3. COD Doorstep Refusal & Auto-Restriction (Test C)
 * 4. Admin COD Manual Restore & Restrict (Test D)
 * 5. Single Source of Truth & Separation of Concerns (Test E)
 */

const jwt = require("./node_modules/jsonwebtoken");
const BASE_URL = "http://localhost:5500";
const JWT_SECRET = process.env.JWT_SECRET || "THULIRVA_CHANGE_THIS_SECRET_KEY";

const adminToken = jwt.sign(
    { id: 1, role: "super_admin", email: "admin@thulirva.com", name: "Super Admin" },
    JWT_SECRET
);

const customerToken = jwt.sign(
    { id: 2, role: "customer", phone: "7904880944", name: "kamsh" },
    JWT_SECRET
);

const partnerToken = jwt.sign(
    { id: "THU-DP-0001", partner_id: "THU-DP-0001", role: "delivery_partner", phone: "7904880944", name: "Karthik Raja" },
    JWT_SECRET
);

let passedCount = 0;
let totalTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        console.log(`  ✅ [PASS] ${message}`);
        passedCount++;
    } else {
        console.error(`  ❌ [FAIL] ${message}`);
        throw new Error(message);
    }
}

async function runTests() {
    console.log("==================================================================");
    console.log("🧪 THULIRVA CARE, PARTNER SUPPORT & COD RISK TEST SUITE");
    console.log("==================================================================");

    // -----------------------------------------------------------------
    // TEST A: CUSTOMER CARE TICKET WORKFLOW
    // -----------------------------------------------------------------
    console.log("\n▶ Running Test A: Customer Care Ticket Workflow...");
    
    // 1. Customer creates ticket
    const custCreateRes = await fetch(`${BASE_URL}/api/support/tickets`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
            category: "Delivery Delay",
            subject: "Automated Test Milk Delay Query",
            description: "Morning delivery was 10 minutes late.",
            order_id: "ORD-TEST-1001",
            priority: "NORMAL"
        })
    }).then(r => r.json());

    assert(custCreateRes.success === true, "Customer can create support ticket");
    const custTicket = custCreateRes.ticket;
    const custTicketId = custTicket.ticket_id || custTicket.ticket_number;
    assert(Boolean(custTicketId), `Ticket ID is defined and valid: ${custTicketId}`);

    // 2. Admin retrieves ticket details
    const adminGetTicket = await fetch(`${BASE_URL}/api/admin/support/tickets/${custTicketId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    }).then(r => r.json());

    assert(adminGetTicket.success === true, "Admin can retrieve ticket details");
    assert(adminGetTicket.ticket.ticket_id === custTicketId, "Retrieved ticket ID matches created ticket ID");
    assert(Array.isArray(adminGetTicket.messages) && adminGetTicket.messages.length >= 1, "Messages thread contains customer initial message");

    // 3. Admin replies to ticket
    const adminReplyRes = await fetch(`${BASE_URL}/api/admin/support/tickets/${custTicketId}/reply`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            message: "We apologize for the delay. Your milk delivery is arriving in 3 minutes."
        })
    }).then(r => r.json());

    assert(adminReplyRes.success === true, "Admin reply sent successfully");

    // 4. Admin adds private internal note
    const noteRes = await fetch(`${BASE_URL}/api/admin/support/tickets/${custTicketId}/internal-notes`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            note: "Confidential note: Hub route 4 road blockage confirmed."
        })
    }).then(r => r.json());

    assert(noteRes.success === true, "Private staff note recorded");

    // 5. Verify Customer cannot see internal notes
    const custViewTicket = await fetch(`${BASE_URL}/api/support/tickets/${custTicketId}`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    }).then(r => r.json());

    assert(custViewTicket.success === true, "Customer can view their own ticket");
    assert(custViewTicket.internal_notes === undefined, "Strict Privacy: Customer CANNOT see private internal staff notes");
    assert(custViewTicket.messages.length === 2, "Customer sees both initial query and admin reply in thread");

    // 6. Admin assigns ticket & updates status
    const assignRes = await fetch(`${BASE_URL}/api/admin/support/tickets/${custTicketId}/assign`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ assigned_agent: "Senior Support Executive" })
    }).then(r => r.json());

    assert(assignRes.success === true, "Ticket successfully assigned to agent");

    const statusRes = await fetch(`${BASE_URL}/api/admin/support/tickets/${custTicketId}/status`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: "RESOLVED" })
    }).then(r => r.json());

    assert(statusRes.success === true, "Ticket status updated to RESOLVED");

    // 7. Customer reopens ticket
    const reopenRes = await fetch(`${BASE_URL}/api/support/tickets/${custTicketId}/reopen`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({ reason: "Issue recurred today." })
    }).then(r => r.json());

    assert(reopenRes.success === true && reopenRes.status === "OPEN", "Customer can reopen resolved support ticket");

    // -----------------------------------------------------------------
    // TEST B: DELIVERY PARTNER CARE WORKFLOW
    // -----------------------------------------------------------------
    console.log("\n▶ Running Test B: Delivery Partner Care Workflow...");

    const partnerCreateRes = await fetch(`${BASE_URL}/api/support/tickets`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${partnerToken}`
        },
        body: JSON.stringify({
            category: "Payment and Payout Issues",
            subject: "Weekly Incentive Calculation Query",
            description: "Rain incentive of Rs 150 not reflected in weekly settlement.",
            order_id: "PAYOUT-INCENTIVE-99",
            priority: "HIGH"
        })
    }).then(r => r.json());

    assert(partnerCreateRes.success === true, "Delivery partner can create support ticket");
    const partnerTicket = partnerCreateRes.ticket;
    const partnerTicketId = partnerTicket.ticket_id || partnerTicket.ticket_number;
    assert(partnerTicket.user_type === "delivery_partner", "Ticket user_type is strictly delivery_partner");

    // Verify separation of concerns: Admin gets partner tickets under user_type=delivery_partner
    const partnerRoster = await fetch(`${BASE_URL}/api/admin/support/tickets?user_type=delivery_partner`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    }).then(r => r.json());

    assert(partnerRoster.success === true, "Admin can query partner tickets roster");
    const foundPartnerTicket = partnerRoster.tickets.find(t => t.ticket_id === partnerTicketId || t.ticket_number === partnerTicketId);
    assert(Boolean(foundPartnerTicket), "Partner ticket appears in Partner Care roster");

    // Verify customer roster does NOT contain partner ticket
    const customerRoster = await fetch(`${BASE_URL}/api/admin/support/tickets?user_type=customer`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    }).then(r => r.json());

    const leakedTicket = customerRoster.tickets.find(t => t.ticket_id === partnerTicketId || t.ticket_number === partnerTicketId);
    assert(!leakedTicket, "Strict Module Separation: Partner ticket never appears in Customer Care view");

    // -----------------------------------------------------------------
    // TEST C: COD DOORSTEP REFUSAL & AUTO-RESTRICTION
    // -----------------------------------------------------------------
    console.log("\n▶ Running Test C: COD Doorstep Refusal & Auto-Restriction (2 Refusals Rule)...");

    const testCustId = "TEST-COD-USER-999";
    const { recordDoorstepCodRefusal, checkCustomerCodEligibility, updateCustomerCodStatus } = require("./services/codRiskService");

    // Reset clean state
    await updateCustomerCodStatus(testCustId, { cod_eligible: true, resetCount: true, adminName: "Test Harness" }).catch(() => {});

    // Initial check: Should be eligible
    const initialCheck = await checkCustomerCodEligibility(testCustId);
    assert(initialCheck.eligible === true, "New customer is initially eligible for COD");
    assert(initialCheck.refusal_count === 0, "Initial refusal count is 0");

    // 1st Doorstep Refusal
    const firstRefusal = await recordDoorstepCodRefusal(testCustId, "ORD-COD-REFUSE-1", {
        notes: "Customer was not home and refused parcel on call."
    });
    assert(firstRefusal.success === true, "First doorstep refusal successfully recorded");
    assert(firstRefusal.refusalCount === 1, "Refusal count is now 1");
    assert(firstRefusal.cod_eligible === true, "Customer remains eligible after 1st refusal (warning state)");

    // 2nd Doorstep Refusal -> Must trigger auto-restriction
    const secondRefusal = await recordDoorstepCodRefusal(testCustId, "ORD-COD-REFUSE-2", {
        notes: "Customer refused delivery at doorstep saying they changed their mind."
    });
    assert(secondRefusal.success === true, "Second doorstep refusal successfully recorded");
    assert(secondRefusal.refusalCount === 2, "Refusal count reached 2");
    assert(secondRefusal.cod_eligible === false, "COD is immediately auto-disabled after 2nd refusal");
    assert(secondRefusal.newlyRestricted === true, "newlyRestricted event triggered");

    // Verify /api/cod-status endpoint returns restricted state
    const codStatusRes = await fetch(`${BASE_URL}/api/cod-status?user_id=${testCustId}`).then(r => r.json());
    assert(codStatusRes.eligible === false, "GET /api/cod-status reports eligible: false");
    assert(codStatusRes.refusal_count === 2, "Refusal count correctly reported as 2");
    assert(Boolean(codStatusRes.reason), `Restriction reason returned: ${codStatusRes.reason}`);

    // Verify POST /api/orders blocks COD checkout for this user
    const blockedOrderRes = await fetch(`${BASE_URL}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            user_id: testCustId,
            customer_name: "Test User",
            customer_phone: "9840998877",
            payment_method: "Cash on Delivery (COD)",
            items: [{ id: 1, name: "Fresh Cow Milk", price: 34, quantity: 1 }],
            address: "123 Test Street, Chennai",
            pincode: "600087"
        })
    });
    const blockedData = await blockedOrderRes.json();
    assert(blockedOrderRes.status === 400, "Server strictly rejects COD order with 400 Bad Request");
    assert(blockedData.cod_restricted === true, "Response contains cod_restricted: true flag");

    // -----------------------------------------------------------------
    // TEST D: ADMIN COD MANUAL RESTORE & RESTRICT
    // -----------------------------------------------------------------
    console.log("\n▶ Running Test D: Admin COD Manual Restore & Restrict...");

    // 1. Admin manually restores COD
    const restoreRes = await fetch(`${BASE_URL}/api/admin/cod-restrictions/${testCustId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            cod_eligible: true,
            reset_count: true,
            reason: "Customer verified via phone call and promised to accept next delivery."
        })
    }).then(r => r.json());

    assert(restoreRes.success === true, "Admin successfully restored customer COD eligibility");

    const recheckStatus = await fetch(`${BASE_URL}/api/cod-status?user_id=${testCustId}`).then(r => r.json());
    assert(recheckStatus.eligible === true, "Customer is now eligible for COD again");

    // 2. Admin manually restricts COD again
    const manualRestrictRes = await fetch(`${BASE_URL}/api/admin/cod-restrictions/${testCustId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            cod_eligible: false,
            reason: "Admin decision due to high-risk location verification failure."
        })
    }).then(r => r.json());

    assert(manualRestrictRes.success === true, "Admin manually restricted COD eligibility");

    // 3. View Customer Audit Log
    const auditRes = await fetch(`${BASE_URL}/api/admin/cod-restrictions/${testCustId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    }).then(r => r.json());

    assert(auditRes.success === true, "Admin can retrieve customer audit history");
    assert(Array.isArray(auditRes.audit_history) && auditRes.audit_history.length >= 3, "Audit history contains refusal, auto-restriction, restoration and manual restriction logs");

    // -----------------------------------------------------------------
    // TEST E: WEBPAGE & ZERO UNDEFINED CHECKS
    // -----------------------------------------------------------------
    console.log("\n▶ Running Test E: Support HTML & API Zero 'undefined' Verification...");

    const allTicketsRes = await fetch(`${BASE_URL}/api/admin/support/tickets`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    }).then(r => r.json());

    for (const t of allTicketsRes.tickets) {
        assert(t.ticket_id !== undefined && t.ticket_id !== "undefined" && t.ticket_id !== null, `Ticket ID is never undefined in ticket list: ${t.ticket_id}`);
        assert(t.user_name !== undefined && t.user_name !== "undefined", `User name is defined: ${t.user_name}`);
        assert(t.subject !== undefined && t.subject !== "undefined", `Subject is defined: ${t.subject}`);
    }

    console.log("\n==================================================================");
    console.log(`🎉 ALL ${passedCount} OF ${totalTests} TESTS PASSED PERFECTLY! (100% SUCCESS)`);
    console.log("==================================================================");
}

runTests().catch(err => {
    console.error("\n❌ TEST SUITE FAILED:", err);
    process.exit(1);
});

