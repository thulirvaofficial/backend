const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "partner_profile_fields_config.json");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Standard 9 delivery partner profile fields default configuration
 */
const DEFAULT_FIELDS_CONFIG = [
    {
        field_key: "name",
        label: "Full Name",
        placeholder: "Enter your full name",
        is_active: true,
        is_visible: true,
        is_editable: true,
        is_required: true,
        validation_rule: "name",
        options: null,
        order: 1
    },
    {
        field_key: "phone",
        label: "Mobile Number",
        placeholder: "10-digit mobile number",
        is_active: true,
        is_visible: true,
        is_editable: false,
        is_required: true,
        validation_rule: "phone",
        options: null,
        order: 2
    },
    {
        field_key: "email",
        label: "Email Address",
        placeholder: "Enter your email address",
        is_active: true,
        is_visible: true,
        is_editable: true,
        is_required: false,
        validation_rule: "email",
        options: null,
        order: 3
    },
    {
        field_key: "vehicle_type",
        label: "Vehicle Type",
        placeholder: "Select vehicle type",
        is_active: true,
        is_visible: true,
        is_editable: true,
        is_required: true,
        validation_rule: "vehicle_type",
        options: ["Electric Scooter", "Scooter", "Motorcycle", "Van", "Bicycle"],
        order: 4
    },
    {
        field_key: "vehicle_number",
        label: "Vehicle Registration Number",
        placeholder: "TN 07 KK 1412",
        is_active: true,
        is_visible: true,
        is_editable: true,
        is_required: true,
        validation_rule: "vehicle_number",
        options: null,
        order: 5
    },
    {
        field_key: "address",
        label: "Residential Address",
        placeholder: "Street address / Door No.",
        is_active: true,
        is_visible: true,
        is_editable: true,
        is_required: false,
        validation_rule: "text",
        options: null,
        order: 6
    },
    {
        field_key: "city",
        label: "City",
        placeholder: "e.g. Chennai",
        is_active: true,
        is_visible: true,
        is_editable: true,
        is_required: false,
        validation_rule: "text",
        options: null,
        order: 7
    },
    {
        field_key: "pincode",
        label: "PIN Code",
        placeholder: "6-digit PIN code",
        is_active: true,
        is_visible: true,
        is_editable: true,
        is_required: false,
        validation_rule: "pincode",
        options: null,
        order: 8
    },
    {
        field_key: "emergency_contact",
        label: "Emergency Contact",
        placeholder: "Emergency phone number",
        is_active: true,
        is_visible: true,
        is_editable: true,
        is_required: false,
        validation_rule: "phone",
        options: null,
        order: 9
    }
];

/**
 * Load fields configuration from disk or return defaults
 */
function loadConfigFromDisk() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (err) {
        console.warn("[PARTNER PROFILE CONFIG] Disk read error:", err.message);
    }
    // Write defaults if not present
    saveConfigToDisk(DEFAULT_FIELDS_CONFIG);
    return DEFAULT_FIELDS_CONFIG;
}

/**
 * Save fields configuration to disk
 */
function saveConfigToDisk(fields) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(fields, null, 2), "utf-8");
        return true;
    } catch (err) {
        console.error("[PARTNER PROFILE CONFIG] Disk write error:", err.message);
        return false;
    }
}

/**
 * Initialize PostgreSQL table if available
 */
async function initDbTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS partner_profile_fields_config (
                id VARCHAR(50) PRIMARY KEY DEFAULT 'main_config',
                fields_json JSONB NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch (e) {
        // Local fallback when DB is unreachable
    }
}
initDbTable();

/**
 * Get Authoritative Partner Profile Fields Configuration
 */
