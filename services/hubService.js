const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const HUBS_FILE = path.join(DATA_DIR, "distribution_hubs.json");

const INITIAL_HUBS = [
    {
        id: 1,
        code: "HUB-KAN-01",
        name: "Thulirva Farm Production & Processing Hub",
        address: "Thulirva Organic Dairy Farms, Thimmarajampettai, Walajabad",
        city: "Kanchipuram",
        state: "Tamil Nadu",
        pincode: "631601",
        latitude: 12.8342,
        longitude: 79.7036,
        contact_phone: "7904880944",
        is_active: true,
        serviceable_radius_km: 25
    },
    {
        id: 2,
        code: "HUB-OMR-02",
        name: "OMR South Micro-Distribution Hub",
        address: "Near Chettinad Health City, Rajiv Gandhi Salai, Padur",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "603103",
        latitude: 12.8025,
        longitude: 80.2233,
        contact_phone: "9876543210",
        is_active: true,
        serviceable_radius_km: 15
    },
    {
        id: 3,
        code: "HUB-WST-03",
        name: "Chennai West Hub (Porur & Alapakkam)",
        address: "Mount Poonamallee Road, Porur Junction",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600116",
        latitude: 13.0382,
        longitude: 80.1565,
        contact_phone: "9840198223",
        is_active: true,
        serviceable_radius_km: 12
    },
    {
        id: 4,
        code: "HUB-CEN-04",
        name: "Chennai Central Hub (Koyambedu & Vadapalani)",
        address: "Jawaharlal Nehru Road, Koyambedu",
        city: "Chennai",
        state: "Tamil Nadu",
        pincode: "600107",
        latitude: 13.0694,
        longitude: 80.1948,
        contact_phone: "9840123456",
        is_active: true,
        serviceable_radius_km: 10
    }
];

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadHubs() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(HUBS_FILE)) {
            return JSON.parse(fs.readFileSync(HUBS_FILE, "utf-8"));
        }
    } catch (_) {}
    saveHubs(INITIAL_HUBS);
    return INITIAL_HUBS;
}

function saveHubs(hubs) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(HUBS_FILE, JSON.stringify(hubs, null, 2), "utf-8");
    } catch (_) {}
}

async function getDistributionHubs() {
    return loadHubs();
}

async function getHubById(id) {
    const hubs = loadHubs();
    return hubs.find(h => h.id.toString() === id.toString() || h.code === id) || null;
}

async function createDistributionHub(hubData) {
    const hubs = loadHubs();
    const newId = hubs.length ? Math.max(...hubs.map(h => h.id)) + 1 : 1;
    const newHub = {
        id: newId,
        code: hubData.code || `HUB-${String(newId).padStart(2, "0")}`,
        name: hubData.name,
        address: hubData.address,
        city: hubData.city || "Chennai",
        state: hubData.state || "Tamil Nadu",
        pincode: hubData.pincode,
        latitude: Number(hubData.latitude),
        longitude: Number(hubData.longitude),
        contact_phone: hubData.contact_phone || "7904880944",
        is_active: hubData.is_active !== undefined ? Boolean(hubData.is_active) : true,
        serviceable_radius_km: Number(hubData.serviceable_radius_km) || 15
    };
    hubs.push(newHub);
    saveHubs(hubs);
    return newHub;
}

module.exports = {
    getDistributionHubs,
    getHubById,
    createDistributionHub
};

