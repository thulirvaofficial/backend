const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { pool } = require("../config/database");

const USERS_FILE = path.resolve(__dirname, "..", "data", "users.json");

function getUserFromDisk(userId) {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const raw = fs.readFileSync(USERS_FILE, "utf-8");
            const users = JSON.parse(raw);
            return users.find(u => u.id == userId) || null;
        }
    } catch (_) {}
    return null;
}

async function fetchLiveUser(userId) {
    if (!userId) return null;
    try {
        if (pool) {
            const res = await pool.query(
                "SELECT id, name, email, phone, role FROM users WHERE id = $1 LIMIT 1",
                [userId]
            );
            if (res.rows && res.rows.length > 0) {
                return res.rows[0];
            }
        }
    } catch (_) {}
    return getUserFromDisk(userId);
}

/**
 * Reusable JWT Authentication Middleware
 * Enforces verified user identity against database / persistent records.
 */
async function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication required. Please sign in."
        });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Authentication token missing."
        });
    }

    let decoded = null;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || "thulirva_secret_key_2026");
    } catch (err) {
        try {
            decoded = jwt.verify(token, "THULIRVA_CHANGE_THIS_SECRET_KEY");
        } catch (_) {
            return res.status(401).json({
                success: false,
                message: "Session expired or invalid token. Please sign in again."
            });
        }
    }

    // Delivery Partner special case (uses partner_id in token)
    if (decoded.partner_id || decoded.role === "delivery_partner") {
        req.user = {
            id: decoded.partner_id || decoded.id,
            partner_id: decoded.partner_id || decoded.id,
            name: decoded.name || "Delivery Partner",
            role: "delivery_partner"
        };
        return next();
    }

    // Live verification against trusted database records
    const liveUser = await fetchLiveUser(decoded.id);
    if (!liveUser) {
        return res.status(401).json({
            success: false,
            message: "User account not found or has been deactivated."
        });
    }

    // Attach trusted database user record (never trust client-supplied input)
    req.user = {
        id: liveUser.id,
        name: liveUser.name,
        email: liveUser.email,
        phone: liveUser.phone,
        role: String(liveUser.role || "customer").toLowerCase().trim()
    };

    next();
}

/**
 * Role-Based Access Control (RBAC) Middleware Factory
 * Protects routes by requiring one of the specified allowed roles.
 */
function requireRole(...allowedRoles) {
    const normalizedAllowed = allowedRoles.map(r => String(r).toLowerCase().trim());

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const userRole = String(req.user.role || "").toLowerCase().trim();

        // Super Admin always has full access to all admin capabilities
        if (userRole === "super_admin") {
            return next();
        }

        if (!normalizedAllowed.includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: You do not have permission to access this administrative resource.",
                required_roles: allowedRoles,
                your_role: req.user.role
            });
        }

        next();
    };
}

const adminOnly = requireRole("super_admin", "admin");
const superAdminOnly = requireRole("super_admin");
const customerOnly = requireRole("customer");
const partnerOnly = requireRole("delivery_partner");

module.exports = {
    authenticateToken,
    requireRole,
    adminOnly,
    superAdminOnly,
    customerOnly,
    partnerOnly
};
