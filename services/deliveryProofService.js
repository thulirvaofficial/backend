const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { emitToAdmin, emitToCustomer, emitToPartner } = require("./socketService");
const { recordProductDeliveryEarning, recordSubscriptionDeliveryEarning } = require("./financialService");
const { getPartnerById, savePartner } = require("./deliveryPartnerService");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SUBS_DELIVERIES_FILE = path.join(DATA_DIR, "subscription_deliveries.json");
const ISSUES_FILE = path.join(DATA_DIR, "customer_delivery_issues.json");

const UPLOADS_DIR = path.resolve(__dirname, "..", "public", "uploads", "delivery_proofs");
if (!fs.existsSync(UPLOADS_DIR)) {
    try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}
}

function loadJson(file, defaultVal = []) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (_) {}
    return defaultVal;
}

function saveJson(file, data) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.warn(`[SAVE JSON WARN ${path.basename(file)}]:`, e.message);
    }
}

/**
 * Validates image buffer magic bytes
 */
function isValidImageBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
    // JPEG: 0xFF, 0xD8
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return true;
    // PNG: 0x89, 0x50, 0x4E, 0x47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
    // WebP: RIFF .... WEBP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return true;
    }
    // GIF: GIF8
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
    return false;
}

/**
 * Save Multer file or Base64 image to server storage disk
 */
