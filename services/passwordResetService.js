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
    } catch (_) { }
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
            ALTER TABLE password_reset_otps DROP CONSTRAINT IF EXISTS password_reset_otps_user_id_fkey;
            ALTER TABLE password_reset_otps ALTER COLUMN user_id DROP NOT NULL;
            ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS partner_id VARCHAR(100);
            ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'customer';
        `);
    } catch (_) { }
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
async function sendResetEmail({ toEmail, name, otp, role = "customer", partnerId = null }) {
    const isPartner = role === "partner" || !!partnerId;
    const purpose = isPartner ? "Delivery Partner Password Reset" : "Password Reset";

    await emailService.sendOtpEmail({
        to: toEmail,
        name: name || (partnerId ? `Partner ${partnerId}` : "Thulirva User"),
        otp,
        purpose,
        expiryMinutes: 5
    });

    // If partner has an internal placeholder email (e.g. @thulirva.in or thu-dp), also notify operations desk
    if (isPartner && (toEmail.endsWith("@thulirva.in") || toEmail.includes("thu-dp"))) {
        try {
            await emailService.sendOtpEmail({
                to: "thulirvaofficial@gmail.com",
                name: `Operations (${name || partnerId})`,
                otp,
                purpose: `Delivery Partner Password Reset for ${partnerId || name}`,
                expiryMinutes: 5
            });
        } catch (_) {}
    }
}

/**
 * 1. Find Account by Email, Phone, or Partner ID Identifier
 */
async function findAccountByIdentifier(rawIdentifier, role = null) {
    if (!rawIdentifier || typeof rawIdentifier !== "string") return null;
    const clean = rawIdentifier.trim().toLowerCase();
    const phoneDigits = rawIdentifier.replace(/\D/g, "");
    const isPartnerQuery = role === "partner" || clean.startsWith("thu-dp") || clean.includes("dp-");

    // 1. If explicitly a partner query or contains DP prefix, check delivery_partners first
    if (isPartnerQuery) {
        const partner = await findPartnerRecord(clean, phoneDigits);
        if (partner) return partner;
    }

    // 2. Check users in PostgreSQL
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
    } catch (_) { }

    // 3. Check JSON / in-memory store for users
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
    } catch (_) { }

    // 4. Fallback check delivery_partners if not found in users
    if (!isPartnerQuery) {
        const partner = await findPartnerRecord(clean, phoneDigits);
        if (partner) return partner;
    }

    return null;
}

/**
 * Helper to find delivery partner across DB and disk
 */
async function findPartnerRecord(clean, phoneDigits) {
    try {
        let pQuery;
        let pParams;
        if (phoneDigits.length === 10) {
            pQuery = `SELECT id, partner_id, name, email, phone, 'partner' as role 
                      FROM delivery_partners 
                      WHERE (LOWER(partner_id) = $1 OR phone = $1 OR REPLACE(phone, ' ', '') = $2 OR LOWER(email) = $1)
                        AND (registration_status IS NULL OR registration_status NOT IN ('deleted', 'deactivated'))
                      LIMIT 1`;
            pParams = [clean, phoneDigits];
        } else {
            pQuery = `SELECT id, partner_id, name, email, phone, 'partner' as role 
                      FROM delivery_partners 
                      WHERE (LOWER(partner_id) = $1 OR LOWER(email) = $1)
                        AND (registration_status IS NULL OR registration_status NOT IN ('deleted', 'deactivated'))
                      LIMIT 1`;
            pParams = [clean];
        }
        const pRes = await pool.query(pQuery, pParams);
        if (pRes.rows && pRes.rows.length > 0) {
            const p = pRes.rows[0];
            return {
                id: p.id || p.partner_id,
                partner_id: p.partner_id,
                name: p.name,
                email: p.email || `${(p.partner_id || 'partner').toLowerCase()}@thulirva.in`,
                phone: p.phone,
                role: "partner"
            };
        }
    } catch (_) { }

    try {
        const { getPartnerById } = require("./deliveryPartnerService");
        const p = await getPartnerById(clean) || (phoneDigits.length === 10 ? await getPartnerById(phoneDigits) : null);
        if (p) {
            return {
                id: p.id || p.partner_id,
                partner_id: p.partner_id,
                name: p.name,
                email: p.email || `${(p.partner_id || 'partner').toLowerCase()}@thulirva.in`,
                phone: p.phone,
                role: "partner"
            };
        }
    } catch (_) { }

    return null;
}

/**
 * 2. Generate and Send Reset OTP
 * Returns generic message to prevent account enumeration
 */
async function generateAndSendResetOtp({ identifier, method = "email", role = null, reqIp = "127.0.0.1" }) {
    if (!identifier) {
        throw new Error("Partner ID, mobile number, or email address is required.");
    }

    const cleanIdent = identifier.trim().toLowerCase();
    const isEmail = cleanIdent.includes("@");

    // Email format validation (only if @ provided)
    if (isEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanIdent)) {
            throw new Error("Please enter a valid email address.");
        }
    }

    // IP-based Rate Limiting (max 15 requests per 15 min)
    const ipLimit = checkRateLimit(IP_RATE_LIMIT, reqIp, 15);
    if (!ipLimit.allowed) {
        throw new Error(ipLimit.message);
    }

    // Email/Identifier-based Rate Limiting (max 6 requests per 15 min)
    const emailLimit = checkRateLimit(EMAIL_RATE_LIMIT, cleanIdent, 6);
    if (!emailLimit.allowed) {
        throw new Error(emailLimit.message);
    }

    const user = await findAccountByIdentifier(cleanIdent, role);

    // GENERIC ENUMERATION PROTECTION:
    // If user does not exist, return generic success message with slight delay
    if (!user || !user.email) {
        await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
        return {
            success: true,
            message: "If an account exists with this credential, a verification code has been sent.",
            cooldownSeconds: 60,
            expiresInSeconds: 300
        };
    }

    const now = Date.now();
    IN_MEMORY_RESET_OTPS = loadOtpsFromDisk();

    // Enforce 60-second resend cooldown for active OTPs
    const existingActive = IN_MEMORY_RESET_OTPS.find(o =>
        (o.user_id === user.id || (user.partner_id && o.partner_id === user.partner_id) || o.identifier === cleanIdent) &&
        !o.is_used &&
        o.expires_at > now
    );

    if (existingActive && (now - existingActive.created_at) < RESEND_COOLDOWN_MS) {
        const remainingSecs = Math.ceil((RESEND_COOLDOWN_MS - (now - existingActive.created_at)) / 1000);
        throw new Error(`Please wait ${remainingSecs} seconds before requesting a new verification code.`);
    }

    // Invalidate previous active OTPs for this user
    IN_MEMORY_RESET_OTPS = IN_MEMORY_RESET_OTPS.map(o => {
        if ((o.user_id === user.id || (user.partner_id && o.partner_id === user.partner_id) || o.identifier === cleanIdent) && !o.is_used) {
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
        partner_id: user.partner_id || null,
        role: user.role || "customer",
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
        const intUserId = parseInt(user.id, 10);
        await pool.query(
            `INSERT INTO password_reset_otps 
             (user_id, partner_id, role, identifier, method, target_destination, otp_hash, salt, attempts, max_attempts, expires_at, is_used, created_at)
             VALUES ($1, $2, $3, $4, 'email', $5, $6, $7, 0, $8, $9, false, NOW())`,
            [
                isNaN(intUserId) ? null : intUserId,
                user.partner_id || null,
                user.role || 'customer',
                cleanIdent,
                user.email.toLowerCase(),
                otpHash,
                salt,
                MAX_ATTEMPTS,
                new Date(expiresAt)
            ]
        );
    } catch (_) { }

    // Dispatch via Thulirva SMTP
    try {
        await sendResetEmail({
            toEmail: user.email,
            name: user.name,
            otp: otp,
            role: user.role,
            partnerId: user.partner_id
        });
    } catch (mailErr) {
        console.error(`[PASSWORD RESET SMTP FAILURE] Target: ${user.email} | Technical Error:`, mailErr.message);
        throw new Error("Unable to send your verification code right now. Please try again in a few minutes.");
    }

    const maskedTarget = maskEmail(user.email);
    return {
        success: true,
        message: `Verification code sent to registered email (${maskedTarget}).`,
        target_destination: maskedTarget,
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

    // Find active OTP record matching identifier or target destination or partner_id
    let record = IN_MEMORY_RESET_OTPS.find(o =>
        (o.identifier === cleanIdent ||
         o.target_destination.toLowerCase() === cleanIdent ||
         (o.partner_id && o.partner_id.toLowerCase() === cleanIdent)) &&
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
        } catch (_) { }

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
            partnerId: record.partner_id || null,
            role: record.role || "customer",
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
    } catch (_) { }

    return {
        success: true,
        message: "Verification code confirmed successfully.",
        reset_token: resetToken
    };
}

/**
 * 4. Reset Password
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

    // Verify JWT reset token
    let decoded;
    try {
        decoded = jwt.verify(reset_token, JWT_SECRET);
    } catch (e) {
        throw new Error("Password reset session has expired or is invalid. Please start again.");
    }

    if (decoded.purpose !== "password_reset" || (!decoded.userId && !decoded.partnerId)) {
        throw new Error("Invalid password reset token.");
    }

    const isPartner = decoded.role === "partner" || !!decoded.partnerId;

    if (isPartner) {
        if (new_password.length < 6) {
            throw new Error("Password must be at least 6 characters in length.");
        }
    } else {
        if (new_password.length < 8) {
            throw new Error("Password must be at least 8 characters in length.");
        }
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
    const partnerId = decoded.partnerId;

    // 1. If Partner, update delivery_partners in PostgreSQL and disk
    if (isPartner) {
        try {
            await pool.query(
                `UPDATE delivery_partners 
                 SET password = $1, updated_at = NOW() 
                 WHERE LOWER(partner_id) = LOWER($2) OR phone = $2 OR LOWER(email) = LOWER($3)`,
                [hashedPassword, partnerId || String(userId), decoded.email]
            );
        } catch (dbErr) {
            console.error("[PARTNER RESET DB ERROR]:", dbErr.message);
        }

        try {
            const { getPartnerById, savePartner } = require("./deliveryPartnerService");
            const p = await getPartnerById(partnerId || userId || decoded.email);
            if (p) {
                p.password = hashedPassword;
                p.password_hash = hashedPassword;
                p.updated_at = new Date().toISOString();
                await savePartner(p);
            }
        } catch (diskErr) {
            console.error("[PARTNER RESET DISK ERROR]:", diskErr.message);
        }
    }

    // 2. Also update users table if matching user row exists
    try {
        const intId = parseInt(userId, 10);
        await pool.query(
            "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 OR LOWER(email) = LOWER($3)",
            [hashedPassword, isNaN(intId) ? -1 : intId, decoded.email]
        );
        await pool.query(
            "UPDATE password_reset_otps SET reset_token_used = true WHERE reset_token_hash = $1",
            [tokenHash]
        );
    } catch (_) { }

    // 3. Update JSON user store if present
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
    } catch (_) { }

    return {
        success: true,
        message: isPartner 
            ? "Your delivery partner password has been reset successfully. Please sign in with your new password."
            : "Your password has been reset successfully. You can now sign in to your Thulirva account using your new password."
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
