const fs = require("fs");
const path = require("path");
const { pool, isDbOnline } = require("../config/database");
const { sendNotification } = require("./notificationService");
const { emitToAdmin, emitToUser } = require("./socketService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const COD_AUDIT_FILE = path.join(DATA_DIR, "cod_risk_audit_log.json");

function ensureFile(filePath, defaultData = []) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), "utf-8");
        }
    } catch (_) {}
}

ensureFile(USERS_FILE, []);
ensureFile(COD_AUDIT_FILE, []);

function readJson(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function writeJson(filePath, data) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.error(`[COD RISK WRITE ERROR] ${filePath}:`, e.message);
    }
}

/**
 * Audit log helper for COD eligibility changes
 */
async function logCodAuditEvent({ customerId, customerName, action, reason, previousState, newState, refusalCount, orderIds = [], adminId = null, adminName = null }) {
    const entry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        customer_id: String(customerId),
        customer_name: customerName || "Customer",
        action, // 'AUTO_RESTRICTED', 'ADMIN_RESTORED', 'ADMIN_RESTRICTED', 'REFUSAL_RECORDED'
        reason: reason || "",
        previous_state: previousState,
        new_state: newState,
        refusal_count: refusalCount,
        order_ids: orderIds,
        admin_id: adminId ? String(adminId) : null,
        admin_name: adminName || (action.startsWith("AUTO") ? "System Guard" : "Admin"),
        created_at: new Date().toISOString()
    };

    const audits = readJson(COD_AUDIT_FILE);
    audits.unshift(entry);
    writeJson(COD_AUDIT_FILE, audits);
    return entry;
}

/**
 * Record a confirmed customer doorstep cancellation/refusal on a COD order.
 * Strictly counts ONLY doorstep refusals (not admin/partner/stock cancellations).
 *
 * Rule: 2 confirmed doorstep refusals => auto-disable COD.
 */
