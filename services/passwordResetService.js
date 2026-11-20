const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const RESET_OTPS_FILE = path.join(DATA_DIR, "password_reset_otps.json");

const JWT_SECRET = process.env.JWT_SECRET || "thulirva_secret_key_2026";
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_ATTEMPTS = 5;

// In-memory rate limiting maps
const IP_RATE_LIMIT = new Map(); // ip -> { count, resetTime }
const EMAIL_RATE_LIMIT = new Map(); // email -> { count, resetTime }
const VERIFY_RATE_LIMIT = new Map(); // ip -> { count, resetTime }

function checkRateLimit(map, key, maxAllowed, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || entry.resetTime <= now) {
        map.set(key, { count: 1, resetTime: now + windowMs });
        return { allowed: true };
    }
    if (entry.count >= maxAllowed) {
        const remainingMinutes = Math.ceil((entry.resetTime - now) / 60000);
        return {
            allowed: false,
            message: `Too many requests. Please try again after ${remainingMinutes} minute(s).`
        };
    }
    entry.count += 1;
    return { allowed: true };
}

// Load OTP records from disk
function loadOtpsFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (fs.existsSync(RESET_OTPS_FILE)) {
            const raw = fs.readFileSync(RESET_OTPS_FILE, "utf-8");
            return JSON.parse(raw);
        }
    } catch (_) {}
    return [];
}

function saveOtpsToDisk(records) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(RESET_OTPS_FILE, JSON.stringify(records, null, 2), "utf-8");
    } catch (e) {
        console.warn("[RESET OTP DISK SAVE ERROR]:", e.message);
    }
}

let IN_MEMORY_RESET_OTPS = loadOtpsFromDisk();

