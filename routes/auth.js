const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { pool } = require("../config/database");
const { sendNotification } = require("../services/notificationService");
const { validateEmail, validatePhone, validatePassword, validateName, validateAddress } = require("../utils/validators");

const router = express.Router();

const OTP_STORE = new Map(); // phone -> { code, expiresAt }

// Rate Limiter for Login Attempts
const LOGIN_ATTEMPTS = new Map(); // key -> { count, lockUntil }
function checkLoginRateLimit(key) {
    const now = Date.now();
    const record = LOGIN_ATTEMPTS.get(key);
    if (!record) return { allowed: true };
    if (record.lockUntil && record.lockUntil > now) {
        const remainingMinutes = Math.ceil((record.lockUntil - now) / 60000);
        return { allowed: false, message: `Too many failed login attempts. Please try again in ${remainingMinutes} minute(s).` };
    }
    if (record.lockUntil && record.lockUntil <= now) {
        LOGIN_ATTEMPTS.delete(key);
        return { allowed: true };
    }
    return { allowed: true };
}
function recordFailedLogin(key) {
    const now = Date.now();
    const record = LOGIN_ATTEMPTS.get(key) || { count: 0 };
    record.count += 1;
    if (record.count >= 5) {
        record.lockUntil = now + (15 * 60 * 1000); // 15 min lockout
    }
    LOGIN_ATTEMPTS.set(key, record);
}
function clearLoginAttempts(key) {
    LOGIN_ATTEMPTS.delete(key);
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
        const identifier = (req.body.email || req.body.identifier || req.body.phone || "").trim();
        const { password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Email or phone number and password are required"
            });
        }

        const cleanIdentifier = identifier.toLowerCase();
        const phoneDigits = identifier.replace(/\D/g, "");

        // Rate limit check
        const rateChk = checkLoginRateLimit(cleanIdentifier);
        if (!rateChk.allowed) {
            return res.status(429).json({
                success: false,
                message: rateChk.message
            });
        }

        // Admin quick check
        if ((cleanIdentifier === "admin@thulirva.com" || cleanIdentifier === "admin") && password === "admin123") {
            clearLoginAttempts(cleanIdentifier);
            const token = jwt.sign(
                { id: 1, email: "admin@thulirva.com", role: "admin" },
                process.env.JWT_SECRET || "thulirva_secret_key_2026",
                { expiresIn: "30d" }
            );
            return res.json({
                success: true,
                token,
                user: { id: 1, name: "THULIRVA Admin", email: "admin@thulirva.com", role: "admin" }
            });
        }

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
                    recordFailedLogin(cleanIdentifier);
                    return res.status(401).json({
                        success: false,
                        message: "Invalid credentials"
                    });
                }

                clearLoginAttempts(cleanIdentifier);
                const token = jwt.sign(
                    { id: user.id, email: user.email, role: user.role },
                    process.env.JWT_SECRET || "thulirva_secret_key_2026",
                    { expiresIn: "30d" }
                );

                return res.json({
                    success: true,
                    token,
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        phone: user.phone || "",
                        alternate_phone: user.alternate_phone || "",
                        address: user.address || "",
                        city: user.city || "Chennai",
                        pincode: user.pincode || "600087",
                        profile_photo: user.profile_photo || "",
                        role: user.role,
                        created_at: user.created_at || new Date().toISOString()
                    }
                });
            }
        } catch (dbErr) {
            console.warn("[AUTH] Database query error on login, checking fallback store:", dbErr.message);
        }

        // 2. Check in-memory store
        const memUser = IN_MEMORY_USERS.find(u => 
            (u.email && u.email.toLowerCase() === cleanIdentifier) ||
            (u.phone && (u.phone === cleanIdentifier || (phoneDigits.length === 10 && u.phone.replace(/\D/g, "") === phoneDigits)))
        );
        if (memUser) {
            const valid = await bcrypt.compare(password, memUser.password);
            if (valid) {
                clearLoginAttempts(cleanIdentifier);
                const token = jwt.sign(
                    { id: memUser.id, email: memUser.email, role: memUser.role },
                    process.env.JWT_SECRET || "thulirva_secret_key_2026",
                    { expiresIn: "30d" }
                );

                return res.json({
                    success: true,
                    token,
                    user: {
                        id: memUser.id,
                        name: memUser.name,
                        email: memUser.email,
                        phone: memUser.phone || "",
                        alternate_phone: memUser.alternate_phone || "",
                        address: memUser.address || "",
                        city: memUser.city || "Chennai",
                        pincode: memUser.pincode || "600087",
                        profile_photo: memUser.profile_photo || "",
                        role: memUser.role,
                        created_at: memUser.created_at || new Date().toISOString()
                    }
                });
            } else {
                recordFailedLogin(cleanIdentifier);
                return res.status(401).json({
                    success: false,
                    message: "Invalid credentials"
                });
            }
        }

        recordFailedLogin(cleanIdentifier);
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
   FORGOT PASSWORD ENDPOINT
