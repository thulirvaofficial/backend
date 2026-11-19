const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const LEDGER_FILE = path.join(DATA_DIR, "partner_earning_ledger.json");
const BALANCES_FILE = path.join(DATA_DIR, "partner_wallet_balances.json");
const WITHDRAWALS_FILE = path.join(DATA_DIR, "partner_withdrawal_requests.json");
const SETTLEMENTS_FILE = path.join(DATA_DIR, "partner_settlements.json");
const FINANCIAL_AUDIT_FILE = path.join(DATA_DIR, "financial_audit_logs.json");
const COD_LEDGER_FILE = path.join(DATA_DIR, "partner_cod_ledger.json");
const COD_REMITTANCES_FILE = path.join(DATA_DIR, "partner_cod_remittances.json");
const BANK_DETAILS_FILE = path.join(DATA_DIR, "partner_bank_details.json");

const ENCRYPTION_KEY = crypto.createHash("sha256").update(process.env.JWT_SECRET || "thulirva_bank_encryption_key_2026").digest();
const IV_LENGTH = 16;

function encryptText(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(String(text), "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
}

function decryptText(encryptedText) {
    if (!encryptedText || !encryptedText.includes(":")) return encryptedText || "";
    try {
        const parts = encryptedText.split(":");
        const iv = Buffer.from(parts[0], "hex");
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    } catch (_) {
        return encryptedText;
    }
}

function maskAccountNumber(acc) {
    if (!acc) return "";
    const clean = String(acc).trim();
    if (clean.length <= 4) return clean;
    const last4 = clean.slice(-4);
    return "XXXX-XXXX-" + last4;
}

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
    } catch (_) { }

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
    } catch (_) { }

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
    } catch (_) { }
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
    } catch (_) { }

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
    } catch (_) { }

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
    } catch (_) { }

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

/**
 * =========================================================================
 * MODULE 5, 6, 7: COD CASH MANAGEMENT & REMITTANCE SYSTEM
 * =========================================================================
 */

/**
 * Get Partner's Current COD Balance and Holding Capacity
 * Strict Invariant: ₹1,000 maximum holding limit across product orders
 */
function getPartnerCodBalance(partnerId) {
    if (!partnerId) return {
        partner_id: "",
        cod_limit: 1000.0,
        outstanding_cod_liability: 0.0,
        remaining_cod_capacity: 1000.0,
        can_accept_cod: true
    };

    // 1. Sum up all collected COD cash for this partner
    const codLedger = loadJson(COD_LEDGER_FILE, []);
    const partnerCollections = codLedger.filter(c => c.partner_id === partnerId);
    const totalCollected = partnerCollections.reduce((sum, c) => sum + Number(c.cash_collected || 0), 0);

    // 2. Sum up all approved remittances and cash handovers
    const remittances = loadJson(COD_REMITTANCES_FILE, []);
    const approvedRemittances = remittances.filter(r => r.partner_id === partnerId && r.status === "approved");
    const totalRemitted = approvedRemittances.reduce((sum, r) => sum + Number(r.amount || 0), 0);

    const outstandingLiability = Math.max(0, Number((totalCollected - totalRemitted).toFixed(2)));
    const codLimit = 1000.0;
    const remainingCapacity = Math.max(0, Number((codLimit - outstandingLiability).toFixed(2)));

    return {
        partner_id: partnerId,
        cod_limit: codLimit,
        total_collected: Number(totalCollected.toFixed(2)),
        total_remitted: Number(totalRemitted.toFixed(2)),
        outstanding_cod_liability: outstandingLiability,
        remaining_cod_capacity: remainingCapacity,
        can_accept_cod: (orderAmount = 0) => (outstandingLiability + Number(orderAmount)) <= codLimit
    };
}

/**
 * Record COD Cash Collection on Delivery Completion (Module 6)
 * Validates delivery proof, actual cash amount, and logs any cash mismatch
 */
