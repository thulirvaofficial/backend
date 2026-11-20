const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { pool } = require("../config/database");
const { sendNotification } = require("../services/notificationService");
const { validateEmail, validatePhone, validatePassword, validateName, validateAddress } = require("../utils/validators");
const { revokeToken } = require("../middleware/auth");
const emailService = require("../services/emailService");
const admin2FAService = require("../services/admin2FAService");

const router = express.Router();

const OTP_STORE = new Map(); // phone -> { code, expiresAt }

// Dual Rate Limiter for Login Attempts (Key + IP Protection)
const LOGIN_ATTEMPTS = new Map(); // key -> { count, lockUntil }
function checkLoginRateLimit(key, ip = "127.0.0.1") {
    const now = Date.now();
    const recKey = LOGIN_ATTEMPTS.get(key);
    const recIp = LOGIN_ATTEMPTS.get(`ip:${ip}`);
    const record = (recKey && recKey.lockUntil > now) ? recKey : (recIp && recIp.lockUntil > now ? recIp : null);
    if (record && record.lockUntil > now) {
        const remainingMinutes = Math.ceil((record.lockUntil - now) / 60000);
        return { allowed: false, message: `Too many failed login attempts. Please try again in ${remainingMinutes} minute(s).` };
    }
    return { allowed: true };
}
function recordFailedLogin(key, ip = "127.0.0.1") {
    const now = Date.now();
    [key, `ip:${ip}`].forEach(k => {
        const r = LOGIN_ATTEMPTS.get(k) || { count: 0 };
        r.count += 1;
        if (r.count >= 5) {
            r.lockUntil = now + (15 * 60 * 1000); // 15-minute security lockout
        }
        LOGIN_ATTEMPTS.set(k, r);
    });
}
function clearLoginAttempts(key, ip = "127.0.0.1") {
    LOGIN_ATTEMPTS.delete(key);
    LOGIN_ATTEMPTS.delete(`ip:${ip}`);
}

function extractUserId(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "thulirva_secret_key_2026");
            return decoded.id;
        } catch (_) {}
    }
    return req.body.id || req.body.userId || req.query.id || req.query.userId || null;
}

const { uploadUserProfilePhoto, USER_UPLOADS_DIR } = require("../middleware/uploadMiddleware");

// Disk-persisted user store for zero-downtime registration, login & profile sync
const DATA_DIR = path.resolve(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function loadUsersFromDisk() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (_) {}
    return [
        {
            id: 1,
            name: "THULIRVA Admin",
            email: "admin@thulirva.com",
            password: "$2a$10$YourHashedPasswordHere",
            phone: "7904880944",
            alternate_phone: "",
            address: "Chennai, Tamil Nadu",
            city: "Chennai",
            pincode: "600087",
            profile_photo: "",
            role: "admin",
            created_at: "2026-01-01T00:00:00.000Z"
        }
    ];
}

function saveUsersToDisk(users) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
    } catch (e) {
        console.warn("[USERS SAVE ERROR]:", e.message);
    }
}

const IN_MEMORY_USERS = loadUsersFromDisk();

