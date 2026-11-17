const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const RATINGS_FILE = path.join(DATA_DIR, "order_ratings.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PARTNERS_FILE = path.join(DATA_DIR, "delivery_partners.json");

function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadRatings() {
    ensureDirs();
    try {
        if (fs.existsSync(RATINGS_FILE)) {
            return JSON.parse(fs.readFileSync(RATINGS_FILE, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function saveRatings(ratings) {
    ensureDirs();
    try {
        fs.writeFileSync(RATINGS_FILE, JSON.stringify(ratings, null, 2), "utf-8");
    } catch (_) {}
}

/**
 * Customer Rates Delivery Partner (Module 10)
 */
async function submitCustomerRating({
    order_id,
    user_id,
    rating, // 1 - 5
    on_time_rating = null,
    behavior_rating = null,
    communication_rating = null,
    feedback = "",
    issue_report = ""
}) {
    if (!order_id) throw new Error("Order ID is required.");
    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
        throw new Error("Rating must be between 1 and 5 stars.");
    }

    // Verify order exists and is delivered
    let order = null;
    if (fs.existsSync(ORDERS_FILE)) {
        const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
        order = orders.find(o => o.id?.toString() === order_id.toString() || o.order_number === order_id);
    }
    if (!order) {
        try {
            const res = await pool.query("SELECT * FROM orders WHERE id::text = $1 OR order_number = $1", [order_id.toString()]);
            if (res.rows.length > 0) order = res.rows[0];
        } catch (_) {}
    }
    if (!order) throw new Error(`Order #${order_id} not found.`);

    const orderStatus = (order.order_status || order.status || "").toLowerCase();
    if (orderStatus !== "delivered") {
        throw new Error(`Cannot rate order #${order_id} with status '${orderStatus}'. Ratings are permitted only after successful delivery.`);
    }

    const partnerId = order.partner_id;
    if (!partnerId) {
        throw new Error(`No delivery partner was assigned to Order #${order_id}.`);
    }

    const ratings = loadRatings();
    const existing = ratings.find(r => r.order_id?.toString() === order_id.toString() && r.rater_type === "customer");
    if (existing) {
        throw new Error(`Customer rating for Order #${order_id} has already been submitted.`);
    }

    const ratingRecord = {
        id: `RATE-CUST-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        order_id: String(order_id),
        order_number: String(order.order_number || order_id),
        rater_type: "customer",
        user_id: String(user_id || order.user_id || ""),
        partner_id: String(partnerId),
        rating: numRating,
        on_time_rating: on_time_rating ? Number(on_time_rating) : null,
        behavior_rating: behavior_rating ? Number(behavior_rating) : null,
        communication_rating: communication_rating ? Number(communication_rating) : null,
        feedback: feedback ? feedback.trim() : "",
        has_issue: Boolean(issue_report && issue_report.trim()),
        issue_report: issue_report ? issue_report.trim() : "",
        created_at: new Date().toISOString()
    };

    ratings.unshift(ratingRecord);
    saveRatings(ratings);

    // Update partner's aggregate average rating
    try {
        const partnerCustomerRatings = ratings.filter(r => r.partner_id === partnerId && r.rater_type === "customer");
        const avg = partnerCustomerRatings.reduce((sum, r) => sum + r.rating, 0) / partnerCustomerRatings.length;
        const roundedAvg = Number(avg.toFixed(2));

        if (fs.existsSync(PARTNERS_FILE)) {
            const partners = JSON.parse(fs.readFileSync(PARTNERS_FILE, "utf-8"));
            const p = partners.find(p => p.partner_id === partnerId);
            if (p) {
                p.rating = roundedAvg;
                p.ratings_count = partnerCustomerRatings.length;
                fs.writeFileSync(PARTNERS_FILE, JSON.stringify(partners, null, 2), "utf-8");
            }
        }
        await pool.query(`UPDATE delivery_partners SET rating = $1 WHERE partner_id = $2`, [roundedAvg, partnerId]).catch(() => {});
    } catch (_) {}

    return {
        success: true,
        message: "Thank you for rating your delivery partner!",
        rating: ratingRecord
    };
}

/**
 * Delivery Partner Rates Customer / Delivery Experience (Module 10)
 */
async function submitPartnerRating({
    order_id,
    partner_id,
    rating, // 1 - 5
    delivery_experience = "",
    feedback = "",
    difficulty_report = ""
}) {
    if (!order_id || !partner_id) throw new Error("Order ID and Partner ID are required.");
    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
        throw new Error("Rating must be between 1 and 5 stars.");
    }

    let order = null;
    if (fs.existsSync(ORDERS_FILE)) {
        const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
        order = orders.find(o => o.id?.toString() === order_id.toString() || o.order_number === order_id);
    }
    if (!order) {
        try {
            const res = await pool.query("SELECT * FROM orders WHERE id::text = $1 OR order_number = $1", [order_id.toString()]);
            if (res.rows.length > 0) order = res.rows[0];
        } catch (_) {}
    }
    if (!order) throw new Error(`Order #${order_id} not found.`);

    const orderStatus = (order.order_status || order.status || "").toLowerCase();
    if (orderStatus !== "delivered") {
        throw new Error(`Cannot rate delivery for Order #${order_id} with status '${orderStatus}'. Only delivered orders can be rated.`);
    }

    const ratings = loadRatings();
    const existing = ratings.find(r => r.order_id?.toString() === order_id.toString() && r.rater_type === "partner");
    if (existing) {
        throw new Error(`Delivery experience rating for Order #${order_id} has already been submitted.`);
    }

    const ratingRecord = {
        id: `RATE-PARTNER-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        order_id: String(order_id),
        order_number: String(order.order_number || order_id),
        rater_type: "partner",
        partner_id: String(partner_id),
        user_id: String(order.user_id || ""),
        customer_name: order.customer_name || "Customer",
        rating: numRating,
        delivery_experience: delivery_experience ? delivery_experience.trim() : "",
        feedback: feedback ? feedback.trim() : "",
        has_difficulty: Boolean(difficulty_report && difficulty_report.trim()),
        difficulty_report: difficulty_report ? difficulty_report.trim() : "",
        created_at: new Date().toISOString()
    };

    ratings.unshift(ratingRecord);
    saveRatings(ratings);

    return {
        success: true,
        message: "Delivery experience feedback submitted successfully.",
        rating: ratingRecord
    };
}

/**
 * Get Ratings for a specific Order
 */
function getOrderRatings(orderId) {
    const ratings = loadRatings();
    return ratings.filter(r => r.order_id?.toString() === orderId.toString());
}

/**
 * Get Ratings for a Delivery Partner
 */
function getPartnerRatings(partnerId) {
    const ratings = loadRatings();
    const list = ratings.filter(r => r.partner_id === partnerId && r.rater_type === "customer");
    const avg = list.length > 0 ? Number((list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(2)) : 5.0;
    return {
        partner_id: partnerId,
        average_rating: avg,
        ratings_count: list.length,
        ratings: list
    };
}

/**
 * Get All Ratings for Admin Moderation
 */
function getAllRatings({ rater_type = null, has_issue = null } = {}) {
    let list = loadRatings();
    if (rater_type) list = list.filter(r => r.rater_type === rater_type);
    if (has_issue !== null) {
        const flag = Boolean(has_issue);
        list = list.filter(r => r.has_issue === flag || r.has_difficulty === flag);
    }
    return list;
}

module.exports = {
    submitCustomerRating,
    submitPartnerRating,
    getOrderRatings,
    getPartnerRatings,
    getAllRatings
};

