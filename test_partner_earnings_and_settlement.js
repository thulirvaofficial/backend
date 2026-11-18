const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    getPartnerWalletBalance,
    recordEarningEntry,
    getPartnerLedger,
    savePartnerBankDetails,
    getPartnerBankDetails,
    executePartnerPayout
} = require("./services/financialService");

const TEST_PARTNER_ID = "TEST-DP-EARN-001";
const DATA_DIR = path.resolve(__dirname, "data");
const LEDGER_FILE = path.join(DATA_DIR, "partner_earning_ledger.json");
const BALANCES_FILE = path.join(DATA_DIR, "partner_wallet_balances.json");
const BANK_DETAILS_FILE = path.join(DATA_DIR, "partner_bank_details.json");
const SETTLEMENTS_FILE = path.join(DATA_DIR, "partner_settlements.json");

async function runEarningsTests() {
    console.log("=== THULIRVA PARTNER EARNINGS, SALARY & SETTLEMENTS TEST ===");

    // Clean test data before running
    const cleanData = () => {
        try {
            [LEDGER_FILE, BALANCES_FILE, BANK_DETAILS_FILE, SETTLEMENTS_FILE].forEach(file => {
                if (fs.existsSync(file)) {
                    let items = JSON.parse(fs.readFileSync(file, "utf-8"));
                    items = items.filter(x => x.partner_id !== TEST_PARTNER_ID);
                    fs.writeFileSync(file, JSON.stringify(items, null, 2));
                }
            });
        } catch (_) {}
    };

    cleanData();

    try {
        // Test 1: Initial Wallet
        console.log("[1] Checking initial wallet balance...");
        let wallet = await getPartnerWalletBalance(TEST_PARTNER_ID);
        assert.strictEqual(wallet.available_payable_rupees, 0);
        assert.strictEqual(wallet.lifetime_earned_rupees, 0);
        console.log("✓ Initial wallet balance is ₹0.");

        // Test 2: Credit Product Delivery Earning (₹45)
        console.log("[2] Crediting delivery earning for Order #ORD-101...");
        await recordEarningEntry({
            partner_id: TEST_PARTNER_ID,
            entry_type: "order_delivery",
            reference_id: "ORD-101",
            amount_in_rupees: 45.0,
            description: "Product delivery payout for Order #ORD-101"
        });

        wallet = await getPartnerWalletBalance(TEST_PARTNER_ID);
        assert.strictEqual(wallet.available_payable_rupees, 45.0, "Available balance must be ₹45");
        assert.strictEqual(wallet.lifetime_earned_rupees, 45.0, "Lifetime earned must be ₹45");
        console.log("✓ Delivery earning credited: Available ₹45.");

        // Test 3: Idempotency check (Duplicate delivery credit on same order must be ignored)
        console.log("[3] Testing double-credit prevention on Order #ORD-101...");
        await recordEarningEntry({
            partner_id: TEST_PARTNER_ID,
            entry_type: "order_delivery",
            reference_id: "ORD-101",
            amount_in_rupees: 45.0,
            description: "Duplicate payout attempt"
        });
        wallet = await getPartnerWalletBalance(TEST_PARTNER_ID);
        assert.strictEqual(wallet.available_payable_rupees, 45.0, "Double crediting must be strictly blocked");
        console.log("✓ Double-credit prevention verified: Balance remains ₹45.");

        // Test 4: Credit Subscription Monthly Salary (₹12,000)
        console.log("[4] Crediting subscription monthly salary (₹12,000)...");
        await recordEarningEntry({
            partner_id: TEST_PARTNER_ID,
            entry_type: "subscription_salary",
            reference_id: "SALARY-2026-11",
            amount_in_rupees: 12000.0,
            description: "Fixed monthly salary for November 2026 morning deliveries"
        });

        wallet = await getPartnerWalletBalance(TEST_PARTNER_ID);
        assert.strictEqual(wallet.available_payable_rupees, 12045.0, "Available balance must be ₹12,045");
        assert.strictEqual(wallet.lifetime_earned_rupees, 12045.0, "Lifetime earned must be ₹12,045");
        console.log("✓ Subscription monthly salary credited: Available ₹12,045.");

        // Test 5: Credit Incentive / Bonus (₹500)
        console.log("[5] Crediting performance bonus (₹500)...");
        await recordEarningEntry({
            partner_id: TEST_PARTNER_ID,
            entry_type: "performance_bonus",
            reference_id: "BONUS-FESTIVE-01",
            amount_in_rupees: 500.0,
            description: "Festival on-time delivery bonus"
        });

        wallet = await getPartnerWalletBalance(TEST_PARTNER_ID);
        assert.strictEqual(wallet.available_payable_rupees, 12545.0);
        console.log("✓ Performance bonus credited: Available ₹12,545.");

        // Test 6: Bank Account Encryption & Masking
        console.log("[6] Saving & verifying encrypted partner bank details...");
        const rawAccount = "50100456789123";
        await savePartnerBankDetails(TEST_PARTNER_ID, {
            account_holder_name: "Hero Delivery Partner",
            bank_name: "HDFC Bank",
            account_number: rawAccount,
            ifsc_code: "HDFC0001234",
            account_type: "savings"
        });

        // Safe masked view for regular displays
        const maskedBank = await getPartnerBankDetails(TEST_PARTNER_ID);
        assert.strictEqual(maskedBank.account_number, "XXXX-XXXX-9123", "Account must be masked");
        assert.strictEqual(maskedBank.is_revealed, false);
        assert(!JSON.stringify(maskedBank).includes(rawAccount), "Raw account must never appear in unencrypted read");

        // Authorized decrypted reveal for finance admin with audit logging
        const decryptedBank = await getPartnerBankDetails(TEST_PARTNER_ID, true, "Operations Admin");
        assert.strictEqual(decryptedBank.account_number, rawAccount, "Decrypted account must match original");
        assert.strictEqual(decryptedBank.is_revealed, true);
        console.log("✓ Bank details encryption & authorized reveal verified.");

        // Test 7: Settle Partner Payout (₹12,545)
        console.log("[7] Processing settlement payout for partner...");
        const payoutResult = await executePartnerPayout({
            partner_id: TEST_PARTNER_ID,
            amount: 12545.0,
            payment_method: "bank_transfer",
            transaction_id: "NEFT-HDFC-998877",
            admin_name: "Finance Manager",
            notes: "Monthly payout settlement"
        });
        assert(payoutResult.success, "Payout execution must succeed");
        assert.strictEqual(payoutResult.wallet.available_payable_rupees, 0.0);
        assert.strictEqual(payoutResult.wallet.total_settled_rupees, 12545.0);

        wallet = await getPartnerWalletBalance(TEST_PARTNER_ID);
        assert.strictEqual(wallet.available_payable_rupees, 0.0, "Available balance must be 0 after full payout");
        assert.strictEqual(wallet.total_settled_rupees, 12545.0, "Total settled must be ₹12,545");
        assert.strictEqual(wallet.lifetime_earned_rupees, 12545.0, "Lifetime earned remains ₹12,545");
        console.log("✓ Settlement confirmed: Available balance 0, total settled ₹12,545.");

        // Test 8: Prevent duplicate payout when balance is 0
        console.log("[8] Testing duplicate payout prevention on zero balance...");
        let dupFailed = false;
        try {
            await executePartnerPayout({
                partner_id: TEST_PARTNER_ID,
                amount: 500.0,
                payment_method: "bank_transfer",
                transaction_id: "NEFT-DUP-001"
            });
        } catch (e) {
            dupFailed = true;
            assert(e.message.includes("Insufficient available earnings"));
        }
        assert(dupFailed, "Payout exceeding available balance must be rejected");
        console.log("✓ Double payout prevention verified: Insufficient balance rejected.");

        console.log("\n=======================================================");
        console.log("✓ ALL PARTNER EARNINGS & SETTLEMENT TESTS PASSED (8/8)");
        console.log("=======================================================\n");
    } finally {
        cleanData();
    }
}

runEarningsTests().catch(err => {
    console.error("EARNINGS TEST FAILED:", err);
    process.exit(1);
});