function saveProofImageToDisk(imageData, identifier = "delivery") {
    if (!imageData) return "";
    try {
        // If already an existing accessible URL, return directly
        if (typeof imageData === "string" && (imageData.startsWith("/uploads/") || imageData.startsWith("/assets/images/"))) {
            return imageData;
        }

        let buffer;
        let ext = "jpg";

        // Check if Multer file object
        if (typeof imageData === "object" && (imageData.filename || imageData.path)) {
            const fileName = imageData.filename || path.basename(imageData.path);
            const fullPath = imageData.path || path.join(UPLOADS_DIR, fileName);
            if (fs.existsSync(fullPath)) {
                const fileBuf = fs.readFileSync(fullPath);
                if (fileBuf.length > 50) {
                    const altDir = path.resolve(__dirname, "..", "..", "website", "website", "assets", "images", "uploads");
                    const altSubDir = path.join(altDir, "delivery_proofs");
                    const publicAlt = path.resolve(__dirname, "..", "assets", "images", "uploads");
                    [altDir, altSubDir, publicAlt].forEach(d => {
                        if (!fs.existsSync(d)) try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
                    });
                    try {
                        fs.writeFileSync(path.join(altDir, fileName), fileBuf);
                        fs.writeFileSync(path.join(altSubDir, fileName), fileBuf);
                        fs.writeFileSync(path.join(publicAlt, fileName), fileBuf);
                    } catch (_) {}
                    return `/uploads/delivery_proofs/${fileName}`;
                }
            }
        } else if (Buffer.isBuffer(imageData)) {
            buffer = imageData;
        } else if (typeof imageData === "string") {
            const matches = imageData.match(/^data:image\/([a-zA-Z0-9\+\-\.]+);base64,(.+)$/);
            ext = matches ? (matches[1].includes("png") ? "png" : (matches[1].includes("webp") ? "webp" : "jpg")) : "jpg";
            const rawBase64 = matches ? matches[2] : imageData.trim();
            buffer = Buffer.from(rawBase64, "base64");
        } else {
            return "";
        }

        if (!buffer || buffer.length < 50) {
            console.warn("[SAVE PROOF WARN]: Image buffer too small or empty");
            return "";
        }

        // Detect extension from buffer magic bytes if available
        if (buffer[0] === 0x89 && buffer[1] === 0x50) ext = "png";
        else if (buffer[0] === 0x52 && buffer[1] === 0x49) ext = "webp";
        else ext = "jpg";

        const fileName = `proof_${identifier}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(filePath, buffer);

        // Also copy to website uploads so all static paths work seamlessly
        const altDir = path.resolve(__dirname, "..", "..", "website", "website", "assets", "images", "uploads");
        const altSubDir = path.join(altDir, "delivery_proofs");
        const publicAlt = path.resolve(__dirname, "..", "assets", "images", "uploads");
        [altDir, altSubDir, publicAlt].forEach(d => {
            if (!fs.existsSync(d)) try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
        });
        try {
            fs.writeFileSync(path.join(altDir, fileName), buffer);
            fs.writeFileSync(path.join(altSubDir, fileName), buffer);
            fs.writeFileSync(path.join(publicAlt, fileName), buffer);
        } catch (_) {}

        // Verify file is readable and non-empty
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
            return `/uploads/delivery_proofs/${fileName}`;
        }
        return "";
    } catch (err) {
        console.error("[SAVE PROOF ERROR]:", err.message);
        return "";
    }
}

/**
 * Save delivery proof for a Product Order or Subscription Delivery and mark as completed
 */
async function saveDeliveryProof({ orderId, subId, partnerId, imageBase64, file, remarks, latitude, longitude, markDelivered = true }) {
    const isSub = Boolean(subId) || (orderId && orderId.toString().startsWith("SUB-"));
    const cleanId = isSub ? (subId || orderId.toString().replace("SUB-", "")).toString() : orderId.toString();

    const proofSource = file || imageBase64;
    const proofUrl = saveProofImageToDisk(proofSource, cleanId);
    if (!proofUrl) {
        throw new Error("Invalid photograph proof or image processing failed.");
    }

    const timestamp = new Date().toISOString();

    if (isSub) {
        // 1. Try PostgreSQL
        let sub = null;
        try {
            const dbRes = await pool.query("SELECT * FROM subscriptions WHERE id::text = $1", [cleanId]);
            if (dbRes.rows && dbRes.rows.length > 0) sub = dbRes.rows[0];
        } catch (_) {}

        // 2. Try JSON
        const subs = loadJson(SUBS_DELIVERIES_FILE, []);
        let jsonSub = subs.find(s => s.id?.toString() === cleanId || s.subscription_id?.toString() === cleanId);

        if (!sub && !jsonSub) {
            jsonSub = {
                id: cleanId,
                subscription_id: cleanId,
                customer_name: "Subscriber",
                product_name: "Farm Fresh Milk",
                status: "delivered",
                created_at: timestamp
            };
            subs.push(jsonSub);
        }

        const targetSub = jsonSub || sub;
        targetSub.delivery_proof = proofUrl;
        targetSub.delivery_proof_url = proofUrl;
        targetSub.delivery_proof_urls = targetSub.delivery_proof_urls || [];
        if (!targetSub.delivery_proof_urls.includes(proofUrl)) targetSub.delivery_proof_urls.push(proofUrl);
        if (remarks) targetSub.delivery_remarks = remarks;
        if (latitude) targetSub.delivery_latitude = Number(latitude);
        if (longitude) targetSub.delivery_longitude = Number(longitude);
        targetSub.proof_uploaded_at = timestamp;

        if (markDelivered) {
            targetSub.status = "delivered";
            targetSub.delivered_at = timestamp;
            targetSub.proof_status = "delivered_verified";
        } else {
            targetSub.proof_status = "uploaded";
        }

        if (jsonSub) saveJson(SUBS_DELIVERIES_FILE, subs);

        const actualPartnerId = partnerId || targetSub.partner_id;
        try {
            await pool.query(
                `UPDATE subscriptions 
                 SET status = 'delivered', 
                     delivered_at = $1, 
                     delivery_proof = $2, 
                     delivery_proof_url = $2, 
                     delivery_remarks = $3, 
                     delivery_latitude = $4, 
                     delivery_longitude = $5, 
                     proof_status = 'delivered_verified',
                     updated_at = NOW() 
                 WHERE id::text = $6`,
                [timestamp, proofUrl, remarks || null, latitude ? Number(latitude) : null, longitude ? Number(longitude) : null, cleanId]
            );
            await pool.query(
                `INSERT INTO delivery_proofs (subscription_id, partner_id, proof_url, remarks, latitude, longitude, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'verified')`,
                [cleanId, actualPartnerId || null, proofUrl, remarks || null, latitude ? Number(latitude) : null, longitude ? Number(longitude) : null]
            ).catch(() => {});
        } catch (_) {}

        if (markDelivered && actualPartnerId) {
            try {
                await recordSubscriptionDeliveryEarning(actualPartnerId, cleanId, 25);
                const partner = await getPartnerById(actualPartnerId);
                if (partner) {
                    partner.total_deliveries_count = (partner.total_deliveries_count || 0) + 1;
                    partner.today_deliveries_count = (partner.today_deliveries_count || 0) + 1;
                    await savePartner(partner);
                }
            } catch (_) {}
        }

        emitToAdmin("delivery:proof:uploaded", {
            type: "subscription",
            id: cleanId,
            partner_id: actualPartnerId,
            proof_url: proofUrl,
            status: targetSub.status,
            timestamp
        });

        if (markDelivered) {
            emitToAdmin("order:delivery:completed", {
                type: "subscription",
                id: cleanId,
                partner_id: actualPartnerId,
                status: "delivered",
                delivered_at: timestamp,
                proof_url: proofUrl
            });
            emitToAdmin("delivery:status:update", { deliveryId: cleanId, status: "delivered", partnerId: actualPartnerId });
            if (actualPartnerId) {
                emitToPartner(actualPartnerId, "delivery:completed", { id: cleanId, status: "delivered" });
            }
        }

        return {
            success: true,
            message: "Subscription delivery successfully confirmed with photo proof.",
            proof_url: proofUrl,
            delivery_proof_url: proofUrl,
            status: targetSub.status || "delivered",
            delivery: targetSub
        };
    } else {
        // 1. Try PostgreSQL
        let order = null;
        try {
            const dbRes = await pool.query("SELECT * FROM orders WHERE id::text = $1 OR order_number = $1", [cleanId]);
            if (dbRes.rows && dbRes.rows.length > 0) order = dbRes.rows[0];
        } catch (_) {}

        // 2. Try JSON
        const orders = loadJson(ORDERS_FILE, []);
        let jsonOrder = orders.find(o => o.id?.toString() === cleanId || o.order_number === cleanId);

        if (!order && !jsonOrder) {
            jsonOrder = {
                id: cleanId,
                order_number: cleanId,
                customer_name: "Customer",
                order_status: "delivered",
                created_at: timestamp
            };
            orders.push(jsonOrder);
        }

        const targetOrder = jsonOrder || order;
        targetOrder.delivery_proof = proofUrl;
        targetOrder.delivery_proof_url = proofUrl;
        targetOrder.delivery_proof_urls = targetOrder.delivery_proof_urls || [];
        if (!targetOrder.delivery_proof_urls.includes(proofUrl)) targetOrder.delivery_proof_urls.push(proofUrl);
        if (remarks) targetOrder.delivery_remarks = remarks;
        if (latitude) targetOrder.delivery_latitude = Number(latitude);
        if (longitude) targetOrder.delivery_longitude = Number(longitude);
        targetOrder.proof_uploaded_at = timestamp;

        if (markDelivered) {
            targetOrder.order_status = "delivered";
            targetOrder.status = "delivered";
            targetOrder.delivered_at = timestamp;
            targetOrder.proof_status = "delivered_verified";
            targetOrder.timeline = targetOrder.timeline || [];
            targetOrder.timeline.push({
                status: "delivered",
                title: "Order Delivered",
                description: `Delivered by partner with proof photo. ${remarks || ''}`.trim(),
                timestamp
            });
        } else {
            targetOrder.proof_status = "uploaded";
        }

        if (jsonOrder) saveJson(ORDERS_FILE, orders);

        // Update DB
        const actualPartnerId = partnerId || targetOrder.partner_id;
        try {
            await pool.query(
                `UPDATE orders 
                 SET order_status = 'delivered', 
                     delivered_at = $1, 
                     delivery_proof = $2, 
                     delivery_proof_url = $2, 
                     delivery_remarks = $3, 
                     delivery_latitude = $4, 
                     delivery_longitude = $5, 
                     proof_status = 'delivered_verified',
                     updated_at = NOW() 
                 WHERE id::text = $6 OR order_number = $6`,
                [timestamp, proofUrl, remarks || null, latitude ? Number(latitude) : null, longitude ? Number(longitude) : null, cleanId]
            );
            await pool.query(
                `INSERT INTO delivery_proofs (order_id, partner_id, proof_url, remarks, latitude, longitude, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'verified')`,
                [cleanId, actualPartnerId || null, proofUrl, remarks || null, latitude ? Number(latitude) : null, longitude ? Number(longitude) : null]
            ).catch(() => {});
        } catch (_) {}

        if (markDelivered && actualPartnerId) {
            try {
                await recordProductDeliveryEarning(actualPartnerId, cleanId, 40);
                const partner = await getPartnerById(actualPartnerId);
                if (partner) {
                    partner.total_deliveries_count = (partner.total_deliveries_count || 0) + 1;
                    partner.today_deliveries_count = (partner.today_deliveries_count || 0) + 1;
                    await savePartner(partner);
                }
                await pool.query(
                    `UPDATE delivery_partners SET total_deliveries_count = COALESCE(total_deliveries_count, 0) + 1, today_deliveries_count = COALESCE(today_deliveries_count, 0) + 1, updated_at = NOW() WHERE partner_id = $1`,
                    [actualPartnerId]
                ).catch(() => {});
            } catch (_) {}
        }

        emitToAdmin("delivery:proof:uploaded", {
            type: "order",
            id: cleanId,
            partner_id: actualPartnerId,
            proof_url: proofUrl,
            status: targetOrder.order_status,
            timestamp
        });

        if (markDelivered) {
            emitToAdmin("order:delivery:completed", {
                type: "order",
                id: cleanId,
                partner_id: actualPartnerId,
                status: "delivered",
                delivered_at: timestamp,
                proof_url: proofUrl
            });
            emitToAdmin("order:updated", { order_id: cleanId, status: "delivered", partner_id: actualPartnerId });
            emitToAdmin("delivery:status:update", { order_id: cleanId, status: "delivered", partner_id: actualPartnerId });
            if (actualPartnerId) {
                emitToPartner(actualPartnerId, "delivery:completed", { id: cleanId, status: "delivered" });
                emitToPartner(actualPartnerId, "order:status_updated", { order_id: cleanId, status: "delivered" });
            }
        }

        if (targetOrder.user_id) {
            emitToCustomer(targetOrder.user_id, "customer:delivery:updated", {
                order_id: cleanId,
                status: targetOrder.order_status,
                has_proof: true,
                proof_url: proofUrl,
                delivered_at: targetOrder.delivered_at
            });
            emitToCustomer(targetOrder.user_id, "order:status_updated", {
                order_id: cleanId,
                status: targetOrder.order_status
            });
        }

        return {
            success: true,
            message: "Delivery confirmed and photo proof saved successfully.",
            proof_url: proofUrl,
            delivery_proof_url: proofUrl,
            status: targetOrder.order_status || "delivered",
            order_status: targetOrder.order_status || "delivered",
            order: targetOrder
        };
    }
}

/**
 * Complete order delivery with mandatory photo proof verification
 */
async function completeDelivery({ orderId, subId, partnerId, remarks, latitude, longitude, imageBase64, file, image, photo, proof }) {
    const isSub = Boolean(subId) || (orderId && orderId.toString().startsWith("SUB-"));
    const cleanId = isSub ? (subId || orderId.toString().replace("SUB-", "")).toString() : orderId.toString();

    const proofSource = file || imageBase64 || image || photo || proof;
    let uploadedProofUrl = "";
    if (proofSource) {
        uploadedProofUrl = saveProofImageToDisk(proofSource, cleanId);
    }

    const timestamp = new Date().toISOString();

    if (isSub) {
        const subs = loadJson(SUBS_DELIVERIES_FILE, []);
        const sub = subs.find(s => s.id?.toString() === cleanId || s.subscription_id?.toString() === cleanId);
        if (!sub) throw new Error(`Subscription delivery #${cleanId} not found.`);

        // Mandatory check: Must have proof uploaded or provided
        const finalProof = uploadedProofUrl || sub.delivery_proof;
        if (!finalProof) {
            throw new Error("Mandatory delivery photograph is required. Please capture and upload a delivery photo before completing.");
        }

        sub.status = "delivered";
        sub.delivered_at = timestamp;
        sub.delivery_proof = finalProof;
        sub.delivery_proof_urls = sub.delivery_proof_urls || [];
        if (uploadedProofUrl && !sub.delivery_proof_urls.includes(uploadedProofUrl)) {
            sub.delivery_proof_urls.push(uploadedProofUrl);
        }
        if (remarks) sub.delivery_remarks = remarks;
        if (latitude) sub.delivery_latitude = Number(latitude);
        if (longitude) sub.delivery_longitude = Number(longitude);
        sub.proof_status = "delivered_verified";

        saveJson(SUBS_DELIVERIES_FILE, subs);

        // Record earnings
        const actualPartnerId = partnerId || sub.partner_id;
        if (actualPartnerId) {
            try {
                await recordSubscriptionDeliveryEarning(actualPartnerId, cleanId, 25);
                const partner = await getPartnerById(actualPartnerId);
                if (partner) {
                    partner.total_deliveries_count = (partner.total_deliveries_count || 0) + 1;
                    partner.today_deliveries_count = (partner.today_deliveries_count || 0) + 1;
                    await savePartner(partner);
                }
            } catch (_) {}
        }

        // Real-time broadcasts
        emitToAdmin("order:delivery:completed", {
            type: "subscription",
            id: cleanId,
            partner_id: actualPartnerId,
            status: "delivered",
            delivered_at: timestamp,
            proof_url: finalProof
        });

        if (actualPartnerId) {
            emitToPartner(actualPartnerId, "delivery:completed", { id: cleanId, status: "delivered" });
        }

        return { success: true, message: "Subscription delivery successfully completed with photo proof.", delivery: sub };
    } else {
        const orders = loadJson(ORDERS_FILE, []);
        const order = orders.find(o => o.id?.toString() === cleanId || o.order_number === cleanId);
        if (!order) throw new Error(`Product order #${cleanId} not found.`);

        const finalProof = uploadedProofUrl || order.delivery_proof;
        if (!finalProof) {
            throw new Error("Mandatory delivery photograph is required. Please capture and upload a delivery photo before completing.");
        }

        order.order_status = "delivered";
        order.status = "delivered";
        order.delivered_at = timestamp;
        order.delivery_proof = finalProof;
        order.delivery_proof_urls = order.delivery_proof_urls || [];
        if (uploadedProofUrl && !order.delivery_proof_urls.includes(uploadedProofUrl)) {
            order.delivery_proof_urls.push(uploadedProofUrl);
        }
        if (remarks) order.delivery_remarks = remarks;
        if (latitude) order.delivery_latitude = Number(latitude);
        if (longitude) order.delivery_longitude = Number(longitude);
        order.proof_status = "delivered_verified";

        // Append to order status timeline
        order.timeline = order.timeline || [];
        order.timeline.push({
            status: "delivered",
            title: "Order Delivered",
            description: `Delivered by partner with proof photo. ${remarks || ''}`.trim(),
            timestamp
        });

        saveJson(ORDERS_FILE, orders);

        // Update DB
        try {
            await pool.query(
                `UPDATE orders SET order_status = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id::text = $1 OR order_number = $1`,
                [cleanId]
            );
        } catch (_) {}

        // Record partner earnings (₹40 commission)
        const actualPartnerId = partnerId || order.partner_id;
        if (actualPartnerId) {
            try {
                await recordProductDeliveryEarning(actualPartnerId, cleanId, 40);
                const partner = await getPartnerById(actualPartnerId);
                if (partner) {
                    partner.total_deliveries_count = (partner.total_deliveries_count || 0) + 1;
                    partner.today_deliveries_count = (partner.today_deliveries_count || 0) + 1;
                    await savePartner(partner);
                }
            } catch (_) {}
        }

        // Real-time notifications & sockets
        emitToAdmin("order:delivery:completed", {
            type: "order",
            id: cleanId,
            partner_id: actualPartnerId,
            status: "delivered",
            delivered_at: timestamp,
            proof_url: finalProof
        });

        if (actualPartnerId) {
            emitToPartner(actualPartnerId, "order:status_updated", { order_id: cleanId, status: "delivered" });
            emitToPartner(actualPartnerId, "delivery:completed", { order_id: cleanId, status: "delivered" });
        }

        if (order.user_id) {
            emitToCustomer(order.user_id, "customer:order:delivered", {
                order_id: cleanId,
                status: "delivered",
                delivered_at: timestamp,
                proof_url: finalProof
            });
        }

        return { success: true, message: "Order successfully delivered with photographic verification.", order };
    }
}