async function recordDoorstepCodRefusal(customerId, orderId, { partnerId = null, notes = "" } = {}) {
    if (!customerId && !orderId) return { success: false, message: "Customer ID or Order ID required" };

    const users = readJson(USERS_FILE);
    let customer = users.find(u => 
        String(u.id) === String(customerId) || 
        (customerId && u.phone && u.phone.replace(/\D/g, "").endsWith(String(customerId).replace(/\D/g, "")))
    );

    // If customer record not yet in users.json, check orders.json to locate customer details
    if (!customer) {
        const orders = readJson(ORDERS_FILE);
        const order = orders.find(o => String(o.id) === String(orderId) || String(o.order_number) === String(orderId));
        if (order) {
            customer = users.find(u => String(u.id) === String(order.user_id) || (order.customer_phone && u.phone === order.customer_phone));
            if (!customer) {
                // Initialize user entry from order
                customer = {
                    id: order.user_id || Date.now(),
                    name: order.customer_name || "Customer",
                    phone: order.customer_phone || "",
                    email: order.customer_email || "",
                    role: "customer",
                    cod_refusal_count: 0,
                    cod_eligible: true,
                    cod_restricted_at: null,
                    cod_restriction_reason: null,
                    cod_restriction_order_ids: [],
                    created_at: new Date().toISOString()
                };
                users.push(customer);
            }
        }
    }

    if (!customer) {
        if (customerId) {
            customer = {
                id: customerId,
                name: "Customer #" + customerId,
                phone: "",
                email: "",
                role: "customer",
                cod_refusal_count: 0,
                cod_eligible: true,
                cod_restricted_at: null,
                cod_restriction_reason: null,
                cod_restriction_order_ids: [],
                created_at: new Date().toISOString()
            };
            users.push(customer);
        } else {
            return { success: false, message: "Customer could not be resolved" };
        }
    }

    // Initialize fields if absent
    if (typeof customer.cod_refusal_count !== "number") customer.cod_refusal_count = 0;
    if (typeof customer.cod_eligible !== "boolean") customer.cod_eligible = true;
    if (!Array.isArray(customer.cod_restriction_order_ids)) customer.cod_restriction_order_ids = [];

    // Avoid double counting same order
    const orderStr = String(orderId);
    if (!customer.cod_restriction_order_ids.includes(orderStr)) {
        customer.cod_restriction_order_ids.push(orderStr);
        customer.cod_refusal_count += 1;
    }

    let newlyRestricted = false;
    const nowIso = new Date().toISOString();

    // Condition: 2 doorstep refusals disables COD
    if (customer.cod_refusal_count >= 2 && customer.cod_eligible === true) {
        customer.cod_eligible = false;
        customer.cod_restricted_at = nowIso;
        customer.cod_restriction_reason = `Cash on Delivery restricted automatically after ${customer.cod_refusal_count} doorstep delivery refusals (Orders: ${customer.cod_restriction_order_ids.join(", ")}).`;
        newlyRestricted = true;

        await logCodAuditEvent({
            customerId: customer.id,
            customerName: customer.name,
            action: "AUTO_RESTRICTED",
            reason: customer.cod_restriction_reason,
            previousState: true,
            newState: false,
            refusalCount: customer.cod_refusal_count,
            orderIds: customer.cod_restriction_order_ids
        });

        // Notify Customer in real-time
        try {
            sendNotification({
                userId: customer.id,
                title: "COD Payment Option Disabled",
                message: "Cash on Delivery has been temporarily disabled for your account due to repeated doorstep refusals. You can still order anytime with UPI and Cards.",
                type: "cod_restricted",
                targetId: customer.id
            }).catch(() => {});
            emitToUser(customer.id, "cod:status_update", { cod_eligible: false, reason: customer.cod_restriction_reason });
        } catch (_) {}

        // Notify Admin
        try {
            emitToAdmin("cod:customer_restricted", {
                customerId: customer.id,
                customerName: customer.name,
                refusalCount: customer.cod_refusal_count,
                orderIds: customer.cod_restriction_order_ids
            });
        } catch (_) {}
    } else {
        await logCodAuditEvent({
            customerId: customer.id,
            customerName: customer.name,
            action: "REFUSAL_RECORDED",
            reason: `Doorstep refusal recorded on Order ${orderId}. Refusal count: ${customer.cod_refusal_count}. Notes: ${notes || "None"}`,
            previousState: customer.cod_eligible,
            newState: customer.cod_eligible,
            refusalCount: customer.cod_refusal_count,
            orderIds: [orderStr]
        });
    }

    writeJson(USERS_FILE, users);

    // Sync PostgreSQL if online
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            await pool.query(`
                UPDATE users 
                SET cod_refusal_count = $1, cod_eligible = $2, 
                    cod_restricted_at = $3, cod_restriction_reason = $4,
                    cod_restriction_order_ids = $5, updated_at = NOW()
                WHERE id = $6
            `, [
                customer.cod_refusal_count,
                customer.cod_eligible,
                customer.cod_restricted_at,
                customer.cod_restriction_reason,
                JSON.stringify(customer.cod_restriction_order_ids),
                customer.id
            ]);
        }
    } catch (_) {}

    return {
        success: true,
        customerId: customer.id,
        refusalCount: customer.cod_refusal_count,
        cod_eligible: customer.cod_eligible,
        newlyRestricted
    };
}

/**
 * Check COD eligibility for an order checkout
 */
async function checkCustomerCodEligibility(userId, customerPhone = null) {
    const users = readJson(USERS_FILE);
    let customer = null;

    if (userId) {
        customer = users.find(u => String(u.id) === String(userId));
    }
    if (!customer && customerPhone) {
        const cleanPhone = String(customerPhone).replace(/\D/g, "");
        customer = users.find(u => u.phone && u.phone.replace(/\D/g, "").endsWith(cleanPhone.slice(-10)));
    }

    if (!customer) {
        // Unknown or guest user defaults to eligible unless globally disabled
        return {
            eligible: true,
            refusal_count: 0,
            restricted_at: null,
            reason: null
        };
    }

    const isEligible = customer.cod_eligible !== false;
    return {
        eligible: isEligible,
        refusal_count: customer.cod_refusal_count || 0,
        restricted_at: customer.cod_restricted_at || null,
        reason: isEligible ? null : (customer.cod_restriction_reason || "Cash on Delivery is unavailable for this account due to previous unaccepted deliveries.")
    };
}