// Initialize PostgreSQL table if available
async function ensureDbTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS password_reset_otps (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                identifier VARCHAR(200) NOT NULL,
                method VARCHAR(20) NOT NULL DEFAULT 'email',
                target_destination VARCHAR(200) NOT NULL,
                otp_hash VARCHAR(255) NOT NULL,
                salt VARCHAR(64) NOT NULL,
                attempts INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT 5,
                expires_at TIMESTAMP NOT NULL,
                is_used BOOLEAN DEFAULT false,
                verified_at TIMESTAMP,
                reset_token_hash VARCHAR(255),
                reset_token_expires_at TIMESTAMP,
                reset_token_used BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_reset_otps_user ON password_reset_otps(user_id);
            CREATE INDEX IF NOT EXISTS idx_reset_otps_ident ON password_reset_otps(identifier);
        `);
    } catch (_) {}
}
ensureDbTable();

// Helper: Mask email (e.g. kamsh@thulirva.com -> k***h@thulirva.com)
function maskEmail(email) {
    if (!email || !email.includes("@")) return "—";
    const [local, domain] = email.split("@");
    if (local.length <= 2) {
        return `${local.charAt(0)}*@${domain}`;
    }
    const first = local.charAt(0);
    const last = local.charAt(local.length - 1);
    const stars = "*".repeat(Math.min(4, Math.max(1, local.length - 2)));
    return `${first}${stars}${last}@${domain}`;
}

// Helper: Mask phone (e.g. 7904880944 -> ••••••0944)
function maskPhone(phone) {
    if (!phone) return "—";
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 4) return digits;
    const last4 = digits.slice(-4);
    return `+91 ••••• •${last4}`;
}

const emailService = require("./emailService");

// Helper: Proxy to centralized mail transporter for backward compatibility
function createMailTransporter() {
    return emailService.getTransporter();
}

// Helper: Send Branded Thulirva OTP Reset Email via Centralized Mail Service
async function sendResetEmail({ toEmail, name, otp }) {
    return emailService.sendOtpEmail({
        to: toEmail,
        name,
        otp,
        purpose: "Password Reset",
        expiryMinutes: 5
    });
}

/**
 * 1. Find Account by Email or Phone Identifier
 */
async function findAccountByIdentifier(rawIdentifier) {
    if (!rawIdentifier || typeof rawIdentifier !== "string") return null;
    const clean = rawIdentifier.trim().toLowerCase();
    const phoneDigits = rawIdentifier.replace(/\D/g, "");

    // 1. Check PostgreSQL
    try {
        let query;
        let params;
        if (phoneDigits.length === 10) {
            query = "SELECT id, name, email, phone, role FROM users WHERE LOWER(email) = $1 OR phone = $1 OR REPLACE(phone, ' ', '') = $2 LIMIT 1";
            params = [clean, phoneDigits];
        } else {
            query = "SELECT id, name, email, phone, role FROM users WHERE LOWER(email) = $1 LIMIT 1";
            params = [clean];
        }
        const res = await pool.query(query, params);
        if (res.rows && res.rows.length > 0) {
            return res.rows[0];
        }
    } catch (_) {}

    // 2. Check JSON / in-memory store
    try {
        if (fs.existsSync(USERS_FILE)) {
            const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
            const found = users.find(u => {
                const uEmail = (u.email || "").toLowerCase().trim();
                const uPhone = (u.phone || "").replace(/\D/g, "");
                return uEmail === clean || (phoneDigits.length === 10 && uPhone === phoneDigits);
            });
            if (found) {
                return {
                    id: found.id,
                    name: found.name,
                    email: found.email,
                    phone: found.phone,
                    role: found.role || "customer"
                };
            }
        }
    } catch (_) {}

    return null;
}

/**
 * 2. Generate and Send Reset OTP
 * Returns generic message to prevent account enumeration
 */
async function generateAndSendResetOtp({ identifier, method = "email", reqIp = "127.0.0.1" }) {
    if (!identifier) {
        throw new Error("Email address is required.");
    }

    const cleanIdent = identifier.trim().toLowerCase();
    const isEmail = cleanIdent.includes("@");

    // Email format validation
    if (isEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanIdent)) {
            throw new Error("Please enter a valid email address.");
        }
    }

    // IP-based Rate Limiting (max 10 requests per 15 min)
    const ipLimit = checkRateLimit(IP_RATE_LIMIT, reqIp, 10);
    if (!ipLimit.allowed) {
        throw new Error(ipLimit.message);
    }

    // Email-based Rate Limiting (max 5 requests per 15 min)
    const emailLimit = checkRateLimit(EMAIL_RATE_LIMIT, cleanIdent, 5);
    if (!emailLimit.allowed) {
        throw new Error(emailLimit.message);
    }

    const user = await findAccountByIdentifier(cleanIdent);

    // GENERIC ENUMERATION PROTECTION:
    // If user does not exist, return generic success message with slight delay
    if (!user || !user.email) {
        await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
        return {
            success: true,
            message: "If an account exists with this email address, a verification code has been sent.",
            cooldownSeconds: 60,
            expiresInSeconds: 300
        };
    }

    const now = Date.now();
    IN_MEMORY_RESET_OTPS = loadOtpsFromDisk();

    // Enforce 60-second resend cooldown for active OTPs
    const existingActive = IN_MEMORY_RESET_OTPS.find(o => 
        o.user_id === user.id &&
        !o.is_used &&
        o.expires_at > now
    );

    if (existingActive && (now - existingActive.created_at) < RESEND_COOLDOWN_MS) {
        const remainingSecs = Math.ceil((RESEND_COOLDOWN_MS - (now - existingActive.created_at)) / 1000);
        throw new Error(`Please wait ${remainingSecs} seconds before requesting a new verification code.`);
    }

    // Invalidate previous active OTPs for this user
    IN_MEMORY_RESET_OTPS = IN_MEMORY_RESET_OTPS.map(o => {
        if (o.user_id === user.id && !o.is_used) {
            return { ...o, is_used: true };
        }
        return o;
    });

    // Cryptographically secure 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const salt = crypto.randomBytes(16).toString("hex");
    const otpHash = crypto.createHash("sha256").update(otp + salt).digest("hex");
    const expiresAt = now + OTP_EXPIRY_MS;

    const record = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        user_id: user.id,
        identifier: cleanIdent,
        method: "email",
        target_destination: user.email.toLowerCase(),
        otp_hash: otpHash,
        salt: salt,
        attempts: 0,
        max_attempts: MAX_ATTEMPTS,
        expires_at: expiresAt,
        is_used: false,
        verified_at: null,
        reset_token_hash: null,
        reset_token_expires_at: null,
        reset_token_used: false,
        created_at: now,
        ip: reqIp
    };

    IN_MEMORY_RESET_OTPS.unshift(record);
    if (IN_MEMORY_RESET_OTPS.length > 1000) IN_MEMORY_RESET_OTPS = IN_MEMORY_RESET_OTPS.slice(0, 1000);
    saveOtpsToDisk(IN_MEMORY_RESET_OTPS);

    // Save to PostgreSQL if available
    try {
        await pool.query(
            `INSERT INTO password_reset_otps 
             (user_id, identifier, method, target_destination, otp_hash, salt, attempts, max_attempts, expires_at, is_used, created_at)
             VALUES ($1, $2, 'email', $3, $4, $5, 0, $6, $7, false, NOW())`,
            [user.id, cleanIdent, user.email.toLowerCase(), otpHash, salt, MAX_ATTEMPTS, new Date(expiresAt)]
        );
    } catch (_) {}

    // Dispatch via Thulirva SMTP
    try {
        await sendResetEmail({
            toEmail: user.email,
            name: user.name,
            otp: otp
        });
    } catch (mailErr) {
        console.error(`[PASSWORD RESET SMTP FAILURE] Target: ${user.email} | Technical Error:`, mailErr.message);
        throw new Error("Unable to send your verification code right now. Please try again in a few minutes.");
    }

    return {
        success: true,
        message: "If an account exists with this email address, a verification code has been sent.",
        cooldownSeconds: 60,
        expiresInSeconds: 300
    };
}

/**
 * 3. Verify Reset OTP
 */
async function verifyResetOtp({ identifier, otp, reqIp = "127.0.0.1" }) {
    if (!identifier || !otp) {
        throw new Error("Email address and 6-digit verification code are required.");
    }

    // IP-based Rate Limiting for OTP verification (max 20 per 15 min)
    const verifyLimit = checkRateLimit(VERIFY_RATE_LIMIT, reqIp, 20);
    if (!verifyLimit.allowed) {
        throw new Error(verifyLimit.message);
    }

    const cleanIdent = identifier.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();
    if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
        throw new Error("Verification code must be exactly 6 digits.");
    }

    const now = Date.now();
    IN_MEMORY_RESET_OTPS = loadOtpsFromDisk();

    // Find active OTP record matching identifier or target destination
    let record = IN_MEMORY_RESET_OTPS.find(o => 
        (o.identifier === cleanIdent || o.target_destination.toLowerCase() === cleanIdent) &&
        !o.is_used &&
        o.expires_at > now
    );

    if (!record) {
        throw new Error("Verification code has expired or is invalid. Please request a new code.");
    }

    if (record.attempts >= record.max_attempts) {
        record.is_used = true;
        saveOtpsToDisk(IN_MEMORY_RESET_OTPS);
        throw new Error("Maximum attempts exceeded. This verification code has been locked. Please request a new code.");
    }

    // Timing-safe comparison of SHA-256 hash
    const expectedHash = crypto.createHash("sha256").update(cleanOtp + record.salt).digest("hex");
    const isMatch = crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(record.otp_hash));

    if (!isMatch) {
        record.attempts += 1;
        const remaining = Math.max(0, record.max_attempts - record.attempts);
        if (remaining === 0) record.is_used = true;
        saveOtpsToDisk(IN_MEMORY_RESET_OTPS);

        // Update DB attempts
        try {
            await pool.query(
                "UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = $1",
                [record.id]
            );
        } catch (_) {}

        if (remaining === 0) {
            throw new Error("Maximum attempts exceeded. This verification code has been locked. Please request a new code.");
        }
        throw new Error(`Invalid verification code. ${remaining} attempt(s) remaining.`);
    }

    // Mark OTP as used (single-use guarantee)
    record.is_used = true;
    record.verified_at = now;

    // Issue single-use server-side Reset Authorization Token (valid for 15 minutes)
    const jti = crypto.randomBytes(16).toString("hex");
    const resetToken = jwt.sign(
        {
            userId: record.user_id,
            email: record.target_destination,
            purpose: "password_reset",
            jti: jti
        },
        JWT_SECRET,
        { expiresIn: "15m" }
    );

    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    record.reset_token_hash = tokenHash;
    record.reset_token_expires_at = now + (15 * 60 * 1000);
    record.reset_token_used = false;

    saveOtpsToDisk(IN_MEMORY_RESET_OTPS);

    // Update DB
    try {
        await pool.query(
            `UPDATE password_reset_otps 
             SET is_used = true, verified_at = NOW(), reset_token_hash = $1, reset_token_expires_at = $2, reset_token_used = false 
             WHERE id = $3`,
            [tokenHash, new Date(record.reset_token_expires_at), record.id]
        );
    } catch (_) {}

    return {
        success: true,
        message: "Verification code confirmed successfully.",
        reset_token: resetToken
    };
}

/**
 * 4. Reset Password with Strict Requirements
 * - Minimum 10 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - At least 1 special character
 */
async function resetPassword({ reset_token, new_password, confirm_password }) {
    if (!reset_token) {
        throw new Error("Reset authorization token is missing. Please verify your OTP code again.");
    }
    if (!new_password || !confirm_password) {
        throw new Error("Both new password and confirm password fields are required.");
    }
    if (new_password !== confirm_password) {
        throw new Error("Passwords do not match. Please verify and re-enter.");
    }

    // Validate strict password requirements
    if (new_password.length < 10) {
        throw new Error("Password must be at least 10 characters in length.");
    }
    if (!/[A-Z]/.test(new_password)) {
        throw new Error("Password must contain at least one uppercase letter (A-Z).");
    }
    if (!/[a-z]/.test(new_password)) {
        throw new Error("Password must contain at least one lowercase letter (a-z).");
    }
    if (!/[0-9]/.test(new_password)) {
        throw new Error("Password must contain at least one number (0-9).");
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(new_password)) {
        throw new Error("Password must contain at least one special character (!@#$%^&* etc.).");
    }

    // Verify JWT reset token
    let decoded;
    try {
        decoded = jwt.verify(reset_token, JWT_SECRET);
    } catch (e) {
        throw new Error("Password reset session has expired or is invalid. Please start again.");
    }

    if (decoded.purpose !== "password_reset" || !decoded.userId) {
        throw new Error("Invalid password reset token.");
    }

    const tokenHash = crypto.createHash("sha256").update(reset_token).digest("hex");
    IN_MEMORY_RESET_OTPS = loadOtpsFromDisk();

    // Check single-use token from record
    const otpRecord = IN_MEMORY_RESET_OTPS.find(o => o.reset_token_hash === tokenHash);
    if (!otpRecord || otpRecord.reset_token_used) {
        throw new Error("This password reset token has already been used. Please request a new code.");
    }

    if (otpRecord.reset_token_expires_at && Date.now() > otpRecord.reset_token_expires_at) {
        throw new Error("Password reset session has expired. Please request a new code.");
    }

    // Mark reset token used (prevents replay attacks)
    otpRecord.reset_token_used = true;
    saveOtpsToDisk(IN_MEMORY_RESET_OTPS);

    // Hash new password with bcrypt
    const hashedPassword = await bcrypt.hash(new_password, 10);
    const userId = decoded.userId;

    // 1. Update PostgreSQL database
    try {
        await pool.query(
            "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2",
            [hashedPassword, userId]
        );
        await pool.query(
            "UPDATE password_reset_otps SET reset_token_used = true WHERE reset_token_hash = $1",
            [tokenHash]
        );
    } catch (_) {}

    // 2. Update JSON user store
    try {
        if (fs.existsSync(USERS_FILE)) {
            let users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
            const idx = users.findIndex(u => u.id === userId || (decoded.email && u.email && u.email.toLowerCase() === decoded.email.toLowerCase()));
            if (idx >= 0) {
                users[idx].password = hashedPassword;
                users[idx].updated_at = new Date().toISOString();
                fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
            }
        }
    } catch (_) {}

    return {
        success: true,
        message: "Your password has been reset successfully. You can now sign in to your Thulirva account using your new password."
    };
}

module.exports = {
    findAccountByIdentifier,
    generateAndSendResetOtp,
    verifyResetOtp,
    resetPassword,
    maskEmail,
    maskPhone,
    createMailTransporter
};