/* ============================================================
   REGISTER ENDPOINT
============================================================ */
router.post("/register", async (req, res) => {
    try {
        const { name, email, password, phone, address } = req.body;

        const nameVal = validateName(name);
        if (!nameVal.valid) {
            return res.status(400).json({ success: false, message: nameVal.message });
        }

        const emailVal = validateEmail(email);
        if (!emailVal.valid) {
            return res.status(400).json({ success: false, message: emailVal.message });
        }

        const passVal = validatePassword(password);
        if (!passVal.valid) {
            return res.status(400).json({
                success: false,
                message: passVal.message,
                missingRequirements: passVal.missingRequirements
            });
        }

        let cleanPhone = "";
        if (phone) {
            const phoneVal = validatePhone(phone);
            if (!phoneVal.valid) {
                return res.status(400).json({ success: false, message: phoneVal.message });
            }
            cleanPhone = phoneVal.cleanPhone;
        }

        const cleanEmail = emailVal.cleanEmail;
        const cleanName = nameVal.cleanName;
        const cleanAddress = address ? address.trim() : "";

        // 1. Try PostgreSQL database first
        try {
            const existing = await pool.query("SELECT id FROM users WHERE LOWER(email)=$1", [cleanEmail]);
            if (existing.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Email is already registered"
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const result = await pool.query(
                `INSERT INTO users (name, email, password, phone, address, role)
                 VALUES ($1, $2, $3, $4, $5, 'customer')
                 RETURNING id, name, email, phone, address, role`,
                [cleanName, cleanEmail, hashedPassword, cleanPhone, cleanAddress]
            );

            const newUser = result.rows[0];
            const token = jwt.sign(
                { id: newUser.id, email: newUser.email, role: newUser.role },
                process.env.JWT_SECRET || "thulirva_secret_key_2026",
                { expiresIn: "30d" }
            );

            // Send instant signup alerts to Admin and welcome notification to Customer
            sendNotification({
                title: "New Customer Registered! 👤",
                message: `${cleanName} (${cleanPhone || cleanEmail}) just created an account with Thulirva.`,
                type: "new_customer",
                targetId: newUser.id,
                forAdmin: true
            }).catch(() => {});

            sendNotification({
                userId: newUser.id,
                title: "Welcome to Thulirva! 🌾",
                message: "We're happy to have you with us. Explore our farm fresh A2 milk, ghee, and groceries!",
                type: "welcome",
                targetId: newUser.id,
                forAdmin: false
            }).catch(() => {});

            // Dispatch Branded Welcome Email via Centralized Mail Server
            if (cleanEmail && cleanEmail.includes("@")) {
                emailService.sendWelcomeEmail({
                    to: cleanEmail,
                    name: cleanName,
                    role: "customer"
                }).catch(err => console.warn("[WELCOME EMAIL WARNING]:", err.message));
            }

            // Also update in-memory and disk fallback store
            let memIdx = IN_MEMORY_USERS.findIndex(u => u.email.toLowerCase() === cleanEmail);
            if (memIdx >= 0) {
                IN_MEMORY_USERS[memIdx] = { ...IN_MEMORY_USERS[memIdx], ...newUser };
            } else {
                IN_MEMORY_USERS.push({
                    id: newUser.id,
                    name: newUser.name,
                    email: newUser.email,
                    phone: newUser.phone,
                    alternate_phone: "",
                    address: newUser.address,
                    city: "Chennai",
                    pincode: "600087",
                    profile_photo: "",
                    role: newUser.role,
                    created_at: new Date().toISOString()
                });
            }
            saveUsersToDisk(IN_MEMORY_USERS);

            return res.json({
                success: true,
                message: "Registration successful",
                token,
                user: {
                    ...newUser,
                    alternate_phone: "",
                    city: "Chennai",
                    pincode: "600087",
                    profile_photo: ""
                }
            });
        } catch (dbErr) {
            console.warn("[AUTH] Database unavailable, using fallback in-memory store:", dbErr.message);

            // 2. Fallback in-memory store
            const existingMem = IN_MEMORY_USERS.find(u => u.email.toLowerCase() === cleanEmail);
            if (existingMem) {
                return res.status(400).json({
                    success: false,
                    message: "Email is already registered"
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const newMemUser = {
                id: IN_MEMORY_USERS.length + 100,
                name: cleanName,
                email: cleanEmail,
                password: hashedPassword,
                phone: cleanPhone,
                alternate_phone: "",
                address: cleanAddress,
                city: "Chennai",
                pincode: "600087",
                profile_photo: "",
                role: "customer",
                created_at: new Date().toISOString()
            };
            IN_MEMORY_USERS.push(newMemUser);
            saveUsersToDisk(IN_MEMORY_USERS);

            if (cleanEmail && cleanEmail.includes("@")) {
                emailService.sendWelcomeEmail({
                    to: cleanEmail,
                    name: cleanName,
                    role: "customer"
                }).catch(err => console.warn("[WELCOME EMAIL WARNING]:", err.message));
            }

            const token = jwt.sign(
                { id: newMemUser.id, email: newMemUser.email, role: newMemUser.role },
                process.env.JWT_SECRET || "thulirva_secret_key_2026",
                { expiresIn: "30d" }
            );

            return res.json({
                success: true,
                message: "Registration successful",
                token,
                user: {
                    id: newMemUser.id,
                    name: newMemUser.name,
                    email: newMemUser.email,
                    phone: newMemUser.phone,
                    alternate_phone: "",
                    address: newMemUser.address,
                    city: newMemUser.city,
                    pincode: newMemUser.pincode,
                    profile_photo: "",
                    role: newMemUser.role,
                    created_at: newMemUser.created_at
                }
            });
        }
    } catch (error) {
        console.error("[AUTH REGISTER ERROR]", error);
        res.status(500).json({
            success: false,
            message: "Registration failed: " + (error.message || "Unknown error")
        });
    }
});

/* ============================================================
   LOGIN ENDPOINT
============================================================ */
router.post("/login", async (req, res) => {
    try {
        const rawIdent = req.body.email || req.body.identifier || req.body.phone;
        const rawPassword = req.body.password;

        if (typeof rawIdent !== "string" || typeof rawPassword !== "string") {
            return res.status(400).json({
                success: false,
                message: "Email or phone number and password must be valid strings"
            });
        }

        const identifier = rawIdent.trim();
        const password = rawPassword;

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Email or phone number and password are required"
            });
        }

        const cleanIdentifier = identifier.toLowerCase();
        const phoneDigits = identifier.replace(/\D/g, "");
        const clientIp = req.ip || req.connection?.remoteAddress || "127.0.0.1";

        // Rate limit check (Key + IP Protection)
        const rateChk = checkLoginRateLimit(cleanIdentifier, clientIp);
        if (!rateChk.allowed) {
            return res.status(429).json({
                success: false,
                message: rateChk.message
            });
        }

        const isAdminLogin = req.body.admin_login === true || req.body.is_admin_portal === true;

        // 1. Try PostgreSQL database first
        try {
            let result;
            if (phoneDigits.length === 10) {
                result = await pool.query(
                    "SELECT * FROM users WHERE LOWER(email)=$1 OR phone=$1 OR REPLACE(phone, ' ', '')=$2", 
                    [cleanIdentifier, phoneDigits]
                );
            } else {
                result = await pool.query("SELECT * FROM users WHERE LOWER(email)=$1", [cleanIdentifier]);
            }

            if (result && result.rows.length > 0) {
                const user = result.rows[0];
                const valid = await bcrypt.compare(password, user.password);
                if (!valid) {
                    recordFailedLogin(cleanIdentifier, clientIp);
                    return res.status(401).json({
                        success: false,
                        message: "Invalid credentials"
                    });
                }

                const userRole = String(user.role || "customer").toLowerCase().trim();
                const isStaff = isAdminLogin || userRole === "admin" || userRole === "super_admin" || cleanIdentifier === "admin@thulirva.com";

                if (isAdminLogin && userRole !== "admin" && userRole !== "super_admin") {
                    return res.status(403).json({
                        success: false,
                        message: "Access Denied: Customer accounts are not authorized to sign in to the Administrative Console."
                    });
                }

                clearLoginAttempts(cleanIdentifier, clientIp);

                const userPayload = {
                    id: user.id,
                    name: user.name,
                    admin_name: user.name,
                    email: user.email,
                    phone: user.phone || "",
                    alternate_phone: user.alternate_phone || "",
                    address: user.address || "",
                    city: user.city || "Chennai",
                    pincode: user.pincode || "600087",
                    profile_photo: user.profile_photo || "",
                    role: user.role,
                    created_at: user.created_at || new Date().toISOString()
                };

                const adminPayload = (userRole === "admin" || userRole === "super_admin" || isStaff) ? {
                    id: user.id,
                    name: user.name || "Super Admin",
                    admin_name: user.name || "Super Admin",
                    email: user.email,
                    role: userRole === "super_admin" ? "Super Admin" : "Operations Admin",
                    raw_role: userRole,
                    profile_photo: user.profile_photo || ""
                } : null;

                // MANDATORY TWO-STEP VERIFICATION FOR EVERY ADMINISTRATIVE LOGIN
                if (isStaff) {
                    return await admin2FAService.initiate2FA(req, res, {
                        user,
                        role: userRole,
                        userPayload,
                        adminPayload
                    });
                }

                const token = jwt.sign(
                    { id: user.id, email: user.email, role: user.role },
                    process.env.JWT_SECRET || "thulirva_secret_key_2026",
                    { expiresIn: "30d" }
                );

                const resData = {
                    success: true,
                    token,
                    user: userPayload,
                    data: {
                        token,
                        user: userPayload
                    }
                };

                return res.json(resData);
            }
        } catch (dbErr) {
            console.warn("[AUTH] Database query error on login, checking fallback store:", dbErr.message);
        }

        // 2. Check in-memory store
        const currentUsers = loadUsersFromDisk();
        const memUser = currentUsers.find(u => 
            (u.email && u.email.toLowerCase() === cleanIdentifier) ||
            (u.phone && (u.phone === cleanIdentifier || (phoneDigits.length === 10 && u.phone.replace(/\D/g, "") === phoneDigits)))
        );
        if (memUser) {
            const valid = await bcrypt.compare(password, memUser.password);
            if (valid) {
                const memRole = String(memUser.role || "customer").toLowerCase().trim();
                const isMemStaff = isAdminLogin || memRole === "admin" || memRole === "super_admin" || cleanIdentifier === "admin@thulirva.com";

                if (isAdminLogin && memRole !== "admin" && memRole !== "super_admin") {
                    return res.status(403).json({
                        success: false,
                        message: "Access Denied: Customer accounts are not authorized to sign in to the Administrative Console."
                    });
                }

                clearLoginAttempts(cleanIdentifier, clientIp);

                const memUserPayload = {
                    id: memUser.id,
                    name: memUser.name,
                    admin_name: memUser.name,
                    email: memUser.email,
                    phone: memUser.phone || "",
                    alternate_phone: memUser.alternate_phone || "",
                    address: memUser.address || "",
                    city: memUser.city || "Chennai",
                    pincode: memUser.pincode || "600087",
                    profile_photo: memUser.profile_photo || "",
                    role: memUser.role,
                    created_at: memUser.created_at || new Date().toISOString()
                };

                const memAdminPayload = (memRole === "admin" || memRole === "super_admin" || isMemStaff) ? {
                    id: memUser.id,
                    name: memUser.name || "Super Admin",
                    admin_name: memUser.name || "Super Admin",
                    email: memUser.email,
                    role: memRole === "super_admin" ? "Super Admin" : "Operations Admin",
                    raw_role: memRole,
                    profile_photo: memUser.profile_photo || ""
                } : null;

                // MANDATORY TWO-STEP VERIFICATION FOR EVERY ADMINISTRATIVE LOGIN
                if (isMemStaff) {
                    return await admin2FAService.initiate2FA(req, res, {
                        user: memUser,
                        role: memRole,
                        userPayload: memUserPayload,
                        adminPayload: memAdminPayload
                    });
                }

                const token = jwt.sign(
                    { id: memUser.id, email: memUser.email, role: memUser.role },
                    process.env.JWT_SECRET || "thulirva_secret_key_2026",
                    { expiresIn: "30d" }
                );

                const memResData = {
                    success: true,
                    token,
                    user: memUserPayload,
                    data: {
                        token,
                        user: memUserPayload
                    }
                };

                return res.json(memResData);
            } else {
                recordFailedLogin(cleanIdentifier, clientIp);
                return res.status(401).json({
                    success: false,
                    message: "Invalid credentials"
                });
            }
        }

        recordFailedLogin(cleanIdentifier, clientIp);
        return res.status(401).json({
            success: false,
            message: "Invalid credentials"
        });
    } catch (error) {
        console.error("[AUTH LOGIN ERROR]", error);
        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});

/* ============================================================
   ADMIN TWO-STEP VERIFICATION (2FA) ENDPOINTS
============================================================ */

/**
 * POST /api/auth/verify-2fa & /api/auth/admin-verify-2fa
 * Validates 6-digit code and issues official Admin JWT session
 */
router.post(["/verify-2fa", "/admin-verify-2fa"], async (req, res) => {
    try {
        const { twoFactorToken, otp } = req.body;
        const result = await admin2FAService.verify2FA(twoFactorToken, otp);
        return res.status(result.status || (result.success ? 200 : 400)).json(result);
    } catch (err) {
        console.error("[ROUTE VERIFY 2FA ERROR]:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to verify two-step code."
        });
    }
});

/**
 * POST /api/auth/resend-2fa & /api/auth/admin-resend-2fa
 * Dispatches fresh code to admin@thulirva.com (enforces 30s cooldown)
 */
router.post(["/resend-2fa", "/admin-resend-2fa"], async (req, res) => {
    try {
        const { twoFactorToken } = req.body;
        const result = await admin2FAService.resend2FA(twoFactorToken, req);
        return res.status(result.status || (result.success ? 200 : 400)).json(result);
    } catch (err) {
        console.error("[ROUTE RESEND 2FA ERROR]:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to resend two-step code."
        });
    }
});

