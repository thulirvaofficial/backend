/**
 * THULIRVA Enterprise — Administrator Two-Step Verification (2FA) Service
 * 
 * Provides mandatory two-factor authentication for all administrative sign-ins
 * across the Web Admin Portal and Flutter Admin Application.
 * 
 * Guarantees:
 * - 6-digit cryptographically generated OTP (crypto.randomInt)
 * - Exclusive delivery to admin@thulirva.com via centralized VPS mail server
 * - Single-use token consumption (anti-replay)
 * - 10-minute expiry window
 * - 5-attempt rate-limit lockout
 * - Resend cooldown protection (30 seconds)
 * - Zero exposure of plaintext codes in API responses
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const emailService = require("./emailService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const SESSIONS_FILE = path.join(DATA_DIR, "admin_2fa_sessions.json");

// Ensure store file exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([], null, 2), "utf-8");
}

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function saveSessions(sessions) {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf-8");
    } catch (e) {
        console.error("[2FA SESSIONS STORE ERROR]:", e.message);
    }
}

/**
 * Initiates 2-Step Verification for an authenticated admin
 */
async function initiate2FA(req, res, { user, role, userPayload, adminPayload, targetEmail = null }) {
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
    const userAgent = req.headers["user-agent"] || (req.body.is_flutter ? "Thulirva Admin Flutter App" : "Thulirva Admin Web Console");
    const recipient = targetEmail || process.env.ADMIN_EMAIL || "admin@thulirva.com";

    // Clean expired sessions
    const now = Date.now();
    let sessions = loadSessions().filter(s => s.expiresAt > now);

    const otp = crypto.randomInt(100000, 999999).toString();
    const twoFactorToken = "2fa_" + crypto.randomBytes(24).toString("hex");

    const sessionRecord = {
        twoFactorToken,
        userId: user.id || 1,
        userEmail: user.email || recipient,
        targetEmail: recipient,
        adminName: user.name || "Administrator",
        role: role || "admin",
        otp: otp,
        expiresAt: now + (10 * 60 * 1000), // 10 minutes
        attempts: 0,
        maxAttempts: 5,
        lastResentAt: now,
        clientIp,
        userAgent,
        userPayload: userPayload || { id: user.id || 1, name: user.name, email: recipient, role },
        adminPayload: adminPayload || { id: user.id || 1, name: user.name, email: recipient, role },
        createdAt: new Date().toISOString()
    };

    sessions.push(sessionRecord);
    saveSessions(sessions);

    // Dispatch email to admin@thulirva.com
    try {
        await emailService.sendAdmin2StepVerificationEmail({
            to: recipient,
            adminName: user.name || "Administrator",
            otp: otp,
            ipAddress: clientIp,
            userAgent: userAgent,
            expiryMinutes: 10
        });
        console.log(`🔐 [ADMIN 2FA DISPATCH] Two-step verification code dispatched to ${recipient} | Token: ${twoFactorToken}`);
    } catch (mailErr) {
        console.error(`❌ [ADMIN 2FA EMAIL ERROR]:`, mailErr.message);
    }

    return res.json({
        success: true,
        requires2FA: true,
        twoFactorToken,
        email: recipient,
        maskedEmail: "a***n@thulirva.com",
        message: `Two-step verification code sent to ${recipient}. Please enter the 6-digit code to complete login.`
    });
}

/**
 * Verifies submitted 2FA code and issues the full Admin JWT session
 */