async function getPartnerProfileFieldsConfig() {
    try {
        const res = await pool.query(`SELECT fields_json FROM partner_profile_fields_config WHERE id = 'main_config' LIMIT 1`);
        if (res.rows && res.rows.length > 0 && Array.isArray(res.rows[0].fields_json)) {
            // Merge with defaults to ensure all 9 keys exist
            const dbFields = res.rows[0].fields_json;
            saveConfigToDisk(dbFields);
            return dbFields;
        }
    } catch (e) {
        // Fall back to disk
    }
    return loadConfigFromDisk();
}

/**
 * Update Authoritative Partner Profile Fields Configuration (Admin)
 */
async function updatePartnerProfileFieldsConfig(updatedFields) {
    if (!Array.isArray(updatedFields) || updatedFields.length === 0) {
        throw new Error("Invalid fields configuration format. Array of fields expected.");
    }

    const currentConfig = await getPartnerProfileFieldsConfig();
    const configMap = new Map(currentConfig.map(f => [f.field_key, f]));

    const validated = updatedFields.map((field, idx) => {
        if (!field.field_key) {
            throw new Error(`Field at index ${idx} is missing field_key.`);
        }
        const existing = configMap.get(field.field_key) || {};

        return {
            field_key: field.field_key,
            label: (field.label !== undefined ? String(field.label).trim() : existing.label) || field.field_key,
            placeholder: field.placeholder !== undefined ? String(field.placeholder).trim() : (existing.placeholder || ""),
            is_active: field.is_active !== undefined ? Boolean(field.is_active) : (existing.is_active !== undefined ? existing.is_active : true),
            is_visible: field.is_visible !== undefined ? Boolean(field.is_visible) : (existing.is_visible !== undefined ? existing.is_visible : true),
            is_editable: field.is_editable !== undefined ? Boolean(field.is_editable) : (existing.is_editable !== undefined ? existing.is_editable : true),
            is_required: field.is_required !== undefined ? Boolean(field.is_required) : Boolean(existing.is_required),
            validation_rule: field.validation_rule || existing.validation_rule || "text",
            options: Array.isArray(field.options) ? field.options : (existing.options || null),
            order: typeof field.order === "number" ? field.order : (existing.order || idx + 1)
        };
    });

    // Sort by order
    validated.sort((a, b) => a.order - b.order);

    // Save to disk mirror
    saveConfigToDisk(validated);

    // Save to PostgreSQL if available
    try {
        await pool.query(`
            INSERT INTO partner_profile_fields_config (id, fields_json, updated_at)
            VALUES ('main_config', $1, NOW())
            ON CONFLICT (id) DO UPDATE
            SET fields_json = EXCLUDED.fields_json, updated_at = NOW()
        `, [JSON.stringify(validated)]);
    } catch (e) {
        // Saved to disk
    }

    return validated;
}

/**
 * Check if a registration number is a placeholder string
 */
function isPlaceholderVehicleNumber(num) {
    if (!num) return false;
    const clean = String(num).replace(/[\s\-]/g, "").toUpperCase();
    return clean === "TN01KK1412" || clean === "TN07KK1412" || clean.startsWith("TN07KK1412");
}

/**
 * Validate Indian vehicle registration number format
 */
function isValidIndianVehicleNumber(num) {
    if (!num) return false;
    const clean = String(num).replace(/[\s\-]/g, "").toUpperCase();
    const standardRegex = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/;
    const bhRegex = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;
    return standardRegex.test(clean) || bhRegex.test(clean);
}

/**
 * Normalize vehicle registration number with standard spacing (e.g. TN 07 KK 1412 or TN 09 AB 1234)
 */
function normalizeVehicleNumber(num) {
    if (!num) return "";
    const clean = String(num).replace(/[\s\-]/g, "").toUpperCase();
    if (!clean) return "";

    const standardMatch = clean.match(/^([A-Z]{2})([0-9]{1,2})([A-Z]{0,3})([0-9]{1,4})$/);
    if (standardMatch) {
        const state = standardMatch[1];
        const rto = standardMatch[2].padStart(2, "0");
        const series = standardMatch[3];
        const number = standardMatch[4];
        return series ? `${state} ${rto} ${series} ${number}` : `${state} ${rto} ${number}`;
    }

    const bhMatch = clean.match(/^([0-9]{2})(BH)([0-9]{4})([A-Z]{1,2})$/);
    if (bhMatch) {
        return `${bhMatch[1]} BH ${bhMatch[3]} ${bhMatch[4]}`;
    }

    return clean;
}