/* ============================================================
   LOGOUT ENDPOINT (Token Invalidation & Session Termination)
============================================================ */
router.post("/logout", (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            if (token) {
                revokeToken(token);
            }
        }
        return res.json({
            success: true,
            message: "Successfully logged out. Session terminated."
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Error terminating session"
        });
    }
});

/* ============================================================
   FORGOT PASSWORD & OTP RESET ENDPOINTS (MODULE 26)
============================================================ */
const passwordResetService = require("../services/passwordResetService");

// 1. Forgot Password -> Directly sends 6-digit OTP to registered email with generic response
router.post("/forgot-password", async (req, res) => {
    try {
        const identifier = (req.body.email || req.body.identifier || req.body.phone || "").trim();
        const reqIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";

        if (!identifier) {
            return res.status(400).json({
                success: false,
                message: "Please enter your registered email address."
            });
        }

        const result = await passwordResetService.generateAndSendResetOtp({
            identifier,
            method: "email",
            reqIp
        });

        res.json(result);
    } catch (err) {
        console.error("[FORGOT PASSWORD ERROR]", err);
        res.status(400).json({
            success: false,
            message: err.message || "Failed to process password reset request."
        });
    }
});

// 2. Dispatch / Send Reset OTP (Email)
router.post("/send-reset-otp", async (req, res) => {
    try {
        const identifier = (req.body.email || req.body.identifier || req.body.phone || "").trim();
        const reqIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";

        if (!identifier) {
            return res.status(400).json({
                success: false,
                message: "Please enter your registered email address."
            });
        }

        const result = await passwordResetService.generateAndSendResetOtp({
            identifier,
            method: "email",
            reqIp
        });

        res.json(result);
    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message || "Failed to send verification code."
        });
    }
});

