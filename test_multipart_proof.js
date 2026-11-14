const http = require("http");
const fs = require("fs");
const path = require("path");

async function testMultipartUpload() {
    console.log("\n[TEST 8] Testing Multipart/form-data File Upload...");

    // Create a boundary and multipart body
    const boundary = "---------------------------" + Date.now().toString(16);
    const testOrderId = "TEST-ORD-999-MP";

    // Setup order
    const ordersFile = path.resolve(__dirname, "data", "orders.json");
    let orders = JSON.parse(fs.readFileSync(ordersFile, "utf8"));
    orders.unshift({
        id: testOrderId,
        order_number: testOrderId,
        customer_name: "Multipart Customer",
        customer_phone: "9876543211",
        address: "456 Multipart Lane",
        city: "Chennai",
        partner_id: "THU-DP-0005",
        order_status: "in_transit",
        status: "in_transit",
        total_amount: 350,
        created_at: new Date().toISOString()
    });
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), "utf8");

    const dummyFileContent = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;");

    let payload = "";
    payload += `--${boundary}\r\n`;
    payload += `Content-Disposition: form-data; name="remarks"\r\n\r\n`;
    payload += `Multipart doorstep photo delivery verified\r\n`;

    payload += `--${boundary}\r\n`;
    payload += `Content-Disposition: form-data; name="latitude"\r\n\r\n`;
    payload += `12.8025\r\n`;

    payload += `--${boundary}\r\n`;
    payload += `Content-Disposition: form-data; name="longitude"\r\n\r\n`;
    payload += `80.2233\r\n`;

    payload += `--${boundary}\r\n`;
    payload += `Content-Disposition: form-data; name="proof_photo"; filename="doorstep_proof.gif"\r\n`;
    payload += `Content-Type: image/gif\r\n\r\n`;

    const bodyPrefix = Buffer.from(payload, "utf8");
    const bodySuffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const totalBody = Buffer.concat([bodyPrefix, dummyFileContent, bodySuffix]);

    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: "localhost",
            port: 5500,
            path: `/api/orders/${testOrderId}/delivery-proof`,
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": totalBody.length
            }
        }, (res) => {
            let resBody = "";
            res.on("data", c => resBody += c);
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(resBody);
                    console.log(`Status: ${res.statusCode}, Success: ${parsed.success}, URL: ${parsed.proof_url}`);
                    if (res.statusCode === 200 && parsed.success && parsed.proof_url) {
                        console.log("✓ Multipart photo proof upload succeeded with HTTP 200!");
                        resolve(true);
                    } else {
                        console.error("✗ Multipart upload returned unexpected body:", parsed);
                        resolve(false);
                    }
                } catch (e) {
                    console.error("✗ Failed to parse JSON:", resBody);
                    resolve(false);
                }
            });
        });

        req.on("error", reject);
        req.write(totalBody);
        req.end();
    });
}

testMultipartUpload().catch(console.error);