/**
 * Get comprehensive delivery details including proof images, partner, customer & timeline
 */
async function getDeliveryDetails(orderId) {
    if (!orderId) return null;
    const isSub = orderId.toString().startsWith("SUB-");
    const cleanId = isSub ? orderId.toString().replace("SUB-", "") : orderId.toString();

    if (isSub) {
        let sub = null;
        try {
            const dbRes = await pool.query("SELECT * FROM subscriptions WHERE id::text = $1", [cleanId]);
            if (dbRes.rows && dbRes.rows.length > 0) sub = dbRes.rows[0];
        } catch (_) {}

        if (!sub) {
            const subs = loadJson(SUBS_DELIVERIES_FILE, []);
            sub = subs.find(s => s.id?.toString() === cleanId || s.subscription_id?.toString() === cleanId);
        }
        if (!sub) return null;

        let partner = null;
        if (sub.partner_id) {
            partner = await getPartnerById(sub.partner_id);
        }

        const proofUrl = sub.delivery_proof_url || sub.delivery_proof || "";
        return {
            id: `SUB-${sub.id}`,
            order_id: `SUB-${sub.id}`,
            type: "subscription",
            status: sub.status || "pending",
            customer_name: sub.customer_name || "Subscriber",
            customer_phone: sub.customer_phone || "",
            delivery_address: sub.address || "",
            landmark: sub.landmark || "",
            items: [{ name: sub.product_name || "Farm Fresh Milk", quantity: sub.quantity || 1 }],
            total: sub.total_price || sub.price || 0,
            payment_status: "Verified (Prepaid Subscription)",
            payment_method: "Subscription Prepaid",
            delivery_proof: proofUrl,
            delivery_proof_url: proofUrl,
            proof_url: proofUrl,
            delivery_proof_urls: sub.delivery_proof_urls || (proofUrl ? [proofUrl] : []),
            delivered_at: sub.delivered_at || null,
            delivery_remarks: sub.delivery_remarks || sub.remarks || "",
            delivery_latitude: sub.delivery_latitude || null,
            delivery_longitude: sub.delivery_longitude || null,
            proof_status: sub.proof_status || (proofUrl ? "delivered_verified" : "pending"),
            partner: partner ? {
                partner_id: partner.partner_id,
                name: partner.name,
                phone: partner.phone,
                vehicle_type: partner.vehicle_type,
                vehicle_number: partner.vehicle_number,
                current_latitude: partner.current_latitude,
                current_longitude: partner.current_longitude
            } : null,
            created_at: sub.created_at || sub.date
        };
    } else {
        let order = null;
        try {
            const dbRes = await pool.query("SELECT * FROM orders WHERE id::text = $1 OR order_number = $1", [cleanId]);
            if (dbRes.rows && dbRes.rows.length > 0) order = dbRes.rows[0];
        } catch (_) {}

        if (!order) {
            const orders = loadJson(ORDERS_FILE, []);
            order = orders.find(o => o.id?.toString() === cleanId || o.order_number === cleanId);
        }
        if (!order) return null;

        let partner = null;
        if (order.partner_id) {
            partner = await getPartnerById(order.partner_id);
        }

        const proofUrl = order.delivery_proof_url || order.delivery_proof || "";
        return {
            id: order.id || order.order_number,
            order_id: order.order_number || `#${order.id}`,
            type: "order",
            status: order.order_status || order.status || "pending",
            customer_name: order.customer_name || order.user_name || "Customer",
            customer_phone: order.customer_phone || order.phone || "",
            delivery_address: order.shipping_address || order.address || "",
            landmark: order.landmark || "",
            delivery_instructions: order.delivery_instructions || "",
            items: order.items || [],
            total: order.total_amount || order.total || 0,
            payment_status: order.payment_status || "Pending",
            payment_method: order.payment_method || "UPI",
            delivery_proof: proofUrl,
            delivery_proof_url: proofUrl,
            proof_url: proofUrl,
            delivery_proof_urls: order.delivery_proof_urls || (proofUrl ? [proofUrl] : []),
            delivered_at: order.delivered_at || null,
            delivery_remarks: order.delivery_remarks || order.remarks || "",
            delivery_latitude: order.delivery_latitude || null,
            delivery_longitude: order.delivery_longitude || null,
            proof_status: order.proof_status || (proofUrl ? "delivered_verified" : "pending"),
            verification_history: order.verification_history || [],
            partner: partner ? {
                partner_id: partner.partner_id,
                name: partner.name,
                phone: partner.phone,
                vehicle_type: partner.vehicle_type,
                vehicle_number: partner.vehicle_number,
                current_latitude: partner.current_latitude,
                current_longitude: partner.current_longitude
            } : null,
            timeline: order.timeline || [
                { status: "placed", title: "Order Placed", timestamp: order.created_at },
                ...(order.delivered_at ? [{ status: "delivered", title: "Delivered", timestamp: order.delivered_at }] : [])
            ],
            created_at: order.created_at
        };
    }
}

