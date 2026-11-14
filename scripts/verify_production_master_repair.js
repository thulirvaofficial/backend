const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5500/api';
const STATIC_URL = 'http://localhost:5500';

// Minimal 1x1 transparent PNG as test image
const SAMPLE_BASE64_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function runTests() {
    console.log('========================================================');
    console.log('  THULIRVA PRODUCTION MASTER REPAIR VERIFICATION SUITE');
    console.log('========================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✓ ${message}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL: ${message}`);
            failed++;
        }
    }

    try {
        // ----------------------------------------------------
        // TEST 1: Customer Profile Photo Upload & Static Serving
        // ----------------------------------------------------
        console.log('[PHASE 1] Customer Profile Photo Upload & Sync');

        // Customer Login (Kamsh)
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifier: '7904880944',
                password: 'password123'
            })
        });
        const loginData = await loginRes.json();
        assert(loginData.success === true, `Customer login successful (HTTP ${loginRes.status})`);
        assert(loginData.user && typeof loginData.user.profile_photo !== 'undefined', 'User object in login contains profile_photo key');

        const customerToken = loginData.token;

        // Upload Profile Photo
        const photoRes = await fetch(`${BASE_URL}/auth/profile/photo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${customerToken}`
            },
            body: JSON.stringify({
                photo: SAMPLE_BASE64_PNG
            })
        });
        const photoData = await photoRes.json();
        assert(photoData.success === true, `Profile photo uploaded successfully: ${photoData.profile_photo}`);

        const customerPhotoUrl = photoData.profile_photo;
        assert(customerPhotoUrl && customerPhotoUrl.includes('/uploads/profiles/'), `Profile photo path correctly directed to /uploads/profiles/ (${customerPhotoUrl})`);

        // Check file exists on disk
        const diskPath = path.resolve(__dirname, '..', 'public', customerPhotoUrl.replace(/^\//, ''));
        assert(fs.existsSync(diskPath), `Customer profile photo verified on disk: ${diskPath}`);

        // Fetch static photo over HTTP
        const staticPhotoRes = await fetch(`${STATIC_URL}${customerPhotoUrl}`);
        assert(staticPhotoRes.status === 200, `Static image serving returns HTTP 200 OK (${STATIC_URL}${customerPhotoUrl})`);

        // Verify GET /auth/profile returns the photo
        const profileRes = await fetch(`${BASE_URL}/auth/profile`, {
            headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        const profileData = await profileRes.json();
        assert(profileData.success === true && profileData.user?.profile_photo === customerPhotoUrl, `GET /auth/profile returns updated photo: ${profileData.user?.profile_photo}`);

        // Verify GET /auth/me alias returns the photo
        const meRes = await fetch(`${BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        const meData = await meRes.json();
        assert(meData.success === true && meData.user?.profile_photo === customerPhotoUrl, `GET /auth/me returns updated photo: ${meData.user?.profile_photo}`);

        // ----------------------------------------------------
        // TEST 2: Delivery Partner Profile Photo Upload & Sync
        // ----------------------------------------------------
        console.log('\n[PHASE 2] Delivery Partner Profile Photo Upload & Sync');

        // Partner Login (Kamsh / DP-0001)
        const partnerLoginRes = await fetch(`${BASE_URL}/delivery/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: '7904880944',
                password: '123456'
            })
        });
        const partnerLoginData = await partnerLoginRes.json();
        assert(partnerLoginData.success === true, `Partner login successful (HTTP ${partnerLoginRes.status})`);
        const partnerToken = partnerLoginData.token;

        // Upload Partner Photo
        const partnerPhotoRes = await fetch(`${BASE_URL}/delivery/profile/photo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${partnerToken}`
            },
            body: JSON.stringify({
                photo: SAMPLE_BASE64_PNG
            })
        });
        const partnerPhotoData = await partnerPhotoRes.json();
        assert(partnerPhotoData.success === true, `Partner photo uploaded successfully: ${partnerPhotoData.profile_photo}`);

        const partnerPhotoUrl = partnerPhotoData.profile_photo;
        const partnerDiskPath = path.resolve(__dirname, '..', 'public', partnerPhotoUrl.replace(/^\//, ''));
        assert(fs.existsSync(partnerDiskPath), `Partner profile photo verified on disk: ${partnerDiskPath}`);

        const partnerStaticRes = await fetch(`${STATIC_URL}${partnerPhotoUrl}`);
        assert(partnerStaticRes.status === 200, `Partner static image returns HTTP 200 OK (${STATIC_URL}${partnerPhotoUrl})`);

        const partnerProfileRes = await fetch(`${BASE_URL}/delivery/profile`, {
            headers: { 'Authorization': `Bearer ${partnerToken}` }
        });
        const partnerProfileData = await partnerProfileRes.json();
        assert(partnerProfileData.success === true && partnerProfileData.partner?.profile_photo === partnerPhotoUrl, `GET /delivery/profile confirms updated photo: ${partnerProfileData.partner?.profile_photo}`);

        // ----------------------------------------------------
        // TEST 3: Delivery Proof Photo & Order Status Sync
        // ----------------------------------------------------
        console.log('\n[PHASE 3] Delivery Proof Photo Workflow & Order Status');

        const testOrderId = 'ORD101';
        const proofRes = await fetch(`${BASE_URL}/delivery/orders/${testOrderId}/delivery-proof`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${partnerToken}`
            },
            body: JSON.stringify({
                image: SAMPLE_BASE64_PNG,
                remarks: 'Delivered securely to customer doorstep with verified photo proof',
                latitude: 13.0692,
                longitude: 80.1298
            })
        });
        const proofData = await proofRes.json();
        assert(proofData.success === true, `Delivery proof upload successful for order #${testOrderId}`);

        const proofUrl = proofData.proof_url || proofData.delivery_proof_url;
        assert(proofUrl && proofUrl.includes('/uploads/delivery_proofs/'), `Proof photo URL correctly generated: ${proofUrl}`);

        const proofDiskPath = path.resolve(__dirname, '..', 'public', proofUrl.replace(/^\//, ''));
        assert(fs.existsSync(proofDiskPath), `Delivery proof file verified on disk: ${proofDiskPath}`);

        const proofStaticRes = await fetch(`${STATIC_URL}${proofUrl}`);
        assert(proofStaticRes.status === 200, `Proof static image returns HTTP 200 OK (${STATIC_URL}${proofUrl})`);

        // Check Customer GET /api/orders/:id returns proof
        const orderDetailRes = await fetch(`${BASE_URL}/orders/${testOrderId}`, {
            headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        const orderDetailData = await orderDetailRes.json();
        assert(orderDetailData.success === true, `Customer order details retrieved successfully for #${testOrderId}`);
        assert(orderDetailData.order?.order_status === 'delivered', `Order status updated to 'delivered'`);
        assert(orderDetailData.order?.delivery_proof_url === proofUrl || orderDetailData.order?.delivery_proof === proofUrl, `Order record contains verified proof photo URL: ${orderDetailData.order?.delivery_proof_url}`);

        // ----------------------------------------------------
        // TEST 4: FCM Push Notification Token Registration
        // ----------------------------------------------------
        console.log('\n[PHASE 4] Delivery Partner Push Notifications Registration');

        const sampleFcmToken = 'fcm_test_token_partner_master_audit_2026_kamsh_device_12345';
        const fcmRes = await fetch(`${BASE_URL}/delivery/fcm-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${partnerToken}`
            },
            body: JSON.stringify({
                token: sampleFcmToken,
                platform: 'android'
            })
        });
        const fcmData = await fcmRes.json();
        assert(fcmData.success === true, `FCM Token registered via /delivery/fcm-token: ${fcmData.message}`);

        // ----------------------------------------------------
        // TEST 5: Distribution Hub Valasaravakkam Coordinates
        // ----------------------------------------------------
        console.log('\n[PHASE 5] Distribution Hub & Road Snapping Coordinates');

        const trackingRes = await fetch(`${BASE_URL}/orders/${testOrderId}/tracking`, {
            headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        const trackingData = await trackingRes.json();
        assert(trackingData.success === true, `Tracking endpoint returned 200 OK for #${testOrderId}`);
        const hub = trackingData.hub_location || trackingData.hub;
        assert(hub && Math.abs(hub.latitude - 13.0403) < 0.001, `Hub Latitude is Valasaravakkam 13.0403 (actual: ${hub?.latitude})`);
        assert(hub && Math.abs(hub.longitude - 80.1723) < 0.001, `Hub Longitude is Valasaravakkam 80.1723 (actual: ${hub?.longitude})`);

        console.log('\n========================================================');
        console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
        console.log('========================================================');

        if (failed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    } catch (err) {
        console.error('Fatal Verification Error:', err);
        process.exit(1);
    }
}

runTests();
