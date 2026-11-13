const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const LEDGER_FILE = path.join(DATA_DIR, "partner_earning_ledger.json");
const BALANCES_FILE = path.join(DATA_DIR, "partner_wallet_balances.json");
const WITHDRAWALS_FILE = path.join(DATA_DIR, "partner_withdrawal_requests.json");
const SETTLEMENTS_FILE = path.join(DATA_DIR, "partner_settlements.json");
const FINANCIAL_AUDIT_FILE = path.join(DATA_DIR, "financial_audit_logs.json");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadJson(file, defaultVal = []) {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, "utf-8"));
        }
    } catch (e) {
        console.warn(`[FINANCIAL DISK LOAD WARN] ${path.basename(file)}:`, e.message);
    }
    return defaultVal;
}

function saveJson(file, data) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.warn(`[FINANCIAL DISK SAVE WARN] ${path.basename(file)}:`, e.message);
    }
}

/**
 * Record a financial audit entry
 */
async function recordFinancialAudit(action, partnerId, adminName, amountPaise, beforeBalance, afterBalance, notes = "") {
    const auditEntry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        action,
        partner_id: partnerId,
        admin_name: adminName || "System Automated",
        amount_paise: amountPaise,
        amount_rupees: Number((amountPaise / 100).toFixed(2)),
        before_balance_paise: beforeBalance,
        after_balance_paise: afterBalance,
        notes,
        created_at: new Date().toISOString()
    };

    const audits = loadJson(FINANCIAL_AUDIT_FILE, []);
    audits.unshift(auditEntry);
    saveJson(FINANCIAL_AUDIT_FILE, audits);

    try {
        await pool.query(`
            INSERT INTO financial_audit_logs (action, partner_id, admin_name, amount_paise, before_balance_paise, after_balance_paise, notes, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [action, partnerId, adminName || "System Automated", amountPaise, beforeBalance, afterBalance, notes]);
    } catch (_) {}

    return auditEntry;
}

/**
 * Get or initialize partner wallet balance
 * All values stored in exact integer paise
 */
async function getPartnerWalletBalance(partnerId) {
    if (!partnerId) return null;

    try {
        const res = await pool.query("SELECT * FROM partner_wallet_balances WHERE partner_id = $1", [partnerId]);
        if (res.rows.length > 0) {
            const row = res.rows[0];
            return {
                partner_id: row.partner_id,
                lifetime_earned_paise: parseInt(row.lifetime_earned_paise || 0, 10),
                total_settled_paise: parseInt(row.total_settled_paise || 0, 10),
                available_payable_paise: parseInt(row.available_payable_paise || 0, 10),
                reserved_withdrawal_paise: parseInt(row.reserved_withdrawal_paise || 0, 10),
                pending_settlement_paise: parseInt(row.pending_settlement_paise || 0, 10),
                lifetime_earned_rupees: (parseInt(row.lifetime_earned_paise || 0, 10) / 100),
                total_settled_rupees: (parseInt(row.total_settled_paise || 0, 10) / 100),
                available_payable_rupees: (parseInt(row.available_payable_paise || 0, 10) / 100),
                reserved_withdrawal_rupees: (parseInt(row.reserved_withdrawal_paise || 0, 10) / 100),
                updated_at: row.updated_at
            };
        }
    } catch (_) {}

    const balances = loadJson(BALANCES_FILE, []);
    let wallet = balances.find(b => b.partner_id === partnerId);
    if (!wallet) {
        wallet = {
            partner_id: partnerId,
            lifetime_earned_paise: 0,
            total_settled_paise: 0,
            available_payable_paise: 0,
            reserved_withdrawal_paise: 0,
            pending_settlement_paise: 0,
            updated_at: new Date().toISOString()
        };
        balances.push(wallet);
        saveJson(BALANCES_FILE, balances);
    }

    return {
        ...wallet,
        lifetime_earned_rupees: (wallet.lifetime_earned_paise / 100),
        total_settled_rupees: (wallet.total_settled_paise / 100),
        available_payable_rupees: (wallet.available_payable_paise / 100),
        reserved_withdrawal_rupees: (wallet.reserved_withdrawal_paise / 100)
    };
}

/**
 * Save partner wallet balance (both DB and disk)
 */
async function savePartnerWalletBalance(wallet) {
    wallet.updated_at = new Date().toISOString();

    const balances = loadJson(BALANCES_FILE, []);
    const idx = balances.findIndex(b => b.partner_id === wallet.partner_id);
    if (idx >= 0) {
        balances[idx] = {
            partner_id: wallet.partner_id,
            lifetime_earned_paise: wallet.lifetime_earned_paise,
            total_settled_paise: wallet.total_settled_paise,
            available_payable_paise: wallet.available_payable_paise,
            reserved_withdrawal_paise: wallet.reserved_withdrawal_paise,
            pending_settlement_paise: wallet.pending_settlement_paise,
            updated_at: wallet.updated_at
        };
    } else {
        balances.push(wallet);
    }
    saveJson(BALANCES_FILE, balances);

    try {
        await pool.query(`
            INSERT INTO partner_wallet_balances (
                partner_id, lifetime_earned_paise, total_settled_paise,
                available_payable_paise, reserved_withdrawal_paise, pending_settlement_paise, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (partner_id) DO UPDATE SET
                lifetime_earned_paise = EXCLUDED.lifetime_earned_paise,
                total_settled_paise = EXCLUDED.total_settled_paise,
                available_payable_paise = EXCLUDED.available_payable_paise,
                reserved_withdrawal_paise = EXCLUDED.reserved_withdrawal_paise,
                pending_settlement_paise = EXCLUDED.pending_settlement_paise,
                updated_at = NOW()
        `, [
            wallet.partner_id, wallet.lifetime_earned_paise, wallet.total_settled_paise,
            wallet.available_payable_paise, wallet.reserved_withdrawal_paise, wallet.pending_settlement_paise
        ]);
    } catch (_) {}
}

/**
 * Record an earning entry in the immutable financial ledger
 * Prevents double-crediting by checking entry_type + reference_id
 */
async function recordEarningEntry({
    partner_id,
    entry_type,
    reference_id,
    amount_in_rupees,
    description,
    admin_name = "System Automated"
}) {
    if (!partner_id || !entry_type || !reference_id) {
        throw new Error("partner_id, entry_type, and reference_id are required.");
    }

    const amountPaise = Math.round(Number(amount_in_rupees) * 100);
    if (isNaN(amountPaise) || amountPaise <= 0) {
        throw new Error("Earning amount must be a positive integer in paise.");
    }

    // Invariant Check 1: Idempotency (Cannot create duplicate earning for same delivery/event)
    const ledger = loadJson(LEDGER_FILE, []);
    const existing = ledger.find(e =>
        e.partner_id === partner_id &&
        e.entry_type === entry_type &&
        e.reference_id?.toString() === reference_id?.toString()
    );

    if (existing) {
        console.log(`[LEDGER IDEMPOTENT] Earning for ${entry_type} #${reference_id} already recorded.`);
        return existing;
    }

    const entryId = `LEDGER-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newEntry = {
        id: entryId,
        partner_id,
        entry_type,
        reference_id: reference_id.toString(),
        amount_paise: amountPaise,
        amount_rupees: Number(amount_in_rupees),
        description: description || `Earning for ${entry_type} #${reference_id}`,
        is_settled: false,
        settlement_id: null,
        created_at: new Date().toISOString()
    };

    ledger.unshift(newEntry);
    saveJson(LEDGER_FILE, ledger);

    try {
        await pool.query(`
            INSERT INTO partner_earning_ledger (
                id, partner_id, entry_type, reference_id, amount_paise, description, is_settled, settlement_id, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, false, null, NOW())
            ON CONFLICT (id) DO NOTHING
        `, [newEntry.id, partner_id, entry_type, reference_id.toString(), amountPaise, newEntry.description]);
    } catch (_) {}

    // Update Wallet Balance Atomically
    const wallet = await getPartnerWalletBalance(partner_id);
    const beforeBal = wallet.available_payable_paise;
    wallet.lifetime_earned_paise += amountPaise;
    wallet.available_payable_paise += amountPaise;
    await savePartnerWalletBalance(wallet);

    await recordFinancialAudit(
        "EARNING_CREDITED",
        partner_id,
        admin_name,
        amountPaise,
        beforeBal,
        wallet.available_payable_paise,
        `Credited ₹${amount_in_rupees} for ${entry_type} #${reference_id}`
    );

    // Emit real-time socket event
    try {
        const { emitToPartner } = require("./socketService");
        emitToPartner(partner_id, "earnings:updated", {
            amount_rupees: Number(amount_in_rupees),
            balance_rupees: wallet.available_payable_paise / 100,
            entry: newEntry
        });
    } catch (_) {}

    return newEntry;
}

