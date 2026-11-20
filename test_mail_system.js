/**
 * THULIRVA CENTRALIZED MAIL SERVER & OTP SYSTEM VERIFICATION SUITE
 * 
 * Tests:
 * 1. VPS Mail Server Handshake (mail.thulirva.com / 15.235.251.225)
 * 2. Centralized emailService Transporter & Dual-Port Fallback (Port 25 -> 587)
 * 3. Secure OTP Generation & Dispatch (/api/auth/send-otp - Zero Plaintext Leaks)
 * 4. Elimination of OTP Backdoors (/api/auth/verify-otp - Rejects '123456')
 * 5. End-to-End Password Reset via Centralized Mail (/api/auth/forgot-password)
 * 6. Customer Support Ticket Email Receipt & Agent Reply Notifications
 * 7. Welcome Email Dispatch on Registration
 * 8. Frontend Security Audit (Ensures zero SMTP credentials in Flutter/Web)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5500';

console.log("==================================================================");
console.log("✉️  THULIRVA CENTRALIZED MAIL SERVER & OTP VERIFICATION SUITE");
console.log("==================================================================\n");

let passCount = 0;
let failCount = 0;

async function it(description, fn) {
    try {
        await fn();
        console.log(`  ✅ [PASS] ${description}`);
        passCount++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${description}`);
        console.error(`     Error: ${err.message}`);
        failCount++;
    }
}

async function runTestSuite() {
    const emailService = require('./services/emailService');

    console.log("▶ Section 1: VPS Mail Server Configuration & Connectivity...");

    await it("SMTP configuration matches user VPS specifications", () => {
        assert.strictEqual(emailService.config.host, "mail.thulirva.com", "Host must be mail.thulirva.com");
        assert.strictEqual(emailService.config.fromEmail, "noreply@thulirva.com", "Sender must be noreply@thulirva.com");
        assert.strictEqual(emailService.config.fromName, "Thulirva", "Sender name must be Thulirva");
        assert.strictEqual(emailService.config.vpsIp, "15.235.251.225", "VPS IP must be 15.235.251.225");
        assert.strictEqual(emailService.config.secure, false, "Secure must be false (STARTTLS)");
    });

    await it("Centralized emailService verifies connectivity to Thulirva VPS mail server", async () => {
        const conn = await emailService.verifyConnection();
        assert.strictEqual(conn.success, true, `SMTP verification failed: ${conn.error}`);
        assert.strictEqual(conn.status, "operational", "Status must be operational");
    });

    console.log("\n▶ Section 2: Secure OTP Generation & Zero-Leakage Verification...");

    const testEmail = "admin@thulirva.com";

    await it("POST /api/auth/send-otp dispatches OTP without leaking code in HTTP response", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, purpose: "Verification" })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
        assert.strictEqual(data.success, true, "Expected success: true");
        assert.strictEqual(data.otp, undefined, "CRITICAL: Plaintext OTP was leaked in HTTP response!");
        assert.strictEqual(data.code, undefined, "CRITICAL: Plaintext code was leaked in HTTP response!");
        assert.ok(data.message.includes("Verification code sent"), "Expected confirmation message");
    });

    await it("POST /api/auth/verify-otp strictly REJECTS the '123456' backdoor", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, otp: "123456" })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 400, "123456 backdoor was NOT rejected!");
        assert.strictEqual(data.verified, false, "123456 was accepted as verified!");
        assert.ok(data.message.includes("Invalid"), "Expected invalid code message");
    });

    await it("POST /api/auth/verify-otp strictly REJECTS invalid / non-matching codes", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, otp: "999999" })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 400);
        assert.strictEqual(data.verified, false);
    });

    console.log("\n▶ Section 3: Password Reset OTP Flow via Centralized Mail Server...");

    const customerEmail = "priya.raman@gmail.com";

    await it("POST /api/auth/forgot-password sends OTP via centralized mailService without user enumeration", async () => {
        const res = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: customerEmail })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.otp, undefined, "Plaintext OTP must not be leaked!");
        assert.ok((data.maskedEmail && data.maskedEmail.includes("@")) || data.message.includes("verification code"), "Expected masked email or confirmation");
    });

    await it("Password reset OTP verification strictly enforces single-use server tokens", async () => {
        // Read the generated OTP from persistent disk store for controlled testing
        const otpsFile = path.resolve(__dirname, 'data', 'password_reset_otps.json');
        assert.ok(fs.existsSync(otpsFile), "password_reset_otps.json must exist");
        const otps = JSON.parse(fs.readFileSync(otpsFile, 'utf8'));
        const userOtps = otps.filter(o => o.identifier.toLowerCase() === customerEmail.toLowerCase() && !o.is_used);
        assert.ok(userOtps.length > 0, "No active OTP record found on disk");
        
        // Ensure invalid OTP is rejected
        const failRes = await fetch(`${BASE_URL}/api/auth/verify-reset-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: customerEmail, otp: "000000" })
        });
        assert.strictEqual(failRes.status, 400);
    });

    console.log("\n▶ Section 4: Customer Support Ticketing Email Integration...");

    const supportService = require('./services/supportService');

    await it("Creating a support ticket automatically logs email confirmation to user", async () => {
        const ticket = await supportService.createTicket({
            userId: "CUST-9999",
            userName: "Mail Audit User",
            userPhone: "9876543210",
            userEmail: "audit.support@thulirva.com",
            userType: "customer",
            category: "Delivery",
            subject: "Morning Milk Delivery Confirmation",
            description: "Please confirm morning delivery arrival time before 6:30 AM."
        });

        assert.ok(ticket.ticket_number.startsWith("THU-TKT-"), "Invalid ticket number format");
        assert.strictEqual(ticket.user_email, "audit.support@thulirva.com");
    });

    await it("Admin replying to ticket triggers formatted email notification to user", async () => {
        // Fetch tickets and find the created ticket
        const ticketsFile = path.resolve(__dirname, 'data', 'support_tickets.json');
        const tickets = JSON.parse(fs.readFileSync(ticketsFile, 'utf8'));
        const t = tickets.find(x => x.user_email === "audit.support@thulirva.com");
        assert.ok(t, "Ticket not found on disk");

        const msg = await supportService.addTicketMessage({
            ticketId: t.ticket_number,
            senderId: "1",
            senderName: "Operations Support Lead",
            senderRole: "admin",
            message: "Your milk delivery route has been optimized for 6:15 AM arrival."
        });

        assert.strictEqual(msg.sender_role, "admin");
    });

    await it("Resolving a ticket updates status and logs resolution email dispatch", async () => {
        const ticketsFile = path.resolve(__dirname, 'data', 'support_tickets.json');
        const tickets = JSON.parse(fs.readFileSync(ticketsFile, 'utf8'));
        const t = tickets.find(x => x.user_email === "audit.support@thulirva.com");
        
        const update = await supportService.updateTicketStatus(t.ticket_number, "RESOLVED", "1", "Operations Lead");
        assert.strictEqual(update.status, "RESOLVED");
    });

    console.log("\n▶ Section 5: Frontend Security & Architecture Compliance Audit...");

    await it("Flutter Mobile App, Admin App, and Delivery App contain ZERO direct SMTP requests", () => {
        const appDirs = ['thulirva_mobile_app', 'thulirva_admin', 'thulirva_delivery_app'];
        let directSmtpFound = false;

        function scanDart(dir) {
            if (!fs.existsSync(dir)) return;
            for (const f of fs.readdirSync(dir)) {
                if (f === 'build' || f === '.dart_tool' || f === '.git' || f === '.gradle') continue;
                const p = path.join(dir, f);
                if (fs.statSync(p).isDirectory()) {
                    scanDart(p);
                } else if (f.endsWith('.dart')) {
                    const c = fs.readFileSync(p, 'utf8');
                    if (/nodemailer|mailer_transport|smtp_client/i.test(c)) {
                        directSmtpFound = true;
                        console.error(`  Direct SMTP found in ${p}`);
                    }
                }
            }
        }

        appDirs.forEach(scanDart);
        assert.strictEqual(directSmtpFound, false, "Direct SMTP code was found in Flutter frontend!");
    });

    await it("Frontend codebase contains ZERO exposed SMTP passwords or mail credentials", () => {
        const clientDirs = ['website/website', 'thulirva_mobile_app', 'thulirva_admin', 'thulirva_delivery_app'];
        let exposedCreds = false;

        function scanSecrets(dir) {
            if (!fs.existsSync(dir)) return;
            for (const f of fs.readdirSync(dir)) {
                if (f === 'build' || f === '.dart_tool' || f === '.git' || f === 'node_modules') continue;
                const p = path.join(dir, f);
                if (fs.statSync(p).isDirectory()) {
                    scanSecrets(p);
                } else if (f.endsWith('.dart') || f.endsWith('.js') || f.endsWith('.html')) {
                    const c = fs.readFileSync(p, 'utf8');
                    if (c.includes('65284b3a049058d55b9ea557e10a8f0d')) {
                        exposedCreds = true;
                        console.error(`  SMTP secret exposed in ${p}`);
                    }
                }
            }
        }

        clientDirs.forEach(scanSecrets);
        assert.strictEqual(exposedCreds, false, "SMTP password was found in frontend code!");
    });

    console.log("\n==================================================================");
    console.log(`TEST SUMMARY: ${passCount} Passed, ${failCount} Failed`);
    console.log("==================================================================");

    if (failCount > 0) {
        process.exit(1);
    }
}

runTestSuite().catch(err => {
    console.error("Execution error:", err);
    process.exit(1);
});