// 3. Resend Reset OTP with 60-second cooldown
router.post("/resend-reset-otp", async (req, res) => {
    try {
        const identifier = (req.body.email || req.body.identifier || req.body.phone || "").trim();
        const reqIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";

        if (!identifier) {
            return res.status(400).json({
                success: false,
                message: "Please enter your registered email address."
            });
        }

        const result = await passwordResetService.generateAndSendResetOtp({
            identifier,
            method: "email",
            reqIp
        });

        res.json(result);
    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message || "Failed to resend verification code."
        });
    }
});

// 4. Verify Reset OTP -> Issues Single-Use Server-Side Reset Token
router.post("/verify-reset-otp", async (req, res) => {
    try {
        const identifier = (req.body.email || req.body.identifier || req.body.phone || "").trim();
        const otp = (req.body.otp || req.body.code || "").trim();
        const reqIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";

        const result = await passwordResetService.verifyResetOtp({
            identifier,
            otp,
            reqIp
        });

        res.json(result);
    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message || "Verification code validation failed."
        });
    }
});

// 5. Set New Password with Reset Token
router.post("/reset-password", async (req, res) => {
    try {
        const resetToken = req.body.reset_token || req.body.token || req.headers["x-reset-token"];
        const newPassword = req.body.new_password || req.body.password;
        const confirmPassword = req.body.confirm_password || req.body.confirmPassword;

        const result = await passwordResetService.resetPassword({
            reset_token: resetToken,
            new_password: newPassword,
            confirm_password: confirmPassword
        });

        res.json(result);
    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message || "Failed to reset password."
        });
    }
});