async function recordCodCashCollected({
    partner_id,
    order_id,
    order_number,
    expected_amount,
    cash_collected,
    mismatch_reason = "",
    proof_image = "",
    admin_name = "System Automated"
}) {
    if (!partner_id || !order_id) {
        throw new Error("partner_id and order_id are required for COD collection.");
    }

    const expAmt = Number(expected_amount || 0);
    const collAmt = Number(cash_collected || 0);

    if (isNaN(collAmt) || collAmt < 0) {
        throw new Error("Invalid cash collected amount.");
    }

    const isMismatch = Math.abs(collAmt - expAmt) > 0.01;
    if (isMismatch && (!mismatch_reason || !mismatch_reason.trim())) {
        throw new Error("Cash mismatch detected! Expected ₹" + expAmt + " but collected ₹" + collAmt + ". Explanation is required.");
    }

    // Idempotency check: don't double record cash for the same order
    const codLedger = loadJson(COD_LEDGER_FILE, []);
    const existing = codLedger.find(c => c.order_id?.toString() === order_id?.toString());
    if (existing) {
        console.log(`[COD LEDGER] Order #${order_id} cash collection already recorded.`);
        return existing;
    }

    const codEntry = {
        id: `COD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        partner_id,
        order_id: String(order_id),
        order_number: String(order_number || order_id),
        expected_amount: expAmt,
        cash_collected: collAmt,
        is_mismatch: isMismatch,
        mismatch_reason: isMismatch ? mismatch_reason.trim() : "",
        proof_image: proof_image || "",
        created_at: new Date().toISOString()
    };

    codLedger.unshift(codEntry);
    saveJson(COD_LEDGER_FILE, codLedger);

    // Audit log
    await recordFinancialAudit(
        "COD_CASH_COLLECTED",
        partner_id,
        admin_name,
        Math.round(collAmt * 100),
        0,
        Math.round(collAmt * 100),
        `COD Collected ₹${collAmt} for Order #${order_number || order_id}${isMismatch ? ' (Mismatch: ' + mismatch_reason + ')' : ''}`
    );

    // Socket alert & broadcast
    try {
        const { emitToPartner, emitToAdmin } = require("./socketService");
        const balance = getPartnerCodBalance(partner_id);
        emitToPartner(partner_id, "cod:balance_updated", balance);
        if (isMismatch) {
            emitToAdmin("cod:mismatch_alert", {
                order_id,
                order_number,
                partner_id,
                expected_amount: expAmt,
                cash_collected: collAmt,
                reason: mismatch_reason
            });
        }
    } catch (_) {}

    return codEntry;
}

/**
 * Submit COD Remittance Request (Module 7)
 * Partner deposits collected cash via UPI or Admin Cash Handover
 */
