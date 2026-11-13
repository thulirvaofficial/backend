const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { getPartnerById, savePartner } = require("./deliveryPartnerService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const KYC_DIR = path.join(DATA_DIR, "kyc_documents");
const KYC_HISTORY_FILE = path.join(DATA_DIR, "partner_kyc_history.json");

function ensureDirectoryExists() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(KYC_DIR)) fs.mkdirSync(KYC_DIR, { recursive: true });
}

function loadHistory() {
    ensureDirectoryExists();
    try {
        if (fs.existsSync(KYC_HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(KYC_HISTORY_FILE, "utf-8"));
        }
    } catch (_) {}
    return [];
}

function saveHistory(history) {
    ensureDirectoryExists();
    try {
        fs.writeFileSync(KYC_HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
    } catch (_) {}
}

const VALID_STATUSES = [
    "NOT_SUBMITTED",
    "PENDING",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "RESUBMISSION_REQUIRED"
];

/**
 * Submit KYC documents by partner
 */
async function submitKycDocuments({
    partner_id,
    aadhaar_number = "",
    aadhaar_front_url,
    aadhaar_back_url,
    pan_number = "",
    pan_url = null,
    driving_license_number = "",
    driving_license_url = null
}) {
    if (!partner_id) throw new Error("partner_id is required.");
    if (!aadhaar_front_url || !aadhaar_back_url) {
        throw new Error("Both Aadhaar front and back documents are required for KYC submission.");
    }

    const partner = await getPartnerById(partner_id);
    if (!partner) throw new Error(`Partner #${partner_id} not found.`);

    const submissionId = `KYC-SUB-${Date.now()}`;
    const nowIso = new Date().toISOString();

    partner.kyc_status = "PENDING";
    partner.aadhaar_number = aadhaar_number || partner.aadhaar_number || "";
    partner.aadhaar_front_url = aadhaar_front_url;
    partner.aadhaar_back_url = aadhaar_back_url;
    if (pan_number) partner.pan_number = pan_number;
    if (pan_url) partner.pan_url = pan_url;
    if (driving_license_number) partner.driving_license_number = driving_license_number;
    if (driving_license_url) partner.driving_license_url = driving_license_url;
    partner.kyc_submitted_at = nowIso;
    partner.kyc_rejection_reason = null;

    await savePartner(partner);

    // Record History Entry
    const history = loadHistory();
    history.unshift({
        submission_id: submissionId,
        partner_id,
        status: "PENDING",
        rejection_reason: null,
        notes: "KYC documents submitted by partner. Pending admin review.",
        submitted_at: nowIso,
        changed_by: `Partner ${partner_id}`,
        created_at: nowIso
    });
    saveHistory(history);

    try {
        await pool.query(`
            UPDATE delivery_partners
            SET kyc_status = 'PENDING', aadhaar_front_url = $1, aadhaar_back_url = $2,
                kyc_submitted_at = NOW(), updated_at = NOW()
            WHERE partner_id = $3
        `, [aadhaar_front_url, aadhaar_back_url, partner_id]);

        await pool.query(`
            INSERT INTO partner_kyc_history (partner_id, status, notes, changed_by, created_at)
            VALUES ($1, 'PENDING', 'KYC documents submitted by partner', $2, NOW())
        `, [partner_id, partner_id]);
    } catch (_) {}

    // Emit Real-time Notification
    try {
        const { emitToAdmin, emitToPartner } = require("./socketService");
        emitToAdmin("partner:kyc_submitted", {
            partner_id,
            partner_name: partner.name,
            kyc_status: "PENDING"
        });
        emitToPartner(partner_id, "partner:kyc_updated", {
            partner_id,
            kyc_status: "PENDING"
        });
    } catch (_) {}

    return {
        success: true,
        submission_id: submissionId,
        partner_id,
        kyc_status: "PENDING",
        message: "KYC documents submitted successfully. Verification in progress."
    };
}

/**
 * Review KYC submission by admin (APPROVE, REJECT, RESUBMISSION_REQUIRED, UNDER_REVIEW)
 */
async function reviewKycSubmission({
    partner_id,
    status,
    rejection_reason = "",
    reviewer_name = "Operations Admin",
    notes = ""
}) {
    if (!partner_id || !status) throw new Error("partner_id and status are required.");
    const cleanStatus = status.trim().toUpperCase();

    if (!VALID_STATUSES.includes(cleanStatus)) {
        throw new Error(`Invalid KYC status '${status}'. Allowed: ${VALID_STATUSES.join(", ")}`);
    }

    if ((cleanStatus === "REJECTED" || cleanStatus === "RESUBMISSION_REQUIRED") && (!rejection_reason || rejection_reason.trim().length < 5)) {
        throw new Error("A clear rejection reason / resubmission instruction is required.");
    }

    const partner = await getPartnerById(partner_id);
    if (!partner) throw new Error(`Partner #${partner_id} not found.`);

    const nowIso = new Date().toISOString();
    partner.kyc_status = cleanStatus;
    partner.kyc_reviewed_at = nowIso;
    partner.kyc_reviewed_by = reviewer_name;
    partner.kyc_rejection_reason = (cleanStatus === "REJECTED" || cleanStatus === "RESUBMISSION_REQUIRED") ? rejection_reason : null;

    if (cleanStatus === "APPROVED") {
        partner.is_active = true;
        partner.registration_status = "approved";
    } else if (cleanStatus === "REJECTED") {
        partner.is_active = false;
    }

    await savePartner(partner);

    // Record History Entry
    const history = loadHistory();
    history.unshift({
        partner_id,
        status: cleanStatus,
        rejection_reason: partner.kyc_rejection_reason,
        notes: notes || `KYC reviewed by ${reviewer_name}: ${cleanStatus}`,
        reviewed_at: nowIso,
        changed_by: reviewer_name,
        created_at: nowIso
    });
    saveHistory(history);

    try {
        await pool.query(`
            UPDATE delivery_partners
            SET kyc_status = $1, registration_status = CASE WHEN $1 = 'APPROVED' THEN 'approved' ELSE registration_status END,
                is_active = CASE WHEN $1 = 'APPROVED' THEN true ELSE is_active END,
                updated_at = NOW()
            WHERE partner_id = $2
        `, [cleanStatus, partner_id]);

        await pool.query(`
            INSERT INTO partner_kyc_history (partner_id, status, notes, changed_by, created_at)
            VALUES ($1, $2, $3, $4, NOW())
        `, [partner_id, cleanStatus, notes || `KYC updated to ${cleanStatus}`, reviewer_name]);
    } catch (_) {}

    // Emit Real-time Notification
    try {
        const { emitToPartner, emitToAdmin } = require("./socketService");
        emitToPartner(partner_id, "partner:kyc_updated", {
            partner_id,
            kyc_status: cleanStatus,
            rejection_reason: partner.kyc_rejection_reason,
            reviewed_by: reviewer_name
        });
        emitToAdmin("partner:kyc_reviewed", {
            partner_id,
            kyc_status: cleanStatus,
            reviewed_by: reviewer_name
        });
    } catch (_) {}

    return {
        success: true,
        partner_id,
        kyc_status: cleanStatus,
        rejection_reason: partner.kyc_rejection_reason,
        message: `Partner #${partner_id} KYC marked as ${cleanStatus}`
    };
}

/**
 * Get KYC history and details for a partner
 */
async function getPartnerKycDetails(partnerId) {
    const partner = await getPartnerById(partnerId);
    if (!partner) return null;

    const history = loadHistory().filter(h => h.partner_id === partnerId);
    return {
        partner_id: partner.partner_id,
        name: partner.name,
        phone: partner.phone,
        kyc_status: partner.kyc_status || "PENDING",
        aadhaar_number: partner.aadhaar_number ? `••••••••${partner.aadhaar_number.slice(-4)}` : null,
        aadhaar_front_url: partner.aadhaar_front_url || null,
        aadhaar_back_url: partner.aadhaar_back_url || null,
        pan_number: partner.pan_number || null,
        pan_url: partner.pan_url || null,
        driving_license_number: partner.driving_license_number || null,
        driving_license_url: partner.driving_license_url || null,
        kyc_submitted_at: partner.kyc_submitted_at || null,
        kyc_reviewed_at: partner.kyc_reviewed_at || null,
        kyc_reviewed_by: partner.kyc_reviewed_by || null,
        kyc_rejection_reason: partner.kyc_rejection_reason || null,
        history
    };
}

module.exports = {
    VALID_STATUSES,
    submitKycDocuments,
    reviewKycSubmission,
    getPartnerKycDetails
};

