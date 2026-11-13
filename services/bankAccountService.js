const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const BANK_ACCOUNTS_FILE = path.join(DATA_DIR, "partner_bank_accounts.json");

const PASSBOOKS_DIR = path.resolve(__dirname, "..", "uploads", "passbooks");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(PASSBOOKS_DIR)) {
        fs.mkdirSync(PASSBOOKS_DIR, { recursive: true });
    }
}

function savePassbookFromBase64(base64Data, filename) {
    ensureDirectoryExists();
    try {
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const filePath = path.join(PASSBOOKS_DIR, filename);
        fs.writeFileSync(filePath, buffer);
        return `/uploads/passbooks/${filename}`;
    } catch (e) {
        console.warn("[PASSBOOK SAVE WARN]:", e.message);
        return null;
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
    account_type = "Savings",
    passbook_url = null,
    passbook_base64 = null
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

    let resolvedPassbookUrl = passbook_url;
    if (passbook_base64) {
        const filename = `passbook_${partner_id}_${Date.now()}.jpg`;
        resolvedPassbookUrl = savePassbookFromBase64(passbook_base64, filename);
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
        account_type: account_type || "Savings",
        passbook_url: resolvedPassbookUrl,
        verification_status: "PENDING",
        rejection_reason: null,
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
            CREATE TABLE IF NOT EXISTS partner_bank_accounts (
                id VARCHAR(100) PRIMARY KEY,
                partner_id VARCHAR(50) NOT NULL,
                account_holder_name VARCHAR(100) NOT NULL,
                account_number VARCHAR(50) NOT NULL,
                ifsc_code VARCHAR(20) NOT NULL,
                bank_name VARCHAR(100),
                branch_name VARCHAR(100),
                account_type VARCHAR(30) DEFAULT 'Savings',
                passbook_url TEXT,
                verification_status VARCHAR(30) DEFAULT 'PENDING',
                rejection_reason TEXT,
                is_verified BOOLEAN DEFAULT false,
                is_primary BOOLEAN DEFAULT true,
                verified_at TIMESTAMP,
                verified_by VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            INSERT INTO partner_bank_accounts (
                id, partner_id, account_holder_name, account_number, ifsc_code,
                bank_name, branch_name, account_type, passbook_url, verification_status,
                is_verified, is_primary, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',false,true,NOW())
            ON CONFLICT (id) DO UPDATE
            SET account_holder_name=EXCLUDED.account_holder_name,
                account_number=EXCLUDED.account_number,
                ifsc_code=EXCLUDED.ifsc_code,
                bank_name=EXCLUDED.bank_name,
                branch_name=EXCLUDED.branch_name,
                account_type=EXCLUDED.account_type,
                passbook_url=EXCLUDED.passbook_url,
                verification_status='PENDING',
                is_verified=false
        `, [
            newAccount.id, partner_id, newAccount.account_holder_name, cleanAcc,
            cleanIfsc, newAccount.bank_name, newAccount.branch_name,
            newAccount.account_type, resolvedPassbookUrl
        ]);
    } catch (_) {}

    // Emit real-time notification
    try {
        const { emitToAdmin } = require("./socketService");
        emitToAdmin("partner:bank_updated", {
            partner_id,
            account_id: newAccount.id,
            account_holder_name: newAccount.account_holder_name,
            bank_name: newAccount.bank_name,
            verification_status: "PENDING"
        });
    } catch (_) {}

    return newAccount;
}

/**
 * Verify partner bank account by admin
 */
async function reviewPartnerBankAccount(accountId, status, rejectionReason = null, adminName = "Operations Admin") {
    const accounts = loadAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (!account) throw new Error(`Bank account #${accountId} not found.`);

    const isApproved = status === "APPROVED" || status === true;
    account.verification_status = isApproved ? "APPROVED" : "REJECTED";
    account.is_verified = isApproved;
    account.rejection_reason = isApproved ? null : (rejectionReason || "Details do not match official bank records");
    account.verified_at = isApproved ? new Date().toISOString() : null;
    account.verified_by = adminName;
    saveAccounts(accounts);

    try {
        await pool.query(`
            UPDATE partner_bank_accounts
            SET verification_status = $1, is_verified = $2, rejection_reason = $3,
                verified_at = $4, verified_by = $5
            WHERE id = $6
        `, [
            account.verification_status, account.is_verified, account.rejection_reason,
            account.verified_at, account.verified_by, accountId
        ]);
    } catch (_) {}

    // Emit socket event to partner
    try {
        const { emitToPartner } = require("./socketService");
        emitToPartner(account.partner_id, "partner:bank_reviewed", {
            account_id: accountId,
            verification_status: account.verification_status,
            is_verified: account.is_verified,
            rejection_reason: account.rejection_reason,
            bank_name: account.bank_name
        });
    } catch (_) {}

    return account;
}

/**
 * Backward compatibility alias for verifying bank account
 */
async function verifyPartnerBankAccount(accountId, adminName = "Operations Admin") {
    return reviewPartnerBankAccount(accountId, "APPROVED", null, adminName);
}

/**
 * Get all partner bank accounts for Admin review
 */
async function getAllPartnerBankAccounts({ status = null } = {}) {
    try {
        let sql = "SELECT * FROM partner_bank_accounts";
        const params = [];
        if (status && status !== "ALL") {
            params.push(status.toUpperCase());
            sql += ` WHERE verification_status = $${params.length}`;
        }
        sql += " ORDER BY created_at DESC";
        const res = await pool.query(sql, params);
        if (res.rows && res.rows.length > 0) return res.rows;
    } catch (_) {}

    const all = loadAccounts();
    if (status && status !== "ALL") {
        return all.filter(a => (a.verification_status || (a.is_verified ? "APPROVED" : "PENDING")).toUpperCase() === status.toUpperCase());
    }
    return all;
}

module.exports = {
    getPartnerBankAccounts,
    getAllPartnerBankAccounts,
    addPartnerBankAccount,
    verifyPartnerBankAccount,
    reviewPartnerBankAccount,
    isValidIFSC
};