/* ============================================================
   GET PROFILE ENDPOINT (AUTHENTICATED CUSTOMER & BY ID)
============================================================ */
const getProfileHandler = async (req, res) => {
    try {
        const userId = extractUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }

        try {
            const result = await pool.query(
                `SELECT id, name, email, phone, alternate_phone, address, city, pincode, profile_photo, role, created_at
                 FROM users WHERE id = $1`,
                [userId]
            );
            if (result.rows.length > 0) {
                const u = result.rows[0];
                const userRole = String(u.role || "customer").toLowerCase().trim();
                const isAdmin = userRole === "admin" || userRole === "super_admin";

                const responseData = {
                    success: true,
                    user: u,
                    data: { user: u }
                };

                if (isAdmin) {
                    const adminPayload = {
                        id: u.id,
                        name: u.name || "Super Admin",
                        admin_name: u.name || "Super Admin",
                        email: u.email || "admin@thulirva.com",
                        role: userRole === "super_admin" ? "Super Admin" : "Operations Admin",
                        raw_role: userRole,
                        profile_photo: u.profile_photo || ""
                    };
                    responseData.admin = adminPayload;
                    responseData.data.admin = adminPayload;
                }

                return res.json(responseData);
            }
        } catch (dbErr) {
            console.warn("[AUTH PROFILE GET DB ERROR]", dbErr.message);
        }

        const memUser = IN_MEMORY_USERS.find(u => u.id == userId);
        if (memUser) {
            const userRole = String(memUser.role || "customer").toLowerCase().trim();
            const isAdmin = userRole === "admin" || userRole === "super_admin";

            const userPayload = {
                id: memUser.id,
                name: memUser.name,
                admin_name: memUser.name || "Customer",
                email: memUser.email,
                phone: memUser.phone || "",
                alternate_phone: memUser.alternate_phone || "",
                address: memUser.address || "",
                city: memUser.city || "Chennai",
                pincode: memUser.pincode || "600087",
                profile_photo: memUser.profile_photo || "",
                role: userRole,
                created_at: memUser.created_at || new Date().toISOString()
            };

            const responseData = {
                success: true,
                user: userPayload,
                data: { user: userPayload }
            };

            if (isAdmin) {
                const adminPayload = {
                    id: memUser.id,
                    name: memUser.name || "Super Admin",
                    admin_name: memUser.name || "Super Admin",
                    email: memUser.email || "admin@thulirva.com",
                    role: userRole === "super_admin" ? "Super Admin" : "Operations Admin",
                    raw_role: userRole,
                    profile_photo: memUser.profile_photo || ""
                };
                responseData.admin = adminPayload;
                responseData.data.admin = adminPayload;
            }

            return res.json(responseData);
        }

        res.status(404).json({ success: false, message: "User profile not found" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const { authenticateToken, adminOnly } = require("../middleware/auth");

router.get("/profile", getProfileHandler);
router.get("/me", getProfileHandler);

// Dedicated Secure Admin Profile Endpoint (Admin & Super Admin ONLY)
router.get("/admin/profile", authenticateToken, adminOnly, async (req, res) => {
    try {
        const u = req.user;
        const userRole = String(u.role || "").toLowerCase().trim();
        const adminPayload = {
            id: u.id,
            name: u.name || "Super Admin",
            admin_name: u.name || "Super Admin",
            email: u.email || "admin@thulirva.com",
            role: userRole === "super_admin" ? "Super Admin" : "Operations Admin",
            raw_role: userRole,
            profile_photo: u.profile_photo || ""
        };
        return res.json({
            success: true,
            admin: adminPayload,
            user: adminPayload
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/profile/:id", async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query(
            `SELECT id, name, email, phone, alternate_phone, address, city, pincode, profile_photo, role, created_at
             FROM users WHERE id = $1 OR LOWER(email) = LOWER($2) OR phone = $2`,
            [isNaN(parseInt(id)) ? -1 : parseInt(id), id]
        );
        if (result.rows.length > 0) {
            return res.json({ success: true, user: result.rows[0] });
        }
    } catch (dbErr) {
        console.warn("[AUTH PROFILE GET BY ID DB ERROR]", dbErr.message);
    }

    const memUser = IN_MEMORY_USERS.find(u => u.id == id || u.email.toLowerCase() === id.toLowerCase() || u.phone === id);
    if (memUser) {
        return res.json({ success: true, user: memUser });
    }

    res.status(404).json({ success: false, message: "Customer profile not found" });
});

/* ============================================================
   UPDATE PROFILE ENDPOINT (NAME, EMAIL, PHONES, ADDRESS, PHOTO)
============================================================ */
router.put("/profile", async (req, res) => {
    try {
        const userId = extractUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }

        const {
            name,
            email,
            phone,
            alternate_phone,
            alternatePhone,
            address,
            city,
            pincode,
            profile_photo,
            profilePhoto
        } = req.body;

        const altPhone = alternate_phone !== undefined ? alternate_phone : alternatePhone;
        const photo = profile_photo !== undefined ? profile_photo : profilePhoto;

        let updatedUser = null;

        try {
            const result = await pool.query(
                `UPDATE users SET
                    name = COALESCE($1, name),
                    email = COALESCE($2, email),
                    phone = COALESCE($3, phone),
                    alternate_phone = COALESCE($4, alternate_phone),
                    address = COALESCE($5, address),
                    city = COALESCE($6, city),
                    pincode = COALESCE($7, pincode),
                    profile_photo = COALESCE($8, profile_photo),
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = $9
                 RETURNING id, name, email, phone, alternate_phone, address, city, pincode, profile_photo, role, created_at`,
                [
                    name || null,
                    email || null,
                    phone || null,
                    altPhone !== undefined ? altPhone : null,
                    address || null,
                    city || null,
                    pincode || null,
                    photo !== undefined ? photo : null,
                    userId
                ]
            );
            if (result.rows.length > 0) {
                updatedUser = result.rows[0];
            }
        } catch (dbErr) {
            console.warn("[AUTH UPDATE PROFILE DB ERROR]", dbErr.message);
            try {
                const resFallback = await pool.query(
                    `UPDATE users SET
                        name = COALESCE($1, name),
                        email = COALESCE($2, email),
                        phone = COALESCE($3, phone),
                        address = COALESCE($4, address)
                     WHERE id = $5
                     RETURNING id, name, email, phone, address, role, created_at`,
                    [name || null, email || null, phone || null, address || null, userId]
                );
                if (resFallback.rows.length > 0) {
                    updatedUser = resFallback.rows[0];
                }
            } catch (fbErr) {
                console.error("[AUTH FALLBACK PROFILE DB ERROR]", fbErr.message);
            }
        }

        const memUser = IN_MEMORY_USERS.find(u => u.id == userId);
        if (memUser) {
            if (name) memUser.name = name;
            if (email) memUser.email = email;
            if (phone) memUser.phone = phone;
            if (altPhone !== undefined) memUser.alternate_phone = altPhone;
            if (address) memUser.address = address;
            if (city) memUser.city = city;
            if (pincode) memUser.pincode = pincode;
            if (photo !== undefined) memUser.profile_photo = photo;
            if (!updatedUser) updatedUser = memUser;
        }

        if (!updatedUser) {
            updatedUser = {
                id: userId,
                name: name || "Customer",
                email: email || "",
                phone: phone || "",
                alternate_phone: altPhone || "",
                address: address || "",
                city: city || "Chennai",
                pincode: pincode || "600087",
                profile_photo: photo || "",
                role: "customer"
            };
            IN_MEMORY_USERS.push(updatedUser);
        }

        saveUsersToDisk(IN_MEMORY_USERS);

        res.json({
            success: true,
            message: "Profile updated successfully",
            user: updatedUser
        });
    } catch (err) {
        console.error("[AUTH PROFILE UPDATE ERROR]", err);
        res.status(500).json({ success: false, message: "Profile update failed: " + err.message });
    }
});

/* ============================================================
   PROFILE PHOTO UPLOAD ENDPOINT
============================================================ */
router.post("/profile/photo", uploadUserProfilePhoto, async (req, res) => {
    try {
        const userId = extractUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }

        const profilesDir = USER_UPLOADS_DIR;
        if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });

        let filename = "";
        let photoUrl = "";
        let fileBuffer = null;

        if (req.file) {
            filename = req.file.filename;
            const fullFilePath = req.file.path || path.join(profilesDir, filename);
            if (fs.existsSync(fullFilePath)) {
                fileBuffer = fs.readFileSync(fullFilePath);
            }
            photoUrl = `/uploads/profiles/${filename}`;
        } else {
            const rawData = req.body.photo || req.body.image || req.body.file || req.body.profile_photo;
            if (!rawData || typeof rawData !== "string") {
                return res.status(400).json({ success: false, message: "Image file or base64 data is required." });
            }

            let ext = "jpg";
            const matches = rawData.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches) {
                ext = matches[1].toLowerCase() === "jpeg" ? "jpg" : matches[1].toLowerCase();
                fileBuffer = Buffer.from(matches[2], "base64");
            } else {
                fileBuffer = Buffer.from(rawData, "base64");
            }

            if (!fileBuffer || fileBuffer.length < 50) {
                return res.status(400).json({ success: false, message: "Invalid image data." });
            }

            filename = `profile_${userId}_${Date.now()}.${ext}`;
            const filePath = path.join(profilesDir, filename);
            fs.writeFileSync(filePath, fileBuffer);
            photoUrl = `/uploads/profiles/${filename}`;
        }

        // Mirror to secondary directories so all static routes serve it
        const mirrorDirs = [
            path.resolve(__dirname, "..", "assets", "images", "uploads", "profiles"),
            path.resolve(__dirname, "..", "assets", "images", "uploads"),
            path.resolve(__dirname, "..", "..", "website", "website", "assets", "images", "uploads", "profiles"),
            path.resolve(__dirname, "..", "..", "website", "website", "assets", "images", "uploads")
        ];
        mirrorDirs.forEach(dir => {
            if (!fs.existsSync(dir)) try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
            try {
                const src = path.join(profilesDir, filename);
                if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, filename));
            } catch (_) {}
        });

        // 1. Update PostgreSQL database
        const versionedUrl = photoUrl.includes("?v=") ? photoUrl : `${photoUrl}?v=${Date.now()}`;
        try {
            await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT;");
            await pool.query(
                "UPDATE users SET profile_photo = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [versionedUrl, userId]
            );
        } catch (_) {}

        // 2. Update In-memory and disk fallback store
        let userObj = IN_MEMORY_USERS.find(u => u.id == userId);
        if (userObj) {
            userObj.profile_photo = versionedUrl;
            userObj.updated_at = new Date().toISOString();
        } else {
            userObj = {
                id: userId,
                name: "Customer",
                email: "",
                phone: "",
                profile_photo: versionedUrl,
                role: "customer"
            };
            IN_MEMORY_USERS.push(userObj);
        }
        saveUsersToDisk(IN_MEMORY_USERS);

        res.json({
            success: true,
            message: "Profile photo uploaded successfully",
            profile_photo: versionedUrl,
            photoUrl: versionedUrl,
            url: versionedUrl,
            full_url: versionedUrl,
            user: userObj
        });
    } catch (err) {
        console.error("[PHOTO UPLOAD ERROR]", err);
        res.status(500).json({ success: false, message: "Failed to upload photo: " + err.message });
    }
});