/**
 * Admin action: Verify delivery proof
 */
async function verifyDeliveryProof(orderId, adminName = "Operations Admin", notes = "") {
    const isSub = orderId.toString().startsWith("SUB-");
    const cleanId = isSub ? orderId.toString().replace("SUB-", "") : orderId.toString();
    const timestamp = new Date().toISOString();

    if (isSub) {
        const subs = loadJson(SUBS_DELIVERIES_FILE, []);
        const sub = subs.find(s => s.id?.toString() === cleanId || s.subscription_id?.toString() === cleanId);
        if (!sub) throw new Error("Subscription not found.");
        sub.proof_status = "verified";
        sub.verification_history = sub.verification_history || [];
        sub.verification_history.push({ action: "VERIFIED", admin: adminName, notes, timestamp });
        saveJson(SUBS_DELIVERIES_FILE, subs);
        emitToAdmin("delivery:verified", { id: cleanId, type: "subscription", admin: adminName });
        return { success: true, message: "Delivery proof verified by admin.", sub };
    } else {
        const orders = loadJson(ORDERS_FILE, []);
        const order = orders.find(o => o.id?.toString() === cleanId || o.order_number === cleanId);
        if (!order) throw new Error("Order not found.");
        order.proof_status = "verified";
        order.verification_history = order.verification_history || [];
        order.verification_history.push({ action: "VERIFIED", admin: adminName, notes, timestamp });
        saveJson(ORDERS_FILE, orders);
        emitToAdmin("delivery:verified", { id: cleanId, type: "order", admin: adminName });
        return { success: true, message: "Delivery proof verified by admin.", order };
    }
}

