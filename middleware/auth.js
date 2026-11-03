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

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.user = decoded;

        next();

    } catch (error) {

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