/**
 * List restricted & monitored customers for Admin Risk Dashboard
 */
async function getMonitoredCustomers({ search = "", status = "ALL", page = 1, limit = 50 } = {}) {
    const users = readJson(USERS_FILE);
    const orders = readJson(ORDERS_FILE);

    // Collect customers who have refusal counts or are non-admin customers
    let list = users.filter(u => u.role !== "admin" && u.role !== "super_admin");

    // Also look at orders for customers with doorstep refusals who might not yet be in users.json
    orders.forEach(o => {
        if ((o.failed_reason || "").includes("doorstep") || (o.failed_reason || "").includes("refused")) {
            const exists = list.find(u => String(u.id) === String(o.user_id) || (o.customer_phone && u.phone === o.customer_phone));
            if (!exists) {
                list.push({
                    id: o.user_id || `CUST-${o.id}`,
                    name: o.customer_name || "Customer",
                    phone: o.customer_phone || "",
                    email: o.customer_email || "",
                    cod_refusal_count: 1,
                    cod_eligible: true,
                    cod_restricted_at: null,
                    cod_restriction_reason: null,
                    cod_restriction_order_ids: [String(o.id)],
                    created_at: o.created_at || new Date().toISOString()
                });
            }
        }
    });

    // Map normalize
    list = list.map(c => {
        const eligible = c.cod_eligible !== false;
        return {
            id: c.id,
            name: c.name || "Customer",
            phone: c.phone || "",
            email: c.email || "",
            address: c.address || "",
            city: c.city || "",
            cod_eligible: eligible,
            cod_refusal_count: c.cod_refusal_count || 0,
            cod_restricted_at: c.cod_restricted_at || null,
            cod_restriction_reason: c.cod_restriction_reason || null,
            cod_restriction_order_ids: c.cod_restriction_order_ids || [],
            created_at: c.created_at || ""
        };
    });

    // Filtering
    if (status === "RESTRICTED") {
        list = list.filter(c => c.cod_eligible === false);
    } else if (status === "WARNED") {
        list = list.filter(c => c.cod_eligible === true && c.cod_refusal_count === 1);
    } else if (status === "ELIGIBLE") {
        list = list.filter(c => c.cod_eligible === true && c.cod_refusal_count === 0);
    } else if (status === "FLAGGED") {
        list = list.filter(c => c.cod_refusal_count > 0 || c.cod_eligible === false);
    }

    if (search) {
        const q = search.toLowerCase();
        list = list.filter(c => 
            String(c.id).toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            c.phone.includes(q) ||
            c.email.toLowerCase().includes(q)
        );
    }

    // Sort: Restricted first, then highest refusal count, then created_at
    list.sort((a, b) => {
        if (!a.cod_eligible && b.cod_eligible) return -1;
        if (a.cod_eligible && !b.cod_eligible) return 1;
        return (b.cod_refusal_count || 0) - (a.cod_refusal_count || 0);
    });

    const total = list.length;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    // Summary KPIs
    const allCustomers = users.filter(u => u.role !== "admin" && u.role !== "super_admin");
    const summary = {
        total_customers: allCustomers.length,
        cod_restricted: allCustomers.filter(c => c.cod_eligible === false).length,
        at_risk_warned: allCustomers.filter(c => c.cod_refusal_count === 1 && c.cod_eligible !== false).length,
        healthy_cod: allCustomers.filter(c => (c.cod_refusal_count || 0) === 0 && c.cod_eligible !== false).length
    };

    return {
        summary,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
        customers: paginated
    };
}

/**
 * Admin manual override: Restore or Restrict COD eligibility
 */
