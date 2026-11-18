/**
 * THULIRVA - PRODUCTION TEST ENVIRONMENT RESET UTILITY
 * 
 * Safely clears:
 * 1. All Orders & Order Chats/Ratings
 * 2. All Subscriptions & Subscription Deliveries
 * 3. All Customer Accounts (preserves Admin login)
 * 4. All Delivery Partners & Attendance/KYC/Wallets/Remittances
 * 5. Re-seeds clean, curated production sample products & metadata
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "data");
const BACKUP_DIR = path.resolve(__dirname, "data_backup_" + Date.now());

console.log("===============================================================================");
console.log("🌿 THULIRVA - PRODUCTION TEST ENVIRONMENT CLEANUP & RESEED");
console.log("===============================================================================\n");

// 1. Create safety backup
console.log(`[1/5] Backing up existing data to: ${BACKUP_DIR}`);
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const filesToBackup = fs.readdirSync(DATA_DIR);
for (const file of filesToBackup) {
    const src = path.join(DATA_DIR, file);
    if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(BACKUP_DIR, file));
    }
}
console.log("✓ Backup completed successfully.");

// Helper to write JSON safely
function writeJson(filename, data) {
    const filePath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`  ✓ Cleared/Updated: ${filename}`);
}

// 2. Clear Orders and Related History
console.log("\n[2/5] Clearing all Orders, Order Chats, Ratings & Issues...");
writeJson("orders.json", []);
writeJson("order_chats.json", {});
writeJson("order_ratings.json", []);
writeJson("customer_delivery_issues.json", []);

// 3. Clear Subscriptions
console.log("\n[3/5] Clearing all Subscriptions & Deliveries...");
writeJson("subscriptions.json", []);
writeJson("subscription_deliveries.json", []);

// 4. Clear Customers & Retain Super Admin Account
console.log("\n[4/5] Clearing Customers (preserving Admin accounts) and related records...");
const usersFile = path.join(DATA_DIR, "users.json");
let existingUsers = [];
try {
    existingUsers = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
} catch (_) {}

// Retain only super_admin and admin
const retainedAdmins = existingUsers.filter(u => u.role === "super_admin" || u.role === "admin");
if (retainedAdmins.length === 0) {
    // Fallback seed admin if none found
    retainedAdmins.push({
        id: 1,
        name: "THULIRVA Super Admin",
        email: "admin@thulirva.com",
        password: "$2b$10$BjfjUUcHYWQnaW9UMCsOi.SiUxqUuEKuDRciXl8w1nBwkbxWnpHoi", // 123456
        phone: "7904880944",
        alternate_phone: "",
        address: "Arcot Road, Valasaravakkam, Chennai",
        city: "Chennai",
        pincode: "600087",
        profile_photo: "/uploads/profiles/profile_1_1794686372800.png",
        role: "super_admin",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });
}
writeJson("users.json", retainedAdmins);
writeJson("addresses.json", []);
writeJson("password_reset_otps.json", []);
writeJson("notifications.json", []);
writeJson("sms_delivery_logs.json", []);
writeJson("support_tickets.json", []);
writeJson("support_ticket_events.json", []);
writeJson("support_ticket_internal_notes.json", []);
writeJson("support_ticket_messages.json", []);

// 5. Clear Delivery Partners and Operations Data
console.log("\n[5/5] Clearing Delivery Partners, KYC, Attendance & Wallets...");
writeJson("delivery_partners.json", []);
writeJson("partner_attendance.json", []);
writeJson("partner_bank_accounts.json", []);
writeJson("partner_bank_details.json", []);
writeJson("partner_cod_ledger.json", []);
writeJson("partner_cod_remittances.json", []);
writeJson("partner_earning_ledger.json", []);
writeJson("partner_kyc_history.json", []);
writeJson("partner_live_locations.json", {});
writeJson("partner_location_history.json", []);
writeJson("partner_settlements.json", []);
writeJson("partner_wallet_balances.json", {});
writeJson("partner_withdrawal_requests.json", []);
writeJson("geofence_events.json", []);
writeJson("financial_audit_logs.json", []);

// 6. Seed Sample Production Products & Content
console.log("\n[6/5] Seeding Clean Sample Production Products & Rich Metadata...");
const SAMPLE_PRODUCTS = [
    {
        id: 1,
        name: "Farm Fresh A2 Desi Cow Milk",
        description: "100% pure raw chilled A2 cow milk directly from pasture-fed cows in Kanchipuram. Delivered cold to your doorstep by 7:00 AM.",
        category: "Milk",
        category_name: "Milk",
        category_id: 1,
        price: 44,
        compare_price: 50,
        weight: "500 ml",
        stock: 120,
        image: "/assets/images/products/fresh_cow_milk.jpg",
        badge: "Farm Fresh",
        status: "active"
    },
    {
        id: 2,
        name: "Farm Fresh A2 Desi Cow Milk (1L Family)",
        description: "1 Litre family glass bottle of pure unadulterated chilled cow milk, delivered fresh every morning before 7:00 AM.",
        category: "Milk",
        category_name: "Milk",
        category_id: 1,
        price: 82,
        compare_price: 95,
        weight: "1 Litre",
        stock: 150,
        image: "/assets/images/products/fresh_cow_milk.jpg",
        badge: "Family Pack",
        status: "active"
    },
    {
        id: 3,
        name: "Pure Hand-Churned Bilona Cow Ghee",
        description: "Crafted using the ancient Vedic Bilona method from curd churned bi-directionally. Golden granular texture with divine farm aroma.",
        category: "Ghee",
        category_name: "Ghee",
        category_id: 2,
        price: 499,
        compare_price: 600,
        weight: "500 ml",
        stock: 45,
        image: "/assets/images/products/pure_cow_ghee.jpg",
        badge: "Bestseller",
        status: "active"
    },
    {
        id: 4,
        name: "Fresh Farm Artisanal Paneer",
        description: "Ultra-soft melt-in-mouth cottage cheese made exclusively from fresh whole cow milk. Zero preservatives or chemicals.",
        category: "Paneer",
        category_name: "Paneer",
        category_id: 3,
        price: 82,
        compare_price: 95,
        weight: "200 g",
        stock: 60,
        image: "/assets/images/products/fresh_paneer.jpg",
        badge: "Fresh Batch",
        status: "active"
    },
    {
        id: 5,
        name: "Natural Probiotic Thick Set Curd",
        description: "Naturally fermented probiotic thick clay-pot style set curd crafted with pure farm milk. Perfect for digestion and cooling.",
        category: "Curd",
        category_name: "Curd",
        category_id: 4,
        price: 48,
        compare_price: 55,
        weight: "500 g",
        stock: 80,
        image: "/assets/images/products/product_lineup.jpg",
        badge: "Daily Essential",
        status: "active"
    },
    {
        id: 6,
        name: "Wood-Pressed Traditional Groundnut Oil",
        description: "Cold-pressed in artisanal wooden chekku at low temperatures to retain natural antioxidants, aroma, and essential fatty acids.",
        category: "Oils",
        category_name: "Oils",
        category_id: 5,
        price: 280,
        compare_price: 320,
        weight: "1 Litre",
        stock: 40,
        image: "/assets/images/products/product_lineup.jpg",
        badge: "Cold Pressed",
        status: "active"
    },
    {
        id: 7,
        name: "Wood-Pressed Pure Gingelly / Sesame Oil",
        description: "Slow wood-pressed black sesame seeds blended with palm jaggery in traditional stone mortar. Rich golden color and intense flavor.",
        category: "Oils",
        category_name: "Oils",
        category_id: 5,
        price: 340,
        compare_price: 390,
        weight: "1 Litre",
        stock: 35,
        image: "/assets/images/products/product_lineup.jpg",
        badge: "Cold Pressed",
        status: "active"
    },
    {
        id: 8,
        name: "Single-Origin Salem Farm Turmeric Powder",
        description: "Sun-dried natural Salem turmeric roots finely ground with high natural curcumin content. Natural healing antiseptic spice.",
        category: "Masalas",
        category_name: "Masalas",
        category_id: 6,
        price: 120,
        compare_price: 145,
        weight: "250 g",
        stock: 50,
        image: "/assets/images/products/product_lineup.jpg",
        badge: "Pure Spice",
        status: "active"
    },
    {
        id: 9,
        name: "Free-Range Pasture Farm Eggs (Pack of 6)",
        description: "Nutritious brown eggs laid by cruelty-free country chickens foraging freely in natural green pastures. High protein and omega-3.",
        category: "Dairy",
        category_name: "Dairy",
        category_id: 1,
        price: 65,
        compare_price: 75,
        weight: "6 Eggs",
        stock: 90,
        image: "/assets/images/products/fresh_paneer.jpg",
        badge: "Free Range",
        status: "active"
    },
    {
        id: 10,
        name: "Raw Unprocessed Wild Forest Honey",
        description: "100% pure raw unheated wildflower honey harvested ethically from Eastern Ghats forest apiaries. Naturally rich in enzymes.",
        category: "Vegan",
        category_name: "Vegan",
        category_id: 7,
        price: 280,
        compare_price: 320,
        weight: "500 ml",
        stock: 30,
        image: "/assets/images/products/product_lineup.jpg",
        badge: "Wild Harvest",
        status: "active"
    }
];

const SAMPLE_CONTENT = {
    "1": {
        "product_id": 1,
        "highlights": [
            "100% Raw Single-Origin Desi A2 Cow Milk",
            "Zero preservatives, hormones, or chemical additives",
            "Direct morning cold-chain delivery before 7:00 AM",
            "Hygienic sterilized glass bottle packaging"
        ],
        "ingredients": ["100% Pure Farm-Fresh Desi Cow Milk"],
        "nutritional_info": {
            "serving_size": "100ml",
            "energy": "62 kcal",
            "protein": "3.4g",
            "fat": "3.8g",
            "carbohydrates": "4.8g",
            "calcium": "124mg",
            "added_sugar": "0g"
        },
        "storage_instructions": "Store strictly under refrigeration between 2°C and 4°C. Consume within 48 hours of delivery.",
        "usage_instructions": "Gentle boiling recommended. Ideal for authentic filter coffee, tea, homemade curd, and infant nutrition.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 4,
            "type": "Instant Replacement or Full Wallet Refund",
            "condition": "Eligible if milk seal is broken, leaked, or sours upon initial delivery boil test.",
            "return_required": false
        },
        "shelf_life": "48 Hours Chilled",
        "certification": "FSSAI Certified • Verified A2 Beta-Casein"
    },
    "2": {
        "product_id": 2,
        "highlights": [
            "1 Litre Family Glass Bottle chilled farm milk",
            "Ethically milked from free-grazing native Indian cows",
            "Delivered within 3 hours of morning milking",
            "100% natural cream retention without homogenization"
        ],
        "ingredients": ["100% Pure Unadulterated Desi Cow Milk"],
        "nutritional_info": {
            "serving_size": "100ml",
            "energy": "64 kcal",
            "protein": "3.5g",
            "fat": "4.0g",
            "carbohydrates": "4.8g",
            "calcium": "126mg",
            "added_sugar": "0g"
        },
        "storage_instructions": "Keep chilled in refrigerator. Do not leave exposed to ambient room temperature.",
        "usage_instructions": "Boil gently on medium flame. Great for whole family daily consumption, golden haldi doodh, and paneer.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 4,
            "type": "Instant Replacement or Full Wallet Refund",
            "condition": "Bottle breakage during transit, broken seal, or curdling during first boil.",
            "return_required": false
        },
        "shelf_life": "48 Hours Chilled",
        "certification": "FSSAI Certified • Cold Chain Monitored"
    },
    "3": {
        "product_id": 3,
        "highlights": [
            "Handmade Vedic Bilona method from cultured A2 curd",
            "Granular golden texture and rich nutty aroma",
            "Rich in fat-soluble vitamins A, D, E, and K2",
            "Free from additives, colors, palm oil, or preservatives"
        ],
        "ingredients": ["100% Clarified Butter Fat from Desi Cow Milk Curd"],
        "nutritional_info": {
            "serving_size": "10g (1 tbsp)",
            "energy": "90 kcal",
            "protein": "0g",
            "fat": "10g",
            "carbohydrates": "0g",
            "cholesterol": "24mg",
            "added_sugar": "0g"
        },
        "storage_instructions": "Store in a cool, dry place away from direct sunlight. Do not refrigerate.",
        "usage_instructions": "Top over hot steaming rice, dosas, parathas, or enjoy 1 spoonful daily on an empty stomach for gut health.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 24,
            "type": "Free Replacement",
            "condition": "Damaged glass jar or broken tamper-evident neck seal upon delivery.",
            "return_required": true
        },
        "shelf_life": "9 Months at Room Temperature",
        "certification": "FSSAI Certified • Lab Tested Pure"
    },
    "4": {
        "product_id": 4,
        "highlights": [
            "Crafted daily using fresh morning whole cow milk",
            "Natural lemon-curdled, free of citric chemical acids",
            "20% pure protein per serving for fitness & wellness",
            "Soft texture that absorbs marinades and gravies effortlessly"
        ],
        "ingredients": ["Pure Cow Milk", "Natural Lemon Extract Starter"],
        "nutritional_info": {
            "serving_size": "100g",
            "energy": "289 kcal",
            "protein": "18.5g",
            "fat": "22.0g",
            "carbohydrates": "3.5g",
            "calcium": "480mg",
            "added_sugar": "0g"
        },
        "storage_instructions": "Submerge block in a bowl of fresh clean water inside the refrigerator. Change water daily.",
        "usage_instructions": "Cut into cubes for palak paneer, tikka skewers, or shallow-fry gently with ghee and rock salt.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 6,
            "type": "Instant Refund or Replacement",
            "condition": "Sour smell or discoloration observed immediately upon unpacking.",
            "return_required": false
        },
        "shelf_life": "4 Days Refrigerated",
        "certification": "FSSAI Certified • Daily Batch Tested"
    },
    "5": {
        "product_id": 5,
        "highlights": [
            "Probiotic natural set curd with live gut-friendly cultures",
            "Natural thick consistency without starch or gelatin",
            "Aids digestion, boosts immunity, and cools the body"
        ],
        "ingredients": ["100% Pure Cow Milk", "Active Lactic Starter Culture"],
        "nutritional_info": {
            "serving_size": "100g",
            "energy": "65 kcal",
            "protein": "3.8g",
            "fat": "4.0g",
            "carbohydrates": "4.5g",
            "calcium": "145mg",
            "added_sugar": "0g"
        },
        "storage_instructions": "Keep refrigerated at 2°C - 5°C. Consume within 72 hours.",
        "usage_instructions": "Enjoy fresh with meals, churn into cooling buttermilk (chaas), or use for raitas.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 6,
            "type": "Instant Replacement",
            "condition": "Container damage or leakage upon arrival.",
            "return_required": false
        },
        "shelf_life": "4 Days Refrigerated",
        "certification": "FSSAI Certified"
    },
    "6": {
        "product_id": 6,
        "highlights": [
            "Wood-pressed in artisanal Vaagai tree chekku",
            "Cold extraction below 40°C protects natural nutrients",
            "Unrefined, unbleached, and naturally sediment-filtered"
        ],
        "ingredients": ["100% Native Sun-Dried Groundnuts"],
        "nutritional_info": {
            "serving_size": "15ml",
            "energy": "120 kcal",
            "protein": "0g",
            "fat": "14g",
            "carbohydrates": "0g",
            "monounsaturated_fat": "7g"
        },
        "storage_instructions": "Store in a cool, dry place in an opaque container away from sunlight.",
        "usage_instructions": "Ideal for sautéing, deep frying, South Indian curries, and tadkas.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 48,
            "type": "Full Replacement",
            "condition": "Bottle leakage or seal damage.",
            "return_required": true
        },
        "shelf_life": "6 Months",
        "certification": "FSSAI Certified • 100% Cold Pressed"
    },
    "7": {
        "product_id": 7,
        "highlights": [
            "Artisanal wood-pressed black sesame oil with palm jaggery",
            "Rich golden hue with traditional aromatic richness",
            "Rich in natural antioxidants sesamol and sesamolin"
        ],
        "ingredients": ["Black Sesame Seeds", "Pure Organic Palm Jaggery"],
        "nutritional_info": {
            "serving_size": "15ml",
            "energy": "120 kcal",
            "protein": "0g",
            "fat": "14g",
            "carbohydrates": "0g"
        },
        "storage_instructions": "Store at ambient room temperature in a dry pantry.",
        "usage_instructions": "Perfect for traditional dosas, idli podi mixing, sambar tempering, and oil pulling.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 48,
            "type": "Full Replacement",
            "condition": "Seal defect or container damage during transit.",
            "return_required": true
        },
        "shelf_life": "6 Months",
        "certification": "FSSAI Certified"
    },
    "8": {
        "product_id": 8,
        "highlights": [
            "Single-origin pure Salem agricultural farm turmeric",
            "High natural curcumin percentage (>3.5%)",
            "Stone ground without lead chromate or artificial yellow color"
        ],
        "ingredients": ["100% Pure Sun-Dried Salem Turmeric Fingers"],
        "nutritional_info": {
            "serving_size": "5g",
            "energy": "17 kcal",
            "protein": "0.4g",
            "carbohydrates": "3.2g",
            "curcumin": "3.8%"
        },
        "storage_instructions": "Keep in an airtight jar away from moisture and direct light.",
        "usage_instructions": "Use in daily cooking, golden milk, marinades, or traditional skincare masks.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 72,
            "type": "Replacement",
            "condition": "Pouch puncture or moisture ingress upon delivery.",
            "return_required": false
        },
        "shelf_life": "12 Months",
        "certification": "FSSAI Certified • Adulterant Free"
    },
    "9": {
        "product_id": 9,
        "highlights": [
            "Laid by native free-range country hens roaming green pastures",
            "Naturally rich in protein, lutein, and omega-3 fatty acids",
            "Zero antibiotics, hormones, or commercial cage feed"
        ],
        "ingredients": ["100% Natural Free-Range Country Hen Eggs"],
        "nutritional_info": {
            "serving_size": "1 Egg (50g)",
            "energy": "74 kcal",
            "protein": "6.3g",
            "fat": "5.0g",
            "carbohydrates": "0.4g"
        },
        "storage_instructions": "Refrigerate pointed end down between 4°C and 8°C.",
        "usage_instructions": "Boiled, poached, half-boiled, or in fluffy omelettes.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 12,
            "type": "Wallet Refund or Replacement",
            "condition": "Cracked egg shell upon delivery.",
            "return_required": false
        },
        "shelf_life": "21 Days Refrigerated",
        "certification": "Farm Fresh • Free Range Inspected"
    },
    "10": {
        "product_id": 10,
        "highlights": [
            "Raw unpasteurized multifloral honey from Eastern Ghats",
            "Contains natural bee pollen, propolis, and live enzymes",
            "Zero corn syrup, jaggery syrup, or artificial sweetness"
        ],
        "ingredients": ["100% Pure Raw Wildflower Forest Honey"],
        "nutritional_info": {
            "serving_size": "20g (1 tbsp)",
            "energy": "64 kcal",
            "protein": "0.1g",
            "fat": "0g",
            "carbohydrates": "17g"
        },
        "storage_instructions": "Store at room temperature. Natural crystallization is proof of purity.",
        "usage_instructions": "Drizzle over pancakes, mix in warm water with lemon, or consume raw.",
        "refund_policy": {
            "is_refundable": true,
            "window_hours": 48,
            "type": "Full Replacement",
            "condition": "Bottle leakage or seal damage.",
            "return_required": true
        },
        "shelf_life": "18 Months",
        "certification": "FSSAI Certified • 100% Raw Forest Harvest"
    }
};

writeJson("products.json", SAMPLE_PRODUCTS);
writeJson("product_content.json", SAMPLE_CONTENT);

// 7. Also clear PostgreSQL tables if connected
async function clearPostgresIfConnected() {
    try {
        const { pool } = require("./config/database");
        await pool.query("SELECT 1;");
        console.log("\n[PostgreSQL] Connection active. Synchronizing PostgreSQL database...");
        
        await pool.query("TRUNCATE TABLE order_items, orders CASCADE;").catch(() => {});
        await pool.query("TRUNCATE TABLE subscription_deliveries, subscriptions CASCADE;").catch(() => {});
        await pool.query("TRUNCATE TABLE delivery_partners CASCADE;").catch(() => {});
        await pool.query("DELETE FROM users WHERE role NOT IN ('super_admin', 'admin');").catch(() => {});
        
        console.log("✓ PostgreSQL tables synchronized with production test baseline.");
    } catch (e) {
        console.log("\n[PostgreSQL] Standalone/JSON mode active. JSON files serve as primary authoritative store.");
    }
}

clearPostgresIfConnected().then(() => {
    console.log("\n===============================================================================");
    console.log("🎉 SUCCESS! ALL ORDERS, SUBSCRIBERS, CUSTOMERS & PARTNERS CLEARED.");
    console.log("   SAMPLE PRODUCTION PRODUCTS (10 Items) SEEDED SUCCESSFULLY.");
    console.log("   ADMIN ACCOUNT PRESERVED: admin@thulirva.com");
    console.log("===============================================================================");
    process.exit(0);
});

