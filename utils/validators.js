/**
 * THULIRVA Universal Centralized Input Validators
 * Phase 3 Specification: Global Input Validation across Backend & Ecosystem
 */

function validateEmail(email) {
    if (!email || typeof email !== 'string') {
        return { valid: false, message: 'Email is required' };
    }
    const cleanEmail = email.trim().toLowerCase();
    // Valid username, mandatory @, valid domain, valid domain extension
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(cleanEmail)) {
        return { valid: false, message: 'Please enter a valid email address (e.g. name@example.com)' };
    }
    return { valid: true, cleanEmail };
}

function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') {
        return { valid: false, message: 'Mobile number is required' };
    }
    const raw = phone.trim();
    // Reject if contains letters
    if (/[a-zA-Z]/.test(raw)) {
        return { valid: false, message: 'Mobile number must contain digits only' };
    }
    // Clean spaces, dashes, parentheses, plus
    let digits = raw.replace(/[\s\-\(\)\+]/g, '');
    // Strip leading 91 or 0 if 12 or 11 digits
    if (digits.length === 12 && digits.startsWith('91')) {
        digits = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith('0')) {
        digits = digits.slice(1);
    }

    if (digits.length !== 10) {
        return { valid: false, message: 'Mobile number must be exactly 10 digits' };
    }
    if (!/^[6-9]\d{9}$/.test(digits)) {
        return { valid: false, message: 'Mobile number must start with 6, 7, 8, or 9' };
    }
    return { valid: true, cleanPhone: digits };
}

function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, message: 'Password is required' };
    }

    const missing = [];
    if (password.length < 8) missing.push('At least 8 characters');
    if (password.length > 64) missing.push('Maximum 64 characters');
    if (!/[A-Z]/.test(password)) missing.push('At least one uppercase letter (A-Z)');
    if (!/[a-z]/.test(password)) missing.push('At least one lowercase letter (a-z)');
    if (!/[0-9]/.test(password)) missing.push('At least one number (0-9)');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) missing.push('At least one special character (!@#$%^&*)');
    if (/\s/.test(password)) missing.push('No spaces allowed');

    if (missing.length > 0) {
        return {
            valid: false,
            message: `Password does not meet requirements: ${missing.join(', ')}`,
            missingRequirements: missing
        };
    }

    return { valid: true };
}

function validateName(name) {
    if (!name || typeof name !== 'string') {
        return { valid: false, message: 'Name is required' };
    }
    const cleanName = name.trim();
    if (cleanName.length < 2) {
        return { valid: false, message: 'Name must be at least 2 characters' };
    }
    if (cleanName.length > 60) {
        return { valid: false, message: 'Name cannot exceed 60 characters' };
    }
    // Reject special-character-only values
    if (!/[a-zA-Z\u0B80-\u0BFF]/.test(cleanName)) {
        return { valid: false, message: 'Name must contain letters' };
    }
    return { valid: true, cleanName };
}

function validatePincode(pincode) {
    if (!pincode) return { valid: false, message: 'PIN code is required' };
    const str = pincode.toString().trim();
    if (!/^[1-9]\d{5}$/.test(str)) {
        return { valid: false, message: 'PIN code must be exactly 6 digits and cannot start with 0' };
    }
    return { valid: true, cleanPincode: str };
}

function validateAddress(address) {
    if (!address || typeof address !== 'string' || address.trim().length < 5) {
        return { valid: false, message: 'Address must be at least 5 characters long' };
    }
    return { valid: true, cleanAddress: address.trim() };
}

function validateUtr(utr) {
    if (!utr || typeof utr !== 'string') {
        return { valid: false, message: 'UTR / Transaction Reference is required' };
    }
    const clean = utr.trim();
    if (clean.length < 6 || clean.length > 35) {
        return { valid: false, message: 'UTR must be between 6 and 35 alphanumeric characters' };
    }
    return { valid: true, cleanUtr: clean };
}

function validatePrice(price) {
    const num = Number(price);
    if (isNaN(num) || num < 0) {
        return { valid: false, message: 'Price must be a valid non-negative number' };
    }
    return { valid: true, value: num };
}

function validateQuantity(quantity, availableStock) {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
        return { valid: false, message: 'Quantity must be a positive integer greater than 0' };
    }
    if (availableStock !== undefined && availableStock !== null) {
        if (qty > availableStock) {
            return { valid: false, message: `Requested quantity (${qty}) exceeds available stock (${availableStock})` };
        }
    }
    return { valid: true, value: qty };
}

module.exports = {
    validateEmail,
    validatePhone,
    validatePassword,
    validateName,
    validatePincode,
    validateAddress,
    validateUtr,
    validatePrice,
    validateQuantity
};
