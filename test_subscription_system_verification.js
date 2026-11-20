const http = require("http");
const {
    getKolkataToday,
    normalizeDateString,
    addCalendarDays,
    getCalendarDayDiff,
    calculateSubscriptionDates,
    generateDeliverySchedule,
    calculateSubscriptionMetrics,
    enrichSubscriptionWithMetrics
} = require("./utils/subscriptionDateUtil");

function fetchJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const reqOpts = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method: options.method || "GET",
            headers: options.headers || {}
        };
        const req = http.request(reqOpts, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (_) {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on("error", reject);
        if (options.body) {
            req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function runTests() {
    console.log("=================================================");
    console.log("   THULIRVA SUBSCRIPTION SYSTEM ACCEPTANCE TESTS  ");
    console.log("=================================================\n");

    let passed = 0;
    let failed = 0;

    function assert(name, condition, details = "") {
        if (condition) {
            console.log(`✓ PASS: ${name}`);
            passed++;
        } else {
            console.error(`✗ FAIL: ${name} ${details}`);
            failed++;
        }
    }

    // -------------------------------------------------------------------------
    // TEST 1: Public & Admin Plans API
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: Subscription Plans Catalog API ---");
    const pubRes = await fetchJson("http://localhost:5500/api/subscriptions/plans");
    assert("Public plans endpoint responds 200", pubRes.status === 200);
    assert("Public plans count is greater than 0", Array.isArray(pubRes.data.plans) && pubRes.data.plans.length >= 6, `Count: ${pubRes.data.plans?.length}`);

    const adminPlansRes = await fetchJson("http://localhost:5500/api/subscriptions/plans/catalog");
    assert("Admin plans catalog alias responds 200", adminPlansRes.status === 200);
    assert("Admin plans catalog count matches 6", Array.isArray(adminPlansRes.data.plans) && adminPlansRes.data.plans.length >= 6);

    // -------------------------------------------------------------------------
    // TEST 2: Start Date & End Date Day 1 Calculation (Day 1 to Day N)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Inclusive Day 1 Start Date & End Date Calculation ---");
    const dates30 = calculateSubscriptionDates({ startDate: "2026-11-20", durationDays: 30 });
    assert("Start date preserved as 2026-11-20", dates30.startDate === "2026-11-20");
    assert("30-day inclusive End date is 2026-12-19 (not 2026-12-20, not 2026-12-01)", dates30.endDate === "2026-12-19", `Got: ${dates30.endDate}`);
    assert("Expiry date matches end date 2026-12-19", dates30.expiryDate === "2026-12-19");
    assert("Total duration days is exactly 30", dates30.durationDays === 30);

    const dates15 = calculateSubscriptionDates({ startDate: "2026-11-20", durationDays: 15 });
    assert("15-day inclusive End date is 2026-12-04", dates15.endDate === "2026-12-04", `Got: ${dates15.endDate}`);

    const dates7 = calculateSubscriptionDates({ startDate: "2026-11-20", durationDays: 7 });
    assert("7-day inclusive End date is 2026-11-26", dates7.endDate === "2026-11-26", `Got: ${dates7.endDate}`);

    // -------------------------------------------------------------------------
    // TEST 3: Calendar Days Remaining & Elapsed Progress
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: Calendar Days Progress Logic ---");
    const subMock = {
        id: "SUB-TEST-1",
        start_date: "2026-11-20",
        end_date: "2026-12-19",
        expiry_date: "2026-12-19",
        total_duration: 30,
        frequency: "Daily",
        status: "active"
    };

    // Case A: Before start date (19-11-2026)
    const mBefore = calculateSubscriptionMetrics(subMock, "2026-11-19");
    assert("Day before start (19-11-2026): 0 elapsed days", mBefore.elapsedDays === 0, `Got: ${mBefore.elapsedDays}`);
    assert("Day before start (19-11-2026): 30 remaining days", mBefore.remainingDays === 30, `Got: ${mBefore.remainingDays}`);
    assert("Day before start (19-11-2026): isExpired is false", mBefore.isExpired === false);

    // Case B: Day 1 (20-11-2026)
    const mDay1 = calculateSubscriptionMetrics(subMock, "2026-11-20");
    assert("Day 1 (20-11-2026): 1 elapsed day", mDay1.elapsedDays === 1, `Got: ${mDay1.elapsedDays}`);
    assert("Day 1 (20-11-2026): 29 remaining days", mDay1.remainingDays === 29, `Got: ${mDay1.remainingDays}`);
    assert("Day 1 (20-11-2026): isExpired is false", mDay1.isExpired === false);

    // Case C: Day 30 (19-12-2026)
    const mDay30 = calculateSubscriptionMetrics(subMock, "2026-12-19");
    assert("Day 30 (19-12-2026): 30 elapsed days", mDay30.elapsedDays === 30, `Got: ${mDay30.elapsedDays}`);
    assert("Day 30 (19-12-2026): 0 remaining days", mDay30.remainingDays === 0, `Got: ${mDay30.remainingDays}`);
    assert("Day 30 (19-12-2026): isExpired is true", mDay30.isExpired === true);

    // -------------------------------------------------------------------------
    // TEST 4: Delivery Schedule Generation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Delivery Schedule Generation per Frequency ---");
    const schedDaily = generateDeliverySchedule("2026-11-20", "2026-12-19", "Daily");
    assert("Daily schedule for 30 calendar days produces 30 deliveries", schedDaily.length === 30, `Count: ${schedDaily.length}`);

    const schedAlt = generateDeliverySchedule("2026-11-20", "2026-12-19", "Alternate Days");
    assert("Alternate Days schedule for 30 calendar days produces 15 deliveries", schedAlt.length === 15, `Count: ${schedAlt.length}`);

    const schedTwice = generateDeliverySchedule("2026-11-20", "2026-12-19", "Twice Weekly");
    assert("Twice Weekly schedule for 30 calendar days produces 9 deliveries", schedTwice.length === 9, `Count: ${schedTwice.length}`);

    // -------------------------------------------------------------------------
    // TEST 5: Create Subscription via API and Verify Date Integrity
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Subscription Creation API & Date Persistence ---");
    const newSubPayload = {
        plan_id: 1,
        product_name: "A2 Desi Cow Milk",
        customer_name: "Karthik Raja",
        customer_phone: "+91 98401 22334",
        delivery_slot: "06:00 - 07:30 AM",
        frequency: "Daily",
        start_date: "2026-11-20",
        allow_immediate_start: true,
        duration_days: 30,
        address: "Plot 42, Gandhi Street, Kanchipuram",
        payment_method: "UPI QR",
        transaction_id: "UPI987654321098",
        price_per_delivery: 44,
        total_price: 1320
    };

    const createRes = await fetchJson("http://localhost:5500/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: newSubPayload
    });

    assert("Create subscription responds with success: true", createRes.data.success === true, JSON.stringify(createRes.data));
    const createdSub = createRes.data.subscription;
    assert("Created subscription has start_date 2026-11-20", createdSub.start_date === "2026-11-20");
    assert("Created subscription has end_date 2026-12-19", createdSub.end_date === "2026-12-19", `Got: ${createdSub.end_date}`);
    assert("Created subscription has expiry_date 2026-12-19", createdSub.expiry_date === "2026-12-19", `Got: ${createdSub.expiry_date}`);
    assert("Created subscription has total_duration 30", createdSub.total_duration === 30);
    assert("Created subscription has remaining_days defined", createdSub.remaining_days !== undefined);
    assert("Created subscription has completed_deliveries = 0", createdSub.completed_deliveries === 0);
    assert("Created subscription has total_deliveries = 30", createdSub.total_deliveries === 30);

    // -------------------------------------------------------------------------
    // TEST 6: Fetch Subscription by ID & Verify Enrichment
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: Fetch Subscription by ID & Enrichment ---");
    const getSubRes = await fetchJson(`http://localhost:5500/api/subscriptions/${createdSub.id}`);
    assert("Fetch subscription by ID responds 200", getSubRes.status === 200);
    const fetched = getSubRes.data.subscription;
    assert("Fetched subscription has start_date 2026-11-20", fetched.start_date === "2026-11-20");
    assert("Fetched subscription has end_date 2026-12-19", fetched.end_date === "2026-12-19");
    assert("Fetched subscription has remaining_days", fetched.remaining_days !== undefined);
    assert("Fetched subscription has total_duration = 30", fetched.total_duration === 30);

    // -------------------------------------------------------------------------
    // TEST 7: Customer Subscriptions by Identifier
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 7: Customer Subscriptions by Phone Identifier ---");
    const userSubsRes = await fetchJson(`http://localhost:5500/api/subscriptions/user/${encodeURIComponent("+91 98401 22334")}`);
    assert("Customer subscriptions endpoint responds 200", userSubsRes.status === 200);
    assert("Customer subscriptions returns an array", Array.isArray(userSubsRes.data.subscriptions) && userSubsRes.data.subscriptions.length > 0);
    const userSub = userSubsRes.data.subscriptions[0];
    assert("Customer subscription record has end_date 2026-12-19", userSub.end_date === "2026-12-19");

    // -------------------------------------------------------------------------
    // TEST 8: Status Toggle (Pause / Resume) & Cancellation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 8: Status Transitions (Pause / Resume / Cancel) ---");
    const pauseRes = await fetchJson(`http://localhost:5500/api/subscriptions/${createdSub.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: { status: "paused" }
    });
    assert("Pause subscription responds with success: true", pauseRes.data.success === true);
    assert("Updated status is paused", pauseRes.data.subscription?.status === "paused" || pauseRes.data.message?.includes("paused"));

    const resumeRes = await fetchJson(`http://localhost:5500/api/subscriptions/${createdSub.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: { status: "active" }
    });
    assert("Resume subscription responds with success: true", resumeRes.data.success === true);

    const cancelRes = await fetchJson(`http://localhost:5500/api/subscriptions/${createdSub.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { reason: "Customer relocation" }
    });
    assert("Cancel subscription responds with success: true", cancelRes.data.success === true);

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log("\n=================================================");
    console.log(`ACCEPTANCE TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
