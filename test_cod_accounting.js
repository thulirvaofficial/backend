const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    getPartnerCodBalance,
    recordCodCashCollected,
    submitCodRemittance,
    reviewCodRemittance,
    getAllCodRemittances,
    getCodRemittanceHistory
} = require("./services/financialService");

const TEST_PARTNER_ID = "TEST-DP-COD-001";
const DATA_DIR = path.resolve(__dirname, "data");
const COD_LEDGER_FILE = path.join(DATA_DIR, "cod_ledger.json");
const COD_REMITTANCES_FILE = path.join(DATA_DIR, "cod_remittances.json");

async function runCodTests() {
    console.log("=== THULIRVA COD CASH COLLECTION & REMITTANCE AUDIT ===");

    // Clean test data before running
    const cleanData = () => {
        try {
            if (fs.existsSync(COD_LEDGER_FILE)) {
                let l = JSON.parse(fs.readFileSync(COD_LEDGER_FILE, "utf-8"));
                l = l.filter(c => c.partner_id !== TEST_PARTNER_ID);
                fs.writeFileSync(COD_LEDGER_FILE, JSON.stringify(l, null, 2));
            }
            if (fs.existsSync(COD_REMITTANCES_FILE)) {
                let r = JSON.parse(fs.readFileSync(COD_REMITTANCES_FILE, "utf-8"));
                r = r.filter(c => c.partner_id !== TEST_PARTNER_ID);
                fs.writeFileSync(COD_REMITTANCES_FILE, JSON.stringify(r, null, 2));
            }
        } catch (_) {}
    };

    cleanData();

    try {
        // Test 1: Initial COD Balance
        console.log("[1] Testing initial COD balance...");
        let balance = getPartnerCodBalance(TEST_PARTNER_ID);
        assert.strictEqual(balance.cod_limit, 1000.0, "COD limit must be ₹1000");
        assert.strictEqual(balance.outstanding_cod_liability, 0, "Initial liability must be 0");
        assert.strictEqual(balance.remaining_cod_capacity, 1000.0, "Initial remaining capacity must be ₹1000");
        assert(balance.can_accept_cod(500), "Partner must be able to accept order below limit");
        console.log("✓ Initial COD balance verified: ₹1,000 capacity, ₹0 liability.");

        // Test 2: First COD Collection (₹500)
        console.log("[2] Recording first COD collection (₹500)...");
        await recordCodCashCollected({
            partner_id: TEST_PARTNER_ID,
            order_id: "ORD-COD-001",
            order_number: "ORD-COD-001",
            expected_amount: 500,
            cash_collected: 500,
            proof_image: "/uploads/proofs/test1.jpg"
        });

        balance = getPartnerCodBalance(TEST_PARTNER_ID);
        assert.strictEqual(balance.outstanding_cod_liability, 500, "Liability must be ₹500");
        assert.strictEqual(balance.remaining_cod_capacity, 500, "Remaining capacity must be ₹500");
        console.log("✓ First collection verified: ₹500 liability, ₹500 capacity.");

        // Test 3: Idempotency (prevent duplicate collection on same order)
        console.log("[3] Testing collection idempotency...");
        await recordCodCashCollected({
            partner_id: TEST_PARTNER_ID,
            order_id: "ORD-COD-001",
            order_number: "ORD-COD-001",
            expected_amount: 500,
            cash_collected: 500
        });
        balance = getPartnerCodBalance(TEST_PARTNER_ID);
        assert.strictEqual(balance.outstanding_cod_liability, 500, "Duplicate collection must be ignored");
        console.log("✓ Idempotency verified: Duplicate collection ignored.");

        // Test 4: Second COD Collection (₹400) -> Total Liability ₹900, Capacity ₹100
        console.log("[4] Recording second COD collection (₹400)...");
        await recordCodCashCollected({
            partner_id: TEST_PARTNER_ID,
            order_id: "ORD-COD-002",
            order_number: "ORD-COD-002",
            expected_amount: 400,
            cash_collected: 400
        });
        balance = getPartnerCodBalance(TEST_PARTNER_ID);
        assert.strictEqual(balance.outstanding_cod_liability, 900, "Liability must be ₹900");
        assert.strictEqual(balance.remaining_cod_capacity, 100, "Remaining capacity must be ₹100");
        assert(balance.can_accept_cod(100), "Can accept ₹100 order");
        assert(!balance.can_accept_cod(150), "Cannot accept ₹150 order (exceeds ₹1,000 limit)");
        console.log("✓ Second collection verified: ₹900 liability, ₹100 capacity. ₹1000 limit enforced.");

        // Test 5: Submit Remittance (₹600)
        console.log("[5] Submitting COD remittance of ₹600 via UPI...");
        const remittance = await submitCodRemittance({
            partner_id: TEST_PARTNER_ID,
            amount: 600,
            payment_mode: "upi",
            transaction_id: "UPI987654321098",
            proof_image: "/uploads/remittances/screenshot1.jpg",
            notes: "UPI payment to company account"
        });
        assert.strictEqual(remittance.status, "pending_verification", "Remittance must start as pending_verification");
        assert.strictEqual(remittance.amount, 600);

        // Verification: Screenshot/submission alone must NEVER reduce liability!
        balance = getPartnerCodBalance(TEST_PARTNER_ID);
        assert.strictEqual(balance.outstanding_cod_liability, 900, "Liability must remain ₹900 until Admin verifies!");
        console.log("✓ Submission verified: Liability remains unchanged at ₹900 pending admin approval.");

        // Test 6: Duplicate Transaction ID protection
        console.log("[6] Testing duplicate transaction ID protection...");
        let dupFailed = false;
        try {
            await submitCodRemittance({
                partner_id: TEST_PARTNER_ID,
                amount: 100,
                transaction_id: "UPI987654321098"
            });
        } catch (e) {
            dupFailed = true;
            assert(e.message.includes("already been submitted"), "Error message must indicate duplicate tx");
        }
        assert(dupFailed, "Duplicate transaction ID must be rejected");
        console.log("✓ Duplicate transaction ID successfully rejected.");

        // Test 7: Admin Approval of Remittance
        console.log("[7] Admin reviews and approves remittance...");
        const reviewResult = await reviewCodRemittance({
            remittance_id: remittance.id,
            status: "approved",
            admin_name: "Finance Admin Test",
            notes: "Bank credit verified on HDFC statement"
        });
        assert(reviewResult.success);

        // Liability must now be reduced by ₹600: 900 - 600 = 300, Capacity restored to 1000 - 300 = 700!
        balance = getPartnerCodBalance(TEST_PARTNER_ID);
        assert.strictEqual(balance.outstanding_cod_liability, 300, "Liability must now be ₹300");
        assert.strictEqual(balance.remaining_cod_capacity, 700, "Capacity must now be restored to ₹700");
        console.log("✓ Admin approval verified: Liability reduced to ₹300, capacity restored to ₹700.");

        // Test 8: Admin Rejection of invalid remittance
        console.log("[8] Testing rejection of fake remittance...");
        const fakeRemit = await submitCodRemittance({
            partner_id: TEST_PARTNER_ID,
            amount: 200,
            payment_mode: "upi",
            transaction_id: "FAKE-TXN-1111",
            notes: "Unverified transaction"
        });
        const rejectResult = await reviewCodRemittance({
            remittance_id: fakeRemit.id,
            status: "rejected",
            admin_name: "Finance Admin Test",
            rejection_reason: "Bank credit not reflected in company account."
        });
        assert(rejectResult.success);

        // Liability must remain ₹300, NOT reduced!
        balance = getPartnerCodBalance(TEST_PARTNER_ID);
        assert.strictEqual(balance.outstanding_cod_liability, 300, "Rejected remittance must NOT reduce liability!");
        console.log("✓ Admin rejection verified: Rejected remittance does not reduce liability.");

        console.log("\n=======================================================");
        console.log("✓ ALL COD CASH COLLECTION & REMITTANCE TESTS PASSED (8/8)");
        console.log("=======================================================\n");
    } finally {
        cleanData();
    }
}

runCodTests().catch(err => {
    console.error("COD TEST FAILED:", err);
    process.exit(1);
});

