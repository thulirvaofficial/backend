const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

let isInitialized = false;

function initFirebaseAdmin() {
    if (isInitialized || admin.apps.length > 0) {
        isInitialized = true;
        return admin;
    }

    try {
        const customPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        const defaultPath = path.join(__dirname, "..", "config", "firebase-service-account.json");

        let serviceAccount = null;

        if (customPath && fs.existsSync(customPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(customPath, "utf8"));
            console.log("[FIREBASE ADMIN] Loaded service account from custom path:", customPath);
        } else if (customPath && customPath.trim().startsWith("{")) {
            serviceAccount = JSON.parse(customPath);
            console.log("[FIREBASE ADMIN] Loaded service account from environment JSON string");
        } else if (fs.existsSync(defaultPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
            console.log("[FIREBASE ADMIN] Loaded service account from default config path:", defaultPath);
        }

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: serviceAccount.project_id || "thulirva-e9697"
            });
            isInitialized = true;
            console.log("✓ [FIREBASE ADMIN] Initialized with Service Account for Project:", serviceAccount.project_id || "thulirva-e9697");
        } else {
            // Initialize with project ID (works with Google Application Default Credentials or Spark)
            admin.initializeApp({
                projectId: process.env.FIREBASE_PROJECT_ID || "thulirva-e9697"
            });
            isInitialized = true;
            console.log("✓ [FIREBASE ADMIN] Initialized with Project ID: thulirva-e9697");
        }
    } catch (err) {
        console.warn("⚠️ [FIREBASE ADMIN] Failed to initialize Firebase Admin SDK:", err.message);
        isInitialized = false;
    }

    return admin;
}

module.exports = {
    initFirebaseAdmin,
    admin,
    get isInitialized() {
        return isInitialized || admin.apps.length > 0;
    }
};

