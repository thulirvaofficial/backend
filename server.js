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

const businessConfigRoutes =
    require("./routes/businessConfig");

const announcementRoutes =
    require("./routes/announcements");

const { supportRouter, adminSupportRouter } =
    require("./routes/support");

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
   API ROUTES & STRICT RBAC AUTHORIZATION GATES
============================================================ */

const { authenticateToken, adminOnly } = require("./middleware/auth");

// Strict Global RBAC Authorization Gate for All /api/admin Routes
app.use("/api/admin", (req, res, next) => {
    const p = req.path.toLowerCase();
    if (p === "/login" || p === "/auth/login") {
        return next();
    }
    return authenticateToken(req, res, () => {
        return adminOnly(req, res, next);
    });
});

// Strict Global RBAC Gate for /api/v1/admin
app.use("/api/v1/admin", (req, res, next) => {
    const p = req.path.toLowerCase();
    if (p === "/login" || p === "/auth/login") {
        return next();
    }
    return authenticateToken(req, res, () => {
        return adminOnly(req, res, next);
    });
});

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
    "/api/api/notifications",
    notificationRoutes
);

app.use(
    "/api/delivery/notifications",
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

app.use(
    "/api/config",
    businessConfigRoutes
);

app.use(
    "/api/admin/config",
    businessConfigRoutes
);

app.use(
    "/api/admin/payment-qr",
    businessConfigRoutes
);

app.use(
    "/api/announcements",
    announcementRoutes
);

app.use(
    "/api/admin/announcements",
    announcementRoutes
);

app.use(
    "/api/ratings",
    require("./routes/ratings")
);

app.use(
    "/ratings",
    require("./routes/ratings")
);

/* ============================================================
   CENTRALIZED V1 API & HEALTH MONITORING
============================================================ */

app.use("/api/v1", v1Routes);
app.use("/api/support", supportRouter);
app.use("/api/admin/support", adminSupportRouter);
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
    path.join(backendPublicUploadsPath, "profiles"),
    path.join(backendPublicUploadsPath, "payments"),
    path.join(backendPublicUploadsPath, "announcements"),
    path.join(backendPublicUploadsPath, "support"),
    backendAssetsUploadsPath,
    path.join(backendAssetsUploadsPath, "profiles"),
    websiteUploadsPath,
    path.join(websiteUploadsPath, "delivery_proofs"),
    path.join(websiteUploadsPath, "partners"),
    path.join(websiteUploadsPath, "profiles")
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
const staticUploadOptions = {
    setHeaders: (res) => {
        res.set("Cache-Control", "no-cache, must-revalidate");
        res.set("Pragma", "no-cache");
    }
};

app.use("/assets", express.static(path.resolve(websitePath, "assets")));
app.use("/assets/images/uploads", express.static(backendAssetsUploadsPath, staticUploadOptions));
app.use("/assets/images/uploads", express.static(websiteUploadsPath, staticUploadOptions));

// 4. Central Uploads routes (available at /uploads AND /api/uploads)
app.use("/uploads", express.static(backendPublicUploadsPath, staticUploadOptions));
app.use("/uploads", express.static(websiteUploadsPath, staticUploadOptions));
app.use("/uploads", express.static(backendAssetsUploadsPath, staticUploadOptions));

app.use("/api/uploads", express.static(backendPublicUploadsPath, staticUploadOptions));
app.use("/api/uploads", express.static(websiteUploadsPath, staticUploadOptions));
app.use("/api/uploads", express.static(backendAssetsUploadsPath, staticUploadOptions));

app.use("/admin/assets", express.static(path.resolve(adminPath, "assets")));
app.use("/admin/images", express.static(path.resolve(adminPath, "images")));
app.use("/admin/uploads", express.static(backendPublicUploadsPath, staticUploadOptions));
app.use("/admin/uploads", express.static(websiteUploadsPath, staticUploadOptions));

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

/* ============================================================
   SEO: SITEMAP & ROBOTS.TXT (DYNAMIC & AUTO-UPDATING)
============================================================ */
app.get("/sitemap.xml", async (req, res) => {
    try {
        const today = new Date().toISOString().split("T")[0];
        let products = [];
        try {
            const prodRes = await pool.query("SELECT id, name, category, image, updated_at FROM products WHERE is_active = true");
            if (prodRes.rows && prodRes.rows.length > 0) products = prodRes.rows;
        } catch (_) {}

        if (products.length === 0) {
            const prodFile = path.resolve(__dirname, "data", "products.json");
            if (fs.existsSync(prodFile)) {
                products = JSON.parse(fs.readFileSync(prodFile, "utf-8"));
            }
        }

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

        const corePages = [
            { path: "/", prio: "1.0", freq: "daily" },
            { path: "/pages/shop.html", prio: "0.9", freq: "daily" },
            { path: "/pages/subscriptions.html", prio: "0.9", freq: "daily" },
            { path: "/pages/farms.html", prio: "0.8", freq: "weekly" },
            { path: "/pages/recipes.html", prio: "0.8", freq: "weekly" },
            { path: "/pages/about.html", prio: "0.7", freq: "monthly" },
            { path: "/pages/contact.html", prio: "0.7", freq: "monthly" }
        ];

        for (const p of corePages) {
            xml += `  <url>\n    <loc>https://thulirva.com${p.path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.freq}</changefreq>\n    <priority>${p.prio}</priority>\n  </url>\n`;
        }

        const categories = ["Milk", "Curd", "Paneer", "Ghee", "Oils", "Masalas", "Vegan"];
        for (const cat of categories) {
            xml += `  <url>\n    <loc>https://thulirva.com/pages/shop.html?category=${encodeURIComponent(cat)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
        }

        for (const p of products) {
            const lastMod = p.updated_at ? new Date(p.updated_at).toISOString().split("T")[0] : today;
            xml += `  <url>\n    <loc>https://thulirva.com/pages/product.html?id=${p.id}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n`;
            if (p.image) {
                const imgUrl = p.image.startsWith("http") ? p.image : `https://thulirva.com/${p.image.replace(/^\/+/, "")}`;
                const safeName = (p.name || "Product").replace(/&/g, "&amp;");
                xml += `    <image:image>\n      <image:loc>${imgUrl}</image:loc>\n      <image:title>${safeName} | THULIRVA</image:title>\n    </image:image>\n`;
            }
            xml += `  </url>\n`;
        }

        xml += '</urlset>';
        res.header("Content-Type", "application/xml; charset=utf-8");
        return res.send(xml);
    } catch (err) {
        const staticFile = path.resolve(__dirname, "..", "website", "website", "sitemap.xml");
        if (fs.existsSync(staticFile)) {
            res.header("Content-Type", "application/xml; charset=utf-8");
            return res.sendFile(staticFile);
        }
        res.status(500).send("Error generating sitemap");
    }
});

app.get("/robots.txt", (req, res) => {
    res.header("Content-Type", "text/plain");
    const robotsFile = path.resolve(__dirname, "..", "website", "website", "robots.txt");
    if (fs.existsSync(robotsFile)) {
        return res.sendFile(robotsFile);
    }
    const publicRobots = path.join(__dirname, "public", "robots.txt");
    if (fs.existsSync(publicRobots)) {
        return res.sendFile(publicRobots);
    }
    res.status(404).send("Robots not found");
});

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
