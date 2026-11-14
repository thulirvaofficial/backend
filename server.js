const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
require("dotenv").config();

const {
    initializeDatabase
} = require("./config/database");

const {
    initFirebaseAdmin
} = require("./services/firebaseAdmin");

const {
    initSocketServer
} = require("./services/socketService");

const authRoutes =
    require("./routes/auth");

const productRoutes =
    require("./routes/products");

const categoryRoutes =
    require("./routes/categories");

const orderRoutes =
    require("./routes/orders");

const adminRoutes =
    require("./routes/admin");

const subscriptionRoutes =
    require("./routes/subscriptions");

const locationRoutes =
    require("./routes/locations");

const couponRoutes =
    require("./routes/coupons");

const addressRoutes =
    require("./routes/addresses");

const {
    router: notificationRoutes,
    checkSubscriptionExpiryScheduler
} = require("./routes/notifications");

const settingsRoutes =
    require("./routes/settings");

const pickupRoutes =
    require("./routes/pickup");

const bannerRoutes =
    require("./routes/banners");

const offerRoutes =
    require("./routes/offers");

const deliveryRoutes =
    require("./routes/delivery");

const adminDeliveryRoutes =
    require("./routes/adminDelivery");

const serviceabilityRoutes =
    require("./routes/serviceability");

const v1Routes =
    require("./routes/v1");


const recipeRoutes =
    require("./routes/recipes");

const app = express();

const PORT =
    process.env.PORT || 5500;


/* ============================================================
   MIDDLEWARE
============================================================ */

app.use(cors());

app.use(express.json({ limit: "50mb" }));

app.use(
    express.urlencoded({
        limit: "50mb",
        extended: true
    })
);


/* ============================================================
   API ROUTES
============================================================ */

app.use(
    "/api/auth",
    authRoutes
);

app.use(
    "/api/products",
    productRoutes
);

app.use(
    "/api/admin/products",
    productRoutes
);

app.use(
    "/api/categories",
    categoryRoutes
);

app.use(
    "/api/orders",
    orderRoutes
);

app.use(
    "/api/admin",
    adminRoutes
);

app.use(
    "/api/subscriptions",
    subscriptionRoutes
);

app.use(
    "/api/locations",
    locationRoutes
);

app.use(
    "/api/coupons",
    couponRoutes
);

app.use(
    "/api/addresses",
    addressRoutes
);

app.use(
    "/api/customer/addresses",
    addressRoutes
);

app.use(
    "/api/notifications",
    notificationRoutes
);

app.use(
    "/api/settings",
    settingsRoutes
);

app.use(
    "/api/pickup",
    pickupRoutes
);

app.use(
    "/api/banners",
    bannerRoutes
);

app.use(
    "/api/recipes",
    recipeRoutes
);

app.use(
    "/api/offers",
    offerRoutes
);

app.use(
    "/api/delivery",
    deliveryRoutes
);

app.use(
    "/api/delivery-partner",
    deliveryRoutes
);

app.use(
    "/api/delivery-partners",
    deliveryRoutes
);

// Fallback & direct mounts for mobile app endpoints without /api prefix
app.use(
    "/delivery",
    deliveryRoutes
);

app.use(
    "/delivery-partner",
    deliveryRoutes
);

app.use(
    "/delivery-partners",
    deliveryRoutes
);

app.use(
    "/orders",
    orderRoutes
);

app.use(
    "/subscriptions",
    subscriptionRoutes
);

app.use(
    "/notifications",
    notificationRoutes
);

app.use(
    "/api/partners",
    require("./routes/v1/partners")
);

app.use(
    "/api/admin/delivery",
    adminDeliveryRoutes
);

app.use(
    "/api/admin/delivery-partners",
    adminDeliveryRoutes
);

app.use(
    "/api/serviceability",
    serviceabilityRoutes
);

app.use(
    "/api/serviceable-areas",
    serviceabilityRoutes
);

app.use(
    "/api/admin/serviceable-areas",
    serviceabilityRoutes
);

app.use(
    "/api/admin/serviceability",
    serviceabilityRoutes
);

/* ============================================================
   CENTRALIZED V1 API & HEALTH MONITORING
============================================================ */

app.use("/api/v1", v1Routes);
app.use("/api/health", require("./routes/v1/health"));
app.use("/api/earnings-v1", require("./routes/v1/earnings"));
app.use("/api/bank-accounts", require("./routes/v1/bankAccounts"));
app.use("/api/withdrawals", require("./routes/v1/withdrawals"));
app.use("/api/settlements", require("./routes/v1/settlements"));
app.use("/api/hubs", require("./routes/v1/hubs"));
app.use("/api/reports", require("./routes/v1/reports"));


/* ============================================================
   FRONTEND & STATIC ASSETS (Common for Website, Admin & Mobile App)
============================================================ */

