const http = require("http");

function request(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (_) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on("error", reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log("=== RUNNING TRACKING & CHAT ENDPOINT TESTS ===");

    // Test 1: Order tracking for an order
    const t1 = await request({
        hostname: "localhost",
        port: 5500,
        path: "/api/orders/1794661515994/tracking",
        method: "GET"
    });
    console.log("Test 1 - GET /api/orders/1794661515994/tracking:", t1.status, "dest lat:", t1.body.customer_destination?.latitude, "dest lng:", t1.body.customer_destination?.longitude);

    // Test 2: Delivery router tracking alias
    const t2 = await request({
        hostname: "localhost",
        port: 5500,
        path: "/api/delivery/tracking/1794661515994",
        method: "GET"
    });
    console.log("Test 2 - GET /api/delivery/tracking/1794661515994:", t2.status, "dest city:", t2.body.customer_destination?.city);

    // Test 3: Chat get messages
    const t3 = await request({
        hostname: "localhost",
        port: 5500,
        path: "/api/orders/1794661515994/chat",
        method: "GET"
    });
    console.log("Test 3 - GET /api/orders/1794661515994/chat:", t3.status, "messages count:", t3.body.messages?.length);

    // Test 4: Post chat message
    const t4 = await request({
        hostname: "localhost",
        port: 5500,
        path: "/api/orders/1794661515994/chat",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, {
        sender: "customer",
        sender_name: "Customer Anand",
        text: "Please leave the packet inside the gate box."
    });
    console.log("Test 4 - POST /api/orders/1794661515994/chat:", t4.status, "saved:", t4.body.message?.text);

    // Test 5: Verify chat message appears
    const t5 = await request({
        hostname: "localhost",
        port: 5500,
        path: "/api/orders/1794661515994/chat",
        method: "GET"
    });
    console.log("Test 5 - GET /api/orders/1794661515994/chat after post:", t5.status, "messages:", t5.body.messages?.map(m => m.text));

    // Test 6: Location by order ID
    const t6 = await request({
        hostname: "localhost",
        port: 5500,
        path: "/api/delivery/location/1794661515994",
        method: "GET"
    });
    console.log("Test 6 - GET /api/delivery/location/1794661515994:", t6.status, "partner:", t6.body.partner_id, "lat:", t6.body.location?.latitude);

    console.log("ALL TESTS COMPLETED SUCCESSFULLY");
}

runTests().catch(console.error);

