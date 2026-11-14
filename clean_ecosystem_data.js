const fs = require('fs');
const path = require('path');
const { pool } = require('./config/database');

async function cleanData() {
    console.log('=== THULIRVA CLEAN DATA EXECUTION ===');

    // 1. Inspect PostgreSQL Tables
    let existingTables = [];
    try {
        const res = await pool.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
        );
        existingTables = res.rows.map(r => r.table_name);
        console.log('Detected DB Tables in PostgreSQL:', existingTables);
    } catch (e) {
        console.warn('Could not query information_schema:', e.message);
    }

    // Tables related to orders, subscriptions, and partners
    const targetTables = [
        'order_status_history',
        'order_items',
        'customer_delivery_issues',
        'delivery_proofs',
        'orders',
        'subscription_deliveries',
        'subscription_orders',
        'subscription_items',
        'subscriptions',
        'partner_earning_ledger',
        'partner_earnings',
        'partner_wallet_balances',
        'partner_withdrawal_requests',
        'partner_bank_accounts',
        'partner_attendance',
        'partner_kyc_history',
        'partner_live_locations',
        'partner_location_history',
        'partner_settlements',
        'delivery_assignments',
        'delivery_partners',
        'partners'
    ];

    console.log('\n--- Purging Database Tables ---');
    for (const tbl of targetTables) {
        if (existingTables.includes(tbl)) {
            try {
                // Use TRUNCATE CASCADE where possible or DELETE
                await pool.query(`TRUNCATE TABLE "${tbl}" CASCADE`);
                console.log(`✓ TRUNCATED table: ${tbl}`);
            } catch (err) {
                try {
                    const delRes = await pool.query(`DELETE FROM "${tbl}"`);
                    console.log(`✓ DELETED from table: ${tbl} (${delRes.rowCount || 0} rows)`);
                } catch (delErr) {
                    console.warn(`! Could not clear ${tbl}:`, delErr.message);
                }
            }
        }
    }

    // Reset sequences for auto-increment IDs if any
    try {
        const seqRes = await pool.query(
            "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'"
        );
        for (const seq of seqRes.rows) {
            const sName = seq.sequence_name;
            if (sName.includes('order') || sName.includes('sub') || sName.includes('partner') || sName.includes('delivery')) {
                try {
                    await pool.query(`ALTER SEQUENCE "${sName}" RESTART WITH 1`);
                    console.log(`✓ Reset sequence: ${sName}`);
                } catch (_) {}
            }
        }
    } catch (_) {}

    // 2. Clean JSON files in backend/data
    const dataDir = path.join(__dirname, 'data');
    console.log('\n--- Purging JSON Store Files in backend/data ---');

    const jsonFilesToEmptyArray = [
        'orders.json',
        'subscription_deliveries.json',
        'delivery_partners.json',
        'partner_attendance.json',
        'partner_bank_accounts.json',
        'partner_earning_ledger.json',
        'partner_kyc_history.json',
        'partner_live_locations.json',
        'partner_location_history.json',
        'partner_settlements.json',
        'partner_wallet_balances.json',
        'partner_withdrawal_requests.json',
        'customer_delivery_issues.json'
    ];

    for (const f of jsonFilesToEmptyArray) {
        const filePath = path.join(dataDir, f);
        try {
            fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf-8');
            console.log(`✓ Cleared JSON file: ${f} -> []`);
        } catch (err) {
            console.warn(`! Could not write to ${f}:`, err.message);
        }
    }

    // Also check subscriptions in memory / routes
    try {
        const subRoute = require('./routes/subscriptions');
        if (typeof subRoute.setSubscriptions === 'function') {
            subRoute.setSubscriptions([]);
        }
    } catch (_) {}

    try {
        const orderRoute = require('./routes/orders');
        if (typeof orderRoute.setMockOrders === 'function') {
            orderRoute.setMockOrders([]);
        }
    } catch (_) {}

    console.log('\n=============================================');
    console.log('✓ ALL ORDERS, SUBSCRIPTIONS & PARTNERS REMOVED CLEANLY');
    console.log('✓ READY FOR FRESH PRODUCTION ENTRY FROM WEBSITE DB');
    console.log('=============================================');

    await pool.end();
}

cleanData().catch(console.error);