/**
 * Admin action: Flag suspicious delivery proof
 */
async function flagDeliveryProof(orderId, adminName = "Operations Admin", reason = "") {
    const isSub = orderId.toString().startsWith("SUB-");
    const cleanId = isSub ? orderId.toString().replace("SUB-", "") : orderId.toString();
    const timestamp = new Date().toISOString();

    if (isSub) {
        const subs = loadJson(SUBS_DELIVERIES_FILE, []);
        const sub = subs.find(s => s.id?.toString() === cleanId || s.subscription_id?.toString() === cleanId);
        if (!sub) throw new Error("Subscription not found.");
        sub.proof_status = "flagged";
        sub.flagged_reason = reason;
        sub.verification_history = sub.verification_history || [];
        sub.verification_history.push({ action: "FLAGGED", admin: adminName, reason, timestamp });
        saveJson(SUBS_DELIVERIES_FILE, subs);
        emitToAdmin("delivery:proof:flagged", { id: cleanId, type: "subscription", admin: adminName, reason });
        return { success: true, message: "Delivery proof flagged for audit.", sub };
    } else {
        const orders = loadJson(ORDERS_FILE, []);
        const order = orders.find(o => o.id?.toString() === cleanId || o.order_number === cleanId);
        if (!order) throw new Error("Order not found.");
        order.proof_status = "flagged";
        order.flagged_reason = reason;
        order.verification_history = order.verification_history || [];
        order.verification_history.push({ action: "FLAGGED", admin: adminName, reason, timestamp });
        saveJson(ORDERS_FILE, orders);
        emitToAdmin("delivery:proof:flagged", { id: cleanId, type: "order", admin: adminName, reason });
        return { success: true, message: "Delivery proof flagged for audit.", order };
    }
}