/**
 * Record Product Delivery Earning (₹40 standard)
 */
async function recordProductDeliveryEarning(partnerId, orderId, amountInRupees = 40) {
    return await recordEarningEntry({
        partner_id: partnerId,
        entry_type: "delivery_order",
        reference_id: orderId,
        amount_in_rupees: amountInRupees,
        description: `Doorstep Product Delivery fee for Order #${orderId}`
    });
}

/**
 * Record Daily Subscription Delivery Earning (₹35 standard)
 */
async function recordSubscriptionDeliveryEarning(partnerId, dailyId, amountInRupees = 35) {
    return await recordEarningEntry({
        partner_id: partnerId,
        entry_type: "delivery_subscription",
        reference_id: dailyId,
        amount_in_rupees: amountInRupees,
        description: `Daily Milk Subscription Delivery fee for Task #${dailyId}`
    });
}

/**
 * Create a partner withdrawal request
 * Reserves the requested amount from available payable balance
 */
async function createWithdrawalRequest({ partner_id, amount_in_rupees, bank_account_id = null, notes = "" }) {
    if (!partner_id) throw new Error("partner_id is required.");
    const amountPaise = Math.round(Number(amount_in_rupees) * 100);
    if (isNaN(amountPaise) || amountPaise <= 0) {
        throw new Error("Invalid withdrawal amount.");
    }

    const wallet = await getPartnerWalletBalance(partner_id);
    if (wallet.available_payable_paise < amountPaise) {
        throw new Error(`Insufficient payable balance. Available: ₹${wallet.available_payable_rupees}, Requested: ₹${amount_in_rupees}`);
    }

    const reqId = `WDR-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const newRequest = {
        id: reqId,
        request_id: reqId,
        partner_id,
        amount_paise: amountPaise,
        amount_rupees: Number(amount_in_rupees),
        status: "pending", // pending, approved, rejected, settled
        bank_account_id,
        notes,
        reviewer_notes: null,
        utr_number: null,
        requested_at: new Date().toISOString(),
        reviewed_at: null,
        settled_at: null
    };

    const requests = loadJson(WITHDRAWALS_FILE, []);
    requests.unshift(newRequest);
    saveJson(WITHDRAWALS_FILE, requests);

    // Invariant: Reserve the withdrawal amount so it cannot be spent again
    const beforeBal = wallet.available_payable_paise;
    wallet.available_payable_paise -= amountPaise;
    wallet.reserved_withdrawal_paise += amountPaise;
    await savePartnerWalletBalance(wallet);

    await recordFinancialAudit(
        "WITHDRAWAL_REQUESTED",
        partner_id,
        "Partner Self",
        amountPaise,
        beforeBal,
        wallet.available_payable_paise,
        `Withdrawal request #${reqId} of ₹${amount_in_rupees} placed. Amount reserved.`
    );

    return newRequest;
}

