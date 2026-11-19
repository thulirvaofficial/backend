/**
 * THULIRVA END-TO-END MASTER VERIFICATION SUITE
 * 
 * Tests:
 * 1. Product details management (8 sections, badges, highlights, ingredients, storage/usage, SEO)
 * 2. Subscription plan configuration (quantities, delivery slots, start date rules, schedules, pricing)
 * 3. Anti-tampering & server-side enforcement
 * 4. Active subscriber protection & terms snapshot immutability
 */

const http = require('http');

const BASE_URL = 'http://localhost:5500';

function makeRequest(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    resolve({ status: res.statusCode, body: parsed, raw: data });
                } catch (e) {
                    resolve({ status: res.statusCode, body: null, raw: data });
                }
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    console.log('====================================================');
    console.log('  THULIRVA MASTER VERIFICATION TEST SUITE STARTING  ');
    console.log('====================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(cond, msg) {
        if (cond) {
            console.log(`  [PASS] ${msg}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${msg}`);
            failed++;
        }
    }

    try {
        // --- ADMIN LOGIN TO ACQUIRE TOKEN ---
        console.log('1. Authenticating as Super Admin...');
        const loginRes = await makeRequest('POST', '/api/auth/login', {
            email: 'admin@thulirva.com',
            password: 'admin123'
        });
        assert(loginRes.status === 200 && loginRes.body.token, 'Super admin authenticated successfully');
        const token = loginRes.body.token;
        const authHeaders = { Authorization: `Bearer ${token}` };

        // --- MODULE 1: PRODUCT DETAILS MANAGEMENT ---
        console.log('\n2. Testing Product Details Management (Module 1)...');
        
        // A. Create new rich product
        const newProductPayload = {
            name: 'A2 Vedic Desi Gir Cow Milk',
            category: 'Milk',
            weight: '1 Litre',
            price: 90,
            compare_price: 105,
            stock: 80,
            badge: 'Purity Gold',
            status: 'active',
            is_active: true,
            short_description: 'Pure A2 Gir Cow raw whole milk fresh from pasture.',
            description: 'Ethically milked at dawn from indigenous Gir cows grazing on organic green pastures in Kanchipuram. Zero hormones, cold-chain preserved.',
            feature_badges: [
                { icon: '🌿', text: '100% Raw A2 Vedic', enabled: true },
                { icon: '🛡️', text: 'Preservative Free', enabled: true },
                { icon: '🐄', text: 'Free Grazing Gir Cows', enabled: true },
                { icon: '❄️', text: 'Chilled within 15 mins', enabled: true }
            ],
            highlights: [
                { icon: '✓', text: 'Natural golden cream layer with high Beta-Casein A2 protein' },
                { icon: '✓', text: 'Zero adulteration, certified antibiotic & chemical free' },
                { icon: '✓', text: 'Doorstep morning chilled delivery in glass packaging' }
            ],
            ingredients: [
                { name: 'Pure Raw Whole A2 Desi Cow Milk', note: '100% natural single origin' }
            ],
            ingredients_enabled: true,
            storage_instructions: 'Keep chilled between 2°C and 4°C. Consume within 48 hours.',
            usage_instructions: 'Boil gently before consumption. Perfect for traditional filter coffee and curd.',
            shelf_life: '48 Hours Refrigerated',
            certification: 'FSSAI Certified • Verified A2 Beta-Casein',
            seo_title: 'Pure A2 Vedic Desi Gir Cow Milk | THULIRVA Farms',
            seo_description: 'Order farm fresh pure raw A2 Desi Gir cow milk delivered daily morning before 7 AM across Chennai and Kanchipuram.'
        };

        const createProdRes = await makeRequest('POST', '/api/admin/products', newProductPayload, authHeaders);
        assert(createProdRes.status === 200 || createProdRes.status === 201, 'Created product with rich 8-section details');
        const createdProdId = createProdRes.body.product?.id || createProdRes.body.id;
        assert(createdProdId, `Product ID acquired: ${createdProdId}`);

        // B. Fetch via public storefront API and verify all fields returned
        const getProdRes = await makeRequest('GET', `/api/products/${createdProdId}`);
        assert(getProdRes.status === 200, 'Fetched product via public storefront API');
        const p = getProdRes.body.product;
        assert(p.short_description === newProductPayload.short_description, 'short_description matches');
        assert(Array.isArray(p.feature_badges) && p.feature_badges.length === 4, 'feature_badges array has 4 items');
        assert(p.feature_badges[0].text === '100% Raw A2 Vedic', 'feature_badges item 0 text preserved');
        assert(Array.isArray(p.highlights) && p.highlights.length === 3, 'highlights array has 3 items');
        assert(Array.isArray(p.ingredients) && p.ingredients.length === 1, 'ingredients array has 1 item');
        assert(p.storage_instructions === newProductPayload.storage_instructions, 'storage_instructions matches');
        assert(p.seo_title === newProductPayload.seo_title, 'seo_title matches');

        // C. Update product (edit badges and disable one)
        newProductPayload.feature_badges[1].enabled = false;
        newProductPayload.feature_badges.push({ icon: '🥛', text: 'Naturally Sweet Taste', enabled: true });
        newProductPayload.price = 92;

        const updateProdRes = await makeRequest('PUT', `/api/admin/products/${createdProdId}`, newProductPayload, authHeaders);
        assert(updateProdRes.status === 200, 'Updated product with modified badges and price');

        const getUpdatedRes = await makeRequest('GET', `/api/products/${createdProdId}`);
        const pUp = getUpdatedRes.body.product;
        assert(pUp.price === 92, 'Price updated to 92');
        assert(pUp.feature_badges.length === 5, 'feature_badges now has 5 items');
        assert(pUp.feature_badges[1].enabled === false, 'Badge 1 enabled state correctly updated to false');

        // --- MODULE 2 & 3: SUBSCRIPTION PLAN MANAGEMENT & DYNAMIC CONFIGURATION ---
        console.log('\n3. Testing Subscription Plan Management & Dynamic Configurations (Modules 2 & 3)...');

        // A. Create new subscription plan with full dynamic config
        const newPlanPayload = {
            product_name: 'A2 Gir Cow Milk Morning Subscription',
            product_id: createdProdId,
            time_period: 'Daily Morning (30 Deliveries)',
            frequency: 'Daily',
            deliveries_count: 30,
            duration_days: 30,
            price: 2622,
            original_price: 2760,
            description: 'Pure chilled A2 Gir Cow Milk delivered before 7:00 AM daily.',
            quantity_config: {
                enabled: true,
                min: 1,
                max: 4,
                default: 1,
                unit: 'Packet',
                options: [
                    { quantity: 1, label: '1 Packet' },
                    { quantity: 2, label: '2 Packets' },
                    { quantity: 3, label: '3 Packets' },
                    { quantity: 4, label: '4 Packets' }
                ]
            },
            delivery_slot_config: {
                enabled: true,
                allow_multiple_slots: true,
                default_slot: 'Morning: 6:00 AM – 7:00 AM',
                slots: [
                    { id: 'morning_early', name: 'Morning: 5:30 AM – 6:30 AM', start_time: '05:30', end_time: '06:30', enabled: true, max_orders: 100 },
                    { id: 'morning_standard', name: 'Morning: 6:00 AM – 7:00 AM', start_time: '06:00', end_time: '07:00', enabled: true, max_orders: 150 },
                    { id: 'evening_standard', name: 'Evening: 6:00 PM – 7:00 PM', start_time: '18:00', end_time: '19:00', enabled: true, max_orders: 80 }
                ]
            },
            start_date_config: {
                enabled: true,
                allow_immediate: true,
                allow_future: true,
                min_notice_hours: 12,
                max_advance_days: 30,
                blocked_dates: ['2026-12-25', '2027-01-01']
            },
            schedule_config: {
                enabled_schedules: ['Daily', 'Alternate Days', 'Twice Weekly'],
                default_schedule: 'Daily'
            },
            pricing_config: {
                base_price_per_delivery: 92,
                original_price: 2760,
                discount_percent: 5,
                auto_calculate: true
            }
        };

        const createPlanRes = await makeRequest('POST', '/api/subscriptions/plans', newPlanPayload, authHeaders);
        assert(createPlanRes.status === 200 || createPlanRes.status === 201, 'Created Subscription Plan with dynamic configs');
        const planId = createPlanRes.body.plan?.id;
        assert(planId, `Plan ID created: ${planId}`);

        // B. Fetch plans storefront endpoint
        const getPlansRes = await makeRequest('GET', '/api/subscriptions/plans');
        assert(getPlansRes.status === 200, 'Fetched storefront subscription plans');
        const fetchedPlan = (getPlansRes.body.plans || []).find(p => p.id === planId);
        assert(fetchedPlan !== undefined, 'Created plan is visible on storefront');
        assert(fetchedPlan.quantity_config.options.length === 4, 'Customer storefront sees all 4 quantity options');
        assert(fetchedPlan.delivery_slot_config.allow_multiple_slots === true, 'allow_multiple_slots is true');

        // C. Update plan: Remove quantity 3 (customer should only see 1, 2, 4)
        newPlanPayload.quantity_config.options = [
            { quantity: 1, label: '1 Packet' },
            { quantity: 2, label: '2 Packets' },
            { quantity: 4, label: '4 Packets' }
        ];
        const updatePlanRes = await makeRequest('PUT', `/api/subscriptions/plans/${planId}`, newPlanPayload, authHeaders);
        assert(updatePlanRes.status === 200, 'Updated plan removing option 3 packets');

        const getUpdatedPlanRes = await makeRequest('GET', '/api/subscriptions/plans');
        const upPlan = (getUpdatedPlanRes.body.plans || []).find(p => p.id === planId);
        assert(upPlan.quantity_config.options.length === 3, 'Customer storefront now sees exactly 3 quantity options');
        assert(!upPlan.quantity_config.options.some(o => o.quantity === 3), 'Option 3 is completely absent from customer options');

        // D. Calculate price endpoint verification
        const calcRes = await makeRequest('POST', '/api/subscriptions/calculate-price', {
            plan_id: planId,
            quantity: 2,
            delivery_slot: 'Morning: 6:00 AM – 7:00 AM',
            frequency: 'Daily'
        });
        assert(calcRes.status === 200, 'Price calculation endpoint responded with 200');
        // Base 92 * 2 qty * 1 slot * 30 deliveries * 0.95 = 5244
        assert(calcRes.body.total_price === 5244, `Server price auto-calculated correctly: ₹${calcRes.body.total_price}`);

        // E. Anti-Tampering & Backend Validation
        console.log('\n4. Testing Anti-Tampering & Backend Validation Rules...');

        // Tamper test 1: Submitting an invalid / removed quantity (e.g. 3 packets, which was removed)
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const tamperQtyRes = await makeRequest('POST', '/api/subscriptions', {
            plan_id: planId,
            customer_name: 'Test Customer',
            customer_phone: '9876543210',
            quantity: 3, // INVALID - removed by admin
            delivery_slot: 'Morning: 6:00 AM – 7:00 AM',
            start_date: tomorrow,
            address: '123 Test Street, Chennai',
            payment_method: 'COD'
        });
        assert(tamperQtyRes.status === 400, 'Rejected subscription with disabled/invalid quantity (HTTP 400)');

        // Tamper test 2: Submitting an invalid / disabled delivery slot
        const tamperSlotRes = await makeRequest('POST', '/api/subscriptions', {
            plan_id: planId,
            customer_name: 'Test Customer',
            customer_phone: '9876543210',
            quantity: 2,
            delivery_slot: 'Midnight: 2:00 AM - 3:00 AM', // INVALID SLOT
            start_date: tomorrow,
            address: '123 Test Street, Chennai',
            payment_method: 'COD'
        });
        assert(tamperSlotRes.status === 400, 'Rejected subscription with non-existent slot (HTTP 400)');

        // Tamper test 3: Submitting a blocked start date (2026-12-25)
        const tamperDateRes = await makeRequest('POST', '/api/subscriptions', {
            plan_id: planId,
            customer_name: 'Test Customer',
            customer_phone: '9876543210',
            quantity: 2,
            delivery_slot: 'Morning: 6:00 AM – 7:00 AM',
            start_date: '2026-12-25', // BLOCKED DATE
            address: '123 Test Street, Chennai',
            payment_method: 'COD'
        });
        assert(tamperDateRes.status === 400, 'Rejected subscription with blocked blackout date (HTTP 400)');

        // F. Valid Subscription Creation with Terms Snapshot
        console.log('\n5. Testing Valid Subscription Creation & Terms Snapshot Immutability...');
        const validSubRes = await makeRequest('POST', '/api/subscriptions', {
            plan_id: planId,
            customer_name: 'Anand Kumar',
            customer_phone: '98' + Math.floor(10000000 + Math.random() * 90000000),
            customer_email: 'anand_' + Date.now() + '@example.com',
            quantity: 2,
            delivery_slot: 'Morning: 6:00 AM – 7:00 AM',
            start_date: tomorrow,
            address: 'Flat 4B, Green Acres, Valasaravakkam, Chennai',
            delivery_location: 'Valasaravakkam',
            pincode: '600087',
            payment_method: 'UPI QR',
            transaction_id: 'UPI_' + Date.now()
        });
        console.log('  [DEBUG validSubRes]:', JSON.stringify(validSubRes.body));
        assert(validSubRes.status === 200 || validSubRes.status === 201, 'Valid subscription successfully created');
        const subId = validSubRes.body.subscription?.id;
        assert(subId, `Subscription ID: ${subId}`);

        // Verify terms snapshot saved
        const adminSubRes = await makeRequest('GET', `/api/subscriptions/${subId}`, null, authHeaders);
        assert(adminSubRes.status === 200, 'Fetched created subscription');
        const subRecord = adminSubRes.body?.subscription || validSubRes.body?.subscription;
        const terms = typeof subRecord?.terms_snapshot === 'string' ? JSON.parse(subRecord.terms_snapshot) : subRecord?.terms_snapshot;
        assert(terms !== undefined && terms !== null, 'Subscription captured terms_snapshot');
        console.log('  [DEBUG TERMS]:', JSON.stringify(terms));
        assert(terms?.plan_id === planId, 'terms_snapshot plan_id recorded');
        assert(terms?.unit_price === 92, 'terms_snapshot unit_price preserved');
        assert(subRecord?.total_price === 5244, 'Server-calculated total_price enforced and saved');

        // G. Active Subscriber Protection
        console.log('\n6. Testing Active Subscriber Protection...');

        // Attempt to delete plan with active subscriber -> MUST FAIL
        const delPlanFailRes = await makeRequest('DELETE', `/api/subscriptions/plans/${planId}`, null, authHeaders);
        assert(delPlanFailRes.status === 400, 'Blocked deleting subscription plan with active subscribers (HTTP 400)');
        assert(delPlanFailRes.body.message.includes('active subscriber'), 'Clear error message indicating active subscribers');

        // View subscribers for this plan
        const viewSubsRes = await makeRequest('GET', `/api/subscriptions/plans/${planId}/subscribers`, null, authHeaders);
        assert(viewSubsRes.status === 200, 'Fetched active subscribers for plan');
        assert(Array.isArray(viewSubsRes.body.subscribers) && viewSubsRes.body.subscribers.length >= 1, 'Active subscribers list includes newly created subscriber');

        // Duplicate plan test
        const dupPlanRes = await makeRequest('POST', `/api/subscriptions/plans/${planId}/duplicate`, null, authHeaders);
        assert(dupPlanRes.status === 200, 'Duplicated plan successfully');
        const dupPlanId = dupPlanRes.body.plan?.id;
        assert(dupPlanId && dupPlanId !== planId, `Duplicated plan ID: ${dupPlanId}`);

        // Archive plan test
        const archivePlanRes = await makeRequest('PUT', `/api/subscriptions/plans/${dupPlanId}/archive`, { is_archived: true }, authHeaders);
        assert(archivePlanRes.status === 200, 'Archived duplicated plan');

        // Delete duplicated plan (has 0 subscribers) -> MUST SUCCEED
        const delDupRes = await makeRequest('DELETE', `/api/subscriptions/plans/${dupPlanId}`, null, authHeaders);
        assert(delDupRes.status === 200, 'Successfully deleted duplicated plan with 0 subscribers');

        // Clean up: delete test product
        const delProdRes = await makeRequest('DELETE', `/api/admin/products/${createdProdId}`, null, authHeaders);
        assert(delProdRes.status === 200, 'Cleaned up test product');

        // --- MODULE 4: NOTIFICATION ROUTING & PARTNER ISOLATION ---
        console.log('\n7. Testing Notification Routing & Delivery Partner Isolation...');
        
        // A. Register distinctive tokens for Customer, Delivery Partner, and Admin
        const testCustomerToken = 'fcm_test_customer_token_suite_999888_cust1';
        const testPartnerToken = 'fcm_test_partner_token_suite_111222_part1';

        await makeRequest('POST', '/api/notifications/register-token', {
            token: testCustomerToken,
            platform: 'android',
            user_id: 'cust_suite_101',
            role: 'customer',
            app_type: 'customer'
        });

        await makeRequest('POST', '/api/notifications/register-token', {
            token: testPartnerToken,
            platform: 'android',
            user_id: 'THU-DP-9999',
            role: 'delivery_partner',
            app_type: 'partner'
        });

        // B. Verify Token Partitioning via Unit Query
        const { getDeviceTokens, isDeliveryPartnerToken } = require('./services/tokenStore');
        const customerTokens = getDeviceTokens({ role: 'customer', userId: 'cust_suite_101' });
        assert(customerTokens.includes(testCustomerToken), 'Customer token store returned registered customer token');
        assert(!customerTokens.includes(testPartnerToken), 'CRITICAL: Customer token store NEVER returned partner token');

        const partnerTokens = getDeviceTokens({ role: 'delivery_partner', userId: 'THU-DP-9999' });
        assert(partnerTokens.includes(testPartnerToken), 'Partner token store returned registered partner token');
        assert(!partnerTokens.includes(testCustomerToken), 'CRITICAL: Partner token store NEVER returned customer token');
        assert(isDeliveryPartnerToken(testPartnerToken) === true, 'isDeliveryPartnerToken correctly identifies partner token');
        assert(isDeliveryPartnerToken(testCustomerToken) === false, 'isDeliveryPartnerToken returns false for customer token');

        // C. Trigger Customer Subscription Payment Verification & Check Dispatch Logs
        const { sendPaymentNotification, NOTIFICATION_DISPATCH_LOGS } = require('./services/notificationService');

        // Scenario 1: Subscription Payment Proof Uploaded -> Payment Pending Notification
        const subForNotif = {
            id: 'SUB-20261119-TESTNOTIF',
            user_id: 'cust_suite_101',
            total_price: 2500
        };

        // Notify customer: Payment Pending
        await sendPaymentNotification({
            orderOrSub: subForNotif,
            status: 'pending',
            amount: 2500,
            forAdmin: false
        });

        const pendingLog = NOTIFICATION_DISPATCH_LOGS.find(l => l.target_id === 'SUB-20261119-TESTNOTIF' && l.event === 'payment_pending');
        assert(pendingLog !== undefined, 'Logged customer payment pending notification dispatch');
        assert(pendingLog?.recipient_role === 'customer', 'Recipient role marked as customer');
        assert(pendingLog?.app_type === 'customer', 'App type marked as customer');
        assert(!pendingLog?.tokens_masked?.some(m => m.includes('111222')), 'CRITICAL: Delivery partner token was NEVER targeted for Payment Pending');

        // Scenario 2: Admin Payment Verification -> Payment Verified Notification
        await sendPaymentNotification({
            orderOrSub: subForNotif,
            status: 'verified',
            amount: 2500,
            forAdmin: false
        });

        const verifiedLog = NOTIFICATION_DISPATCH_LOGS.find(l => l.target_id === 'SUB-20261119-TESTNOTIF' && l.event === 'payment_verified');
        assert(verifiedLog !== undefined, 'Logged customer payment verified notification dispatch');
        assert(!verifiedLog?.tokens_masked?.some(m => m.includes('111222')), 'CRITICAL: Delivery partner token was NEVER targeted for Payment Verified');

        // Scenario 3: Admin Rejects Payment Proof -> Payment Rejected Notification
        await sendPaymentNotification({
            orderOrSub: subForNotif,
            status: 'rejected',
            amount: 2500,
            reason: 'UTR mismatch',
            forAdmin: false
        });

        const rejectedLog = NOTIFICATION_DISPATCH_LOGS.find(l => l.target_id === 'SUB-20261119-TESTNOTIF' && l.event === 'payment_rejected');
        assert(rejectedLog !== undefined, 'Logged customer payment rejected notification dispatch');
        assert(!rejectedLog?.tokens_masked?.some(m => m.includes('111222')), 'CRITICAL: Delivery partner token was NEVER targeted for Payment Rejected');

        // Scenario 4: Attempt to route customer payment event to a delivery partner -> MUST BE REJECTED
        const { sendNotification } = require('./services/notificationService');
        const leakAttemptRes = await sendNotification({
            userId: 'THU-DP-9999',
            title: 'Payment Pending ⏳',
            message: 'Payment proof for Subscription #SUB-20261119-1351 is undergoing verification.',
            type: 'payment_pending',
            targetId: 'SUB-20261119-1351',
            role: 'delivery_partner',
            forAdmin: false
        });
        assert(leakAttemptRes.status === 'rejected', 'Backend anti-leak safeguard REJECTED payment notification targeted at delivery partner');
        assert(leakAttemptRes.reason?.includes('INVALID_RECIPIENT_TYPE'), 'Rejection reason contains INVALID_RECIPIENT_TYPE');

        // Scenario 5: Valid Partner Dispatch -> Allowed & Delivered
        const partnerOrderRes = await sendNotification({
            userId: 'THU-DP-9999',
            title: '🚨 New Thulirva Order #ORD-12345',
            message: 'New delivery order assigned to you.',
            type: 'NEW_ORDER_ASSIGNED',
            targetId: 'ORD-12345',
            channelId: 'thulirva_incoming_orders',
            role: 'delivery_partner'
        });
        assert(partnerOrderRes.status !== 'rejected', 'Legitimate partner order dispatch accepted');
        const partnerOrderLog = NOTIFICATION_DISPATCH_LOGS.find(l => l.target_id === 'ORD-12345');
        assert(partnerOrderLog?.recipient_role === 'delivery_partner', 'Recipient role logged as delivery_partner');

        // Scenario 6: Notification stats endpoint reflects partitioned token counters
        const statsRes = await makeRequest('GET', '/api/notifications/stats', null, authHeaders);
        assert(statsRes.status === 200, 'Notification stats endpoint returns HTTP 200');
        assert(statsRes.body.tokens?.partnerActive !== undefined || statsRes.body.tokens?.inMemoryPartner !== undefined, 'Tokens stats tracks partner tokens separately from customer tokens');

    } catch (err) {
        console.error('Test execution error:', err);
        failed++;
    }

    console.log('\n====================================================');
    console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED  `);
    console.log('====================================================');

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