/**
 * Enforce Admin Permissions and Validation Rules on Partner Profile Submission
 */
async function validateProfileSubmission(submittedData, currentPartner) {
    const config = await getPartnerProfileFieldsConfig();
    const configMap = new Map(config.map(f => [f.field_key, f]));

    const sanitized = {};

    for (const field of config) {
        const key = field.field_key;
        const currentVal = currentPartner[key] !== undefined && currentPartner[key] !== null ? String(currentPartner[key]).trim() : "";
        const submittedVal = submittedData[key] !== undefined && submittedData[key] !== null ? String(submittedData[key]).trim() : undefined;

        // 1. If field is disabled or hidden, do not permit edits; preserve existing database value
        if (!field.is_active || !field.is_visible) {
            sanitized[key] = currentPartner[key] || "";
            continue;
        }

        // 2. If field is read-only (not editable)
        if (!field.is_editable) {
            if (submittedVal !== undefined && submittedVal !== currentVal && currentVal !== "") {
                return {
                    valid: false,
                    message: `Field "${field.label}" cannot be edited because it is configured as read-only by the administrator.`
                };
            }
            // Always preserve existing value for read-only fields
            sanitized[key] = currentPartner[key] || "";
            continue;
        }

        // 3. Field is editable: use submitted value or fallback to current
        let finalVal = submittedVal !== undefined ? submittedVal : currentVal;

        // 4. Validate Required fields
        if (field.is_required && (!finalVal || finalVal.trim() === "")) {
            return {
                valid: false,
                message: `"${field.label}" is required.`
            };
        }

        // 5. Special validation rules
        if (finalVal && finalVal.trim() !== "") {
            finalVal = finalVal.trim();

            if (key === "vehicle_number") {
                if (isPlaceholderVehicleNumber(finalVal)) {
                    return {
                        valid: false,
                        message: "Placeholder 'TN 07 KK 1412' cannot be saved as your vehicle number. Please enter your actual vehicle registration number."
                    };
                }
                if (!isValidIndianVehicleNumber(finalVal)) {
                    return {
                        valid: false,
                        message: "Please enter a valid Indian vehicle registration number (e.g. TN 07 KK 1412 or TN 09 AB 1234)."
                    };
                }
                finalVal = normalizeVehicleNumber(finalVal);
            } else if (key === "phone" || key === "emergency_contact") {
                const digits = finalVal.replace(/\D/g, "");
                if (digits.length < 10) {
                    return {
                        valid: false,
                        message: `"${field.label}" must contain at least 10 valid digits.`
                    };
                }
                finalVal = digits.length === 10 ? digits : digits.slice(-10);
            } else if (key === "email") {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(finalVal)) {
                    return {
                        valid: false,
                        message: "Please enter a valid email address."
                    };
                }
            } else if (key === "pincode") {
                const pinRegex = /^[1-9][0-9]{5}$/;
                if (!pinRegex.test(finalVal.replace(/\s/g, ""))) {
                    return {
                        valid: false,
                        message: "Please enter a valid 6-digit Indian PIN code."
                    };
                }
                finalVal = finalVal.replace(/\s/g, "");
            }
        }

        sanitized[key] = finalVal;
    }

    return {
        valid: true,
        sanitized
    };
}

module.exports = {
    DEFAULT_FIELDS_CONFIG,
    getPartnerProfileFieldsConfig,
    updatePartnerProfileFieldsConfig,
    isPlaceholderVehicleNumber,
    isValidIndianVehicleNumber,
    normalizeVehicleNumber,
    validateProfileSubmission
};
