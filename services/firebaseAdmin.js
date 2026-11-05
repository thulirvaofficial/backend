const admin = require("firebase-admin");
const { initializeApp, getApps, getApp, cert, applicationDefault } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const fs = require("fs");
const path = require("path");

// Backwards-compatibility shims on the legacy `admin` namespace for third-party or legacy references
if (!admin.apps) {
    Object.defineProperty(admin, "apps", {
        get() {
            return getApps();
        },
        configurable: true,
        enumerable: true
    });
}

if (!admin.credential) {
    admin.credential = {
        cert,
        applicationDefault
    };
}

if (!admin.messaging) {
    admin.messaging = function (app) {
        return app ? getMessaging(app) : getMessaging();
    };
}

let appInstance = null;

/**
 * Initialize Firebase Admin SDK using supported modular APIs (Firebase Admin v14+).
 * Safe against duplicate initialization and handles missing credentials gracefully.
 */
function initFirebaseAdmin() {
    const existingApps = getApps();
    if (existingApps.length > 0) {
        appInstance = existingApps[0];
        return appInstance;
    }

    try {
        const customPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        const defaultPath = path.join(__dirname, "..", "config", "firebase-service-account.json");

        let serviceAccount = null;

        if (customPath && fs.existsSync(customPath)) {
            try {
                serviceAccount = JSON.parse(fs.readFileSync(customPath, "utf8"));
                console.log("[FIREBASE ADMIN] Loaded service account file from custom path:", customPath);
            } catch (readErr) {
                console.warn("⚠️ [FIREBASE ADMIN] Failed parsing service account at customPath:", readErr.message);
            }
        } else if (customPath && customPath.trim().startsWith("{")) {
            try {
                serviceAccount = JSON.parse(customPath);
                console.log("[FIREBASE ADMIN] Loaded service account from environment JSON string");
            } catch (parseErr) {
                console.warn("⚠️ [FIREBASE ADMIN] Failed parsing service account from environment JSON:", parseErr.message);
            }
        } else if (fs.existsSync(defaultPath)) {
            try {
                serviceAccount = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
                console.log("[FIREBASE ADMIN] Loaded service account from default config path:", defaultPath);
            } catch (defaultReadErr) {
                console.warn("⚠️ [FIREBASE ADMIN] Failed parsing service account at defaultPath:", defaultReadErr.message);
            }
        }

        const projectId = process.env.FIREBASE_PROJECT_ID || (serviceAccount && serviceAccount.project_id) || "thulirva-e9697";

        if (serviceAccount && serviceAccount.private_key && serviceAccount.client_email) {
            appInstance = initializeApp({
                credential: cert(serviceAccount),
                projectId
            });
            console.log(`✓ [FIREBASE ADMIN] Initialized with Service Account for Project: ${projectId}`);
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            appInstance = initializeApp({
                credential: applicationDefault(),
                projectId
            });
            console.log(`✓ [FIREBASE ADMIN] Initialized with Google Application Default Credentials for Project: ${projectId}`);
        } else {
            // Initialize with project ID (works for environments using default metadata service or client messaging)
            appInstance = initializeApp({
                projectId
            });
            console.log(`✓ [FIREBASE ADMIN] Initialized with Project ID: ${projectId}`);
        }
    } catch (err) {
        console.warn("⚠️ [FIREBASE ADMIN] Failed to initialize Firebase Admin SDK:", err.message);
    }

    return appInstance;
}

/**
 * Returns a ready-to-use Messaging service instance, or null if initialization failed.
 */
function getMessagingSafe() {
    if (getApps().length === 0) {
        initFirebaseAdmin();
    }
    if (getApps().length === 0) {
        return null;
    }
    try {
        return getMessaging();
    } catch (err) {
        console.warn("⚠️ [FIREBASE ADMIN] Failed getting messaging service:", err.message);
        return null;
    }
}

module.exports = {
    initFirebaseAdmin,
    admin,
    initializeApp,
    getApps,
    getApp,
    cert,
    applicationDefault,
    getMessaging: getMessagingSafe,
    get isInitialized() {
        return getApps().length > 0;
    }
};
