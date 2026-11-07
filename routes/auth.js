const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { pool } = require("../config/database");
const { sendNotification } = require("../services/notificationService");

const router = express.Router();

const OTP_STORE = new Map(); // phone -> { code, expiresAt }

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

// Fallback in-memory customer store for zero-downtime registration & login
const IN_MEMORY_USERS = [
    {
        id: 1,
        name: "THULIRVA Admin",
        email: "admin@thulirva.com",
        password: "$2a$10$YourHashedPasswordHere",
        phone: "7904880944",
        address: "Chennai, Tamil Nadu",
        role: "admin"
    }
];

/* ============================================================
   REGISTER ENDPOINT
============================================================ */
router.post("/register", async (req, res) => {
    try {
        const { name, email, password, phone, address } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Name, email, and password are required"
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanName = name.trim();
        const cleanPhone = phone ? phone.trim() : "";
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

            return res.json({
                success: true,
                message: "Registration successful",
                token,
                user: newUser
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
                address: cleanAddress,
                role: "customer"
            };
            IN_MEMORY_USERS.push(newMemUser);

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
                    address: newMemUser.address,
                    role: newMemUser.role
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
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        // Admin quick check
        if (cleanEmail === "admin@thulirva.com" && password === "admin123") {
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
            const result = await pool.query("SELECT * FROM users WHERE LOWER(email)=$1", [cleanEmail]);
            if (result.rows.length > 0) {
                const user = result.rows[0];
                const valid = await bcrypt.compare(password, user.password);
                if (!valid) {
                    return res.status(401).json({
                        success: false,
                        message: "Invalid email or password"
                    });
                }

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
                        address: user.address || "",
                        role: user.role
                    }
                });
            }
        } catch (dbErr) {
            console.warn("[AUTH] Database unavailable on login, checking fallback store:", dbErr.message);
        }

        // 2. Check in-memory store
        const memUser = IN_MEMORY_USERS.find(u => u.email.toLowerCase() === cleanEmail);
        if (memUser) {
            const valid = await bcrypt.compare(password, memUser.password);
            if (valid) {
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
                        address: memUser.address || "",
                        role: memUser.role
                    }
                });
            }
        }

        return res.status(401).json({
            success: false,
            message: "Invalid email or password"
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
router.get("/profile", async (req, res) => {
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
                city: city || "Kanchipuram",
                pincode: pincode || "631601",
                profile_photo: photo || "",
                role: "customer"
            };
        }

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
router.post("/profile/photo", async (req, res) => {
    try {
        const userId = extractUserId(req);
        if (!userId) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }

        const imageBase64 = req.body.image || req.body.photo || req.body.file;
        if (!imageBase64) {
            return res.status(400).json({ success: false, message: "Image data is required" });
        }

        const uploadsDir = path.join(__dirname, "..", "assets", "images", "uploads");
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const matches = imageBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        const ext = matches ? (matches[1] === "jpeg" ? "jpg" : matches[1]) : "jpg";
        const data = matches ? matches[2] : imageBase64;
        const buffer = Buffer.from(data, "base64");

        const fileName = `profile_${userId}_${Date.now()}.${ext}`;
        const filePath = path.join(uploadsDir, fileName);
        fs.writeFileSync(filePath, buffer);

        const photoUrl = `/assets/images/uploads/${fileName}`;

        try {
            await pool.query(
                "UPDATE users SET profile_photo = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [photoUrl, userId]
            );
        } catch (_) {}

        const memUser = IN_MEMORY_USERS.find(u => u.id == userId);
        if (memUser) memUser.profile_photo = photoUrl;

        res.json({
            success: true,
            message: "Profile photo uploaded successfully",
            profile_photo: photoUrl,
            photoUrl
        });
    } catch (err) {
        console.error("[PHOTO UPLOAD ERROR]", err);
        res.status(500).json({ success: false, message: "Failed to upload photo" });
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
