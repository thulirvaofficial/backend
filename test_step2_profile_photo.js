const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || "THULIRVA_CHANGE_THIS_SECRET_KEY";
const BASE_URL = 'http://localhost:5500';

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

// Generate valid 1x1 green JPEG image
const VALID_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

// Invalid non-image text data
const INVALID_DATA_BASE64 = Buffer.from("THIS_IS_NOT_AN_IMAGE_FILE_DATA").toString('base64');

async function runTests() {
    console.log("==================================================");
    console.log("   STEP 2 VERIFICATION: DELIVERY PARTNER PROFILE PHOTO");
    console.log("==================================================\n");

    const testPartnerId = "DP-TEST-9999";
    const testToken = jwt.sign(
        {
            partner_id: testPartnerId,
            name: "Vigneshwaran M (Test)",
            phone: "9840515293",
            role: "delivery_partner"
        },
        JWT_SECRET,
        { expiresIn: "1h" }
    );

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

    // 1. Upload valid Base64 JPEG
    console.log("--- Test 1: Upload Valid Base64 JPEG Profile Photo ---");
    const uploadRes = await makeRequest({
        method: 'POST',
        urlPath: '/api/delivery/profile/photo',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
            photo_base64: `data:image/jpeg;base64,${VALID_JPEG_BASE64}`
        })
    });

    assert(uploadRes.statusCode === 200, `Upload returns HTTP 200 (Got ${uploadRes.statusCode})`);
    assert(uploadRes.json && uploadRes.json.success === true, "Upload response JSON has success === true");
    assert(uploadRes.json && typeof uploadRes.json.profile_photo === 'string', "profile_photo string returned");
    assert(uploadRes.json && uploadRes.json.partner && uploadRes.json.partner.partner_id === testPartnerId, "partner_id matches test partner");

    const uploadedUrl = uploadRes.json?.profile_photo || "";
    console.log(`Uploaded photo path: ${uploadedUrl}`);

    // 2. Physical File Verification on Disk
    console.log("\n--- Test 2: Physical File Verification on Disk ---");
    const filename = path.basename(uploadedUrl);
    const diskPath = path.resolve(__dirname, 'public', 'uploads', 'partners', filename);
    const existsOnDisk = fs.existsSync(diskPath);
    assert(existsOnDisk, `Physical image exists on disk at: ${diskPath}`);
    if (existsOnDisk) {
        const fileStat = fs.statSync(diskPath);
        assert(fileStat.size > 0, `File size is greater than 0 bytes (${fileStat.size} bytes)`);

        const fileBytes = fs.readFileSync(diskPath);
        const isJpeg = fileBytes[0] === 0xFF && fileBytes[1] === 0xD8 && fileBytes[2] === 0xFF;
        assert(isJpeg, "File magic bytes confirm valid JPEG (0xFF 0xD8 0xFF)");
    }

    // 3. GET /api/delivery/profile Verification
    console.log("\n--- Test 3: GET /api/delivery/profile Verification ---");
    const profileRes = await makeRequest({
        method: 'GET',
        urlPath: '/api/delivery/profile',
        headers: {
            'Authorization': `Bearer ${testToken}`
        }
    });

    assert(profileRes.statusCode === 200, `GET /api/delivery/profile returns HTTP 200 (Got ${profileRes.statusCode})`);
    assert(profileRes.json && profileRes.json.success === true, "Profile response has success === true");
    assert(profileRes.json?.partner?.profile_photo === uploadedUrl, `Profile photo matches uploaded URL: ${profileRes.json?.partner?.profile_photo}`);

    // 4. HTTP GET of Image Asset
    console.log("\n--- Test 4: HTTP GET Static Asset Retrieval ---");
    const imageGetRes = await makeRequest({
        method: 'GET',
        urlPath: uploadedUrl
    });

    assert(imageGetRes.statusCode === 200, `Image asset returns HTTP 200 (Got ${imageGetRes.statusCode})`);
    const ct = imageGetRes.headers['content-type'] || "";
    assert(ct.includes('image'), `Content-Type is image/* (Got '${ct}')`);
    assert(imageGetRes.rawBuffer.length > 0, `Image binary payload > 0 bytes (${imageGetRes.rawBuffer.length} bytes)`);

    // 5. Test Invalid/Corrupted Image Rejection
    console.log("\n--- Test 5: Corrupted / Invalid Image Rejection ---");
    const badUploadRes = await makeRequest({
        method: 'POST',
        urlPath: '/api/delivery/profile/photo',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
            photo_base64: `data:image/jpeg;base64,${INVALID_DATA_BASE64}`
        })
    });

    assert(badUploadRes.statusCode === 400, `Corrupted image upload correctly rejected with HTTP 400 (Got ${badUploadRes.statusCode})`);
    assert(badUploadRes.json && badUploadRes.json.success === false, "Bad upload JSON has success === false");

    // 6. Test Multipart FormData Upload
    console.log("\n--- Test 6: Multipart FormData Upload ---");
    const boundary = "----WebKitFormBoundaryThulirvaTest" + Date.now();
    const imageBinary = Buffer.from(VALID_JPEG_BASE64, 'base64');
    
    let multipartBody = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="profile_multipart.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        imageBinary,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const multipartRes = await makeRequest({
        method: 'POST',
        urlPath: '/api/delivery/profile/photo',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Authorization': `Bearer ${testToken}`
        },
        body: multipartBody
    });

    assert(multipartRes.statusCode === 200, `Multipart upload returns HTTP 200 (Got ${multipartRes.statusCode})`);
    assert(multipartRes.json && multipartRes.json.success === true, "Multipart response JSON has success === true");
    const multipartUrl = multipartRes.json?.profile_photo || "";
    assert(multipartUrl.startsWith('/uploads/partners/'), `Multipart profile photo path is valid: ${multipartUrl}`);

    // 7. Verify Multipart Photo Persisted
    const profileRes2 = await makeRequest({
        method: 'GET',
        urlPath: '/api/delivery/profile',
        headers: {
            'Authorization': `Bearer ${testToken}`
        }
    });
    assert(profileRes2.json?.partner?.profile_photo === multipartUrl, "Profile photo updated to multipart photo URL");

    // 8. Test DELETE /api/delivery/profile/photo
    console.log("\n--- Test 8: DELETE /api/delivery/profile/photo ---");
    const deleteRes = await makeRequest({
        method: 'DELETE',
        urlPath: '/api/delivery/profile/photo',
        headers: {
            'Authorization': `Bearer ${testToken}`
        }
    });

    assert(deleteRes.statusCode === 200, `DELETE returns HTTP 200 (Got ${deleteRes.statusCode})`);
    assert(deleteRes.json && deleteRes.json.success === true, "DELETE response JSON has success === true");

    const profileRes3 = await makeRequest({
        method: 'GET',
        urlPath: '/api/delivery/profile',
        headers: {
            'Authorization': `Bearer ${testToken}`
        }
    });
    assert(profileRes3.json?.partner?.profile_photo === null, "Profile photo is null after deletion");

    // Re-upload a photo for the partner so clean record remains
    await makeRequest({
        method: 'POST',
        urlPath: '/api/delivery/profile/photo',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
            photo_base64: `data:image/jpeg;base64,${VALID_JPEG_BASE64}`
        })
    });

    console.log("\n==================================================");
    console.log(`STEP 2 SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error("Test execution fatal error:", err);
    process.exit(1);
});

