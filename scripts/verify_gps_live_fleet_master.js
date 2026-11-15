/**
 * THULIRVA - GPS + LIVE FLEET + ONLINE/OFFLINE + ORDER TRACKING MASTER VERIFICATION
 * Tests Parts 1 through 16 of the Master System Fix Specification
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5500';

function makeRequest(method, endpoint, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, BASE_URL);
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
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (_) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, data: parsed });
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    console.log('========================================================================');
    console.log('🚀 THULIRVA MASTER VERIFICATION: GPS, FLEET & REAL-TIME TRACKING');
    console.log('========================================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(name, condition, details = '') {
        if (condition) {
            console.log(`  ✅ [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
            passed++;
        } else {
            console.error(`  ❌ [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
            failed++;
        }
    }

    try {
        // TEST 1: Health check
        const health = await makeRequest('GET', '/api/health');
        assert('Backend API Health Check', health.status === 200 && health.data.status === 'healthy');

        // TEST 2: Partner Login
        const partnerLogin = await makeRequest('POST', '/api/delivery/login', {
            phone: '7904880944',
            password: '123456'
        });
        assert('Partner Login (THU-DP-0001)', partnerLogin.status === 200 && partnerLogin.data.token, `Token received`);
        const partnerToken = partnerLogin.data.token;
        const partnerHeaders = { 'Authorization': `Bearer ${partnerToken}` };

        // TEST 3: Verify initial state is offline and dummy locations are eliminated
        const initialStatus = await makeRequest('GET', '/api/delivery/location/THU-DP-0001');
        assert('Initial Partner State - Not Live Streaming', initialStatus.status === 200 && initialStatus.data.is_online === false);
        assert('No Hardcoded Coordinates when Offline', initialStatus.data.location === null || initialStatus.data.location?.location_available === false);

        // TEST 4: Toggle Partner ONLINE
        const goOnline = await makeRequest('PUT', '/api/delivery/status', { is_online: true }, partnerHeaders);
        assert('Partner Toggle ONLINE', goOnline.status === 200 && goOnline.data.is_online === true);

        // TEST 5: Send Real Device GPS Coordinates
        const deviceGps = {
            latitude: 12.802145,
            longitude: 80.222912,
            speed: 24.5,
            heading: 65,
            accuracy: 3.2,
            altitude: 14.5,
            locationSource: 'device_gps',
            timestamp: new Date().toISOString()
        };
        const sendGps = await makeRequest('POST', '/api/delivery/location', deviceGps, partnerHeaders);
        assert('Partner GPS Telemetry Ingestion', sendGps.status === 200 && sendGps.data.success === true);

        // TEST 6: Retrieve Live Location
        const liveLoc = await makeRequest('GET', '/api/delivery/location/THU-DP-0001');
        assert('Partner Live Location Retrieval', 
            liveLoc.status === 200 && 
            liveLoc.data.location && 
            Math.abs(liveLoc.data.location.latitude - 12.802145) < 0.0001 &&
            liveLoc.data.location.is_fresh === true
        );

        // TEST 7: Admin Live Tracking Endpoint
        const adminFleet = await makeRequest('GET', '/api/admin/delivery/live-tracking');
        const adminPartner = (adminFleet.data.partners || []).find(p => p.partner_id === 'THU-DP-0001');
        assert('Admin Fleet Ingestion of Live Partner', 
            adminFleet.status === 200 && 
            adminPartner && 
            adminPartner.is_online === true &&
            Math.abs(adminPartner.latitude - 12.802145) < 0.0001
        );

        // TEST 8: Customer Order & Live Tracking
        const customerLogin = await makeRequest('POST', '/api/auth/login', {
            phone: '7904880944',
            password: 'password123'
        });
        const userToken = customerLogin.data.token;
        const userHeaders = { 'Authorization': `Bearer ${userToken}` };

        // Create an active product order
        const createOrder = await makeRequest('POST', '/api/orders', {
            address: 'Flat 4B, Emerald Heights, Porur, Chennai',
            delivery_address: 'Flat 4B, Emerald Heights, Porur, Chennai',
            city: 'Chennai',
            pincode: '600116',
            latitude: 13.0382,
            longitude: 80.1565,
            items: [{ product_id: 'PRD-001', name: 'Fresh Country Milk (1L)', quantity: 2, price: 65.0 }],
            total: 130.0,
            payment_method: 'UPI'
        }, userHeaders);

        const orderId = createOrder.data.order?.id || createOrder.data.id || 'TEST_LIVE_ORD';
        assert('Customer Product Order Creation', createOrder.status === 200 || createOrder.status === 201, `Order ID: ${orderId}`);

        // Update order to assigned to THU-DP-0001 and out_for_delivery
        const DATA_DIR = path.resolve(__dirname, '..', 'data');
        const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
        const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
        const targetOrder = orders.find(o => String(o.id) === String(orderId) || o.order_number === orderId);
        if (targetOrder) {
            targetOrder.partner_id = 'THU-DP-0001';
            targetOrder.delivery_partner_id = 'THU-DP-0001';
            targetOrder.order_status = 'out_for_delivery';
            targetOrder.status = 'out_for_delivery';
            fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');
        }

        // TEST 9: Order Tracking API Verification
        const orderTracking = await makeRequest('GET', `/api/orders/${orderId}/tracking`);
        assert('Order Tracking Hub is Valasaravakkam', 
            orderTracking.status === 200 && 
            orderTracking.data.hub_location && 
            Math.abs(orderTracking.data.hub_location.latitude - 13.0403) < 0.001 &&
            Math.abs(orderTracking.data.hub_location.longitude - 80.1723) < 0.001
        );
        assert('Order Tracking Live GPS Stream',
            orderTracking.data.partner_live_location &&
            Math.abs(orderTracking.data.partner_live_location.latitude - 12.802145) < 0.0001
        );

        // TEST 10: Block Going OFFLINE while order is Out for Delivery
        const tryOfflineWithOrder = await makeRequest('PUT', '/api/delivery/status', { is_online: false }, partnerHeaders);
        assert('Block Going Offline with Active Delivery', 
            tryOfflineWithOrder.status === 400 && 
            tryOfflineWithOrder.data.has_active_deliveries === true,
            `Correctly rejected: ${tryOfflineWithOrder.data.message}`
        );

        // TEST 11: Complete Delivery
        const completeOrders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
        const orderToComplete = completeOrders.find(o => String(o.id) === String(orderId) || o.order_number === orderId);
        if (orderToComplete) {
            orderToComplete.order_status = 'delivered';
            orderToComplete.status = 'delivered';
            orderToComplete.is_delivered = true;
            fs.writeFileSync(ORDERS_FILE, JSON.stringify(completeOrders, null, 2), 'utf-8');
        }

        // TEST 12: Successfully Go OFFLINE after delivery completion
        const goOfflineAfterDelivery = await makeRequest('PUT', '/api/delivery/status', { is_online: false }, partnerHeaders);
        assert('Allow Going Offline when Deliveries Completed', 
            goOfflineAfterDelivery.status === 200 && 
            goOfflineAfterDelivery.data.is_online === false
        );

        // TEST 13: Verify Offline Partner is Removed from Live Locations
        const liveFile = path.join(DATA_DIR, 'partner_live_locations.json');
        const liveData = JSON.parse(fs.readFileSync(liveFile, 'utf-8'));
        const livePartner = liveData.find(l => l.partner_id === 'THU-DP-0001');
        assert('Offline Partner Evicted from Live Stream Map', !livePartner, 'Evicted from live locations');

        // TEST 14: Tracking API Returns Null Live Location for Completed/Offline
        const orderTrackingAfterOffline = await makeRequest('GET', `/api/orders/${orderId}/tracking`);
        assert('Order Tracking Respects Partner Offline State', 
            orderTrackingAfterOffline.data.partner?.is_online === false &&
            orderTrackingAfterOffline.data.partner_live_location === null,
            'No fake/stale coordinates emitted'
        );

        console.log('\n========================================================================');
        console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
        console.log('========================================================================\n');

        if (failed === 0) {
            console.log('🎉 ALL 14 MASTER SYSTEM SPECIFICATION CRITERIA VERIFIED SUCCESSFULLY!');
            process.exit(0);
        } else {
            console.error('❌ SOME TESTS FAILED');
            process.exit(1);
        }

    } catch (e) {
        console.error('Fatal test error:', e);
        process.exit(1);
    }
}

runTests();
