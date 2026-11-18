/**
 * THULIRVA - MODULE 9 AUTOMATED VERIFICATION TEST
 * DYNAMIC SUBSCRIPTION MANAGEMENT, QUANTITY TIER PRICING, & DELIVERY SLOTS
 */

const assert = require("assert");
const subscriptionRoutes = require("./routes/subscriptions");
const calculatePricing = subscriptionRoutes.calculatePricing;

async function runSubscriptionTests() {
    console.log("===============================================================");
    console.log("▶ STARTING MODULE 9: SUBSCRIPTION PRICING & SLOTS TEST SUITE");
    console.log("===============================================================");

    let passedTests = 0;

    // Test 1: Tier Discount for Quantity 1 (0% discount)
    console.log("\n[TEST 1] Quantity 1 - Fresh Cow Milk 500ml (30 Days Daily)");
    const calcQ1 = calculatePricing({
        plan_id: 1,
        quantity: 1,
        frequency: "Daily",
        duration_days: 30,
        slot_type: "morning"
    });
    console.log(` -> Base unit: ₹${calcQ1.base_unit_price}, Deliveries: ${calcQ1.total_deliveries}`);
    console.log(` -> Gross: ₹${calcQ1.gross_total}, Discount%: ${calcQ1.tier_discount_percent}%, Total: ₹${calcQ1.total_price}`);
    assert.strictEqual(calcQ1.quantity, 1);
    assert.strictEqual(calcQ1.tier_discount_percent, 0, "Qty 1 must have 0% tier discount");
    assert.strictEqual(calcQ1.total_price, 1320, "Total must be ₹1320 for 30 daily deliveries of 1 unit");
    console.log("✓ TEST 1 PASSED: Qty 1 standard price verified");
    passedTests++;

    // Test 2: Tier Discount for Quantity 2 (3% tier discount)
    console.log("\n[TEST 2] Quantity 2 - 3% Tier Discount Verification");
    const calcQ2 = calculatePricing({
        plan_id: 1,
        quantity: 2,
        frequency: "Daily",
        duration_days: 30,
        slot_type: "morning"
    });
    console.log(` -> Gross: ₹${calcQ2.gross_total}, Discount%: ${calcQ2.tier_discount_percent}%, Discount: ₹${calcQ2.discount_amount}, Total: ₹${calcQ2.total_price}`);
    assert.strictEqual(calcQ2.tier_discount_percent, 3, "Qty 2 must have 3% tier discount");
    // Gross: 44 * 30 * 2 = 2640. 3% of 2640 = 79.2 -> 79. Total = 2640 - 79 = 2561
    assert.strictEqual(calcQ2.gross_total, 2640);
    assert.strictEqual(calcQ2.discount_amount, 79);
    assert.strictEqual(calcQ2.total_price, 2561);
    console.log("✓ TEST 2 PASSED: Qty 2 tier discount (3%) applied correctly");
    passedTests++;

    // Test 3: Tier Discount for Quantity 3 (6% tier discount)
    console.log("\n[TEST 3] Quantity 3 - 6% Tier Discount Verification");
    const calcQ3 = calculatePricing({
        plan_id: 1,
        quantity: 3,
        frequency: "Daily",
        duration_days: 30,
        slot_type: "morning"
    });
    console.log(` -> Gross: ₹${calcQ3.gross_total}, Discount%: ${calcQ3.tier_discount_percent}%, Discount: ₹${calcQ3.discount_amount}, Total: ₹${calcQ3.total_price}`);
    assert.strictEqual(calcQ3.tier_discount_percent, 6, "Qty 3 must have 6% tier discount");
    // Gross: 44 * 30 * 3 = 3960. 6% of 3960 = 237.6 -> 238. Total = 3960 - 238 = 3722
    assert.strictEqual(calcQ3.gross_total, 3960);
    assert.strictEqual(calcQ3.discount_amount, 238);
    assert.strictEqual(calcQ3.total_price, 3722);
    console.log("✓ TEST 3 PASSED: Qty 3 tier discount (6%) applied correctly");
    passedTests++;

    // Test 4: Tier Discount for Quantity 4 (9% tier discount)
    console.log("\n[TEST 4] Quantity 4 - 9% Tier Discount Verification");
    const calcQ4 = calculatePricing({
        plan_id: 1,
        quantity: 4,
        frequency: "Daily",
        duration_days: 30,
        slot_type: "morning"
    });
    console.log(` -> Gross: ₹${calcQ4.gross_total}, Discount%: ${calcQ4.tier_discount_percent}%, Discount: ₹${calcQ4.discount_amount}, Total: ₹${calcQ4.total_price}`);
    assert.strictEqual(calcQ4.tier_discount_percent, 9, "Qty 4 must have 9% tier discount");
    // Gross: 44 * 30 * 4 = 5280. 9% of 5280 = 475.2 -> 475. Total = 5280 - 475 = 4805
    assert.strictEqual(calcQ4.gross_total, 5280);
    assert.strictEqual(calcQ4.discount_amount, 475);
    assert.strictEqual(calcQ4.total_price, 4805);
    console.log("✓ TEST 4 PASSED: Qty 4 tier discount (9%) applied correctly");
    passedTests++;

    // Test 5: Tier Discount for Quantity 5+ (12% tier discount)
    console.log("\n[TEST 5] Quantity 5 - 12% Max Tier Discount Verification");
    const calcQ5 = calculatePricing({
        plan_id: 1,
        quantity: 5,
        frequency: "Daily",
        duration_days: 30,
        slot_type: "morning"
    });
    console.log(` -> Gross: ₹${calcQ5.gross_total}, Discount%: ${calcQ5.tier_discount_percent}%, Discount: ₹${calcQ5.discount_amount}, Total: ₹${calcQ5.total_price}`);
    assert.strictEqual(calcQ5.tier_discount_percent, 12, "Qty 5+ must have 12% tier discount");
    // Gross: 44 * 30 * 5 = 6600. 12% of 6600 = 792. Total = 6600 - 792 = 5808
    assert.strictEqual(calcQ5.gross_total, 6600);
    assert.strictEqual(calcQ5.discount_amount, 792);
    assert.strictEqual(calcQ5.total_price, 5808);
    console.log("✓ TEST 5 PASSED: Qty 5 tier discount (12%) applied correctly");
    passedTests++;

    // Test 6: Slot type 'both' (twice daily deliveries morning + evening)
    console.log("\n[TEST 6] Twice Daily Deliveries (slot_type = 'both')");
    const calcBoth = calculatePricing({
        plan_id: 1,
        quantity: 1,
        frequency: "Daily",
        duration_days: 30,
        slot_type: "both"
    });
    console.log(` -> Total Deliveries: ${calcBoth.total_deliveries}, Total Price: ₹${calcBoth.total_price}`);
    assert.strictEqual(calcBoth.total_deliveries, 60, "Both slots must double delivery count to 60");
    assert.strictEqual(calcBoth.total_price, 2640, "Total price must be ₹2640 (44 * 60)");
    console.log("✓ TEST 6 PASSED: Twice daily slot correctly doubles deliveries & calculates price");
    passedTests++;

    // Test 7: Alternate Days Frequency
    console.log("\n[TEST 7] Alternate Days Frequency (15 deliveries in 30 days)");
    const calcAlt = calculatePricing({
        plan_id: 1,
        quantity: 1,
        frequency: "Alternate",
        duration_days: 30,
        slot_type: "morning"
    });
    console.log(` -> Total Deliveries: ${calcAlt.total_deliveries}, Total Price: ₹${calcAlt.total_price}`);
    assert.strictEqual(calcAlt.total_deliveries, 15);
    assert.strictEqual(calcAlt.total_price, 660);
    console.log("✓ TEST 7 PASSED: Alternate frequency calculates 15 deliveries correctly");
    passedTests++;

    // Test 8: Server-Side Price Tampering Protection
    console.log("\n[TEST 8] Client Price Tampering Protection in createSubscriptionRecord");
    const tamperedSubInput = {
        customer_name: "Tamper Test User",
        customer_phone: "9876543210",
        customer_email: "tamper@thulirva.com",
        plan_id: 1,
        quantity: 1,
        total_price: 1, // Malicious client trying to purchase a ₹1320 subscription for ₹1
        frequency: "Daily",
        duration_days: 30,
        transaction_id: `TX-SEC-${Date.now()}`
    };

    const createdSub = await subscriptionRoutes.createSubscriptionRecord(tamperedSubInput);
    console.log(` -> Client sent total_price: ₹1, Server enforced total_price: ₹${createdSub.total_price}`);
    assert.strictEqual(createdSub.total_price, 1320, "Server must override tampered ₹1 with authentic calculated ₹1320");
    assert.strictEqual(createdSub.price_per_delivery, 44, "Server must enforce ₹44 per delivery");
    console.log("✓ TEST 8 PASSED: Client price tampering successfully detected and neutralized");
    passedTests++;

    // Test 9: Dynamic Delivery Slots File Persistence
    console.log("\n[TEST 9] Dynamic Delivery Slots Verification");
    const fs = require("fs");
    const path = require("path");
    const slotsPath = path.join(__dirname, "data", "delivery_slots.json");
    assert.ok(fs.existsSync(slotsPath), "delivery_slots.json must exist on disk");
    const slotsData = JSON.parse(fs.readFileSync(slotsPath, "utf-8"));
    assert.ok(Array.isArray(slotsData) && slotsData.length >= 3, "Must have default delivery slots");
    assert.ok(slotsData.some(s => s.slot_type === "morning"), "Must have morning slot");
    assert.ok(slotsData.some(s => s.slot_type === "evening"), "Must have evening slot");
    assert.ok(slotsData.some(s => s.slot_type === "both"), "Must have both morning & evening slot");
    console.log(` -> Found ${slotsData.length} active delivery slots: ${slotsData.map(s => s.display_text).join(" | ")}`);
    console.log("✓ TEST 9 PASSED: Delivery slots loaded and persisted properly");
    passedTests++;

    console.log("\n===============================================================");
    console.log(`✅ MODULE 9 TEST SUITE COMPLETE: ${passedTests}/${passedTests} TESTS PASSED!`);
    console.log("===============================================================\n");
}

runSubscriptionTests().catch(err => {
    console.error("❌ MODULE 9 TEST FAILURE:", err);
    process.exit(1);
});