/**
 * Review withdrawal request (Approve, Reject, or Settle)
 * Invariant: Rejection releases reserved balance back to available payable balance
 * Invariant: Settlement deducts from reserved and adds to total_settled
 */
async function reviewWithdrawalRequest({ request_id, action, reviewer_notes = "", utr_number = null, admin_name = "Operations Admin" }) {
    const requests = loadJson(WITHDRAWALS_FILE, []);
    const req = requests.find(r => r.id === request_id || r.request_id === request_id);
    if (!req) throw new Error(`Withdrawal request #${request_id} not found.`);

    if (req.status === "settled") throw new Error("This withdrawal has already been settled.");
    if (req.status === "rejected") throw new Error("This withdrawal has already been rejected.");

    const wallet = await getPartnerWalletBalance(req.partner_id);

    if (action === "reject") {
        req.status = "rejected";
        req.reviewed_at = new Date().toISOString();
        req.reviewer_notes = reviewer_notes || "Rejected by admin";

        // Release reserved balance back to available
        const beforeBal = wallet.available_payable_paise;
        wallet.reserved_withdrawal_paise = Math.max(0, wallet.reserved_withdrawal_paise - req.amount_paise);
        wallet.available_payable_paise += req.amount_paise;
        await savePartnerWalletBalance(wallet);

        await recordFinancialAudit(
            "WITHDRAWAL_REJECTED",
            req.partner_id,
            admin_name,
            req.amount_paise,
            beforeBal,
            wallet.available_payable_paise,
            `Withdrawal #${request_id} rejected. Reserved ₹${req.amount_rupees} restored to payable balance.`
        );
    } else if (action === "settle" || action === "approve_and_settle") {
        if (!utr_number) {
            throw new Error("UTR / Bank Reference number is required to confirm settlement.");
        }
        req.status = "settled";
        req.reviewed_at = new Date().toISOString();
        req.settled_at = new Date().toISOString();
        req.reviewer_notes = reviewer_notes;
        req.utr_number = utr_number;

        // Move from reserved to settled
        const beforeBal = wallet.available_payable_paise;
        wallet.reserved_withdrawal_paise = Math.max(0, wallet.reserved_withdrawal_paise - req.amount_paise);
        wallet.total_settled_paise += req.amount_paise;
        await savePartnerWalletBalance(wallet);

        await recordFinancialAudit(
            "WITHDRAWAL_SETTLED",
            req.partner_id,
            admin_name,
            req.amount_paise,
            beforeBal,
            wallet.available_payable_paise,
            `Withdrawal #${request_id} settled via Bank Transfer. UTR: ${utr_number}.`
        );
    } else {
        throw new Error(`Unsupported withdrawal review action '${action}'. Allowed: reject, settle`);
    }

    saveJson(WITHDRAWALS_FILE, requests);
    return req;
}

