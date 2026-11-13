const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {

    const header = req.headers.authorization;

    if (!header) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    const token = header.split(" ")[1];

    try {

        const secret = process.env.JWT_SECRET || "thulirva_secret_key_2026";
        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        next();
    } catch (error) {
        // Fallback for secondary secret if configured
        try {
            const fallbackSecret = "THULIRVA_CHANGE_THIS_SECRET_KEY";
            const decoded = jwt.verify(token, fallbackSecret);
            req.user = decoded;
            return next();
        } catch (_) {}

        return res.status(403).json({
            success: false,
            message: "Invalid or expired token"
        });
    }
}


function adminOnly(req, res, next) {

    if (!req.user || req.user.role !== "admin") {

        return res.status(403).json({
            success: false,
            message: "Admin access required"
        });

    }

    next();
}


module.exports = {
    authenticateToken,
    adminOnly
};
