const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || "THULIRVA_CHANGE_THIS_SECRET_KEY";
const BASE_URL = 'http://localhost:5500';
const ORDERS_FILE = path.resolve(__dirname, 'data', 'orders.json');

function makeRequest({ method, urlPath, headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlPath, BASE_URL);
        const opts = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method,
            headers
        };

        const req = http.request(opts, (res) => {
            const chunks = [];
            res.on('data', (d) => chunks.push(d));
            res.on('end', () => {
                const rawBuffer = Buffer.concat(chunks);
                const rawText = rawBuffer.toString('utf-8');
                let json = null;
                try {
                    json = JSON.parse(rawText);
                } catch (_) {}
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    rawBuffer,
                    rawText,
                    json
                });
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

// 1x1 green jpeg for delivery proof
const VALID_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function runTests() {
    console.log("==================================================");
    console.log("   STEP 3 VERIFICATION: ORDER STATUS SYNCHRONIZATION");
    console.log("==================================================\n");

    const partnerId = "DP-TEST-9999";
    const partnerToken = jwt.sign(
        { partner_id: partnerId, name: "Vignesh Test", phone: "9840515293", role: "delivery_partner" },
        JWT_SECRET,
        { expiresIn: "1h" }
    );

    const testOrderId = `ORD-TEST-${Date.now()}`;

    // Seed test order
    let orders = [];
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
        }
    } catch (_) {}

    const newOrder = {
        id: testOrderId,
        order_number: testOrderId,
        order_status: "placed",
        status: "placed",
        total: 240,
        customer_name: "Customer Thiruverkadu",
        customer_phone: "9876543210",
        address: "No 12, Dairy Street",
        city: "Chennai",
        partner_id: partnerId,
        user_id: "cust_test_1",
        created_at: new Date().toISOString()
    };

    orders.unshift(newOrder);
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');

    let passed = 0;
    let failed = 0;

    function assert(cond, name) {
        if (cond) {
            console.log(`✓ [PASS] ${name}`);
            passed++;
        } else {
            console.error(`✗ [FAIL] ${name}`);
            failed++;
        }
    }

    const getStatus = (res) => res.json?.order?.order_status || res.json?.order_status || res.json?.order?.status || res.json?.status;

    // 1. Initial State: PLACED
    console.log("--- Test 1: Verify Initial Order Status (PLACED) ---");
    let fetchRes = await makeRequest({ method: 'GET', urlPath: `/api/orders/${testOrderId}` });
    assert(fetchRes.statusCode === 200, `Fetch order returns HTTP 200 (Got ${fetchRes.statusCode})`);
    assert(getStatus(fetchRes) === "placed", `Order status is 'placed' (Got ${getStatus(fetchRes)})`);

    // 2. Transition: PLACED -> CONFIRMED
    console.log("\n--- Test 2: Transition PLACED -> CONFIRMED ---");
    let updateRes = await makeRequest({
        method: 'PUT',
        urlPath: `/api/orders/${testOrderId}/status`,
        headers: { 'Content-Type': 'application/json', 'x-admin-key': 'thulirva_admin' },
        body: JSON.stringify({ status: "confirmed" })
    });
    assert(updateRes.statusCode === 200, `Status updated to 'confirmed' (HTTP 200)`);
    fetchRes = await makeRequest({ method: 'GET', urlPath: `/api/orders/${testOrderId}` });
    assert(getStatus(fetchRes) === "confirmed", "Backend confirms status is 'confirmed'");

    // 3. Transition: CONFIRMED -> PREPARING
    console.log("\n--- Test 3: Transition CONFIRMED -> PREPARING ---");
    updateRes = await makeRequest({
        method: 'PUT',
        urlPath: `/api/orders/${testOrderId}/status`,
        headers: { 'Content-Type': 'application/json', 'x-admin-key': 'thulirva_admin' },
        body: JSON.stringify({ status: "preparing" })
    });
    assert(updateRes.statusCode === 200, `Status updated to 'preparing' (HTTP 200)`);
    fetchRes = await makeRequest({ method: 'GET', urlPath: `/api/orders/${testOrderId}` });
    assert(getStatus(fetchRes) === "preparing", "Backend confirms status is 'preparing'");

    // 4. Transition: PREPARING -> ASSIGNED
    console.log("\n--- Test 4: Transition PREPARING -> ASSIGNED ---");
    updateRes = await makeRequest({
        method: 'PUT',
        urlPath: `/api/orders/${testOrderId}/status`,
        headers: { 'Content-Type': 'application/json', 'x-admin-key': 'thulirva_admin' },
        body: JSON.stringify({ status: "assigned", partner_id: partnerId })
    });
    assert(updateRes.statusCode === 200, `Status updated to 'assigned' (HTTP 200)`);
    fetchRes = await makeRequest({ method: 'GET', urlPath: `/api/orders/${testOrderId}` });
    assert(getStatus(fetchRes) === "assigned", "Backend confirms status is 'assigned'");

    // 5. Partner transitions: ASSIGNED -> PICKED_UP
    console.log("\n--- Test 5: Delivery Partner Transitions ASSIGNED -> PICKED_UP ---");
    const partnerPickupRes = await makeRequest({
        method: 'PUT',
        urlPath: `/api/delivery/orders/${testOrderId}/status`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${partnerToken}`
        },
        body: JSON.stringify({ status: "picked_up" })
    });
    assert(partnerPickupRes.statusCode === 200, `Partner pickup returns HTTP 200 (Got ${partnerPickupRes.statusCode})`);
    assert(partnerPickupRes.json && partnerPickupRes.json.success === true, "Partner pickup response success === true");

    // Fetch order as Customer
    fetchRes = await makeRequest({ method: 'GET', urlPath: `/api/orders/${testOrderId}` });
    assert(getStatus(fetchRes) === "picked_up", `Customer sees status 'picked_up' (Got ${getStatus(fetchRes)})`);

    // 6. Partner transitions: PICKED_UP -> OUT_FOR_DELIVERY
    console.log("\n--- Test 6: Delivery Partner Transitions PICKED_UP -> OUT_FOR_DELIVERY ---");
    const partnerOutRes = await makeRequest({
        method: 'PUT',
        urlPath: `/api/delivery/orders/${testOrderId}/status`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${partnerToken}`
        },
        body: JSON.stringify({ status: "out_for_delivery" })
    });
    assert(partnerOutRes.statusCode === 200, `Partner out for delivery returns HTTP 200 (Got ${partnerOutRes.statusCode})`);
    assert(partnerOutRes.json?.order?.order_status === "out_for_delivery", "Partner App order status is 'out_for_delivery'");

    // Customer App and Admin Portal check
    fetchRes = await makeRequest({ method: 'GET', urlPath: `/api/orders/${testOrderId}` });
    assert(getStatus(fetchRes) === "out_for_delivery", `Customer App immediately reflects 'out_for_delivery' (Got ${getStatus(fetchRes)})`);

    // 7. Verify Persistence on Disk
    console.log("\n--- Test 7: Verify Status Persistence on Disk File ---");
    const diskOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    const diskMatch = diskOrders.find(o => o.id === testOrderId || o.order_number === testOrderId);
    assert(diskMatch && diskMatch.order_status === "out_for_delivery", `Disk JSON has persisted order_status: ${diskMatch?.order_status}`);

    // 8. Invalid Transition Block: Cannot jump from out_for_delivery back to placed
    console.log("\n--- Test 8: State Machine Enforces Valid Transitions ---");
    const badJumpRes = await makeRequest({
        method: 'PUT',
        urlPath: `/api/delivery/orders/${testOrderId}/status`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${partnerToken}`
        },
        body: JSON.stringify({ status: "placed" })
    });
    assert(badJumpRes.statusCode === 400, `Illegal backwards jump blocked with HTTP 400 (Got ${badJumpRes.statusCode})`);

    // 9. Delivery Completion: OUT_FOR_DELIVERY -> DELIVERED with proof
    console.log("\n--- Test 9: Complete Delivery with Mandatory Proof (OUT_FOR_DELIVERY -> DELIVERED) ---");
    const proofRes = await makeRequest({
        method: 'POST',
        urlPath: `/api/delivery/orders/${testOrderId}/delivery-proof`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${partnerToken}`
        },
        body: JSON.stringify({
            image: `data:image/jpeg;base64,${VALID_JPEG_BASE64}`,
            remarks: "Handed over to customer safely",
            latitude: 13.0827,
            longitude: 80.2707
        })
    });
    assert(proofRes.statusCode === 200, `Delivery completion returns HTTP 200 (Got ${proofRes.statusCode})`);
    assert(proofRes.json && proofRes.json.success === true, "Delivery completion response success === true");

    // Customer App verification
    fetchRes = await makeRequest({ method: 'GET', urlPath: `/api/orders/${testOrderId}` });
    assert(getStatus(fetchRes) === "delivered", `Customer App reflects 'delivered' (Got ${getStatus(fetchRes)})`);

    // 10. Locked: Delivered Order cannot be modified
    console.log("\n--- Test 10: Delivered Order is Permanently Locked ---");
    const lockRes = await makeRequest({
        method: 'PUT',
        urlPath: `/api/delivery/orders/${testOrderId}/status`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${partnerToken}`
        },
        body: JSON.stringify({ status: "out_for_delivery" })
    });
    assert(lockRes.statusCode === 400, `Modification on locked delivered order rejected with HTTP 400 (Got ${lockRes.statusCode})`);

    console.log("\n==================================================");
    console.log(`STEP 3 SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error("Test execution fatal error:", err);
    process.exit(1);
});
