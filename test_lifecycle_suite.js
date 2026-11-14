const http = require("http");
const fs = require("fs");
const path = require("path");

function request(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
                } catch (_) {
                    resolve({ status: res.statusCode, headers: res.headers, body });
                }
            });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
    });
}

async function runTests() {
    console.log("=== THULIRVA DELIVERY ECOSYSTEM VERIFICATION ===");

    // 1. Test Static Partner Profile Photo
    console.log("\n[TEST 1] Verifying Delivery Partner Profile Photo...");
    const photoRes = await request({
        hostname: "localhost",
        port: 5500,
        path: "/uploads/partners/vignesh_profile.png",
        method: "GET"
    });
    console.log(`Status: ${photoRes.status} (Expected: 200)`);
    if (photoRes.status === 200) {
        console.log("✓ Partner profile photo returns 200 OK");
    } else {
        console.error("✗ Failed to fetch partner profile photo:", photoRes.status);
    }

    // 2. Setup a test order in orders.json
    const ordersFile = path.resolve(__dirname, "data", "orders.json");
    let orders = [];
    if (fs.existsSync(ordersFile)) {
        orders = JSON.parse(fs.readFileSync(ordersFile, "utf8"));
    }
    const testOrderId = "TEST-ORD-999";
    const existingIndex = orders.findIndex(o => o.id === testOrderId || o.order_number === testOrderId);
    const testOrder = {
        id: testOrderId,
        order_number: testOrderId,
        customer_name: "Test Customer",
        customer_phone: "9876543210",
        address: "123 Test Street",
        city: "Chennai",
        partner_id: "THU-DP-0005",
        order_status: "assigned",
        status: "assigned",
        total_amount: 500,
        created_at: new Date().toISOString()
    };
    if (existingIndex >= 0) orders[existingIndex] = testOrder;
    else orders.unshift(testOrder);
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), "utf8");

    // 3. Test State Machine Transition: Attempt skipping pickup directly to in_transit
    console.log("\n[TEST 2] Testing Gating: Skipping pickup directly to in_transit...");
    const skipPickupRes = await request({
        hostname: "localhost",
        port: 5500,
        path: `/api/orders/${testOrderId}/status`,
        method: "PUT",
        headers: { "Content-Type": "application/json" }
    }, JSON.stringify({
        status: "in_transit",
        partner_id: "THU-DP-0005"
    }));
    console.log(`Status: ${skipPickupRes.status}, Code: ${skipPickupRes.body?.error_code}`);
    if (skipPickupRes.status === 400 && skipPickupRes.body?.error_code === "PICKUP_REQUIRED") {
        console.log("✓ Correctly blocked transition to in_transit: 'PICKUP_REQUIRED'");
    } else {
        console.error("✗ Failed gating check:", skipPickupRes.body);
    }

    // 4. Test State Machine Transition: Advance to pickup_confirmed
    console.log("\n[TEST 3] Testing Transition: ASSIGNED -> PICKUP_CONFIRMED...");
    const pickupRes = await request({
        hostname: "localhost",
        port: 5500,
        path: `/api/orders/${testOrderId}/status`,
        method: "PUT",
        headers: { "Content-Type": "application/json" }
    }, JSON.stringify({
        status: "pickup_confirmed",
        partner_id: "THU-DP-0005"
    }));
    console.log(`Status: ${pickupRes.status}, Status: ${pickupRes.body?.order?.order_status}`);
    if (pickupRes.status === 200 && pickupRes.body?.order?.order_status === "pickup_confirmed") {
        console.log("✓ Correctly advanced to pickup_confirmed");
    } else {
        console.error("✗ Failed to advance to pickup_confirmed:", pickupRes.body);
    }

    // 5. Test State Machine Transition: Advance to in_transit
    console.log("\n[TEST 4] Testing Transition: PICKUP_CONFIRMED -> IN_TRANSIT...");
    const transitRes = await request({
        hostname: "localhost",
        port: 5500,
        path: `/api/orders/${testOrderId}/status`,
        method: "PUT",
        headers: { "Content-Type": "application/json" }
    }, JSON.stringify({
        status: "in_transit",
        partner_id: "THU-DP-0005"
    }));
    console.log(`Status: ${transitRes.status}, Status: ${transitRes.body?.order?.order_status}`);
    if (transitRes.status === 200 && transitRes.body?.order?.order_status === "in_transit") {
        console.log("✓ Correctly advanced to in_transit");
    } else {
        console.error("✗ Failed to advance to in_transit:", transitRes.body);
    }

    // 6. Test Gating: Attempt transition to delivered without proof
    console.log("\n[TEST 5] Testing Gating: IN_TRANSIT -> DELIVERED without proof photo...");
    const noProofRes = await request({
        hostname: "localhost",
        port: 5500,
        path: `/api/orders/${testOrderId}/status`,
        method: "PUT",
        headers: { "Content-Type": "application/json" }
    }, JSON.stringify({
        status: "delivered",
        partner_id: "THU-DP-0005"
    }));
    console.log(`Status: ${noProofRes.status}, Code: ${noProofRes.body?.error_code}`);
    if (noProofRes.status === 400 && noProofRes.body?.error_code === "PROOF_REQUIRED") {
        console.log("✓ Correctly blocked transition to delivered: 'PROOF_REQUIRED'");
    } else {
        console.error("✗ Failed gating check:", noProofRes.body);
    }

    // 7. Test Upload Delivery Proof & Complete Delivery
    console.log("\n[TEST 6] Testing Delivery Proof Upload & Completion...");
    const dummyBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const proofRes = await request({
        hostname: "localhost",
        port: 5500,
        path: `/api/orders/${testOrderId}/delivery-proof`,
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, JSON.stringify({
        image: dummyBase64,
        partner_id: "THU-DP-0005",
        remarks: "Delivered to customer doorstep verified with photo",
        latitude: 12.8025,
        longitude: 80.2233
    }));
    console.log(`Status: ${proofRes.status}, Success: ${proofRes.body?.success}, Proof URL: ${proofRes.body?.proof_url}`);
    if (proofRes.status === 200 && proofRes.body?.success && proofRes.body?.proof_url) {
        console.log("✓ Delivery proof uploaded and order marked delivered!");
    } else {
        console.error("✗ Failed delivery proof upload:", proofRes.body);
    }

    // 8. Test Permanently Locked Check
    console.log("\n[TEST 7] Testing Locked Order: Attempt modifying delivered order...");
    const lockedRes = await request({
        hostname: "localhost",
        port: 5500,
        path: `/api/orders/${testOrderId}/status`,
        method: "PUT",
        headers: { "Content-Type": "application/json" }
    }, JSON.stringify({
        status: "in_transit",
        partner_id: "THU-DP-0005"
    }));
    console.log(`Status: ${lockedRes.status}, Code: ${lockedRes.body?.error_code}`);
    if (lockedRes.status === 400 && lockedRes.body?.error_code === "ORDER_LOCKED") {
        console.log("✓ Correctly blocked modification on locked delivered order");
    } else {
        console.error("✗ Failed locked check:", lockedRes.body);
    }

    console.log("\n=== ALL BACKEND LIFECYCLE TESTS COMPLETED ===");
}

runTests().catch(console.error);
