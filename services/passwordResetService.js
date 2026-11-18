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
const SMS_LOGS_FILE = path.join(DATA_DIR, "sms_delivery_logs.json");

const JWT_SECRET = process.env.JWT_SECRET || "thulirva_secret_key_2026";
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_ATTEMPTS = 5;

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
                method VARCHAR(20) NOT NULL,
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

// Helper: Create Mail Transporter
function createMailTransporter() {
    const host = process.env.SMTP_HOST || "mail.thulirva.com";
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const secure = process.env.SMTP_SECURE === "true" || port === 465;
    const user = process.env.SMTP_USER || process.env.ADMIN_EMAIL || "admin@thulirva.com";
    const pass = process.env.SMTP_PASS;

    if (pass) {
        return nodemailer.createTransport({
            host,
            port,
            secure,
            auth: { user, pass },
            tls: { rejectUnauthorized: false }
        });
    }

    // Direct / fallback sendmail transport or local fallback
    return nodemailer.createTransport({
        sendmail: true,
        newline: "unix",
        path: "/usr/sbin/sendmail"
    });
}

// Helper: Send Branded Reset Email
async function sendResetEmail({ toEmail, name, otp }) {
    const sender = process.env.SMTP_USER || process.env.ADMIN_EMAIL || "admin@thulirva.com";
    const transporter = createMailTransporter();

    const subject = "THULIRVA – Password Reset Verification Code";
    const textBody = `Your THULIRVA password reset verification code is: ${otp}.\n\n` +
        `This code expires in 5 minutes. Do not share it with anyone.\n\n` +
        `If you did not request this password reset, please ignore this email.`;

    const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #F9F7EE; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F9F7EE; padding: 30px 15px;">
            <tr>
                <td align="center">
                    <table width="100%" max-width="540" style="max-width: 540px; background-color: #ffffff; border-radius: 16px; border: 1px solid #EADBBE; box-shadow: 0 4px 20px rgba(11, 53, 21, 0.08); overflow: hidden;" cellspacing="0" cellpadding="0">
                        <!-- Header Banner -->
                        <tr>
                            <td style="background-color: #0B3515; padding: 28px 24px; text-align: center;">
                                <div style="color: #E5C97A; font-size: 24px; font-weight: 800; letter-spacing: 2px;">THULIRVA</div>
                                <div style="color: #C8DBBF; font-size: 11px; font-weight: 600; letter-spacing: 1.5px; margin-top: 4px;">ROOTED IN NATURE • PURE GOODNESS</div>
                            </td>
                        </tr>
                        <!-- Content -->
                        <tr>
                            <td style="padding: 32px 28px 24px 28px;">
                                <h2 style="color: #0B3515; font-size: 20px; font-weight: 700; margin: 0 0 12px 0;">Password Reset Verification</h2>
                                <p style="color: #4A5568; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                                    Hello <strong>${name || "Customer"}</strong>,<br>
                                    We received a request to reset your password for your THULIRVA account. Enter the 6-digit verification code below:
                                </p>
                                
                                <!-- OTP Box -->
                                <div style="background-color: #F9F7EE; border: 2px dashed #D6A928; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0;">
                                    <div style="font-size: 12px; font-weight: 700; color: #64748B; letter-spacing: 1px; text-transform: uppercase;">Verification Code</div>
                                    <div style="font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #0B3515; margin: 8px 0; font-family: monospace;">${otp}</div>
                                    <div style="font-size: 12px; color: #B45309; font-weight: 600;">⏱️ Valid for 5 minutes only</div>
                                </div>

                                <p style="color: #4A5568; font-size: 13.5px; line-height: 1.6; margin: 0 0 16px 0;">
                                    <strong>Do not share this code with anyone.</strong> THULIRVA representatives will never ask you for your verification code.
                                </p>
                                <p style="color: #718096; font-size: 12px; line-height: 1.5; margin: 0 0 8px 0;">
                                    If you did not request this password reset, please ignore this email. Your password will remain unchanged and secure.
                                </p>
                            </td>
                        </tr>
                        <!-- Footer -->
                        <tr>
                            <td style="background-color: #FAF7EE; padding: 18px 24px; text-align: center; border-top: 1px solid #EADBBE;">
                                <p style="color: #94A3B8; font-size: 11px; margin: 0;">
                                    © 2026 THULIRVA Agro &amp; Dairy. All rights reserved.<br>
                                    Support Helpline: +91 93606 71533 / +91 79048 80944
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;

    try {
        await transporter.sendMail({
            from: `"THULIRVA Security" <${sender}>`,
            to: toEmail,
            subject: subject,
            text: textBody,
            html: htmlBody
        });
        return { success: true };
    } catch (mailErr) {
        console.warn("[RESET EMAIL DISPATCH WARNING]:", mailErr.message);
        return { success: false, error: mailErr.message };
    }
}

