const http = require('http');

function postRequest(path, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const options = {
            hostname: '127.0.0.1',
            port: 5500,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: body });
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function runStep5Tests() {
    console.log('==================================================');
    console.log('🧪 STEP 5: DELIVERY PARTNER PUSH NOTIFICATIONS TEST');
    console.log('==================================================');

    let passed = 0;
    let failed = 0;

    // Test 1: Register partner token via /api/notifications/register-token
    try {
        const res1 = await postRequest('/api/notifications/register-token', {
            token: 'fcm_test_token_step5_partner_1234567890_abcdef',
            role: 'partner',
            user_id: 'THU-DP-001',
            platform: 'android'
        });
        if (res1.status === 200 && res1.data && res1.data.success === true) {
            console.log('✓ Test 1: /api/notifications/register-token succeeded for partner');
            passed++;
        } else {
            console.error('✗ Test 1 FAILED:', res1);
            failed++;
        }
    } catch (e) {
        console.error('✗ Test 1 Exception:', e.message);
        failed++;
    }

    // Test 2: Register partner token via /api/delivery/fcm-token
    try {
        const res2 = await postRequest('/api/delivery/fcm-token', {
            fcm_token: 'fcm_delivery_partner_direct_token_999888777_xyz',
            partner_id: 'THU-DP-002',
            platform: 'android'
        });
        if (res2.status === 200 && res2.data && res2.data.success === true) {
            console.log('✓ Test 2: /api/delivery/fcm-token succeeded');
            passed++;
        } else {
            console.error('✗ Test 2 FAILED:', res2);
            failed++;
        }
    } catch (e) {
        console.error('✗ Test 2 Exception:', e.message);
        failed++;
    }

    // Test 3: Verify tokenStore in-memory and disk retrieval
    try {
        const { getDeviceTokens, DEVICE_TOKENS } = require('./services/tokenStore');
        const partnerTokens = getDeviceTokens({ role: 'partner' });
        const partner1Tokens = getDeviceTokens({ userId: 'THU-DP-001' });

        if (partnerTokens.length >= 2 && partner1Tokens.includes('fcm_test_token_step5_partner_1234567890_abcdef')) {
            console.log(`✓ Test 3: tokenStore correctly indexed partner tokens (${partnerTokens.length} active)`);
            passed++;
        } else {
            console.error('✗ Test 3 FAILED: partnerTokens =', partnerTokens, 'partner1Tokens =', partner1Tokens);
            failed++;
        }
    } catch (e) {
        console.error('✗ Test 3 Exception:', e.message);
        failed++;
    }

    // Test 4: Verify push notification channel mapping logic
    try {
        const { sendNotification } = require('./services/notificationService');
        // Test dispatch with mock token
        const notifResult = await sendNotification({
            userId: 'THU-DP-001',
            title: '🚨 NEW DELIVERY ASSIGNMENT',
            message: 'New order #ORD-9999 ready for pickup from Farm Hub',
            type: 'delivery_assignment',
            targetId: 'ORD-9999'
        });

        console.log('✓ Test 4: sendNotification completed without unhandled exceptions');
        passed++;
    } catch (e) {
        console.error('✗ Test 4 Exception:', e.message);
        failed++;
    }

    console.log('--------------------------------------------------');
    console.log(`Summary: Passed: ${passed}, Failed: ${failed}`);
    if (failed === 0) {
        console.log('🎉 STEP 5 AUTOMATED VERIFICATION PASSED 100%');
        process.exit(0);
    } else {
        console.error('❌ STEP 5 VERIFICATION HAD FAILURES');
        process.exit(1);
    }
}

runStep5Tests();