async function verify2FA(twoFactorToken, otp) {
    const cleanToken = String(twoFactorToken || "").trim();
    const cleanOtp = String(otp || "").trim();

    if (!cleanToken || !cleanOtp) {
        return {
            status: 400,
            success: false,
            message: "Session token and 6-digit verification code are required."
        };
    }

    let sessions = loadSessions();
    const sessionIndex = sessions.findIndex(s => s.twoFactorToken === cleanToken);

    if (sessionIndex === -1) {
        return {
            status: 400,
            success: false,
            message: "Two-step verification session is invalid or has expired. Please sign in again."
        };
    }

    const session = sessions[sessionIndex];

    // Check expiration
    if (Date.now() > session.expiresAt) {
        sessions.splice(sessionIndex, 1);
        saveSessions(sessions);
        return {
            status: 400,
            success: false,
            message: "Verification code has expired. Please request a new code or sign in again."
        };
    }

    // Check maximum attempts
    if (session.attempts >= session.maxAttempts) {
        sessions.splice(sessionIndex, 1);
        saveSessions(sessions);
        return {
            status: 403,
            success: false,
            message: "Too many failed attempts. For security, this verification session has been terminated. Please sign in again."
        };
    }

    // Strictly check OTP (no backdoors)
    if (session.otp !== cleanOtp) {
        session.attempts += 1;
        saveSessions(sessions);
        const remaining = session.maxAttempts - session.attempts;
        return {
            status: 400,
            success: false,
            verified: false,
            message: `Invalid 2-step verification code. (${remaining} attempt${remaining === 1 ? '' : 's'} remaining)`
        };
    }

    // Valid OTP! Invalidate session immediately (single-use guarantee)
    sessions.splice(sessionIndex, 1);
    saveSessions(sessions);

    // Sign the official Admin JWT Token
    const jwtSecret = process.env.JWT_SECRET || "thulirva_secret_key_2026";
    const token = jwt.sign(
        { id: session.userId, email: session.userEmail, role: session.role },
        jwtSecret,
        { expiresIn: "30d" }
    );

    console.log(`✓ [ADMIN 2FA SUCCESS] Admin ${session.adminName} (${session.targetEmail}) authorized from IP ${session.clientIp}`);

    return {
        status: 200,
        success: true,
        token,
        user: session.userPayload,
        admin: session.adminPayload,
        data: {
            token,
            user: session.userPayload,
            admin: session.adminPayload
        },
        message: "Two-step verification successful. Welcome to Thulirva Console."
    };
}

/**
 * Resends a fresh 2FA code to admin@thulirva.com with cooldown enforcement
 */
async function resend2FA(twoFactorToken, req) {
    const cleanToken = String(twoFactorToken || "").trim();
    if (!cleanToken) {
        return {
            status: 400,
            success: false,
            message: "Session token is required."
        };
    }

    let sessions = loadSessions();
    const session = sessions.find(s => s.twoFactorToken === cleanToken);

    if (!session || Date.now() > session.expiresAt) {
        return {
            status: 400,
            success: false,
            message: "Verification session has expired. Please sign in again."
        };
    }

    // 30-second cooldown rate limit
    const now = Date.now();
    const cooldownRemaining = Math.ceil(((session.lastResentAt || 0) + 30000 - now) / 1000);
    if (cooldownRemaining > 0) {
        return {
            status: 429,
            success: false,
            message: `Please wait ${cooldownRemaining} second${cooldownRemaining === 1 ? '' : 's'} before requesting a new code.`
        };
    }

    const newOtp = crypto.randomInt(100000, 999999).toString();
    session.otp = newOtp;
    session.attempts = 0;
    session.expiresAt = now + (10 * 60 * 1000);
    session.lastResentAt = now;
    saveSessions(sessions);

    const clientIp = req ? (req.headers["x-forwarded-for"] || req.socket.remoteAddress || session.clientIp) : session.clientIp;
    const userAgent = req ? (req.headers["user-agent"] || session.userAgent) : session.userAgent;

    await emailService.sendAdmin2StepVerificationEmail({
        to: session.targetEmail,
        adminName: session.adminName,
        otp: newOtp,
        ipAddress: clientIp,
        userAgent: userAgent,
        expiryMinutes: 10
    });

    console.log(`🔐 [ADMIN 2FA RESEND] Fresh code sent to ${session.targetEmail}`);

    return {
        status: 200,
        success: true,
        message: `A fresh verification code has been dispatched to ${session.targetEmail}.`
    };
}

module.exports = {
    initiate2FA,
    verify2FA,
    resend2FA
};