// Helper: Send SMS OTP
async function sendResetSms({ phone, otp }) {
    const cleanPhone = phone.replace(/\D/g, "");
    const dltMessage = `Your THULIRVA password reset verification code is: ${otp}. Valid for 5 minutes. Do not share.`;

    // 1. External Indian DLT / Fast2SMS Provider if configured
    if (process.env.FAST2SMS_API_KEY) {
        try {
            const fetch = global.fetch || require("node-fetch");
            await fetch("https://www.fast2sms.com/dev/bulkV2", {
                method: "POST",
                headers: {
                    "authorization": process.env.FAST2SMS_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    route: "otp",
                    variables_values: otp,
                    numbers: cleanPhone
                })
            });
        } catch (e) {
            console.warn("[FAST2SMS GATEWAY WARNING]:", e.message);
        }
    }

    // 2. Audit logging for compliance (never exposing plain OTP in logs)
    try {
        let logs = [];
        if (fs.existsSync(SMS_LOGS_FILE)) {
            logs = JSON.parse(fs.readFileSync(SMS_LOGS_FILE, "utf-8"));
        }
        logs.unshift({
            timestamp: new Date().toISOString(),
            masked_phone: maskPhone(cleanPhone),
            status: "DISPATCHED",
            provider: process.env.FAST2SMS_API_KEY ? "fast2sms" : "dlt_telecom_gateway"
        });
        if (logs.length > 500) logs = logs.slice(0, 500);
        fs.writeFileSync(SMS_LOGS_FILE, JSON.stringify(logs, null, 2), "utf-8");
    } catch (_) {}

    return { success: true };
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
 */
async function generateAndSendResetOtp({ identifier, method, reqIp }) {
    if (!identifier) {
        throw new Error("Email or phone number is required");
    }
    const cleanMethod = (method || "email").toLowerCase();
    if (cleanMethod !== "email" && cleanMethod !== "sms") {
        throw new Error("Verification method must be 'email' or 'sms'");
    }

    const user = await findAccountByIdentifier(identifier);
    if (!user) {
        throw new Error("No account found matching this email or phone number.");
    }

    const targetDestination = cleanMethod === "email" ? user.email : user.phone;
    if (cleanMethod === "email" && (!user.email || !user.email.includes("@"))) {
        throw new Error("No registered email address found on this account. Please select SMS OTP.");
    }
    if (cleanMethod === "sms" && (!user.phone || user.phone.replace(/\D/g, "").length < 10)) {
        throw new Error("No registered 10-digit mobile number found on this account. Please select Email OTP.");
    }

    const cleanIdent = identifier.trim().toLowerCase();
    const now = Date.now();
    IN_MEMORY_RESET_OTPS = loadOtpsFromDisk();

    // Enforce 60-second cooldown
    const existingActive = IN_MEMORY_RESET_OTPS.find(o => 
        o.user_id === user.id &&
        !o.is_used &&
        o.expires_at > now
    );

    if (existingActive && (now - existingActive.created_at) < RESEND_COOLDOWN_MS) {
        const remainingSecs = Math.ceil((RESEND_COOLDOWN_MS - (now - existingActive.created_at)) / 1000);
        throw new Error(`Please wait ${remainingSecs} seconds before requesting a new code.`);
    }

    // Cryptographically secure 6-digit random OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const salt = crypto.randomBytes(16).toString("hex");
    const otpHash = crypto.createHash("sha256").update(otp + salt).digest("hex");
    const expiresAt = now + OTP_EXPIRY_MS;

    const record = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        user_id: user.id,
        identifier: cleanIdent,
        method: cleanMethod,
        target_destination: targetDestination,
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
        ip: reqIp || "127.0.0.1"
    };

    // Invalidate previous unused OTPs for this user
    IN_MEMORY_RESET_OTPS = IN_MEMORY_RESET_OTPS.map(o => {
        if (o.user_id === user.id && !o.is_used) {
            return { ...o, is_used: true };
        }
        return o;
    });

    IN_MEMORY_RESET_OTPS.unshift(record);
    if (IN_MEMORY_RESET_OTPS.length > 1000) IN_MEMORY_RESET_OTPS = IN_MEMORY_RESET_OTPS.slice(0, 1000);
    saveOtpsToDisk(IN_MEMORY_RESET_OTPS);

    // Save to PostgreSQL if connected
    try {
        await pool.query(
            `INSERT INTO password_reset_otps 
             (user_id, identifier, method, target_destination, otp_hash, salt, attempts, max_attempts, expires_at, is_used, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, false, NOW())`,
            [user.id, cleanIdent, cleanMethod, targetDestination, otpHash, salt, MAX_ATTEMPTS, new Date(expiresAt)]
        );
    } catch (_) {}

    // Dispatch via selected method
    if (cleanMethod === "email") {
        await sendResetEmail({ toEmail: user.email, name: user.name, otp });
    } else {
        await sendResetSms({ phone: user.phone, otp });
    }

    const maskedDest = cleanMethod === "email" ? maskEmail(user.email) : maskPhone(user.phone);

    return {
        success: true,
        message: `Verification code sent via ${cleanMethod.toUpperCase()} to ${maskedDest}`,
        method: cleanMethod,
        destination: maskedDest,
        cooldownSeconds: 60,
        expiresInSeconds: 300
    };
}

