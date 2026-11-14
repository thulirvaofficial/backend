const http = require('http');
const fs = require('fs');
const path = require('path');

// Real sample valid JPEG base64 (Red square test photo)
const sampleJpgBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function makeRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: buffer.toString('utf8'),
                    buffer
                });
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function runStep1Verification() {
    console.log('================================================================');
    console.log('  THULIRVA STEP 1 - DELIVERY PROOF IMAGE UPLOAD VERIFICATION');
    console.log('================================================================');

    let allPassed = true;
    const testOrderId = `STEP1-VERIFY-${Date.now()}`;

    // TEST 1: Upload Delivery Proof with real JPEG image
    console.log('\n[TEST 1] Testing Delivery Proof Upload API (POST /api/orders/:id/delivery-proof)...');
    const uploadPayload = JSON.stringify({
        image: sampleJpgBase64,
        remarks: 'Delivered to customer doorstep at Padur Flat 4B',
        latitude: 12.8025,
        longitude: 80.2233,
        partner_id: 'THU-DP-0001'
    });

    const uploadRes = await makeRequest({
        hostname: '127.0.0.1',
        port: 5500,
        path: `/api/orders/${testOrderId}/delivery-proof`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(uploadPayload)
        }
    }, uploadPayload);

    console.log('  Upload Response Code:', uploadRes.statusCode);
    const uploadJson = JSON.parse(uploadRes.body);
    console.log('  Upload Success:', uploadJson.success);
    console.log('  Proof URL:', uploadJson.proof_url);

    if (uploadRes.statusCode === 200 && uploadJson.success && uploadJson.proof_url) {
        console.log('  ✓ TEST 1 PASSED: Delivery proof stored successfully on server.');
    } else {
        console.error('  ❌ TEST 1 FAILED:', uploadRes.body);
        allPassed = false;
    }

    const proofUrl = uploadJson.proof_url;

    // TEST 2: Retrieve Image from Server via HTTP GET
    console.log('\n[TEST 2] Testing Image Retrieval via HTTP GET (' + proofUrl + ')...');
    const imgRes = await makeRequest({
        hostname: '127.0.0.1',
        port: 5500,
        path: proofUrl,
        method: 'GET'
    });

    console.log('  Image Fetch Code:', imgRes.statusCode);
    console.log('  Content-Type:', imgRes.headers['content-type']);
    console.log('  Downloaded Bytes:', imgRes.buffer.length);

    // Verify JPEG magic bytes: 0xFF, 0xD8
    const isJpeg = imgRes.buffer[0] === 0xFF && imgRes.buffer[1] === 0xD8;
    if (imgRes.statusCode === 200 && imgRes.headers['content-type'] === 'image/jpeg' && isJpeg) {
        console.log('  ✓ TEST 2 PASSED: Image is valid JPEG, Content-Type is image/jpeg, magic bytes verified.');
    } else {
        console.error('  ❌ TEST 2 FAILED: Invalid image content or headers.');
        allPassed = false;
    }

    // TEST 3: Verify Physical Storage on Disk
    console.log('\n[TEST 3] Testing Physical Disk Persistence...');
    const localRelPath = proofUrl.replace(/^\/uploads\//, '');
    const diskPath = path.resolve(__dirname, 'public', 'uploads', localRelPath);
    console.log('  Checking disk path:', diskPath);
    if (fs.existsSync(diskPath) && fs.statSync(diskPath).size > 0) {
        console.log('  ✓ TEST 3 PASSED: File confirmed on disk with size', fs.statSync(diskPath).size, 'bytes.');
    } else {
        console.error('  ❌ TEST 3 FAILED: File missing from disk!');
        allPassed = false;
    }

    // TEST 4: Retrieve Delivery Details via API (GET /api/orders/:id/delivery-details)
    console.log('\n[TEST 4] Testing Delivery Details API Retrieval...');
    const detailsRes = await makeRequest({
        hostname: '127.0.0.1',
        port: 5500,
        path: `/api/orders/${testOrderId}/delivery-details`,
        method: 'GET'
    });

    console.log('  Details Code:', detailsRes.statusCode);
    const detailsJson = JSON.parse(detailsRes.body);
    console.log('  Order Status:', detailsJson.delivery?.status);
    console.log('  Delivery Proof URL:', detailsJson.delivery?.delivery_proof);
    console.log('  Handover Time:', detailsJson.delivery?.delivered_at);
    console.log('  Remarks:', detailsJson.delivery?.delivery_remarks);

    if (detailsRes.statusCode === 200 && detailsJson.success && detailsJson.delivery?.delivery_proof === proofUrl) {
        console.log('  ✓ TEST 4 PASSED: Delivery details and proof URL correctly synced in backend.');
    } else {
        console.error('  ❌ TEST 4 FAILED:', detailsRes.body);
        allPassed = false;
    }

    // TEST 5: Verify Missing Image Fallback (Guarantees NO HTML is sent to Flutter decoders)
    console.log('\n[TEST 5] Testing Missing Image Fallback (Never return HTML)...');
    const fakeImgRes = await makeRequest({
        hostname: '127.0.0.1',
        port: 5500,
        path: '/uploads/delivery_proofs/nonexistent_fake_12345.jpg',
        method: 'GET'
    });

    console.log('  Missing Image Code:', fakeImgRes.statusCode);
    console.log('  Content-Type:', fakeImgRes.headers['content-type']);
    if (fakeImgRes.statusCode === 404 && fakeImgRes.headers['content-type'] === 'image/png') {
        console.log('  ✓ TEST 5 PASSED: Server returned image/png fallback instead of HTML.');
    } else {
        console.error('  ❌ TEST 5 FAILED: Server returned', fakeImgRes.headers['content-type']);
        allPassed = false;
    }

    // TEST 6: Invalid Image Data Rejection
    console.log('\n[TEST 6] Testing Invalid Image Rejection...');
    const invalidPayload = JSON.stringify({
        image: 'not_an_image_random_text_12345',
        orderId: testOrderId
    });

    const invalidRes = await makeRequest({
        hostname: '127.0.0.1',
        port: 5500,
        path: `/api/orders/${testOrderId}-invalid/delivery-proof`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(invalidPayload)
        }
    }, invalidPayload);

    console.log('  Invalid Upload Code:', invalidRes.statusCode);
    console.log('  Invalid Upload Body:', invalidRes.body);
    if (invalidRes.statusCode === 400) {
        console.log('  ✓ TEST 6 PASSED: Server rejected invalid image data with status 400.');
    } else {
        console.error('  ❌ TEST 6 FAILED: Expected status 400 but got', invalidRes.statusCode);
        allPassed = false;
    }

    // Clean up test order record
    try {
        const ordersFile = path.resolve(__dirname, 'data', 'orders.json');
        if (fs.existsSync(ordersFile)) {
            let orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
            orders = orders.filter(o => !o.id?.toString().includes('STEP1-VERIFY'));
            fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), 'utf8');
        }
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    } catch (_) {}

    console.log('\n================================================================');
    if (allPassed) {
        console.log('  ✓ ALL 6 TESTS FOR STEP 1 PASSED WITH 100% SUCCESS!');
    } else {
        console.log('  ❌ SOME TESTS FAILED IN STEP 1.');
        process.exit(1);
    }
    console.log('================================================================');
    process.exit(0);
}

runStep1Verification().catch(e => {
    console.error('Verification error:', e);
    process.exit(1);
});