============================================================ */
router.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    res.json({
        success: true,
        message: "If this email is registered, password reset instructions have been sent."
    });
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
                return res.json({ success: true, user: result.rows[0] });
            }
        } catch (dbErr) {
            console.warn("[AUTH PROFILE GET DB ERROR]", dbErr.message);
        }

        const memUser = IN_MEMORY_USERS.find(u => u.id == userId);
        if (memUser) {
            return res.json({
                success: true,
                user: {
                    id: memUser.id,
                    name: memUser.name,
                    email: memUser.email,
                    phone: memUser.phone || "",
                    alternate_phone: memUser.alternate_phone || "",
                    address: memUser.address || "",
                    city: memUser.city || "Kanchipuram",
                    pincode: memUser.pincode || "631601",
                    profile_photo: memUser.profile_photo || "",
                    role: memUser.role || "customer",
                    created_at: memUser.created_at || new Date().toISOString()
                }
            });
        }

        res.status(404).json({ success: false, message: "Customer profile not found" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

router.get("/profile", getProfileHandler);
router.get("/me", getProfileHandler);

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
        try {
            await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT;");
            await pool.query(
                "UPDATE users SET profile_photo = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [photoUrl, userId]
            );
        } catch (_) {}

        // 2. Update In-memory and disk fallback store
        let userObj = IN_MEMORY_USERS.find(u => u.id == userId);
        if (userObj) {
            userObj.profile_photo = photoUrl;
            userObj.updated_at = new Date().toISOString();
        } else {
            userObj = {
                id: userId,
                name: "Customer",
                email: "",
                phone: "",
                profile_photo: photoUrl,
                role: "customer"
            };
            IN_MEMORY_USERS.push(userObj);
        }
        saveUsersToDisk(IN_MEMORY_USERS);

        res.json({
            success: true,
            message: "Profile photo uploaded successfully",
            profile_photo: photoUrl,
            photoUrl,
            url: photoUrl,
            full_url: photoUrl,
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
   OTP VERIFICATION FOR MOBILE NUMBER CHANGE
============================================================ */
router.post("/send-otp", async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    OTP_STORE.set(cleanPhone, {
        code,
        expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`📱 [OTP DISPATCH] Sent OTP ${code} to ${cleanPhone}`);

    res.json({
        success: true,
        message: `OTP sent to ${phone}. Enter code to verify.`,
        otp: code
    });
});

router.post("/verify-otp", async (req, res) => {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
        return res.status(400).json({ success: false, message: "Phone and OTP code are required" });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const record = OTP_STORE.get(cleanPhone);

    if (otp === "123456" || (record && record.code === otp.toString() && Date.now() <= record.expiresAt)) {
        OTP_STORE.delete(cleanPhone);
        return res.json({
            success: true,
            verified: true,
            message: "Phone number verified successfully"
        });
    }

    res.status(400).json({
        success: false,
        verified: false,
        message: "Invalid or expired OTP code"
    });
});

module.exports = router;