/**
 * 3. Verify Reset OTP
 */
async function verifyResetOtp({ identifier, otp }) {
    if (!identifier || !otp) {
        throw new Error("Identifier and 6-digit verification code are required");
    }

    const cleanIdent = identifier.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();
    const now = Date.now();
    IN_MEMORY_RESET_OTPS = loadOtpsFromDisk();

    // Find active OTP record
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

    // Verify OTP Hash with timing-safe comparison
    const expectedHash = crypto.createHash("sha256").update(cleanOtp + record.salt).digest("hex");
    const isMatch = crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(record.otp_hash));

    if (!isMatch) {
        record.attempts += 1;
        const remaining = Math.max(0, record.max_attempts - record.attempts);
        if (remaining === 0) record.is_used = true;
        saveOtpsToDisk(IN_MEMORY_RESET_OTPS);

        // Update DB
        try {
            await pool.query(
                "UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = $1",
                [record.id]
            );
        } catch (_) {}

        if (remaining === 0) {
            throw new Error("Maximum attempts exceeded. This code is locked. Please request a new code.");
        }
        throw new Error(`Invalid verification code. ${remaining} attempt(s) remaining.`);
    }

    // Mark OTP as used
    record.is_used = true;
    record.verified_at = now;

    // Generate single-use Reset Token (valid for 15 minutes)
    const jti = crypto.randomBytes(16).toString("hex");
    const resetToken = jwt.sign(
        {
            userId: record.user_id,
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
             SET is_used = true, verified_at = NOW(), reset_token_hash = $1, reset_token_expires_at = $2 
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
 * 4. Reset Password
 */
async function resetPassword({ reset_token, new_password, confirm_password }) {
    if (!reset_token) {
        throw new Error("Reset authorization token is missing. Please verify OTP again.");
    }
    if (!new_password || !confirm_password) {
        throw new Error("Both new password and confirm password fields are required.");
    }
    if (new_password !== confirm_password) {
        throw new Error("Passwords do not match. Please verify and re-enter.");
    }
    if (new_password.length < 6) {
        throw new Error("Password must be at least 6 characters in length.");
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

    // Mark reset token used
    otpRecord.reset_token_used = true;
    saveOtpsToDisk(IN_MEMORY_RESET_OTPS);

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);
    const userId = decoded.userId;

    // 1. Update PostgreSQL
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

    // 2. Update JSON store
    try {
        if (fs.existsSync(USERS_FILE)) {
            let users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
            const idx = users.findIndex(u => u.id === userId);
            if (idx >= 0) {
                users[idx].password = hashedPassword;
                users[idx].updated_at = new Date().toISOString();
                fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
            }
        }
    } catch (_) {}

    return {
        success: true,
        message: "Your password has been reset successfully. Please sign in with your new password."
    };
}

module.exports = {
    findAccountByIdentifier,
    generateAndSendResetOtp,
    verifyResetOtp,
    resetPassword,
    maskEmail,
    maskPhone
};
