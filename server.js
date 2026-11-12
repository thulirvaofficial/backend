const express = require("express");
const http = require("http");
const path = require("path");
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


/* ============================================================
   FRONTEND & STATIC ASSETS (Common for Website, Admin & Mobile App)
============================================================ */

const websitePath = path.resolve(__dirname, "..", "website", "website");
const adminPath = path.resolve(__dirname, "..", "website", "admin");
const uploadsPath = path.resolve(websitePath, "assets", "images", "uploads");

// 1. Customer Website Frontend
app.use(express.static(websitePath));

// 2. Admin Panel Frontend
app.use("/admin", express.static(adminPath));

// 3. Common Static Assets & Uploads (shared with Mobile App and Web)
app.use("/assets", express.static(path.resolve(websitePath, "assets")));
app.use("/uploads", express.static(uploadsPath));
app.use("/admin/assets", express.static(path.resolve(adminPath, "assets")));
app.use("/admin/images", express.static(path.resolve(adminPath, "images")));


/* ============================================================
   API STATUS
============================================================ */

app.get(
    "/api",
    (req, res) => {

        res.json({

            project:
                "THULIRVA",

            message:
                "THULIRVA API is running",

            status:
                "online",

            version:
                "1.0.0"

        });

    }
);


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
