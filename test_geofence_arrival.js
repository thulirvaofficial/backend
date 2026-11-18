const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { calculateDistanceMeters, checkGeofenceTriggers, resetOrderGeofence } = require("./services/geofenceService");

const DATA_DIR = path.resolve(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const GEOFENCE_STATE_FILE = path.join(DATA_DIR, "geofence_events.json");

const TEST_ORDER_ID = "ORD-GEO-TEST-001";
const TEST_PARTNER_ID = "PARTNER-GEO-001";
const TEST_USER_ID = "CUST-GEO-001";

// Destination: Padur Chennai (12.8025, 80.2233)
const DEST_LAT = 12.802500;
const DEST_LNG = 80.223300;

async function runGeofenceTests() {
    console.log("=== THULIRVA DELIVERY PARTNER ARRIVAL NOTIFICATION (100M GEOFENCE) TEST ===");

    // Test 1: Haversine Distance Calculation Accuracy
    console.log("[1] Testing Haversine formula calculation...");
    const distZero = calculateDistanceMeters(DEST_LAT, DEST_LNG, DEST_LAT, DEST_LNG);
    assert.strictEqual(Math.round(distZero), 0, "Distance to self must be 0 meters");

    // Coordinate approx 60 meters away
    const lat60m = DEST_LAT + 0.00054; // ~60m north
    const dist60m = calculateDistanceMeters(DEST_LAT, DEST_LNG, lat60m, DEST_LNG);
    assert(dist60m > 50 && dist60m < 70, `Distance should be ~60m, got ${dist60m}m`);

    // Coordinate approx 500 meters away
    const lat500m = DEST_LAT + 0.0045; // ~500m north
    const dist500m = calculateDistanceMeters(DEST_LAT, DEST_LNG, lat500m, DEST_LNG);
    assert(dist500m > 400 && dist500m < 600, `Distance should be ~500m, got ${dist500m}m`);
    console.log(`✓ Haversine distances verified: 0m, ${Math.round(dist60m)}m, ${Math.round(dist500m)}m.`);

    // Setup active order in orders.json
    let orders = [];
    if (fs.existsSync(ORDERS_FILE)) {
        try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8")); } catch (_) {}
    }
    const cleanOrders = orders.filter(o => o.id !== TEST_ORDER_ID);
    cleanOrders.push({
        id: TEST_ORDER_ID,
        order_number: TEST_ORDER_ID,
        user_id: TEST_USER_ID,
        partner_id: TEST_PARTNER_ID,
        order_status: "out_for_delivery",
        latitude: DEST_LAT,
        longitude: DEST_LNG,
        customer_name: "Test Customer"
    });
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(cleanOrders, null, 2), "utf-8");

    // Reset geofence state for this order
    resetOrderGeofence(TEST_ORDER_ID);

    try {
        // Test 2: Partner at 500 meters away (Outside 100m geofence)
        console.log("[2] Partner GPS at 500m away -> Geofence should NOT trigger...");
        await checkGeofenceTriggers({
            partner_id: TEST_PARTNER_ID,
            latitude: lat500m,
            longitude: DEST_LNG,
            accuracy: 10,
            timestamp: new Date().toISOString()
        });

        let geofenceState = JSON.parse(fs.readFileSync(GEOFENCE_STATE_FILE, "utf-8"));
        assert(!geofenceState.product_arrival[TEST_ORDER_ID], "Geofence must not trigger when outside 100m");
        console.log("✓ Geofence correctly stayed dormant at 500m.");

        // Test 3: Partner enters 100m radius (~60m away) -> Geofence MUST trigger
        console.log("[3] Partner enters 100m radius (60m away) -> Geofence MUST trigger...");
        await checkGeofenceTriggers({
            partner_id: TEST_PARTNER_ID,
            latitude: lat60m,
            longitude: DEST_LNG,
            accuracy: 10,
            timestamp: new Date().toISOString()
        });

        geofenceState = JSON.parse(fs.readFileSync(GEOFENCE_STATE_FILE, "utf-8"));
        const arrivalEvent = geofenceState.product_arrival[TEST_ORDER_ID];
        assert(arrivalEvent, "Arrival event must be recorded in geofence state");
        assert.strictEqual(arrivalEvent.order_id, TEST_ORDER_ID);
        assert.strictEqual(arrivalEvent.partner_id, TEST_PARTNER_ID);
        assert(arrivalEvent.distance_meters <= 100, `Recorded distance must be <= 100m, got ${arrivalEvent.distance_meters}m`);
        assert(arrivalEvent.arrived_at, "Arrival timestamp must be recorded");
        const recordedTime = new Date(arrivalEvent.arrived_at).getTime();
        console.log(`✓ Arrival event triggered: Partner at ${arrivalEvent.distance_meters}m. Arrival logged at ${arrivalEvent.arrived_at}.`);

        // Test 4: Idempotency (Subsequent GPS updates inside geofence must NEVER re-trigger)
        console.log("[4] Testing duplicate prevention on subsequent GPS updates inside 100m...");
        const lat30m = DEST_LAT + 0.00027; // ~30m
        await checkGeofenceTriggers({
            partner_id: TEST_PARTNER_ID,
            latitude: lat30m,
            longitude: DEST_LNG,
            accuracy: 8,
            timestamp: new Date().toISOString()
        });

        geofenceState = JSON.parse(fs.readFileSync(GEOFENCE_STATE_FILE, "utf-8"));
        const subsequentEvent = geofenceState.product_arrival[TEST_ORDER_ID];
        assert.strictEqual(new Date(subsequentEvent.arrived_at).getTime(), recordedTime, "Timestamp must not be altered; duplicate triggers prevented");
        console.log("✓ Idempotency verified: Zero duplicate notifications on continuous GPS updates.");

        console.log("\n=======================================================");
        console.log("✓ ALL GEOFENCE ARRIVAL NOTIFICATION TESTS PASSED (4/4)");
        console.log("=======================================================\n");
    } finally {
        // Cleanup test order and geofence state
        resetOrderGeofence(TEST_ORDER_ID);
        const restoredOrders = cleanOrders.filter(o => o.id !== TEST_ORDER_ID);
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(restoredOrders, null, 2), "utf-8");
    }
}

runGeofenceTests().catch(err => {
    console.error("GEOFENCE TEST FAILED:", err);
    process.exit(1);
});
