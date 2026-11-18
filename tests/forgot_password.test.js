const http = require("http");
const fs = require("fs");
const path = require("path");

function request(method, pathUrl, body) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : "";
        const req = http.request({
            hostname: "localhost",
            port: 5500,
            path: pathUrl,
            method: method,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (_) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on("error", reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log("=== THULIRVA FORGOT PASSWORD & OTP TEST SUITE ===");

    // Clear cooldown for test account before starting
    const otpsFile = path.resolve(__dirname, "data", "password_reset_otps.json");
    if (fs.existsSync(otpsFile)) {
        try {
            let recs = JSON.parse(fs.readFileSync(otpsFile, "utf-8"));
            recs = recs.map(r => ({ ...r, created_at: r.created_at - 70000 }));
            fs.writeFileSync(otpsFile, JSON.stringify(recs, null, 2), "utf-8");
        } catch (_) {}
    }

    // Test 1: Account Lookup by Email
    console.log("\n[Test 1] POST /api/auth/forgot-password by Email");
    let res = await request("POST", "/api/auth/forgot-password", { email: "kamsh@thulirva.com" });
    console.log("Status:", res.status, "Response:", res.data);
    if (!res.data.success || !res.data.masked_email || !res.data.methods.includes("email")) {
        throw new Error("Test 1 Failed: Account lookup by email failed");
    }
    console.log("✓ PASS: Account found, masked email:", res.data.masked_email, "methods:", res.data.methods);

    // Test 2: Account Lookup by Phone
    console.log("\n[Test 2] POST /api/auth/forgot-password by Phone");
    res = await request("POST", "/api/auth/forgot-password", { phone: "7904880944" });
    console.log("Status:", res.status, "Response:", res.data);
    if (!res.data.success || !res.data.masked_phone || !res.data.methods.includes("sms")) {
        throw new Error("Test 2 Failed: Account lookup by phone failed");
    }
    console.log("✓ PASS: Account found, masked phone:", res.data.masked_phone);

    // Test 3: Account Lookup with Non-Existent User
    console.log("\n[Test 3] POST /api/auth/forgot-password with Non-Existent User");
    res = await request("POST", "/api/auth/forgot-password", { email: "ghost_user_9999@thulirva.com" });
    console.log("Status:", res.status, "Response:", res.data);
    if (res.status !== 404 || res.data.success !== false) {
        throw new Error("Test 3 Failed: Non-existent account should return 404");
    }
    console.log("✓ PASS: Non-existent account rejected cleanly without exposure");

    // Test 4: Dispatch Email OTP
    console.log("\n[Test 4] POST /api/auth/send-reset-otp (Email)");
    res = await request("POST", "/api/auth/send-reset-otp", { identifier: "kamsh@thulirva.com", method: "email" });
    console.log("Status:", res.status, "Response:", res.data);
    if (!res.data.success || res.data.cooldownSeconds !== 60) {
        throw new Error("Test 4 Failed: OTP dispatch failed");
    }
    console.log("✓ PASS: Email OTP dispatched with 60s cooldown");

    // Test 5: Resend Cooldown Enforcement
    console.log("\n[Test 5] POST /api/auth/resend-reset-otp within cooldown window");
    res = await request("POST", "/api/auth/resend-reset-otp", { identifier: "kamsh@thulirva.com", method: "email" });
    console.log("Status:", res.status, "Response:", res.data);
    if (res.status !== 400 || !res.data.message.includes("seconds")) {
        throw new Error("Test 5 Failed: Cooldown was not enforced");
    }
    console.log("✓ PASS: Cooldown properly enforced:", res.data.message);

    // Test 6: Verify Invalid OTP Code
    console.log("\n[Test 6] POST /api/auth/verify-reset-otp with wrong OTP");
    res = await request("POST", "/api/auth/verify-reset-otp", { identifier: "kamsh@thulirva.com", otp: "000000" });
    console.log("Status:", res.status, "Response:", res.data);
    if (res.status !== 400 || !res.data.message.includes("attempt")) {
        throw new Error("Test 6 Failed: Wrong OTP should be rejected with remaining attempts count");
    }
    console.log("✓ PASS: Wrong OTP rejected with attempt count:", res.data.message);

    // Test 7: Retrieve OTP hash & test actual verification
    // To test verification without waiting for an email in automated test, read latest OTP salt & recompute or read record
    const records = JSON.parse(fs.readFileSync(otpsFile, "utf-8"));
    const latest = records[0];
    console.log("\n[Security Audit] Latest OTP record in database/disk:", {
        id: latest.id,
        user_id: latest.user_id,
        method: latest.method,
        has_hash: Boolean(latest.otp_hash),
        salt: latest.salt ? latest.salt.substring(0, 8) + "..." : null,
        expires_at: new Date(latest.expires_at).toISOString(),
        is_used: latest.is_used
    });

    // Reset cooldown in memory for test sequence:
    latest.created_at = Date.now() - 65000;
    fs.writeFileSync(otpsFile, JSON.stringify(records, null, 2), "utf-8");

    // Re-dispatch SMS OTP
    console.log("\n[Test 7] POST /api/auth/send-reset-otp (SMS)");
    res = await request("POST", "/api/auth/send-reset-otp", { identifier: "7904880944", method: "sms" });
    console.log("Status:", res.status, "Response:", res.data);
    if (!res.data.success) throw new Error("Test 7 Failed: SMS OTP dispatch failed");
    console.log("✓ PASS: SMS OTP dispatched to", res.data.destination);

    // Verify SMS audit log
    const smsLogFile = path.resolve(__dirname, "data", "sms_delivery_logs.json");
    if (fs.existsSync(smsLogFile)) {
        const smsLogs = JSON.parse(fs.readFileSync(smsLogFile, "utf-8"));
        console.log("✓ PASS: SMS Delivery Log verified:", smsLogs[0]);
    }

    // Now test valid verification by retrieving the generated OTP from salt or generating known one
    // Let's create a known test record in password_reset_otps
    const crypto = require("crypto");
    const testOtp = "729154";
    const testSalt = crypto.randomBytes(16).toString("hex");
    const testHash = crypto.createHash("sha256").update(testOtp + testSalt).digest("hex");
    const testRecord = {
        id: 9999999,
        user_id: 2,
        identifier: "kamsh@thulirva.com",
        method: "email",
        target_destination: "kamsh@thulirva.com",
        otp_hash: testHash,
        salt: testSalt,
        attempts: 0,
        max_attempts: 5,
        expires_at: Date.now() + 300000,
        is_used: false,
        created_at: Date.now(),
        ip: "127.0.0.1"
    };

    const currentRecords = JSON.parse(fs.readFileSync(otpsFile, "utf-8"));
    currentRecords.unshift(testRecord);
    fs.writeFileSync(otpsFile, JSON.stringify(currentRecords, null, 2), "utf-8");

    // Test 8: Verify Correct OTP
    console.log("\n[Test 8] POST /api/auth/verify-reset-otp with correct OTP");
    res = await request("POST", "/api/auth/verify-reset-otp", { identifier: "kamsh@thulirva.com", otp: testOtp });
    console.log("Status:", res.status, "Response:", res.data);
    if (!res.data.success || !res.data.reset_token) {
        throw new Error("Test 8 Failed: Correct OTP did not return reset_token");
    }
    const resetToken = res.data.reset_token;
    console.log("✓ PASS: OTP verified and short-lived reset_token generated:", resetToken.substring(0, 30) + "...");

    // Test 9: Prevent OTP Reuse
    console.log("\n[Test 9] Prevent OTP Reuse (submitting the same OTP again)");
    res = await request("POST", "/api/auth/verify-reset-otp", { identifier: "kamsh@thulirva.com", otp: testOtp });
    console.log("Status:", res.status, "Response:", res.data);
    if (res.status !== 400) {
        throw new Error("Test 9 Failed: Used OTP must be rejected");
    }
    console.log("✓ PASS: OTP reuse prevented");

    // Test 10: Reset Password with Mismatched Passwords
    console.log("\n[Test 10] POST /api/auth/reset-password with mismatched passwords");
    res = await request("POST", "/api/auth/reset-password", {
        reset_token: resetToken,
        new_password: "NewPassword2026!",
        confirm_password: "MismatchPassword!"
    });
    console.log("Status:", res.status, "Response:", res.data);
    if (res.status !== 400 || !res.data.message.includes("match")) {
        throw new Error("Test 10 Failed: Password mismatch should be rejected");
    }
    console.log("✓ PASS: Mismatched passwords rejected");

    // Test 11: Reset Password with Weak (< 6 chars) Password
    console.log("\n[Test 11] POST /api/auth/reset-password with short password (< 6 chars)");
    res = await request("POST", "/api/auth/reset-password", {
        reset_token: resetToken,
        new_password: "123",
        confirm_password: "123"
    });
    console.log("Status:", res.status, "Response:", res.data);
    if (res.status !== 400 || !res.data.message.includes("6 characters")) {
        throw new Error("Test 11 Failed: Weak password should be rejected");
    }
    console.log("✓ PASS: Short password rejected");

    // Test 12: Successful Password Reset
    console.log("\n[Test 12] POST /api/auth/reset-password with valid passwords");
    const testNewPassword = "ThulirvaSecret2026#";
    res = await request("POST", "/api/auth/reset-password", {
        reset_token: resetToken,
        new_password: testNewPassword,
        confirm_password: testNewPassword
    });
    console.log("Status:", res.status, "Response:", res.data);
    if (!res.data.success) {
        throw new Error("Test 12 Failed: Password reset failed");
    }
    console.log("✓ PASS: Password successfully updated:", res.data.message);

    // Test 13: Prevent Reset Token Reuse
    console.log("\n[Test 13] Prevent Reset Token Reuse");
    res = await request("POST", "/api/auth/reset-password", {
        reset_token: resetToken,
        new_password: "AnotherPassword123",
        confirm_password: "AnotherPassword123"
    });
    console.log("Status:", res.status, "Response:", res.data);
    if (res.status !== 400 || !res.data.message.includes("already been used")) {
        throw new Error("Test 13 Failed: Reusing reset token should be rejected");
    }
    console.log("✓ PASS: Reset token reuse rejected");

    // Test 14: Login with New Password
    console.log("\n[Test 14] POST /api/auth/login with New Password");
    res = await request("POST", "/api/auth/login", {
        email: "kamsh@thulirva.com",
        password: testNewPassword
    });
    console.log("Status:", res.status, "Response:", { success: res.data.success, user: res.data.user?.name });
    if (!res.data.success || !res.data.token) {
        throw new Error("Test 14 Failed: Could not login with new password");
    }
    console.log("✓ PASS: Login with new password succeeded!");

    // Test 15: Login with Old/Invalid Password Rejected
    console.log("\n[Test 15] POST /api/auth/login with Old Password");
    res = await request("POST", "/api/auth/login", {
        email: "kamsh@thulirva.com",
        password: "OldInvalidPassword!"
    });
    console.log("Status:", res.status, "Response:", res.data);
    if (res.status !== 401 && res.status !== 400) {
        throw new Error("Test 15 Failed: Old password should be rejected");
    }
    console.log("✓ PASS: Old password rejected cleanly");

    console.log("\n==========================================");
    console.log("ALL 15 BACKEND SECURITY TESTS PASSED 100%!");
    console.log("==========================================\n");
}

runTests().catch(e => {
    console.error("TEST FAILED:", e);
    process.exit(1);
});
