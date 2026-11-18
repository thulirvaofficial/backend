/**
 * THULIRVA - INTEGRATION TEST SUITE
 * ORDER LIFECYCLE STATE MACHINE, CHAT MESSAGING, ATTENDANCE & RATINGS
 */

const assert = require("assert");
const { validateTransition, normalizeStatus } = require("./utils/deliveryStateMachine");
const { saveChatMessage, getChatMessages, markChatAsRead } = require("./services/chatService");
const { checkIn, checkOut, getTodayAttendance } = require("./services/attendanceService");
const { submitCustomerRating, submitPartnerRating, getOrderRatings } = require("./services/ratingService");
const { checkServiceability } = require("./services/serviceabilityService");

async function runLifecycleTests() {
    console.log("===============================================================");
    console.log("▶ STARTING INTEGRATION TEST SUITE: ORDER LIFECYCLE & WORKFLOWS");
    console.log("===============================================================");

    let passedTests = 0;

    // Test 1: Order State Machine Transitions
    console.log("\n[TEST 1] Testing Delivery State Machine valid & invalid transitions");
    const valid1 = validateTransition("assigned", "accepted", { isAdmin: true });
    assert.strictEqual(valid1.valid, true, "assigned -> accepted must be valid");
    
    const valid2 = validateTransition("accepted", "picked_up", { isAdmin: true });
    assert.strictEqual(valid2.valid, true, "accepted -> picked_up must be valid");

    const valid3 = validateTransition("picked_up", "in_transit", { isAdmin: true });
    assert.strictEqual(valid3.valid, true, "picked_up -> in_transit must be valid");

    // Invalid transition: pending straight to delivered without assignment/pickup
    const invalidSkip = validateTransition("pending", "delivered", { isAdmin: false });
    assert.strictEqual(invalidSkip.valid, false, "pending -> delivered direct jump must be rejected");
    console.log("✓ TEST 1 PASSED: State machine successfully validates valid and rejects illegal jumps");
    passedTests++;

    // Test 2: Two-Way Customer <-> Partner Messaging
    console.log("\n[TEST 2] Testing Order-Associated Two-Way In-App Chat");
    const testOrderId = `TEST-ORD-${Date.now()}`;
    
    // Customer sends message
    const msg1 = await saveChatMessage(testOrderId, {
        sender: "customer",
        sender_name: "Kavitha S.",
        text: "Please leave package with security guard if door unanswered."
    });
    assert.strictEqual(msg1.sender, "customer");
    assert.strictEqual(msg1.order_id, testOrderId);
    assert.strictEqual(msg1.is_read, false);

    // Partner sends reply
    const msg2 = await saveChatMessage(testOrderId, {
        sender: "partner",
        sender_name: "Murugan D. (Delivery Partner)",
        text: "Understood ma'am, will do that upon arrival."
    });
    assert.strictEqual(msg2.sender, "partner");

    // Retrieve chat history
    const history = await getChatMessages(testOrderId);
    assert.ok(history.length >= 3, "History must contain system welcome + 2 messages");
    
    // Mark as read by customer
    const readRes = await markChatAsRead(testOrderId, "customer");
    assert.ok(readRes.read_count >= 1, "Must mark partner message as read");
    console.log("✓ TEST 2 PASSED: Two-way order chat with read receipts verified");
    passedTests++;

    // Test 3: Partner Attendance Photo Check-in
    console.log("\n[TEST 3] Testing Mandatory Partner Attendance Check-in");
    const testPartnerId = `PT-TEST-${Date.now()}`;
    
    // Attempt gallery photo check-in (Must be rejected)
    const galleryCheck = await checkIn({
        partner_id: testPartnerId,
        is_camera: false
    });
    assert.strictEqual(galleryCheck.success, false, "Gallery upload must be rejected for attendance");
    assert.ok(galleryCheck.message.includes("camera"), "Message must require live camera capture");

    // Legitimate camera check-in
    const dummySelfie = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const checkinRes = await checkIn({
        partner_id: testPartnerId,
        partner_name: "Test Rider",
        photo_base64: dummySelfie,
        latitude: 12.9234,
        longitude: 80.1345,
        is_camera: true
    });
    assert.strictEqual(checkinRes.success, true, "Camera check-in must succeed");
    assert.ok(checkinRes.attendance.check_in_time);

    // Duplicate check-in on the same day must be rejected
    const dupCheck = await checkIn({
        partner_id: testPartnerId,
        is_camera: true
    });
    assert.strictEqual(dupCheck.success, false, "Duplicate check-in today must be blocked");

    // Check Out
    const checkoutRes = await checkOut({ partner_id: testPartnerId });
    assert.strictEqual(checkoutRes.success, true, "Check-out must succeed");
    assert.ok(checkoutRes.attendance.check_out_time);
    console.log("✓ TEST 3 PASSED: Compulsory camera attendance and shift lifecycle verified");
    passedTests++;

    // Test 4: Ratings and Feedback
    console.log("\n[TEST 4] Testing Customer & Partner Delivery Ratings");
    const fs = require("fs");
    const path = require("path");
    const ordersFile = path.join(__dirname, "data", "orders.json");
    const orders = JSON.parse(fs.readFileSync(ordersFile, "utf-8"));
    const rateOrderId = `ORD-RATE-${Date.now()}`;
    orders.unshift({
        id: rateOrderId,
        order_number: rateOrderId,
        user_id: 101,
        partner_id: "THU-DP-0001",
        order_status: "delivered",
        total: 350
    });
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), "utf-8");

    try {
        // Customer rates partner
        const custRating = await submitCustomerRating({
            order_id: rateOrderId,
            user_id: 101,
            rating: 5,
            behavior_rating: 5,
            feedback: "Very polite delivery partner, milk arrived chilled and fresh."
        });
        assert.strictEqual(custRating.success, true);
        assert.strictEqual(custRating.rating.rating, 5);

        // Duplicate rating on same order rejected
        try {
            await submitCustomerRating({ order_id: rateOrderId, user_id: 101, rating: 4 });
            assert.fail("Duplicate customer rating should throw error");
        } catch (e) {
            assert.ok(e.message.includes("already been submitted") || e.message.includes("already"));
        }

        // Partner rates delivery experience
        const partRating = await submitPartnerRating({
            order_id: rateOrderId,
            partner_id: "THU-DP-0001",
            rating: 5,
            delivery_experience: "Smooth doorstep handover"
        });
        assert.strictEqual(partRating.success, true);

        const orderRatings = getOrderRatings(rateOrderId);
        assert.strictEqual(orderRatings.length, 2, "Must contain customer and partner rating");
        console.log("✓ TEST 4 PASSED: Customer and partner ratings with duplicate protection verified");
        passedTests++;
    } finally {
        // Clean up test order
        const curOrders = JSON.parse(fs.readFileSync(ordersFile, "utf-8"));
        const cleaned = curOrders.filter(o => o.id !== rateOrderId);
        fs.writeFileSync(ordersFile, JSON.stringify(cleaned, null, 2), "utf-8");
    }

    // Test 5: Serviceability for Thiruverkadu (PIN 600077)
    console.log("\n[TEST 5] Testing Serviceability Resolution for Thiruverkadu");
    const pinCheck = await checkServiceability({ pincode: "600077" });
    assert.strictEqual(pinCheck.serviceable, true, "Thiruverkadu PIN 600077 must be serviceable");
    assert.strictEqual(pinCheck.area.name, "Thiruverkadu");

    const gpsCheck = await checkServiceability({ latitude: 13.0694, longitude: 80.1247 });
    assert.strictEqual(gpsCheck.serviceable, true, "Thiruverkadu GPS coordinate must be serviceable");
    console.log("✓ TEST 5 PASSED: Thiruverkadu delivery area confirmed serviceable via PIN and GPS");
    passedTests++;

    console.log("\n===============================================================");
    console.log(`✅ INTEGRATION TEST SUITE COMPLETE: ${passedTests}/${passedTests} TESTS PASSED!`);
    console.log("===============================================================\n");
}

runLifecycleTests().catch(err => {
    console.error("❌ TEST SUITE FAILED:", err);
    process.exit(1);
});