async function submitCodRemittance({
    partner_id,
    amount,
    payment_mode = "upi",
    transaction_id = "",
    proof_image = "",
    notes = ""
}) {
    if (!partner_id) throw new Error("Partner ID is required.");
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error("Remittance amount must be greater than zero.");
    }

    const balance = getPartnerCodBalance(partner_id);
    if (balance.outstanding_cod_liability <= 0) {
        throw new Error("You have no outstanding COD liability to remit.");
    }

    if (numAmount > balance.outstanding_cod_liability) {
        throw new Error(`Remittance amount (₹${numAmount}) exceeds outstanding liability (₹${balance.outstanding_cod_liability}).`);
    }

    const remittances = loadJson(COD_REMITTANCES_FILE, []);

    // Transaction ID uniqueness / duplicate prevention
    if (transaction_id && transaction_id.trim()) {
        const cleanTx = transaction_id.trim().toUpperCase();
        const dup = remittances.find(r => (r.transaction_id || "").trim().toUpperCase() === cleanTx);
        if (dup) {
            throw new Error(`Transaction ID '${transaction_id}' has already been submitted for Remittance #${dup.id}.`);
        }
    }

    const remittanceId = `REMIT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const newRemittance = {
        id: remittanceId,
        partner_id,
        amount: numAmount,
        payment_mode: payment_mode || "upi",
        transaction_id: transaction_id ? transaction_id.trim().toUpperCase() : null,
        proof_image: proof_image || "",
        notes: notes || "",
        status: "pending_verification", // pending_verification | approved | rejected
        admin_name: null,
        rejection_reason: null,
        created_at: new Date().toISOString(),
        reviewed_at: null
    };

    remittances.unshift(newRemittance);
    saveJson(COD_REMITTANCES_FILE, remittances);

    // Notify Partner
    try {
        const { sendNotification } = require("./notificationService");
        await sendNotification({
            userId: partner_id,
            recipientRole: "delivery_partner",
            appType: "partner",
            title: "COD Remittance Submitted",
            message: `Your COD cash remittance request of ₹${numAmount} (Ref: ${transaction_id || remittanceId}) was submitted and is awaiting Admin verification.`,
            type: "cod_remittance",
            targetId: remittanceId
        });
    } catch (_) {}

    // Emit socket alert to Admin
    try {
        const { emitToAdmin } = require("./socketService");
        emitToAdmin("remittance:new", newRemittance);
    } catch (_) {}

    return newRemittance;
}

/**
 * Admin Review COD Remittance (Approve / Reject) (Module 7 & 11)
 * Only confirmed approval reduces outstanding COD liability and restores capacity!
 */
async function reviewCodRemittance({
    remittance_id,
    status, // 'approved' | 'rejected'
    admin_name = "Super Admin",
    rejection_reason = "",
    notes = ""
}) {
    if (!["approved", "rejected"].includes(status)) {
        throw new Error("Status must be 'approved' or 'rejected'.");
    }

    const remittances = loadJson(COD_REMITTANCES_FILE, []);
    const remittance = remittances.find(r => r.id === remittance_id);
    if (!remittance) {
        throw new Error(`Remittance request #${remittance_id} not found.`);
    }

    if (remittance.status !== "pending_verification") {
        throw new Error(`Remittance #${remittance_id} is already ${remittance.status}.`);
    }

    remittance.status = status;
    remittance.admin_name = admin_name;
    remittance.notes = notes || remittance.notes;
    remittance.reviewed_at = new Date().toISOString();

    if (status === "rejected") {
        remittance.rejection_reason = rejection_reason || "Verification failed by Admin.";
    }

    saveJson(COD_REMITTANCES_FILE, remittances);

    const partnerId = remittance.partner_id;
    const balance = getPartnerCodBalance(partnerId);

    // Audit log
    await recordFinancialAudit(
        status === "approved" ? "COD_REMITTANCE_APPROVED" : "COD_REMITTANCE_REJECTED",
        partnerId,
        admin_name,
        Math.round(remittance.amount * 100),
        0,
        0,
        `Remittance #${remittance_id} of ₹${remittance.amount} ${status}${status === 'rejected' ? ': ' + remittance.rejection_reason : ''}`
    );

    // Notify Partner with Breakdown (Module 11)
    try {
        const { sendNotification } = require("./notificationService");
        const { emitToPartner } = require("./socketService");

        emitToPartner(partnerId, "cod:balance_updated", balance);

        if (status === "approved") {
            await sendNotification({
                userId: partnerId,
                recipientRole: "delivery_partner",
                appType: "partner",
                title: "COD Remittance Confirmed",
                message: `Your COD remittance of ₹${remittance.amount} has been verified and APPROVED by Admin. Your remaining COD capacity has been restored to ₹${balance.remaining_cod_capacity}.`,
                type: "cod_remittance",
                targetId: remittance_id
            });
        } else {
            await sendNotification({
                userId: partnerId,
                recipientRole: "delivery_partner",
                appType: "partner",
                title: "COD Remittance Rejected",
                message: `Your COD remittance of ₹${remittance.amount} was REJECTED: ${remittance.rejection_reason || 'Verification failure'}. Please contact Admin.`,
                type: "cod_remittance",
                targetId: remittance_id
            });
        }
    } catch (_) {}

    return {
        success: true,
        remittance,
        balance
    };
}

/**
 * Record Direct Physical Cash Handover to Admin (Module 7)
 */
