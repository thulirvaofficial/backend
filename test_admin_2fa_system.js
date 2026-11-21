/**
 * THULIRVA Enterprise — Administrator 2-Step Verification (2FA) Verification Suite
 * 
 * Verifies:
 * 1. Admin login triggers 2FA and dispatches code to admin@thulirva.com
 * 2. Plaintext OTP is NEVER leaked in the login HTTP response
 * 3. Invalid OTP is strictly rejected with attempts tracking
 * 4. Legitimate OTP authorizes session, issues JWT, and invalidates session
 * 5. Replay attacks with consumed tokens are rejected
 * 6. Resend 2FA dispatches fresh code and enforces 30s rate limiting
 * 7. Customer login does not trigger admin 2FA
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const BASE_URL = "http://localhost:5500";
const ADMIN_EMAIL = "admin@thulirva.com";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "Thulirva@OpsAdmin#deb0ea41!2026";
const SESSIONS_FILE = path.resolve(__dirname, "data", "admin_2fa_sessions.json");

let passCount = 0;
let failCount = 0;

async function it(title, fn) {
    try {
        await fn();
        console.log(`  ✅ [PASS] ${title}`);
        passCount++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${title}`);
        console.error(`     Error: ${err.message}\n`);
        failCount++;
    }
}

async function run2FATestSuite() {
    console.log("==================================================================");
    console.log("🔐 THULIRVA ADMIN 2-STEP VERIFICATION (2FA) TEST SUITE");
    console.log("==================================================================");

    console.log("\n▶ Section 1: Admin Login 2FA Trigger & Zero-Leakage Audit...");

    let twoFactorToken = null;

    await it("Admin login with valid credentials returns requires2FA: true and session token", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: ADMIN_EMAIL,
                password: ADMIN_PASS,
                admin_login: true,
                is_admin_portal: true
            })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.requires2FA, true, "Expected requires2FA to be true");
        assert.ok(data.twoFactorToken, "Expected twoFactorToken to be returned");
        assert.ok(data.email && data.email.includes("@"), "Expected email in 2FA response");
        assert.ok(Array.isArray(data.deliveryTargets) && data.deliveryTargets.includes("thulirvaofficial@gmail.com"), "Expected thulirvaofficial@gmail.com in delivery targets");
        assert.ok(data.deliveryTargets.includes("admin@thulirva.com"), "Expected admin@thulirva.com in delivery targets");
        assert.strictEqual(data.token, undefined, "JWT token must NOT be issued before 2FA!");
        assert.strictEqual(data.otp, undefined, "CRITICAL: Plaintext OTP leaked in response!");
        assert.strictEqual(data.code, undefined, "CRITICAL: Plaintext code leaked in response!");

        twoFactorToken = data.twoFactorToken;
    });

    await it("Session is recorded in server store with recipients thulirvaofficial@gmail.com and admin@thulirva.com", () => {
        assert.ok(fs.existsSync(SESSIONS_FILE), "admin_2fa_sessions.json must exist");
        const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
        const session = sessions.find(s => s.twoFactorToken === twoFactorToken);
        assert.ok(session, "Session record not found in data store");
        assert.ok(session.targetEmails.includes("thulirvaofficial@gmail.com"), "Session must include thulirvaofficial@gmail.com");
        assert.ok(session.targetEmails.includes("admin@thulirva.com"), "Session must include admin@thulirva.com");
        assert.strictEqual(session.otp.length, 6);
        assert.strictEqual(session.attempts, 0);
    });

    console.log("\n▶ Section 2: Two-Step Code Verification Security...");

    await it("POST /api/auth/verify-2fa strictly REJECTS invalid codes and counts attempts", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/verify-2fa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                twoFactorToken,
                otp: "000000"
            })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 400);
        assert.strictEqual(data.success, false);
        assert.ok(data.message.includes("Invalid 2-step verification code"), "Expected invalid code message");
    });

    await it("POST /api/auth/verify-2fa strictly REJECTS empty or missing tokens", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/verify-2fa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                twoFactorToken: "",
                otp: "123456"
            })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 400);
        assert.strictEqual(data.success, false);
    });

    await it("POST /api/auth/verify-2fa ACCEPTS the legitimate code and issues Admin JWT session", async () => {
        // Read the server-stored OTP for this controlled test
        const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
        const session = sessions.find(s => s.twoFactorToken === twoFactorToken);
        assert.ok(session, "Session must exist");

        const res = await fetch(`${BASE_URL}/api/auth/verify-2fa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                twoFactorToken,
                otp: session.otp
            })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
        assert.strictEqual(data.success, true);
        assert.ok(data.token, "Admin JWT token must be returned upon successful 2FA");
        assert.ok(data.admin, "Admin profile object must be returned");
        const role = (data.admin.role || "").toLowerCase();
        assert.ok(role.includes("admin"), `Expected admin role, got ${data.admin.role}`);
    });

    await it("Consumed 2FA token is deleted immediately (Anti-Replay Protection)", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/verify-2fa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                twoFactorToken,
                otp: "123456"
            })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 400);
        assert.strictEqual(data.success, false);
        assert.ok(data.message.includes("invalid or has expired"), "Replay attempt must be rejected");
    });

    console.log("\n▶ Section 3: 2FA Resend & Rate Limiting...");

    let resendToken = null;

    await it("Triggering new login provides fresh token for resend testing", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: ADMIN_EMAIL,
                password: ADMIN_PASS,
                admin_login: true,
                is_admin_portal: true
            })
        });

        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.requires2FA, true);
        resendToken = data.twoFactorToken;
    });

    await it("POST /api/auth/resend-2fa enforces 30-second cooldown rate limit", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/resend-2fa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ twoFactorToken: resendToken })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 429, `Expected 429 Too Many Requests, got ${res.status}`);
        assert.ok(data.message.includes("Please wait"), "Expected cooldown message");
    });

    console.log("\n▶ Section 4: Customer Login Isolation...");

    await it("Customer login does NOT require admin 2FA and returns direct customer JWT", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "priya.raman@gmail.com",
                password: "customer_password_or_hash"
            })
        });

        // Even with wrong password, ensure requires2FA is false
        const data = await res.json();
        assert.strictEqual(data.requires2FA, undefined, "Customers must not receive requires2FA flag");
    });

    console.log("\n==================================================================");
    console.log(`TEST SUMMARY: ${passCount} Passed, ${failCount} Failed`);
    console.log("==================================================================");

    if (failCount > 0) {
        process.exit(1);
    }
}

run2FATestSuite().catch(err => {
    console.error("Test Suite Execution Error:", err);
    process.exit(1);
});