/**
 * Customer reports a delivery issue
 */
async function reportDeliveryIssue({ orderId, customerId, issueCategory, description, imageBase64 }) {
    const issues = loadJson(ISSUES_FILE, []);
    const issueId = `ISSUE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const proofUrl = imageBase64 ? saveProofImageToDisk(imageBase64, issueId) : null;
    const timestamp = new Date().toISOString();

    const newIssue = {
        issue_id: issueId,
        order_id: orderId,
        customer_id: customerId,
        issue_category: issueCategory || "Product not received",
        description: description || "",
        image_url: proofUrl,
        status: "OPEN",
        created_at: timestamp
    };

    issues.push(newIssue);
    saveJson(ISSUES_FILE, issues);

    // Flag order as having a complaint
    try {
        const orders = loadJson(ORDERS_FILE, []);
        const order = orders.find(o => o.id?.toString() === orderId.toString() || o.order_number === orderId);
        if (order) {
            order.has_complaint = true;
            order.last_complaint_id = issueId;
            saveJson(ORDERS_FILE, orders);
        }
    } catch (_) {}

    emitToAdmin("order:complaint:received", newIssue);
    return { success: true, message: "Your delivery issue has been reported to Thulirva Support. Our team will contact you shortly.", issue: newIssue };
}

/**
 * Get delivered orders for a partner (Read-only historical view)
 */
async function getDeliveredOrdersForPartner(partnerId, { page = 1, limit = 50, date = null } = {}) {
    const orders = loadJson(ORDERS_FILE, []);
    let delivered = orders.filter(o => o.partner_id === partnerId && o.order_status === "delivered");

    if (date) {
        delivered = delivered.filter(o => (o.delivered_at || o.created_at || "").startsWith(date));
    }

    // Sort newest delivered first
    delivered.sort((a, b) => new Date(b.delivered_at || b.created_at) - new Date(a.delivered_at || a.created_at));

    const total = delivered.length;
    const startIndex = (page - 1) * limit;
    const paginated = delivered.slice(startIndex, startIndex + limit);

    return {
        total,
        page,
        limit,
        orders: paginated
    };
}

module.exports = {
    saveDeliveryProof,
    completeDelivery,
    getDeliveryDetails,
    verifyDeliveryProof,
    flagDeliveryProof,
    reportDeliveryIssue,
    getDeliveredOrdersForPartner
};