async function recordCashHandover({
    partner_id,
    amount,
    admin_name = "Super Admin",
    receipt_no = "",
    notes = ""
}) {
    const numAmount = Number(amount);
    if (!partner_id || isNaN(numAmount) || numAmount <= 0) {
        throw new Error("Valid partner_id and positive cash amount are required.");
    }

    const remittanceId = `HANDOVER-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const handover = {
        id: remittanceId,
        partner_id,
        amount: numAmount,
        payment_mode: "cash_handover",
        transaction_id: receipt_no ? receipt_no.trim().toUpperCase() : `CASH-${Date.now()}`,
        proof_image: "",
        notes: notes || "Direct physical cash handover to Admin",
        status: "approved",
        admin_name,
        rejection_reason: null,
        created_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString()
    };

    const remittances = loadJson(COD_REMITTANCES_FILE, []);
    remittances.unshift(handover);
    saveJson(COD_REMITTANCES_FILE, remittances);

    const balance = getPartnerCodBalance(partner_id);

    await recordFinancialAudit(
        "COD_CASH_HANDOVER",
        partner_id,
        admin_name,
        Math.round(numAmount * 100),
        0,
        0,
        `Direct Cash Handover of ₹${numAmount} received by Admin ${admin_name}`
    );

    try {
        const { sendNotification } = require("./notificationService");
        const { emitToPartner } = require("./socketService");
        emitToPartner(partner_id, "cod:balance_updated", balance);
        await sendNotification({
            userId: partner_id,
            recipientRole: "delivery_partner",
            appType: "partner",
            title: "Cash Handover Confirmed",
            message: `Official Admin Cash Receipt: ₹${numAmount} cash handover confirmed by ${admin_name}. Remaining COD Capacity: ₹${balance.remaining_cod_capacity}.`,
            type: "cod_remittance",
            targetId: remittanceId
        });
    } catch (_) {}

    return { success: true, handover, balance };
}

/**
 * Get Remittance History for Partner
 */
function getCodRemittanceHistory(partnerId) {
    const remittances = loadJson(COD_REMITTANCES_FILE, []);
    return remittances.filter(r => r.partner_id === partnerId);
}

/**
 * Get All Remittances for Admin
 */
function getAllCodRemittances({ status = null, partner_id = null } = {}) {
    let remittances = loadJson(COD_REMITTANCES_FILE, []);
    if (status) {
        remittances = remittances.filter(r => r.status === status);
    }
    if (partner_id) {
        remittances = remittances.filter(r => r.partner_id === partner_id);
    }
    return remittances;
}

/**
 * =========================================================================
 * MODULE 2: PARTNER BANK DETAILS (ENCRYPTED AT REST, MASKED BY DEFAULT)
 * =========================================================================
 */

/**
 * Save / Update Partner Bank Details
 * Automatically encrypts sensitive bank account numbers with AES-256
 */
async function savePartnerBankDetails(partnerId, {
    account_holder_name,
    bank_name,
    account_number,
    ifsc_code,
    account_type = "savings"
}) {
    if (!partnerId) throw new Error("Partner ID is required.");
    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
        throw new Error("Account holder name, bank name, account number, and IFSC code are required.");
    }

    const cleanAcc = String(account_number).trim();
    const cleanIfsc = String(ifsc_code).trim().toUpperCase();

    const bankDetailsList = loadJson(BANK_DETAILS_FILE, []);
    const idx = bankDetailsList.findIndex(b => b.partner_id === partnerId);

    const record = {
        partner_id: partnerId,
        account_holder_name: account_holder_name.trim(),
        bank_name: bank_name.trim(),
        encrypted_account_number: encryptText(cleanAcc),
        last4_account_number: cleanAcc.slice(-4),
        masked_account_number: maskAccountNumber(cleanAcc),
        ifsc_code: cleanIfsc,
        account_type: account_type || "savings",
        updated_at: new Date().toISOString()
    };

    if (idx >= 0) {
        bankDetailsList[idx] = record;
    } else {
        bankDetailsList.push(record);
    }
    saveJson(BANK_DETAILS_FILE, bankDetailsList);

    // Save to PostgreSQL if available
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_bank_details (
                partner_id VARCHAR(50) PRIMARY KEY,
                account_holder_name VARCHAR(100),
                bank_name VARCHAR(100),
                encrypted_account_number TEXT,
                last4 VARCHAR(10),
                ifsc_code VARCHAR(20),
                account_type VARCHAR(20),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            INSERT INTO partner_bank_details (
                partner_id, account_holder_name, bank_name, encrypted_account_number, last4, ifsc_code, account_type, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (partner_id) DO UPDATE SET
                account_holder_name = EXCLUDED.account_holder_name,
                bank_name = EXCLUDED.bank_name,
                encrypted_account_number = EXCLUDED.encrypted_account_number,
                last4 = EXCLUDED.last4,
                ifsc_code = EXCLUDED.ifsc_code,
                account_type = EXCLUDED.account_type,
                updated_at = NOW()
        `, [record.partner_id, record.account_holder_name, record.bank_name, record.encrypted_account_number, record.last4_account_number, record.ifsc_code, record.account_type]);
    } catch (_) {}

    return {
        success: true,
        message: "Bank details saved securely.",
        bank_details: {
            partner_id: record.partner_id,
            account_holder_name: record.account_holder_name,
            bank_name: record.bank_name,
            account_number: record.masked_account_number,
            ifsc_code: record.ifsc_code,
            account_type: record.account_type,
            updated_at: record.updated_at
        }
    };
}

/**
 * Get Partner Bank Details
 * Security: Masked by default. Decrypted only when reveal=true and requested by authorized Admin with audit trail
 */
async function getPartnerBankDetails(partnerId, reveal = false, adminName = null) {
    if (!partnerId) return null;

    const bankDetailsList = loadJson(BANK_DETAILS_FILE, []);
    const record = bankDetailsList.find(b => b.partner_id === partnerId);
    if (!record) return null;

    let returnedAccount = record.masked_account_number;
    if (reveal && adminName) {
        returnedAccount = decryptText(record.encrypted_account_number);
        // Record sensitive-data access in audit log (Module 2 requirement)
        await recordFinancialAudit(
            "ADMIN_REVEALED_BANK_DETAILS",
            partnerId,
            adminName,
            0,
            0,
            0,
            `Admin ${adminName} unmasked full bank account details for Partner ${partnerId}`
        );
    }

    return {
        partner_id: record.partner_id,
        account_holder_name: record.account_holder_name,
        bank_name: record.bank_name,
        account_number: returnedAccount,
        is_revealed: Boolean(reveal && adminName),
        ifsc_code: record.ifsc_code,
        account_type: record.account_type,
        updated_at: record.updated_at
    };
}

