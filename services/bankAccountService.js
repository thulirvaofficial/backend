const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const BANK_ACCOUNTS_FILE = path.join(DATA_DIR, "partner_bank_accounts.json");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadAccounts() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(BANK_ACCOUNTS_FILE)) {
            return JSON.parse(fs.readFileSync(BANK_ACCOUNTS_FILE, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function saveAccounts(accounts) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(BANK_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf-8");
    } catch (_) {}
}

/**
 * Validate Indian IFSC Code format
 */
function isValidIFSC(ifsc) {
    if (!ifsc || typeof ifsc !== "string") return false;
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

/**
 * Get all bank accounts for a partner
 */
async function getPartnerBankAccounts(partnerId) {
    if (!partnerId) return [];
    try {
        const res = await pool.query(
            "SELECT * FROM partner_bank_accounts WHERE partner_id = $1 ORDER BY created_at DESC",
            [partnerId]
        );
        if (res.rows.length > 0) return res.rows;
    } catch (_) {}

    const all = loadAccounts();
    return all.filter(a => a.partner_id === partnerId);
}

/**
 * Add or update partner bank account
 */
async function addPartnerBankAccount({
    partner_id,
    account_holder_name,
    account_number,
    ifsc_code,
    bank_name,
    branch_name,
    passbook_url = null
}) {
    if (!partner_id || !account_holder_name || !account_number || !ifsc_code) {
        throw new Error("partner_id, account_holder_name, account_number, and ifsc_code are required.");
    }

    const cleanIfsc = ifsc_code.trim().toUpperCase();
    if (!isValidIFSC(cleanIfsc)) {
        throw new Error("Invalid IFSC code format. Expected e.g., HDFC0001234 or SBIN0005678.");
    }

    const cleanAcc = account_number.toString().trim().replace(/\s+/g, "");
    if (cleanAcc.length < 8 || cleanAcc.length > 20) {
        throw new Error("Invalid bank account number length (must be 8-20 digits).");
    }

    const accountId = `BANK-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const newAccount = {
        id: accountId,
        partner_id,
        account_holder_name: account_holder_name.trim(),
        account_number: cleanAcc,
        masked_account_number: `••••••••${cleanAcc.slice(-4)}`,
        ifsc_code: cleanIfsc,
        bank_name: bank_name || "Commercial Bank",
        branch_name: branch_name || "",
        passbook_url,
        is_verified: false,
        is_primary: true,
        verified_at: null,
        verified_by: null,
        created_at: new Date().toISOString()
    };

    const accounts = loadAccounts();
    // Demote any existing accounts from primary
    accounts.forEach(a => {
        if (a.partner_id === partner_id) a.is_primary = false;
    });
    accounts.unshift(newAccount);
    saveAccounts(accounts);

    try {
        await pool.query(`
            INSERT INTO partner_bank_accounts (
                id, partner_id, account_holder_name, account_number, ifsc_code,
                bank_name, branch_name, passbook_url, is_verified, is_primary, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        `, [
            newAccount.id, partner_id, newAccount.account_holder_name, cleanAcc,
            cleanIfsc, newAccount.bank_name, newAccount.branch_name, passbook_url,
            false, true
        ]);
    } catch (_) {}

    // Emit real-time notification
    try {
        const { emitToAdmin } = require("./socketService");
        emitToAdmin("partner:bank_updated", {
            partner_id,
            account_holder_name: newAccount.account_holder_name,
            bank_name: newAccount.bank_name
        });
    } catch (_) {}

    return newAccount;
}

/**
 * Verify partner bank account by admin
 */
async function verifyPartnerBankAccount(accountId, isVerified = true, adminName = "Operations Admin") {
    const accounts = loadAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (!account) throw new Error(`Bank account #${accountId} not found.`);

    account.is_verified = Boolean(isVerified);
    account.verified_at = isVerified ? new Date().toISOString() : null;
    account.verified_by = isVerified ? adminName : null;
    saveAccounts(accounts);

    try {
        await pool.query(`
            UPDATE partner_bank_accounts
            SET is_verified = $1, verified_at = $2, verified_by = $3
            WHERE id = $4
        `, [account.is_verified, account.verified_at, account.verified_by, accountId]);
    } catch (_) {}

    // Emit socket event to partner
    try {
        const { emitToPartner } = require("./socketService");
        emitToPartner(account.partner_id, "partner:bank_verified", {
            account_id: accountId,
            is_verified: account.is_verified,
            bank_name: account.bank_name
        });
    } catch (_) {}

    return account;
}

module.exports = {
    getPartnerBankAccounts,
    addPartnerBankAccount,
    verifyPartnerBankAccount,
    isValidIFSC
};

