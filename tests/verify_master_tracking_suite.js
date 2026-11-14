const path = require('path');
const io = require('socket.io-client');
const http = require('http');

function postJson(urlPath, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 5500,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:5500${urlPath}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', reject);
  });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('    THULIRVA REAL GOOGLE MAPS WORLDWIDE TRACKING SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
    }
  }

  // --- TEST H: Worldwide Coordinates & Road Routing ---
  console.log('--- TEST H: Worldwide Geographical Routing (London, New York, Chennai) ---');
  try {
    const https = require('https');
    function osrmRoute(lat1, lon1, lat2, lon2) {
      return new Promise((resolve) => {
        const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
        https.get(url, { headers: { 'User-Agent': 'ThulirvaApp/1.0' } }, (res) => {
          let b = '';
          res.on('data', c => b += c);
          res.on('end', () => {
            try { resolve(JSON.parse(b)); } catch (_) { resolve(null); }
          });
        }).on('error', () => resolve(null));
      });
    }

    // London Test: Big Ben to Tower Bridge
    const londonRoute = await osrmRoute(51.5007, -0.1246, 51.5055, -0.0754);
    assert(londonRoute && londonRoute.routes && londonRoute.routes.length > 0, 'Worldwide Test London: Real road polyline resolved across London streets');
    if (londonRoute?.routes?.[0]) {
      console.log(`       London Distance: ${(londonRoute.routes[0].distance / 1000).toFixed(2)} km, Duration: ${(londonRoute.routes[0].duration / 60).toFixed(1)} mins`);
    }

    // New York Test: Central Park to Times Square
    const nyRoute = await osrmRoute(40.785091, -73.968285, 40.758896, -73.985130);
    assert(nyRoute && nyRoute.routes && nyRoute.routes.length > 0, 'Worldwide Test New York: Real road polyline resolved across Manhattan streets');
    if (nyRoute?.routes?.[0]) {
      console.log(`       NYC Distance: ${(nyRoute.routes[0].distance / 1000).toFixed(2)} km, Duration: ${(nyRoute.routes[0].duration / 60).toFixed(1)} mins`);
    }

    // Chennai Test: Padur Hub to Navalur
    const chennaiRoute = await osrmRoute(12.8025, 80.2233, 12.8465, 80.2268);
    assert(chennaiRoute && chennaiRoute.routes && chennaiRoute.routes.length > 0, 'Chennai Road Network: Real road polyline resolved along OMR Rajiv Gandhi Salai');
    if (chennaiRoute?.routes?.[0]) {
      console.log(`       OMR Distance: ${(chennaiRoute.routes[0].distance / 1000).toFixed(2)} km, Duration: ${(chennaiRoute.routes[0].duration / 60).toFixed(1)} mins`);
    }
  } catch (err) {
    console.error('Test H error:', err.message);
  }

  // --- TEST B & C: Live Partner GPS Streaming & Multi-Client Synchronization ---
  console.log('\n--- TEST B & C: Real-Time Multi-Client GPS Synchronization (Admin & Customer) ---');
  const partnerId = 'THU-DP-0004';
  const orderId = '1794661515994';

  const adminSocket = io('http://localhost:5500', { transports: ['websocket'] });
  const customerSocket = io('http://localhost:5500', { transports: ['websocket'] });

  let adminReceived = null;
  let customerReceived = null;

  await new Promise((resolve) => {
    let connected = 0;
    const checkDone = () => { if (++connected === 2) resolve(); };

    adminSocket.on('connect', () => {
      adminSocket.emit('join:admin');
      checkDone();
    });

    customerSocket.on('connect', () => {
      customerSocket.emit('join:order', { orderId });
      checkDone();
    });
  });

  adminSocket.on('delivery:location_updated', (data) => {
    if (data.partnerId === partnerId || data.partner_id === partnerId) {
      adminReceived = data;
    }
  });

  customerSocket.on('delivery:location_updated', (data) => {
    customerReceived = data;
  });

  // Step 1: Partner sends live GPS update
  const testLat = 12.8088;
  const testLng = 80.2265;
  const testSpeed = 32.4;
  const testHeading = 72.0;

  const updateRes = await postJson('/api/delivery/location/update', {
    partner_id: partnerId,
    latitude: testLat,
    longitude: testLng,
    speed: testSpeed,
    heading: testHeading,
    accuracy: 3.0,
    orderId
  });

  assert(updateRes.status === 200 && updateRes.data.success, 'POST /api/delivery/location/update succeeded');

  // Wait 600ms for websocket delivery
  await new Promise(r => setTimeout(r, 600));

  assert(adminReceived !== null, 'Admin socket received real-time delivery:location_updated event');
  assert(customerReceived !== null, 'Customer socket received real-time delivery:location_updated event');

  if (adminReceived && customerReceived) {
    assert(
      adminReceived.latitude === customerReceived.latitude &&
      adminReceived.longitude === customerReceived.longitude,
      'Test C: Admin and Customer received IDENTICAL live coordinates (Single Source of Truth)'
    );
    console.log(`       Verified Coords: Lat ${adminReceived.latitude}, Lng ${adminReceived.longitude}, Speed ${adminReceived.speed} km/h, Heading ${adminReceived.heading}°`);
  }

  // --- TEST D & E: Single Source of Truth Order Tracking Endpoint & Dynamic ETA ---
  console.log('\n--- TEST D & E: Order Tracking Single Source of Truth & Telemetry ---');
  const trackingRes = await getJson(`/api/orders/${orderId}/tracking`);
  assert(trackingRes.status === 200 && trackingRes.data.success, `GET /api/orders/${orderId}/tracking succeeded`);
  assert(trackingRes.data.partner_live_location !== null, 'Tracking response contains live partner coordinates');
  assert(trackingRes.data.partner_live_location.latitude === testLat, 'Tracking response reflects the exact updated latitude');
  assert(trackingRes.data.partner !== null, 'Tracking response contains partner identity & vehicle info');
  assert(trackingRes.data.hub_location !== null, 'Tracking response contains Thulirva Dairy Hub location');

  // --- TEST F: Freshness & Stale Location Detection ---
  console.log('\n--- TEST F: Location Freshness & Stale Location Safeguards ---');
  const partnerLoc = await getJson(`/api/delivery/location/${partnerId}`);
  assert(partnerLoc.status === 200 && partnerLoc.data.success, `GET /api/delivery/location/${partnerId} succeeded`);
  assert(partnerLoc.data.location.is_fresh === true, 'Recent location marked as fresh (is_fresh = true)');
  console.log(`       Freshness check: is_fresh = ${partnerLoc.data.location.is_fresh}, last seen ${partnerLoc.data.location.last_seen_seconds_ago}s ago`);

  // --- TEST G: Delivery Completion & Tracking Termination ---
  console.log('\n--- TEST G: Delivery Lifecycle Transition & Status Events ---');
  let deliveredEventReceived = false;
  customerSocket.on('delivery:delivered', (data) => {
    if (data.order_id === orderId || data.orderId === orderId) {
      deliveredEventReceived = true;
    }
  });

  // Call the live backend server to trigger delivery completion
  try {
    await postJson(`/api/orders/${orderId}/status`, {
      order_status: 'delivered',
      status: 'delivered',
      delivery_proof_url: 'https://thulirva.com/uploads/delivery_proofs/proof_test.jpg'
    });
  } catch (_) {}

  await new Promise(r => setTimeout(r, 600));
  assert(deliveredEventReceived === true, 'Test G: delivery:delivered socket event triggered cleanly upon completion');

  adminSocket.disconnect();
  customerSocket.disconnect();

  console.log('\n================================================================');
  console.log(`       TRACKING SUITE RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('================================================================');
}

runTestSuite().catch(console.error);