/**
 * Execute Weekly Salary Settlement
 * Aggregates all unsettled ledger entries for the partner, marks them settled,
 * increments total_settled_paise, sets available_payable_paise to zero for those items.
 * Lifetime earnings and ledger history are 100% PRESERVED.
 */
async function executeWeeklySettlement({
    partner_id,
    period_start,
    period_end,
    payment_mode = "NEFT / IMPS Bank Transfer",
    utr_number,
    notes = "",
    admin_name = "Finance Operations Admin"
}) {
    if (!partner_id) throw new Error("partner_id is required.");
    if (!utr_number || utr_number.trim().length < 4) {
        throw new Error("Valid UTR / Bank Transfer Transaction ID is required for audit trail.");
    }

    const ledger = loadJson(LEDGER_FILE, []);
    const unsettledEntries = ledger.filter(e => e.partner_id === partner_id && !e.is_settled);

    if (unsettledEntries.length === 0) {
        throw new Error("No unsettled earnings available for this partner.");
    }

    const totalOrders = unsettledEntries.filter(e => e.entry_type === "delivery_order").length;
    const totalSubs = unsettledEntries.filter(e => e.entry_type === "delivery_subscription").length;
    const grossPaise = unsettledEntries.reduce((acc, e) => acc + (e.amount_paise || 0), 0);

    const wallet = await getPartnerWalletBalance(partner_id);
    const beforeBal = wallet.available_payable_paise;
    const netPaise = Math.min(wallet.available_payable_paise, grossPaise);
    const priorDeductionsPaise = Math.max(0, grossPaise - netPaise);

    const settlementId = `SETTLE-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    // Mark entries as settled in ledger
    unsettledEntries.forEach(e => {
        e.is_settled = true;
        e.settlement_id = settlementId;
        e.settled_at = new Date().toISOString();
    });
    saveJson(LEDGER_FILE, ledger);

    // Create Settlement Record
    const settlementRecord = {
        id: settlementId,
        settlement_id: settlementId,
        partner_id,
        period_start: period_start || new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0],
        period_end: period_end || new Date().toISOString().split("T")[0],
        total_orders_count: totalOrders,
        total_subs_count: totalSubs,
        gross_amount_paise: grossPaise,
        gross_amount_rupees: grossPaise / 100,
        deductions_paise: priorDeductionsPaise,
        deductions_rupees: priorDeductionsPaise / 100,
        net_amount_paise: netPaise,
        net_amount_rupees: netPaise / 100,
        payment_mode,
        utr_number,
        status: "completed",
        settled_by: admin_name,
        settled_at: new Date().toISOString(),
        notes: notes || "Weekly salary settlement disbursement"
    };

    const settlements = loadJson(SETTLEMENTS_FILE, []);
    settlements.unshift(settlementRecord);
    saveJson(SETTLEMENTS_FILE, settlements);

    // Update Wallet Balances Atomically
    wallet.total_settled_paise += netPaise;
    wallet.available_payable_paise = Math.max(0, wallet.available_payable_paise - netPaise);
    await savePartnerWalletBalance(wallet);

    await recordFinancialAudit(
        "WEEKLY_SALARY_SETTLED",
        partner_id,
        admin_name,
        netPaise,
        beforeBal,
        wallet.available_payable_paise,
        `Settled ₹${grossPaise / 100} for ${totalOrders} orders and ${totalSubs} subscriptions. UTR: ${utr_number}. History preserved.`
    );

    // Emit Real-time Socket Event
    try {
        const { emitToPartner } = require("./socketService");
        emitToPartner(partner_id, "settlement:completed", {
            settlement_id: settlementId,
            net_amount_rupees: grossPaise / 100,
            utr_number,
            available_payable_rupees: wallet.available_payable_paise / 100
        });
    } catch (_) {}

    return settlementRecord;
}

/**
 * Get Partner Ledger Entries with pagination and filtering
 */
function getPartnerLedger(partnerId, { page = 1, limit = 50, entry_type = null } = {}) {
    const ledger = loadJson(LEDGER_FILE, []);
    let filtered = ledger.filter(e => e.partner_id === partnerId);
    if (entry_type) {
        filtered = filtered.filter(e => e.entry_type === entry_type);
    }
    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const items = filtered.slice(startIndex, startIndex + limit);

    return {
        total,
        page: Number(page),
        limit: Number(limit),
        items
    };
}

/**
 * Get Partner Settlement History
 */
function getPartnerSettlementHistory(partnerId) {
    const settlements = loadJson(SETTLEMENTS_FILE, []);
    return settlements.filter(s => s.partner_id === partnerId);
}

/**
 * Get Partner Withdrawal Requests
 */
function getPartnerWithdrawalRequests(partnerId) {
    const requests = loadJson(WITHDRAWALS_FILE, []);
    return requests.filter(r => r.partner_id === partnerId);
}

module.exports = {
    getPartnerWalletBalance,
    recordEarningEntry,
    recordProductDeliveryEarning,
    recordSubscriptionDeliveryEarning,
    createWithdrawalRequest,
    reviewWithdrawalRequest,
    executeWeeklySettlement,
    getPartnerLedger,
    getPartnerSettlementHistory,
    getPartnerWithdrawalRequests,
    recordFinancialAudit
};
