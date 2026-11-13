const fs = require("fs");
const path = require("path");
const { getPartners } = require("./deliveryPartnerService");
const { getPartnerWalletBalance } = require("./financialService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SUB_DELIVERIES_FILE = path.join(DATA_DIR, "subscription_deliveries.json");
const ATTENDANCE_FILE = path.join(DATA_DIR, "partner_attendance.json");
const SETTLEMENTS_FILE = path.join(DATA_DIR, "partner_settlements.json");
const LEDGER_FILE = path.join(DATA_DIR, "partner_earning_ledger.json");

function loadJson(file, defaultVal = []) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (_) {}
    return defaultVal;
}

/**
 * Get comprehensive operations and financial executive summary
 */
async function getFinancialSummaryReport() {
    const ledger = loadJson(LEDGER_FILE, []);
    const settlements = loadJson(SETTLEMENTS_FILE, []);
    const partners = await getPartners();

    const totalEarningEntries = ledger.length;
    const grossEarnedPaise = ledger.reduce((acc, e) => acc + (e.amount_paise || 0), 0);
    const totalSettledPaise = settlements.reduce((acc, s) => acc + (s.net_amount_paise || 0), 0);
    const pendingSettlementPaise = Math.max(0, grossEarnedPaise - totalSettledPaise);

    const partnerBalances = [];
    for (const p of partners) {
        const bal = await getPartnerWalletBalance(p.partner_id);
        if (bal) {
            partnerBalances.push({
                partner_id: p.partner_id,
                name: p.name,
                phone: p.phone,
                assigned_area: p.assigned_area,
                lifetime_earned_rupees: bal.lifetime_earned_rupees,
                total_settled_rupees: bal.total_settled_rupees,
                available_payable_rupees: bal.available_payable_rupees,
                reserved_withdrawal_rupees: bal.reserved_withdrawal_rupees
            });
        }
    }

    return {
        gross_earned_rupees: grossEarnedPaise / 100,
        total_settled_rupees: totalSettledPaise / 100,
        pending_payable_rupees: pendingSettlementPaise / 100,
        total_ledger_entries: totalEarningEntries,
        total_settlements_processed: settlements.length,
        partner_wallet_summaries: partnerBalances
    };
}

/**
 * Get fleet operations performance report
 */
async function getFleetPerformanceReport() {
    const partners = await getPartners();
    const orders = loadJson(ORDERS_FILE, []);
    const subs = loadJson(SUB_DELIVERIES_FILE, []);
    const attendance = loadJson(ATTENDANCE_FILE, []);

    const deliveredOrders = orders.filter(o => o.order_status === "delivered");
    const deliveredSubs = subs.filter(s => s.status === "delivered");

    return {
        total_fleet_count: partners.length,
        online_fleet_count: partners.filter(p => p.is_online).length,
        approved_kyc_count: partners.filter(p => p.kyc_status === "APPROVED").length,
        total_product_deliveries: deliveredOrders.length,
        total_subscription_deliveries: deliveredSubs.length,
        total_combined_deliveries: deliveredOrders.length + deliveredSubs.length,
        attendance_logs_count: attendance.length
    };
}

module.exports = {
    getFinancialSummaryReport,
    getFleetPerformanceReport
};

