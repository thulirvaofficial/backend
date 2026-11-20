const fs = require('fs');

async function runSecurityAssessment() {
  console.log('================================================================');
  console.log('  THULIRVA ADVERSARIAL SECURITY ASSESSMENT & ATTACK SIMULATION  ');
  console.log('================================================================\n');

  const BASE_URL = 'http://localhost:5500';
  const findings = [];

  function recordFinding(id, title, severity, status, details) {
    findings.push({ id, title, severity, status, details });
    const icon = status === 'VULNERABLE' ? '🚨 [VULNERABLE]' : '✅ [PROTECTED]';
    console.log(`${icon} [${severity}] ${id}: ${title}`);
    console.log(`   Details: ${details}\n`);
  }

  // ATTACK 1: Test Hardcoded Backdoor Credentials in /api/auth/login
  console.log('--- TEST 1: Hardcoded Admin Backdoor in Auth Route ---');
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@thulirva.com', password: 'admin123', admin_login: true })
    });
    const data = await res.json();
    if (res.ok && data.success && data.token && (data.user?.role === 'super_admin' || data.admin?.role === 'super_admin')) {
      recordFinding('VULN-01', 'Hardcoded Admin Backdoor in /api/auth/login', 'CRITICAL', 'VULNERABLE', 
        'Login succeeded with hardcoded credentials "admin@thulirva.com" / "admin123", bypassing real bcrypt hashing!');
    } else {
      recordFinding('VULN-01', 'Hardcoded Admin Backdoor in /api/auth/login', 'CRITICAL', 'SAFE', 
        'Hardcoded credentials rejected properly with status: ' + res.status);
    }
  } catch (err) {
    console.error('Test 1 error:', err.message);
  }

  // ATTACK 2: Test Master Session Token Bypass in Auth Middleware
  console.log('--- TEST 2: Hardcoded Master Session Token Bypass ---');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/profile`, {
      headers: { 'Authorization': 'Bearer thulirva_admin_master_session' }
    });
    if (res.ok) {
      const data = await res.json();
      recordFinding('VULN-02', 'Master Session Token Bypass in Middleware', 'CRITICAL', 'VULNERABLE', 
        'Middleware granted full super_admin access using unauthenticated string "thulirva_admin_master_session"!');
    } else {
      recordFinding('VULN-02', 'Master Session Token Bypass in Middleware', 'CRITICAL', 'SAFE', 
        'Master session token rejected with status: ' + res.status);
    }
  } catch (err) {
    console.error('Test 2 error:', err.message);
  }

  // ATTACK 3: Customer Token Privilege Escalation to Admin API
  console.log('--- TEST 3: Privilege Escalation (Customer Token on Admin API) ---');
  try {
    // Generate customer login or sign a customer token
    const custRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'priya.raman@gmail.com', password: 'Thulirva@2026StrongPass!' })
    });
    const custData = await custRes.json();
    if (custData.token) {
      const adminRes = await fetch(`${BASE_URL}/api/admin/profile`, {
        headers: { 'Authorization': `Bearer ${custData.token}` }
      });
      if (adminRes.ok) {
        recordFinding('VULN-03', 'Privilege Escalation: Customer Token Accepted on Admin API', 'CRITICAL', 'VULNERABLE',
          'Customer token was authorized to access /api/admin/profile!');
      } else {
        recordFinding('VULN-03', 'Privilege Escalation: Customer Token on Admin API', 'HIGH', 'SAFE',
          'Customer token properly rejected on /api/admin/profile with status: ' + adminRes.status);
      }
    } else {
      console.log('   Could not authenticate test customer account to test privilege escalation.');
    }
  } catch (err) {
    console.error('Test 3 error:', err.message);
  }

  // ATTACK 4: Unauthenticated Access to Admin APIs
  console.log('--- TEST 4: Direct Unauthenticated Access to Admin APIs ---');
  try {
    const endpoints = ['/api/admin/profile', '/api/admin/products', '/api/admin/customers', '/api/v1/admin/dashboard'];
    let anyLeaked = false;
    for (const ep of endpoints) {
      const r = await fetch(`${BASE_URL}${ep}`);
      if (r.ok) {
        anyLeaked = true;
        console.error(`   Endpoint ${ep} returned 200 without auth!`);
      }
    }
    if (anyLeaked) {
      recordFinding('VULN-04', 'Broken Access Control on Admin APIs', 'CRITICAL', 'VULNERABLE',
        'One or more admin API endpoints returned data without an Authorization header.');
    } else {
      recordFinding('VULN-04', 'Broken Access Control on Admin APIs', 'HIGH', 'SAFE',
        'All admin API endpoints strictly required authentication (401/403).');
    }
  } catch (err) {
    console.error('Test 4 error:', err.message);
  }

  // ATTACK 5: Parameter Pollution / Type Confusion (Malformed input causing 500 error)
  console.log('--- TEST 5: Parameter Pollution & Malformed Input Testing ---');
  try {
    const r = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ['admin@thulirva.com', 'evil@hacker.com'], password: 'test' })
    });
    if (r.status === 500) {
      recordFinding('VULN-05', 'Parameter Pollution Crash / Unhandled Exception', 'MEDIUM', 'VULNERABLE',
        'Array input for email caused unhandled 500 internal server error instead of clean 400 validation error.');
    } else {
      recordFinding('VULN-05', 'Parameter Pollution Handling', 'MEDIUM', 'SAFE',
        'Handled cleanly with status: ' + r.status);
    }
  } catch (err) {
    console.error('Test 5 error:', err.message);
  }

  // ATTACK 6: Rapid Brute-Force Login Rate Limiting
  console.log('--- TEST 6: Rapid Brute-Force Rate Limiting ---');
  try {
    let rateLimited = false;
    for (let i = 0; i < 8; i++) {
      const r = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bruteforce.target@thulirva.com', password: `guess_${i}` })
      });
      if (r.status === 429) {
        rateLimited = true;
        break;
      }
    }
    if (rateLimited) {
      recordFinding('VULN-06', 'Login Brute-Force Protection', 'HIGH', 'SAFE',
        'Repeated failed login attempts triggered HTTP 429 Too Many Requests.');
    } else {
      recordFinding('VULN-06', 'Login Brute-Force Rate Limiting Insufficient', 'HIGH', 'VULNERABLE',
        '8 rapid failed login attempts did not trigger rate limiting / lockout.');
    }
  } catch (err) {
    console.error('Test 6 error:', err.message);
  }

  // ATTACK 7: Missing HTTP Security Headers
  console.log('--- TEST 7: Security Headers Inspection ---');
  try {
    const r = await fetch(`${BASE_URL}/admin/index.html`);
    const h = r.headers;
    const missing = [];
    if (!h.get('x-frame-options') && !h.get('content-security-policy')) missing.push('X-Frame-Options (Clickjacking)');
    if (!h.get('x-content-type-options')) missing.push('X-Content-Type-Options (MIME sniffing)');
    if (!h.get('referrer-policy')) missing.push('Referrer-Policy');
    if (!h.get('content-security-policy')) missing.push('Content-Security-Policy');

    if (missing.length > 0) {
      recordFinding('VULN-07', 'Missing Critical HTTP Security Headers', 'HIGH', 'VULNERABLE',
        'Missing headers: ' + missing.join(', '));
    } else {
      recordFinding('VULN-07', 'HTTP Security Headers', 'HIGH', 'SAFE',
        'All standard security headers are present.');
    }
  } catch (err) {
    console.error('Test 7 error:', err.message);
  }

  // ATTACK 8: Custom 404 Routing Fallback
  console.log('--- TEST 8: Custom 404 Routing for Non-Existent Pages ---');
  try {
    const r = await fetch(`${BASE_URL}/this-route-definitely-does-not-exist-${Date.now()}`);
    const text = await r.text();
    if (r.status === 404 && text.includes('Moo! Page Not Found')) {
      recordFinding('VULN-08', 'Custom 404 Page Serving', 'MEDIUM', 'SAFE',
        'Server returned 404 status and served the Thulirva animated custom 404 page.');
    } else if (text.includes('Cannot GET')) {
      recordFinding('VULN-08', 'Missing Custom 404 Route Handler', 'MEDIUM', 'VULNERABLE',
        'Server returned Express default plain "Cannot GET" error instead of custom 404 page!');
    } else {
      recordFinding('VULN-08', 'Custom 404 Status Check', 'MEDIUM', 'VULNERABLE',
        'Status: ' + r.status + ', unexpected body received.');
    }
  } catch (err) {
    console.error('Test 8 error:', err.message);
  }

  // ATTACK 9: API 404 JSON Guarantee
  console.log('--- TEST 9: API 404 Pure JSON Guarantee ---');
  try {
    const r = await fetch(`${BASE_URL}/api/nonexistent-endpoint-${Date.now()}`);
    const ctype = r.headers.get('content-type') || '';
    if (r.status === 404 && ctype.includes('application/json')) {
      recordFinding('VULN-09', 'API 404 Pure JSON Response', 'LOW', 'SAFE',
        'API route returned clean JSON error with HTTP 404.');
    } else {
      recordFinding('VULN-09', 'API 404 Not Returning JSON', 'MEDIUM', 'VULNERABLE',
        'Status: ' + r.status + ', Content-Type: ' + ctype);
    }
  } catch (err) {
    console.error('Test 9 error:', err.message);
  }

  // ATTACK 10: XSS in 404 Path & Injection
  console.log('--- TEST 10: XSS Payload Reflection in 404 Path ---');
  try {
    const payload = '<script>alert("XSS")</script>';
    const r = await fetch(`${BASE_URL}/${encodeURIComponent(payload)}`);
    const body = await r.text();
    if (body.includes('<script>alert("XSS")</script>')) {
      recordFinding('VULN-10', 'Reflected XSS on 404 Page', 'HIGH', 'VULNERABLE',
        'User path containing script tags was reflected unescaped in response body!');
    } else {
      recordFinding('VULN-10', 'Reflected XSS on 404 Page', 'HIGH', 'SAFE',
        'No unescaped script reflection in 404 response.');
    }
  } catch (err) {
    console.error('Test 10 error:', err.message);
  }

  // ATTACK 11: Credential Exposure in Admin Login HTML
  console.log('--- TEST 11: Static Analysis of Admin Login HTML ---');
  try {
    const html = fs.readFileSync('website/admin/index.html', 'utf8');
    const hasValueAdmin = html.includes('value="admin@thulirva.com"');
    const hasValuePass = html.includes('value="admin123"');
    const hasAlertCreds = html.includes('promptSupportHelp') && html.includes('Password: admin123');

    if (hasValueAdmin || hasValuePass || hasAlertCreds) {
      recordFinding('VULN-11', 'Admin Login Page Exposes Default Credentials in Source', 'HIGH', 'VULNERABLE',
        `Pre-filled fields (email: ${hasValueAdmin}, pass: ${hasValuePass}) or alert popup exposes credentials!`);
    } else {
      recordFinding('VULN-11', 'Admin Login Page Credentials Exposure', 'HIGH', 'SAFE',
        'No default credentials pre-filled or exposed in admin login source.');
    }
  } catch (err) {
    console.error('Test 11 error:', err.message);
  }

  console.log('\n================================================================');
  console.log('  ASSESSMENT COMPLETE: SUMMARY OF IDENTIFIED VULNERABILITIES   ');
  console.log('================================================================');
  const vulns = findings.filter(f => f.status === 'VULNERABLE');
  console.log(`Total Findings: ${findings.length} | Vulnerabilities: ${vulns.length}`);
  vulns.forEach(v => console.log(` - [${v.severity}] ${v.id}: ${v.title}`));
}

runSecurityAssessment().catch(console.error);