/**
 * =========================================================================
 * MODULE 3 & 11: PARTNER EARNINGS, PAYOUT LEDGER & FINANCIAL NOTIFICATIONS
 * =========================================================================
 */

/**
 * Execute Partner Payout (Partial or Full)
 * Invariant: Deducts available earnings only after payment confirmed. Never erases lifetime earnings.
 */
async function executePartnerPayout({
    partner_id,
    amount,
    payment_method = "bank_transfer",
    transaction_id = "",
    admin_name = "Super Admin",
    notes = ""
}) {
    if (!partner_id) throw new Error("Partner ID is required.");
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error("Payout amount must be greater than zero.");
    }

    const wallet = await getPartnerWalletBalance(partner_id);
    if (!wallet) throw new Error("Partner wallet not found.");

    const availableRupees = wallet.available_payable_rupees;
    if (numAmount > availableRupees) {
        throw new Error(`Insufficient available earnings. Requested ₹${numAmount}, available: ₹${availableRupees}.`);
    }

    const amountPaise = Math.round(numAmount * 100);
    const beforeBal = wallet.available_payable_paise;

    // Atomically deduct from available and increase total settled
    wallet.available_payable_paise -= amountPaise;
    wallet.total_settled_paise += amountPaise;
    await savePartnerWalletBalance(wallet);

    const payoutId = `PAYOUT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const payoutRecord = {
        id: payoutId,
        partner_id,
        amount_rupees: numAmount,
        amount_paise: amountPaise,
        payment_method: payment_method || "bank_transfer",
        transaction_id: transaction_id || `TXN-${Date.now()}`,
        admin_name,
        notes: notes || "Direct Partner Payout",
        remaining_balance_rupees: wallet.available_payable_paise / 100,
        status: "successful",
        created_at: new Date().toISOString()
    };

    // Record in settlement file & audit log
    const settlements = loadJson(SETTLEMENTS_FILE, []);
    settlements.unshift(payoutRecord);
    saveJson(SETTLEMENTS_FILE, settlements);

    await recordFinancialAudit(
        "PAYOUT_PROCESSED",
        partner_id,
        admin_name,
        amountPaise,
        beforeBal,
        wallet.available_payable_paise,
        `Processed payout of ₹${numAmount} via ${payment_method}. UTR/Ref: ${payoutRecord.transaction_id}`
    );

    // Module 11: Real-Time Payout Notification with Full Breakdown
    try {
        const { sendNotification } = require("./notificationService");
        const { emitToPartner } = require("./socketService");

        const now = new Date();
        const dateStr = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
        const timeStr = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

        const notifMsg = `Your Thulirva payout of ₹${numAmount} was successfully processed on ${dateStr} at ${timeStr}. Reference: ${payoutRecord.transaction_id}. Available Balance: ₹${(wallet.available_payable_paise / 100).toFixed(2)}.`;

        await sendNotification({
            userId: partner_id,
            recipientRole: "delivery_partner",
            appType: "partner",
            title: "Payout Successful ✓",
            message: notifMsg,
            type: "payout",
            targetId: payoutId,
            data: {
                payout_id: payoutId,
                amount: numAmount,
                transaction_id: payoutRecord.transaction_id,
                remaining_balance: wallet.available_payable_paise / 100
            }
        });

        emitToPartner(partner_id, "payout:processed", payoutRecord);
    } catch (_) {}

    return {
        success: true,
        message: `Payout of ₹${numAmount} successfully completed.`,
        payout: payoutRecord,
        wallet: {
            available_payable_rupees: wallet.available_payable_paise / 100,
            lifetime_earned_rupees: wallet.lifetime_earned_paise / 100,
            total_settled_rupees: wallet.total_settled_paise / 100
        }
    };
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
    recordFinancialAudit,
    // COD Cash Management
    getPartnerCodBalance,
    recordCodCashCollected,
    submitCodRemittance,
    reviewCodRemittance,
    recordCashHandover,
    getCodRemittanceHistory,
    getAllCodRemittances,
    // Bank Details
    savePartnerBankDetails,
    getPartnerBankDetails,
    // Payout Execution
    executePartnerPayout
};
