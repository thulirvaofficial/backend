const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || "THULIRVA_CHANGE_THIS_SECRET_KEY";

const validJpegBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function apiRequest(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: '127.0.0.1',
            port: 5500,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, headers: res.headers, raw: data });
                }
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function fetchStaticAsset(assetPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 5500,
            path: assetPath,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    contentType: res.headers['content-type'],
                    buffer: Buffer.concat(chunks)
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function runTests() {
    console.log('==================================================');
    console.log('🧪 VERIFICATION: PROFILE PHOTO & OVERFLOW REPAIR');
    console.log('==================================================');

    let passed = 0;
    let failed = 0;

    const tokenKamsh = jwt.sign(
        { partner_id: 'THU-DP-0001', name: 'kamsh', phone: '7904880944', role: 'delivery_partner' },
        JWT_SECRET,
        { expiresIn: '30d' }
    );

    // Test 1: GET /api/delivery/profile for THU-DP-0001
    try {
        const res1 = await apiRequest('GET', '/api/delivery/profile', null, tokenKamsh);
        if (res1.status === 200 && res1.data && res1.data.success === true && res1.data.partner.partner_id === 'THU-DP-0001') {
            console.log('✓ Test 1: GET /api/delivery/profile returned 200 with authentic partner data');
            console.log('  Partner Name:', res1.data.partner.name, '| Area:', res1.data.partner.assigned_area);
            passed++;
        } else {
            console.error('✗ Test 1 FAILED:', res1);
            failed++;
        }
    } catch (e) {
        console.error('✗ Test 1 Exception:', e.message);
        failed++;
    }

    // Test 2: Upload Photo for THU-DP-0001
    let uploadedPhotoUrl = '';
    try {
        const res2 = await apiRequest('POST', '/api/delivery/profile/photo', {
            photo_base64: validJpegBase64
        }, tokenKamsh);

        if (res2.status === 200 && res2.data && res2.data.success === true && res2.data.profile_photo) {
            uploadedPhotoUrl = res2.data.profile_photo;
            console.log('✓ Test 2: POST /api/delivery/profile/photo returned 200 with photo path:', uploadedPhotoUrl);
            passed++;
        } else {
            console.error('✗ Test 2 FAILED:', res2);
            failed++;
        }
    } catch (e) {
        console.error('✗ Test 2 Exception:', e.message);
        failed++;
    }

    // Test 3: Fetch Static Image from Server
    try {
        const res3 = await fetchStaticAsset(uploadedPhotoUrl);
        if (res3.status === 200 && res3.contentType && res3.contentType.includes('image')) {
            console.log('✓ Test 3: Static asset fetch returned 200 with Content-Type:', res3.contentType, 'size:', res3.buffer.length);
            passed++;
        } else {
            console.error('✗ Test 3 FAILED: Status', res3.status, 'Type', res3.contentType);
            failed++;
        }
    } catch (e) {
        console.error('✗ Test 3 Exception:', e.message);
        failed++;
    }

    // Test 4: Verify Profile GET reflects updated photo immediately
    try {
        const res4 = await apiRequest('GET', '/api/delivery/profile', null, tokenKamsh);
        if (res4.status === 200 && res4.data && res4.data.partner.profile_photo === uploadedPhotoUrl) {
            console.log('✓ Test 4: Profile GET confirms updated photo URL matches:', res4.data.partner.profile_photo);
            passed++;
        } else {
            console.error('✗ Test 4 FAILED: Expected', uploadedPhotoUrl, 'Got', res4.data?.partner?.profile_photo);
            failed++;
        }
    } catch (e) {
        console.error('✗ Test 4 Exception:', e.message);
        failed++;
    }

    // Test 5: Verify Persistence on Disk
    try {
        const { getPartnerById } = require('./services/deliveryPartnerService');
        const p = await getPartnerById('THU-DP-0001');
        if (p && p.profile_photo === uploadedPhotoUrl) {
            console.log('✓ Test 5: Disk persistence confirmed: partner profile_photo is saved');
            passed++;
        } else {
            console.error('✗ Test 5 FAILED: Disk partner:', p);
            failed++;
        }
    } catch (e) {
        console.error('✗ Test 5 Exception:', e.message);
        failed++;
    }

    console.log('--------------------------------------------------');
    console.log(`Summary: Passed: ${passed}, Failed: ${failed}`);
    if (failed === 0) {
        console.log('🎉 ALL PROFILE & BACKEND PERSISTENCE TESTS PASSED 100%');
        process.exit(0);
    } else {
        console.error('❌ SOME TESTS FAILED');
        process.exit(1);
    }
}

runTests();
