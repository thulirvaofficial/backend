const fs = require("fs");
const path = require("path");

const ORDERS_FILE = path.join(__dirname, "../data/orders.json");

function ensureThiruverkaduOrder() {
    const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8") || "[]");
    const existingIdx = orders.findIndex(o => o.order_number === "THU-20261114-7701" || o.id === 1794661515994);

    const thiruverkaduOrder = {
        id: 1794661515994,
        order_number: "THU-20261114-2155",
        orderNumber: "THU-20261114-2155",
        user_id: 1,
        userId: 1,
        customer_name: "Kamesh S",
        customerName: "Kamesh S",
        customer_phone: "9876543210",
        customerPhone: "9876543210",
        customer_email: "kamesh@thulirva.com",
        delivery_type: "delivery",
        order_type: "delivery",
        address: "Door No. 12, Farm Lane, Thiruverkadu, Chennai",
        city: "Thiruverkadu",
        state: "Tamil Nadu",
        pincode: "600077",
        latitude: 13.0694,
        longitude: 80.1247,
        landmark: "Near Thiruverkadu Temple",
        delivery_instructions: "Leave packet at front doorstep milk box",
        subtotal: 150,
        delivery_charge: 30,
        discount_amount: 0,
        total: 180,
        total_price: 180,
        payment_method: "UPI",
        payment_status: "Paid",
        order_status: "out_for_delivery",
        partner_id: "THU-DP-0004",
        created_at: new Date().toISOString(),
        items: [
            {
                id: "PROD-01",
                name: "Farm Fresh Cow Milk 1L",
                price: 75,
                quantity: 2
            }
        ]
    };

    if (existingIdx !== -1) {
        orders[existingIdx] = { ...orders[existingIdx], ...thiruverkaduOrder };
    } else {
        orders.unshift(thiruverkaduOrder);
    }

    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
    console.log("Thiruverkadu order synced successfully: THU-20261114-2155 -> Thiruverkadu (13.0694, 80.1247)");
}

ensureThiruverkaduOrder();

