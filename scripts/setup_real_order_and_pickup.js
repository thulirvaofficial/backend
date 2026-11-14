const fs = require("fs");
const path = require("path");

const ORDERS_FILE = path.join(__dirname, "../data/orders.json");
const PARTNERS_FILE = path.join(__dirname, "../data/delivery_partners.json");
const LOCATIONS_FILE = path.join(__dirname, "../data/partner_live_locations.json");

function setupRealProductOrder() {
    console.log("=== Setting up Real Product Order for Kamesh (Thiruverkadu) ===");
    
    // 1. Prepare Order
    let orders = [];
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
        }
    } catch (e) {
        console.error("Error reading orders:", e);
    }

    const orderId = 1794669999001;
    const orderNumber = "THU-20261114-LIVE";

    const realOrder = {
        id: orderId,
        order_number: orderNumber,
        orderNumber: orderNumber,
        user_id: 3,
        userId: 3,
        customer_name: "kamesh",
        customerName: "kamesh",
        customer_email: "kameshthehacker01@gmail.com",
        customerEmail: "kameshthehacker01@gmail.com",
        customer_phone: "7904880944",
        customerPhone: "7904880944",
        delivery_type: "delivery",
        order_type: "delivery",
        delivery_zone: "West Chennai",
        is_pickup: false,
        address: "Door No. 12, Farm Lane, Thiruverkadu, Chennai",
        city: "Thiruverkadu",
        state: "Tamil Nadu",
        pincode: "600077",
        latitude: 13.0694,
        longitude: 80.1247,
        landmark: "Near Thiruverkadu Temple",
        delivery_instructions: "Hand over milk bottle directly to customer",
        subtotal: 150,
        delivery_charge: 30,
        discount_amount: 0,
        total: 180,
        total_price: 180,
        totalPrice: 180,
        payment_method: "UPI",
        payment_status: "Paid",
        order_status: "out_for_delivery",
        status: "out_for_delivery",
        partner_id: "THU-DP-0001",
        created_at: new Date().toISOString(),
        picked_up_at: new Date().toISOString(),
        items: [
            {
                id: "PROD-01",
                name: "Farm Fresh Cow Milk 1L",
                price: 75,
                quantity: 2
            }
        ]
    };

    const existingIdx = orders.findIndex(o => o.id === orderId || o.order_number === orderNumber);
    if (existingIdx !== -1) {
        orders[existingIdx] = { ...orders[existingIdx], ...realOrder };
    } else {
        orders.unshift(realOrder);
    }
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
    console.log(`[SUCCESS] Order #${orderNumber} created/updated with status: out_for_delivery`);

    // 2. Update Delivery Partner "kamsh" (THU-DP-0001)
    let partners = [];
    try {
        if (fs.existsSync(PARTNERS_FILE)) {
            partners = JSON.parse(fs.readFileSync(PARTNERS_FILE, "utf-8"));
        }
    } catch (e) {
        console.error("Error reading partners:", e);
    }

    const partnerIdx = partners.findIndex(p => p.partner_id === "THU-DP-0001");
    if (partnerIdx !== -1) {
        partners[partnerIdx].assigned_area = "All";
        partners[partnerIdx].current_latitude = 13.0382;
        partners[partnerIdx].current_longitude = 80.1565;
        partners[partnerIdx].is_online = true;
        partners[partnerIdx].is_active = true;
        fs.writeFileSync(PARTNERS_FILE, JSON.stringify(partners, null, 2), "utf-8");
        console.log(`[SUCCESS] Partner THU-DP-0001 (kamsh) updated: assigned_area=All, location=(13.0382, 80.1565)`);
    }

    // 3. Update Partner Live Location (Porur Junction -> en route to Thiruverkadu)
    let locations = [];
    try {
        if (fs.existsSync(LOCATIONS_FILE)) {
            locations = JSON.parse(fs.readFileSync(LOCATIONS_FILE, "utf-8"));
        }
    } catch (e) {
        console.error("Error reading locations:", e);
    }

    const liveLoc = {
        partner_id: "THU-DP-0001",
        latitude: 13.0382,
        longitude: 80.1565,
        accuracy: 3.2,
        speed: 26.5,
        heading: 315,
        active_delivery_id: orderId.toString(),
        device_timestamp: new Date().toISOString(),
        server_timestamp: new Date().toISOString(),
        is_fresh: true,
        last_seen_seconds_ago: 0
    };

    const locIdx = locations.findIndex(l => l.partner_id === "THU-DP-0001");
    if (locIdx !== -1) {
        locations[locIdx] = liveLoc;
    } else {
        locations.push(liveLoc);
    }
    fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(locations, null, 2), "utf-8");
    console.log(`[SUCCESS] Live GPS coordinate set to Porur Junction (13.0382, 80.1565) for partner THU-DP-0001`);
}

setupRealProductOrder();