const websitePath = path.resolve(__dirname, "..", "website", "website");
const adminPath = path.resolve(__dirname, "..", "website", "admin");
const websiteUploadsPath = path.resolve(websitePath, "assets", "images", "uploads");
const backendPublicUploadsPath = path.resolve(__dirname, "public", "uploads");
const backendAssetsUploadsPath = path.resolve(__dirname, "assets", "images", "uploads");

// Ensure upload directories exist
[
    backendPublicUploadsPath,
    path.join(backendPublicUploadsPath, "partners"),
    path.join(backendPublicUploadsPath, "delivery_proofs"),
    path.join(backendPublicUploadsPath, "attendance"),
    backendAssetsUploadsPath,
    websiteUploadsPath,
    path.join(websiteUploadsPath, "delivery_proofs"),
    path.join(websiteUploadsPath, "partners")
].forEach(dir => {
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
});

// 1. Customer Website Frontend
app.use(express.static(websitePath));

// 2. Admin Panel Frontend
app.use("/admin", express.static(adminPath));

// 3. Common Static Assets & Uploads (shared with Mobile App and Web)
app.use("/assets", express.static(path.resolve(websitePath, "assets")));
app.use("/assets/images/uploads", express.static(backendAssetsUploadsPath));
app.use("/assets/images/uploads", express.static(websiteUploadsPath));

// 4. Central Uploads routes (available at /uploads AND /api/uploads)
app.use("/uploads", express.static(backendPublicUploadsPath));
app.use("/uploads", express.static(websiteUploadsPath));
app.use("/uploads", express.static(backendAssetsUploadsPath));

app.use("/api/uploads", express.static(backendPublicUploadsPath));
app.use("/api/uploads", express.static(websiteUploadsPath));
app.use("/api/uploads", express.static(backendAssetsUploadsPath));

app.use("/admin/assets", express.static(path.resolve(adminPath, "assets")));
app.use("/admin/images", express.static(path.resolve(adminPath, "images")));
app.use("/admin/uploads", express.static(backendPublicUploadsPath));
app.use("/admin/uploads", express.static(websiteUploadsPath));

// 5. Fallback for missing images in upload routes (Never return HTML to Flutter image decoders!)
const TRANSPARENT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const missingImageFallback = (req, res, next) => {
    if (req.path && req.path.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) {
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "no-store, no-cache, must-revalidate");
        return res.status(404).send(TRANSPARENT_PNG);
    }
    next();
};

app.use("/uploads", missingImageFallback);
app.use("/api/uploads", missingImageFallback);
app.use("/assets/images/uploads", missingImageFallback);
app.use("/admin/uploads", missingImageFallback);


/* ============================================================
   API STATUS
============================================================ */

const apiStatusHandler = (req, res) => {
    res.json({
        project: "THULIRVA",
        message: "THULIRVA API is running",
        status: "online",
        version: "1.0.0",
        timestamp: new Date().toISOString()
    });
};

app.get("/api", apiStatusHandler);
app.get("/api/", apiStatusHandler);


/* ============================================================
   API 404 CATCH-ALL (Guarantees pure JSON, never HTML)
============================================================ */

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        error: "ENDPOINT_NOT_FOUND",
        message: `API endpoint ${req.method} ${req.originalUrl} was not found on this server.`,
        path: req.originalUrl,
        method: req.method
    });
});

/* ============================================================
   GLOBAL ERROR HANDLER FOR API (Always returns JSON)
============================================================ */

app.use((err, req, res, next) => {
    console.error("[API ERROR]", err);
    if (req.originalUrl && req.originalUrl.startsWith("/api")) {
        return res.status(err.status || 500).json({
            success: false,
            error: "INTERNAL_ERROR",
            message: err.message || "An unexpected internal server error occurred."
        });
    }
    next(err);
});


/* ============================================================
   HOME
============================================================ */

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                websitePath,
                "index.html"
            )
        );

    }
);


/* ============================================================
   SERVER START
============================================================ */

function startServer() {
    const server = http.createServer(app);
    initSocketServer(server);

    server.listen(
        PORT,
        () => {
            console.log("");
            console.log(
                "================================================="
            );
            console.log(
                "              THULIRVA E-COMMERCE"
            );
            console.log(
                "================================================="
            );
            console.log("");
            console.log(
                `Website : http://localhost:${PORT}`
            );
            console.log(
                `Admin   : http://localhost:${PORT}/admin`
            );
            console.log(
                `API     : http://localhost:${PORT}/api`
            );
            console.log("");
            console.log(
                "Server running with Socket.IO..."
            );
            console.log("");
        }
    );

    initFirebaseAdmin();
    initializeDatabase().catch(() => {});

    // Critical: Run subscription expiry scheduler and periodically recheck
    try {
        checkSubscriptionExpiryScheduler();
        setInterval(checkSubscriptionExpiryScheduler, 60 * 60 * 1000);
    } catch (err) {
        console.error("Error starting subscription expiry scheduler:", err);
    }

    // Keepalive event loop interval
    setInterval(() => {}, 60000);

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = app;
module.exports.startServer = startServer;