async function updateCustomerCodStatus(customerId, { cod_eligible, reason, adminId, adminName, resetCount = false }) {
    const users = readJson(USERS_FILE);
    let customer = users.find(u => String(u.id) === String(customerId));

    if (!customer) {
        if (customerId) {
            customer = {
                id: customerId,
                name: `User ${customerId}`,
                phone: "",
                role: "customer",
                cod_eligible: true,
                cod_refusal_count: 0,
                cod_restricted_at: null,
                cod_restriction_reason: null,
                cod_restriction_order_ids: [],
                created_at: new Date().toISOString()
            };
            users.push(customer);
        } else {
            throw new Error(`Customer with ID ${customerId} not found.`);
        }
    }

    const previousState = customer.cod_eligible !== false;
    const targetState = Boolean(cod_eligible);
    const nowIso = new Date().toISOString();

    customer.cod_eligible = targetState;

    if (targetState === true) {
        // Restoring COD
        if (resetCount) {
            customer.cod_refusal_count = 0;
            customer.cod_restriction_order_ids = [];
        }
        customer.cod_restricted_at = null;
        customer.cod_restriction_reason = null;

        await logCodAuditEvent({
            customerId: customer.id,
            customerName: customer.name,
            action: "ADMIN_RESTORED",
            reason: reason || "Restored manually by admin.",
            previousState,
            newState: true,
            refusalCount: customer.cod_refusal_count,
            adminId,
            adminName
        });

        // Notify user of restoration
        try {
            sendNotification({
                userId: customer.id,
                title: "COD Payment Restored",
                message: "Cash on Delivery payment option has been restored for your account. You can now choose COD during checkout.",
                type: "cod_restored",
                targetId: customer.id
            }).catch(() => {});
            emitToUser(customer.id, "cod:status_update", { cod_eligible: true });
        } catch (_) {}
    } else {
        // Manually Restricting COD
        customer.cod_restricted_at = nowIso;
        customer.cod_restriction_reason = reason || "Restricted manually by Admin decision.";

        await logCodAuditEvent({
            customerId: customer.id,
            customerName: customer.name,
            action: "ADMIN_RESTRICTED",
            reason: customer.cod_restriction_reason,
            previousState,
            newState: false,
            refusalCount: customer.cod_refusal_count,
            adminId,
            adminName
        });

        try {
            sendNotification({
                userId: customer.id,
                title: "COD Payment Option Disabled",
                message: "Cash on Delivery has been temporarily restricted for your account. Please choose UPI QR or Online Payment.",
                type: "cod_restricted",
                targetId: customer.id
            }).catch(() => {});
            emitToUser(customer.id, "cod:status_update", { cod_eligible: false, reason: customer.cod_restriction_reason });
        } catch (_) {}
    }

    writeJson(USERS_FILE, users);

    // Sync PostgreSQL if online
    try {
        if (pool && typeof isDbOnline === "function" && isDbOnline()) {
            await pool.query(`
                UPDATE users 
                SET cod_eligible = $1, cod_restricted_at = $2, 
                    cod_restriction_reason = $3, cod_refusal_count = $4,
                    updated_at = NOW()
                WHERE id = $5
            `, [
                customer.cod_eligible,
                customer.cod_restricted_at,
                customer.cod_restriction_reason,
                customer.cod_refusal_count,
                customer.id
            ]);
        }
    } catch (_) {}

    return {
        success: true,
        customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            cod_eligible: customer.cod_eligible,
            cod_refusal_count: customer.cod_refusal_count,
            cod_restricted_at: customer.cod_restricted_at,
            cod_restriction_reason: customer.cod_restriction_reason
        }
    };
}

/**
 * Get audit history for a customer or overall
 */
async function getCodAuditLogs(customerId = null) {
    const audits = readJson(COD_AUDIT_FILE);
    if (customerId) {
        return audits.filter(a => String(a.customer_id) === String(customerId));
    }
    return audits;
}

module.exports = {
    recordDoorstepCodRefusal,
    checkCustomerCodEligibility,
    getMonitoredCustomers,
    updateCustomerCodStatus,
    getCodAuditLogs
};
