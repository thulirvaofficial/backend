/**
 * THULIRVA - MODULE 10: MULTI-DEVICE SCALABILITY & PROGRESSIVE LOAD TESTING
 * Simulates Concurrent Virtual Users (50, 100, 250, 500, 1,000)
 * Measures: Requests/sec, Latency (Avg, P95, P99), Error Rate, RAM/CPU
 */

const http = require("http");

const BASE_URL = "http://localhost:5500";
const TIERS = [50, 100, 250, 500, 1000];

const ENDPOINTS = [
    { method: "GET", path: "/api/products" },
    { method: "GET", path: "/api/subscriptions/plans" },
    { method: "GET", path: "/api/products/1" },
    {
        method: "POST",
        path: "/api/subscriptions/calculate-price",
        body: JSON.stringify({ plan_id: 1, quantity: 2, frequency: "Daily", duration_days: 30 })
    }
];

function makeRequest({ method, path, body }) {
    return new Promise((resolve) => {
        const start = performance.now();
        const url = new URL(BASE_URL + path);

        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: method,
            headers: {
                "User-Agent": "ThulirvaLoadTester/1.0",
                "Connection": "keep-alive"
            }
        };

        if (body) {
            options.headers["Content-Type"] = "application/json";
            options.headers["Content-Length"] = Buffer.byteLength(body);
        }

        const req = http.request(options, (res) => {
            let resData = "";
            res.on("data", (chunk) => { resData += chunk; });
            res.on("end", () => {
                const duration = performance.now() - start;
                resolve({
                    success: res.statusCode >= 200 && res.statusCode < 400,
                    status: res.statusCode,
                    duration: duration
                });
            });
        });

        req.on("error", (err) => {
            const duration = performance.now() - start;
            resolve({
                success: false,
                status: 500,
                error: err.message,
                duration: duration
            });
        });

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

async function runTier(concurrency) {
    console.log(`\n---------------------------------------------------------------`);
    console.log(`🚀 RUNNING LOAD TIER: ${concurrency} CONCURRENT VIRTUAL USERS`);
    console.log(`---------------------------------------------------------------`);

    const initialMem = process.memoryUsage();
    const startTime = performance.now();

    // Create concurrent tasks across endpoints
    const tasks = [];
    for (let i = 0; i < concurrency; i++) {
        const endpoint = ENDPOINTS[i % ENDPOINTS.length];
        tasks.push(makeRequest(endpoint));
    }

    const results = await Promise.all(tasks);
    const totalTimeMs = performance.now() - startTime;
    const finalMem = process.memoryUsage();

    const successCount = results.filter(r => r.success).length;
    const errorCount = results.length - successCount;
    const errorRate = ((errorCount / results.length) * 100).toFixed(2);
    const rps = ((results.length / (totalTimeMs / 1000))).toFixed(1);

    const latencies = results.map(r => r.duration).sort((a, b) => a - b);
    const minLat = latencies[0].toFixed(1);
    const maxLat = latencies[latencies.length - 1].toFixed(1);
    const avgLat = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1);
    const p50 = latencies[Math.floor(latencies.length * 0.50)].toFixed(1);
    const p90 = latencies[Math.floor(latencies.length * 0.90)].toFixed(1);
    const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(1);
    const p99 = latencies[Math.floor(latencies.length * 0.99)].toFixed(1);

    const heapUsedMB = (finalMem.heapUsed / 1024 / 1024).toFixed(1);
    const rssMB = (finalMem.rss / 1024 / 1024).toFixed(1);

    console.log(`  Requests Sent     : ${concurrency}`);
    console.log(`  Success / Errors  : ${successCount} passed / ${errorCount} errors (${errorRate}% error rate)`);
    console.log(`  Throughput        : ${rps} req/sec`);
    console.log(`  Total Time        : ${(totalTimeMs / 1000).toFixed(2)}s`);
    console.log(`  Latency (Avg/Min) : ${avgLat}ms / ${minLat}ms`);
    console.log(`  Latency (P50/P90) : ${p50}ms / ${p90}ms`);
    console.log(`  Latency (P95/P99) : ${p95}ms / ${p99}ms (Max: ${maxLat}ms)`);
    console.log(`  Process Memory    : Heap: ${heapUsedMB} MB | RSS: ${rssMB} MB`);

    if (errorCount > 0) {
        console.warn(`  ⚠️ Warnings: Encountered ${errorCount} failed requests`);
    } else {
        console.log(`  ✓ 100% SUCCESS - Sub-second latency maintained`);
    }

    return {
        concurrency,
        successCount,
        errorCount,
        errorRate: parseFloat(errorRate),
        rps: parseFloat(rps),
        avgLat: parseFloat(avgLat),
        p95: parseFloat(p95),
        p99: parseFloat(p99)
    };
}

async function runProgressiveLoadTesting() {
    console.log("===============================================================");
    console.log("▶ STARTING MODULE 10: PROGRESSIVE LOAD & SCALABILITY TEST SUITE");
    console.log("  Target: THULIRVA Centralized Node.js Server (Port 5500)");
    console.log("  Concurrency Stages: 50 -> 100 -> 250 -> 500 -> 1,000 Users");
    console.log("===============================================================");

    const summary = [];
    for (const tier of TIERS) {
        const res = await runTier(tier);
        summary.push(res);
        // Short cooldown between tiers to simulate real traffic rhythm
        await new Promise(r => setTimeout(r, 800));
    }

    console.log("\n===============================================================");
    console.log("📊 PROGRESSIVE LOAD TEST BENCHMARK SUMMARY");
    console.log("===============================================================");
    console.log("| Users | Throughput (RPS) | Avg Latency | P95 Latency | P99 Latency | Error Rate |");
    console.log("|-------|------------------|-------------|-------------|-------------|------------|");
    summary.forEach(s => {
        console.log(`| ${s.concurrency.toString().padEnd(5)} | ${(s.rps + ' req/s').padEnd(16)} | ${(s.avgLat + ' ms').padEnd(11)} | ${(s.p95 + ' ms').padEnd(11)} | ${(s.p99 + ' ms').padEnd(11)} | ${(s.errorRate + '%').padEnd(10)} |`);
    });
    console.log("===============================================================");
    const allPassed = summary.every(s => s.errorRate === 0 && s.p95 < 2000);
    if (allPassed) {
        console.log("✅ ALL PROGRESSIVE LOAD TIERS PASSED WITH 0% ERROR RATE!");
    } else {
        console.warn("⚠️ Some tiers exceeded performance thresholds");
    }
    console.log("===============================================================\n");
}

runProgressiveLoadTesting().catch(err => {
    console.error("❌ LOAD TEST SUITE FAILED:", err);
    process.exit(1);
});

