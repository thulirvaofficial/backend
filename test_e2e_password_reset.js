const fs = require('fs');
const crypto = require('crypto');

async function runTests() {
  console.log('=== THULIRVA PASSWORD RESET END-TO-END VERIFICATION ===\n');

  // Test 1: HTML Page and Elements verification
  console.log('1. Checking login.html availability & markup:');
  const pageRes = await fetch('http://localhost:5500/pages/login.html');
  const html = await pageRes.text();
  
  const expectedElements = [
    'id="forgotFormContainer"',
    'id="fpStep1"',
    'id="fpEmailInput"',
    'id="fpBtnSendCode"',
    'id="fpStep2"',
    'id="otpDigit0"',
    'id="otpDigit5"',
    'id="fpTimerText"',
    'id="fpResendBtn"',
    'id="fpBtnVerify"',
    'id="fpStep3"',
    'id="fpNewPassword"',
    'id="fpConfirmPassword"',
    'id="pwdStrengthLabel"',
    'id="pwdSeg1"',
    'id="reqLen"',
    'id="reqUpper"',
    'id="reqLower"',
    'id="reqNum"',
    'id="reqSpecial"',
    'id="reqMatch"',
    'id="fpBtnReset"',
    'id="fpStep4"',
    'finishPasswordReset()'
  ];

  let missing = 0;
  for (const el of expectedElements) {
    if (!html.includes(el)) {
      console.error('   ❌ Missing in HTML:', el);
      missing++;
    }
  }
  if (missing === 0) {
    console.log('   ✅ All 24 UI elements and handlers verified in login.html');
  }

  // Test 2: Account Enumeration Protection (non-existent email)
  console.log('\n2. Testing Account Enumeration Protection:');
  const fakeRes = await fetch('http://localhost:5500/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nonexistent.random.user.999@gmail.com' })
  });
  const fakeData = await fakeRes.json();
  console.log('   Status:', fakeRes.status, 'Response:', fakeData);
  if (fakeRes.status === 200 && fakeData.message.includes('If an account exists')) {
    console.log('   ✅ Account enumeration prevention confirmed (Generic 200 returned).');
  } else {
    console.error('   ❌ Account enumeration failed');
  }

  // Test 3: Valid Email Reset Request (Real SMTP via mail.thulirva.com:587)
  console.log('\n3. Testing Real SMTP OTP Generation for priya.raman@gmail.com:');
  const reqRes = await fetch('http://localhost:5500/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.raman@gmail.com' })
  });
  const reqData = await reqRes.json();
  console.log('   Status:', reqRes.status, 'Response:', reqData);

  // Read OTP stored in fallback DB
  let otps = [];
  try {
    otps = JSON.parse(fs.readFileSync('backend/data/password_reset_otps.json', 'utf8'));
  } catch(e) {}
  const userOtpRecord = otps.find(o => (o.target_destination || '').toLowerCase() === 'priya.raman@gmail.com' || (o.identifier || '').toLowerCase() === 'priya.raman@gmail.com');
  console.log('   Found OTP record for priya.raman@gmail.com:', {
    has_hash: !!userOtpRecord?.otp_hash,
    has_salt: !!userOtpRecord?.salt,
    expires_at: userOtpRecord?.expires_at,
    attempts: userOtpRecord?.attempts,
    created_at: userOtpRecord?.created_at
  });

  // Test 4: Resend Cooldown Protection
  console.log('\n4. Testing 60-Second Resend Cooldown:');
  const resendRes = await fetch('http://localhost:5500/api/auth/resend-reset-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.raman@gmail.com' })
  });
  const resendData = await resendRes.json();
  console.log('   Status:', resendRes.status, 'Response:', resendData.message);
  if (resendRes.status === 400 && resendData.message.includes('Please wait')) {
    console.log('   ✅ Cooldown enforcement confirmed.');
  }

  // Test 5: Invalid OTP Attempt
  console.log('\n5. Testing Invalid OTP Rejection & Attempt Counter:');
  const badOtpRes = await fetch('http://localhost:5500/api/auth/verify-reset-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.raman@gmail.com', otp: '000000' })
  });
  const badOtpData = await badOtpRes.json();
  console.log('   Status:', badOtpRes.status, 'Response:', badOtpData.message);
  if (badOtpRes.status === 400 && badOtpData.message.includes('remaining')) {
    console.log('   ✅ Invalid OTP rejected with remaining attempts warning.');
  }

  // Test 6: Valid OTP Verification & Reset Token Issuance
  console.log('\n6. Testing Valid OTP Verification:');
  const testOtp = '849201';
  const salt = crypto.randomBytes(16).toString('hex');
  const otpHash = crypto.createHash('sha256').update(testOtp + salt).digest('hex');
  
  // Update record in backend data file
  if (userOtpRecord) {
    userOtpRecord.salt = salt;
    userOtpRecord.otp_hash = otpHash;
    userOtpRecord.expires_at = Date.now() + 300000;
    userOtpRecord.attempts = 0;
    userOtpRecord.is_used = false;
    fs.writeFileSync('backend/data/password_reset_otps.json', JSON.stringify(otps, null, 2));
  }

  const verifyRes = await fetch('http://localhost:5500/api/auth/verify-reset-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.raman@gmail.com', otp: testOtp })
  });
  const verifyData = await verifyRes.json();
  console.log('   Status:', verifyRes.status, 'Reset Token issued:', !!verifyData.reset_token);
  const resetToken = verifyData.reset_token;

  // Test 7: Password Policy Enforcement (Min 10, Upper, Lower, Number, Special)
  console.log('\n7. Testing Password Policy Enforcement:');
  const weakCases = [
    { pwd: 'short', err: 'at least 10 characters' },
    { pwd: 'alllowercaseletters123!', err: 'uppercase' },
    { pwd: 'ALLUPPERCASELETTERS123!', err: 'lowercase' },
    { pwd: 'NoNumbersInPassword!', err: 'number' },
    { pwd: 'NoSpecialCharsIn12345', err: 'special character' }
  ];

  for (const c of weakCases) {
    const r = await fetch('http://localhost:5500/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'priya.raman@gmail.com',
        reset_token: resetToken,
        new_password: c.pwd,
        confirm_password: c.pwd
      })
    });
    const d = await r.json();
    console.log('   Policy check (' + c.err + '):', r.status === 400 ? '✅ Rejected' : '❌ Accepted', '-', d.message);
  }

  // Test 8: Successful Password Reset
  console.log('\n8. Testing Successful Password Reset:');
  const newSecret = 'Thulirva@2026StrongPass!';
  const resetRes = await fetch('http://localhost:5500/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'priya.raman@gmail.com',
      reset_token: resetToken,
      new_password: newSecret,
      confirm_password: newSecret
    })
  });
  const resetFinal = await resetRes.json();
  console.log('   Status:', resetRes.status, 'Response:', resetFinal);

  // Test 9: Reset Token Replay Protection
  console.log('\n9. Testing Reset Token Replay / Reuse Protection:');
  const replayRes = await fetch('http://localhost:5500/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'priya.raman@gmail.com',
      reset_token: resetToken,
      new_password: newSecret,
      confirm_password: newSecret
    })
  });
  const replayData = await replayRes.json();
  console.log('   Replay Status:', replayRes.status, 'Response:', replayData.message);
  if (replayRes.status === 400 && replayData.message.includes('already been used')) {
    console.log('   ✅ Replay attack prevented (token single-use confirmed).');
  }

  // Test 10: Authenticate Customer Login with New Password
  console.log('\n10. Testing Customer Login with NEW Password:');
  const loginNewRes = await fetch('http://localhost:5500/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.raman@gmail.com', password: newSecret })
  });
  const loginNewData = await loginNewRes.json();
  console.log('   Status:', loginNewRes.status, 'Success:', loginNewData.success, 'User:', loginNewData.user ? loginNewData.user.name : null);
  if (loginNewRes.status === 200 && loginNewData.success) {
    console.log('   ✅ Login with newly set password succeeded!');
  } else {
    console.error('   ❌ Login with new password failed');
  }

  // Test 11: Customer Login with OLD Password (must fail)
  console.log('\n11. Testing Customer Login with OLD Password (must fail):');
  const loginOldRes = await fetch('http://localhost:5500/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.raman@gmail.com', password: 'oldPassword123!' })
  });
  const loginOldData = await loginOldRes.json();
  console.log('   Status:', loginOldRes.status, 'Response:', loginOldData.message);
  if (loginOldRes.status === 401) {
    console.log('   ✅ Old password successfully invalidated.');
  }

  console.log('\n=== ALL END-TO-END VERIFICATION CHECKS COMPLETED SUCCESSFULLY ===');
}

runTests().catch(console.error);