/* ============================================================
   DELETE PROFILE PHOTO ENDPOINT
============================================================ */
router.delete("/profile/photo", async (req, res) => {
    try {
        const userId = extractUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }

        try {
            await pool.query("UPDATE users SET profile_photo = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [userId]);
        } catch (_) {}

        const userObj = IN_MEMORY_USERS.find(u => u.id == userId);
        if (userObj) {
            userObj.profile_photo = "";
            saveUsersToDisk(IN_MEMORY_USERS);
        }

        res.json({ success: true, message: "Profile photo removed successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ============================================================
   CENTRALIZED OTP VERIFICATION (EMAIL & PHONE)
============================================================ */
router.post("/send-otp", async (req, res) => {
    try {
        const rawTarget = req.body.email || req.body.phone || req.body.identifier;
        if (!rawTarget || typeof rawTarget !== "string") {
            return res.status(400).json({ success: false, message: "Valid email address or phone number is required" });
        }

        const isEmail = rawTarget.includes("@");
        const cleanKey = isEmail ? rawTarget.trim().toLowerCase() : rawTarget.replace(/\D/g, "");

        if (!cleanKey) {
            return res.status(400).json({ success: false, message: "Invalid target destination for OTP" });
        }

        // Generate cryptographically random 6-digit OTP
        const code = crypto.randomInt(100000, 999999).toString();
        const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes

        OTP_STORE.set(cleanKey, {
            code,
            expiresAt,
            attempts: 0
        });

        if (isEmail) {
            await emailService.sendOtpEmail({
                to: cleanKey,
                name: req.body.name || "Customer",
                otp: code,
                purpose: req.body.purpose || "Verification",
                expiryMinutes: 5
            });
            console.log(`✉ [OTP EMAIL DISPATCH] Sent OTP to ${cleanKey}`);
        } else {
            console.log(`📱 [OTP SMS DISPATCH] Generated OTP for phone ${cleanKey}`);
        }

        // Strictly do NOT return the plaintext OTP in the response
        return res.json({
            success: true,
            message: `Verification code sent successfully to ${isEmail ? cleanKey : "phone"}. Valid for 5 minutes.`
        });
    } catch (err) {
        console.error("[SEND OTP ERROR]", err);
        return res.status(500).json({
            success: false,
            message: "Failed to dispatch verification code: " + (err.message || "Unknown error")
        });
    }
});

router.post("/verify-otp", async (req, res) => {
    try {
        const rawTarget = req.body.email || req.body.phone || req.body.identifier;
        const otp = (req.body.otp || req.body.code || "").toString().trim();

        if (!rawTarget || !otp) {
            return res.status(400).json({ success: false, message: "Identifier and OTP code are required" });
        }

        const isEmail = rawTarget.includes("@");
        const cleanKey = isEmail ? rawTarget.trim().toLowerCase() : rawTarget.replace(/\D/g, "");
        const record = OTP_STORE.get(cleanKey);

        if (!record) {
            return res.status(400).json({
                success: false,
                verified: false,
                message: "No verification code found or code has expired. Please request a new one."
            });
        }

        if (Date.now() > record.expiresAt) {
            OTP_STORE.delete(cleanKey);
            return res.status(400).json({
                success: false,
                verified: false,
                message: "Verification code has expired. Please request a new code."
            });
        }

        record.attempts = (record.attempts || 0) + 1;
        if (record.attempts > 5) {
            OTP_STORE.delete(cleanKey);
            return res.status(429).json({
                success: false,
                verified: false,
                message: "Too many incorrect attempts. Please request a new code."
            });
        }

        // Secure string comparison (no hardcoded backdoors)
        if (record.code === otp) {
            OTP_STORE.delete(cleanKey);
            return res.json({
                success: true,
                verified: true,
                message: "Verification successful"
            });
        }

        return res.status(400).json({
            success: false,
            verified: false,
            message: "Invalid verification code. Please check and try again."
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Error verifying code: " + (err.message || "Unknown error")
        });
    }
});

module.exports = router;
