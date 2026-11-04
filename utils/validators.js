/**
 * THULIRVA Universal Input Validators
 * Used across Backend APIs for robust security & data integrity
 */

function validateEmail(email) {
    if (!email || typeof email !== 'string') return { valid: false, message: 'Email is required' };
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(email.trim())) {
        return { valid: false, message: 'Please enter a valid email address with a domain (e.g. name@example.com)' };
    }
    return { valid: true };
}

function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') return { valid: false, message: 'Phone number is required' };
    const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
    // Strip leading 91 or 0 if 12 or 11 digits
    let digits = cleaned;
    if (digits.length === 12 && digits.startsWith('91')) {
        digits = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith('0')) {
        digits = digits.slice(1);
    }
    if (!/^[6-9]\d{9}$/.test(digits)) {
        return { valid: false, message: 'Phone number must be exactly 10 digits starting with 6, 7, 8, or 9' };
    }
    return { valid: true, cleanPhone: digits };
}

function validateName(name) {
    if (!name || typeof name !== 'string') return { valid: false, message: 'Name is required' };
    const trimmed = name.trim();
    if (trimmed.length < 2) {
        return { valid: false, message: 'Name must be at least 2 characters long' };
    }
    if (!/^[a-zA-Z\s\.\'\-]+$/.test(trimmed)) {
        return { valid: false, message: 'Name must contain only alphabetic characters and spaces' };
    }
    return { valid: true, cleanName: trimmed };
}

function validatePassword(password) {
    if (!password || typeof password !== 'string') return { valid: false, message: 'Password is required' };
    if (password.length < 6) {
        return { valid: false, message: 'Password must be at least 6 characters long' };
    }
    return { valid: true };
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
        return { valid: false, message: 'Quantity must be a positive integer' };
    }
    if (availableStock !== undefined && availableStock !== null) {
        if (qty > availableStock) {
            return { valid: false, message: `Requested quantity (${qty}) exceeds available stock (${availableStock})` };
        }
    }
    return { valid: true, value: qty };
}

function validateAddress(address) {
    if (!address || typeof address !== 'string' || address.trim().length < 5) {
        return { valid: false, message: 'Delivery address must be at least 5 characters long' };
    }
    return { valid: true, cleanAddress: address.trim() };
}

module.exports = {
    validateEmail,
    validatePhone,
    validateName,
    validatePassword,
    validatePrice,
    validateQuantity,
    validateAddress
};

