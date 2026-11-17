const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "THULIRVA_CHANGE_THIS_SECRET_KEY";

/**
 * Middleware: Verify Delivery Partner JWT Token
 */
function authenticatePartner(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, message: "Authentication required. Please sign in as Delivery Partner." });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== "delivery_partner" && decoded.role !== "admin") {
            return res.status(403).json({ success: false, message: "Access restricted to Delivery Partners." });
        }
        req.partner = decoded;
        next();
    } catch {
        return res.status(401).json({ success: false, message: "Session expired or invalid token. Please log in again." });
    }
}

module.exports = {
    authenticatePartner
};

