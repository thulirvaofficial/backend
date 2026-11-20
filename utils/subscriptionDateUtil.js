/**
 * THULIRVA Centralized Subscription Date & Progress Calculation Engine
 * Timezone: Asia/Kolkata
 * Single Source of Truth for Calendar Arithmetic & Delivery Schedules
 */

/**
 * Returns today's calendar date string in Asia/Kolkata timezone (YYYY-MM-DD)
 */
function getKolkataToday(date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(date);
        return parts; // e.g. "2026-11-20"
    } catch (_) {
        const d = date instanceof Date ? date : new Date(date);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }
}

/**
 * Normalizes input date to clean "YYYY-MM-DD" string
 * Supports ISO strings, YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY
 */
function normalizeDateString(dateInput) {
    if (!dateInput) return getKolkataToday();
    const str = String(dateInput).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    // DD-MM-YYYY or DD/MM/YYYY
    const dmyMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (dmyMatch) {
        const dd = dmyMatch[1].padStart(2, "0");
        const mm = dmyMatch[2].padStart(2, "0");
        const yyyy = dmyMatch[3];
        return `${yyyy}-${mm}-${dd}`;
    }

    // ISO string or timestamp
    try {
        const dt = new Date(str);
        if (!isNaN(dt.getTime())) {
            return getKolkataToday(dt);
        }
    } catch (_) {}

    return getKolkataToday();
}

/**
 * Pure integer UTC calendar arithmetic to add days without timezone shifts
 */
function addCalendarDays(dateStr, daysToAdd) {
    const norm = normalizeDateString(dateStr);
    const [y, m, d] = norm.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + Number(daysToAdd));
    const resY = dt.getUTCFullYear();
    const resM = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const resD = String(dt.getUTCDate()).padStart(2, "0");
    return `${resY}-${resM}-${resD}`;
}

/**
 * Difference in calendar days (dateStr1 - dateStr2)
 */
function getCalendarDayDiff(dateStr1, dateStr2) {
    const d1 = normalizeDateString(dateStr1);
    const d2 = normalizeDateString(dateStr2);
    const [y1, m1, day1] = d1.split("-").map(Number);
    const [y2, m2, day2] = d2.split("-").map(Number);
    const utc1 = Date.UTC(y1, m1 - 1, day1);
    const utc2 = Date.UTC(y2, m2 - 1, day2);
    return Math.round((utc1 - utc2) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate accurate subscription start, end, and expiry dates.
 * RULE:
 * Start date = Day 1 (e.g. 2026-11-20)
 * Duration = N days (e.g. 30 days)
 * Final Service Day = Day N = startDate + (duration - 1) days (e.g. 2026-12-19)
 * Expiry occurs after completion of Final Service Day.
 */
function calculateSubscriptionDates({ startDate, durationDays = 30 }) {
    const validStart = normalizeDateString(startDate);
    const duration = Math.max(1, parseInt(durationDays, 10) || 30);
    const endDate = addCalendarDays(validStart, duration - 1);

    return {
        startDate: validStart,
        endDate: endDate,
        expiryDate: endDate, // Inclusive final service day convention
        durationDays: duration
    };
}

/**
 * Generate full delivery schedule dates from startDate to endDate
 */
function generateDeliverySchedule(startDate, endDate, frequency = "Daily") {
    const start = normalizeDateString(startDate);
    const end = normalizeDateString(endDate);
    const totalSpan = getCalendarDayDiff(end, start) + 1;
    if (totalSpan <= 0) return [start];

    const freqLower = String(frequency || "daily").toLowerCase().trim();
    const scheduleDates = [];

    for (let i = 0; i < totalSpan; i++) {
        const currentDate = addCalendarDays(start, i);
        const [y, m, d] = currentDate.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        const dayOfWeek = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

        if (freqLower.includes("alternate")) {
            if (i % 2 === 0) scheduleDates.push(currentDate);
        } else if (freqLower.includes("twice")) {
            // Wednesday (3) & Saturday (6) standard or start day + 3
            const startDay = new Date(start).getDay();
            const secondDay = (startDay + 3) % 7;
            if (dayOfWeek === startDay || dayOfWeek === secondDay) {
                scheduleDates.push(currentDate);
            }
        } else if (freqLower.includes("weekly") && !freqLower.includes("twice")) {
            const startDay = new Date(start).getDay();
            if (dayOfWeek === startDay) scheduleDates.push(currentDate);
        } else if (freqLower.includes("monthly")) {
            if (i === 0) scheduleDates.push(currentDate);
        } else {
            // Daily / default
            scheduleDates.push(currentDate);
        }
    }

    if (scheduleDates.length === 0) {
        scheduleDates.push(start);
    }

    return scheduleDates;
}

/**
 * Centralized Subscription Metrics Engine
 * Calculates:
 * - Total Duration
 * - Elapsed Calendar Days
 * - Remaining Calendar Days
 * - Completed Deliveries
 * - Remaining Deliveries
 * - Total Scheduled Deliveries
 */
function calculateSubscriptionMetrics(sub, asOfDateStr = null, deliveryRecords = []) {
    const todayStr = asOfDateStr ? normalizeDateString(asOfDateStr) : getKolkataToday();
    const rawStart = sub.start_date || sub.startDate || todayStr;
    const duration = Math.max(1, parseInt(sub.duration_days || sub.durationDays || sub.total_days || 30, 10));
    
    // Explicit end date calculation
    const dates = calculateSubscriptionDates({ startDate: rawStart, durationDays: duration });
    const startDate = dates.startDate;
    const endDate = dates.endDate;
    const expiryDate = dates.expiryDate;

    // Day difference from start date
    const dayDiff = getCalendarDayDiff(todayStr, startDate);
    let elapsedDays = 0;
    if (dayDiff < 0) {
        // Before start date (e.g. 19 Nov for 20 Nov start)
        elapsedDays = 0;
    } else {
        // On or after start date (Day 1 on start date)
        elapsedDays = Math.min(duration, dayDiff + 1);
    }
    const remainingDays = Math.max(0, duration - elapsedDays);

    // Deliveries schedule
    const frequency = sub.frequency || "Daily";
    const scheduledDates = generateDeliverySchedule(startDate, endDate, frequency);
    const totalDeliveries = scheduledDates.length;

    // Completed deliveries from real delivery records
    const subIdStr = String(sub.id || sub.subscription_id || "");
    const matchingRecords = (deliveryRecords || []).filter(d => 
        String(d.subscription_id || d.subscriptionId) === subIdStr
    );
    const completedDeliveries = matchingRecords.filter(d => {
        const st = String(d.status || "").toLowerCase();
        return st === "delivered" || st === "completed";
    }).length;

    const remainingDeliveries = Math.max(0, totalDeliveries - completedDeliveries);

    // Status helpers
    const currentStatus = String(sub.status || "Active");
    const paymentStatus = String(sub.payment_status || sub.paymentStatus || "Pending");
    const isPaused = currentStatus.toLowerCase() === "paused";
    const isCancelled = currentStatus.toLowerCase() === "cancelled" || currentStatus.toLowerCase() === "rejected";
    const isExpired = elapsedDays >= duration && remainingDays === 0 && !isCancelled;
    const isPendingApproval = currentStatus.toLowerCase().includes("pending") || paymentStatus.toLowerCase().includes("pending");

    let effectiveStatus = currentStatus;
    if (isExpired && !isCancelled && !isPaused) {
        effectiveStatus = "Expired";
    }

    return {
        startDate,
        endDate,
        expiryDate,
        durationDays: duration,
        totalDuration: duration,
        totalDays: duration,
        elapsedDays,
        remainingDays,
        progressDaysText: `${elapsedDays}/${duration} days`,
        totalDeliveries,
        completedDeliveries,
        remainingDeliveries,
        progressDeliveriesText: `${completedDeliveries}/${totalDeliveries} deliveries`,
        scheduledDates,
        isExpired,
        isPaused,
        isCancelled,
        isPendingApproval,
        effectiveStatus
    };
}

/**
 * Enriches a raw subscription object with all standardized metric fields
 * (Both snake_case and camelCase for seamless multi-platform consumption)
 */
function enrichSubscriptionWithMetrics(sub, asOfDateStr = null, deliveryRecords = []) {
    if (!sub) return sub;
    const metrics = calculateSubscriptionMetrics(sub, asOfDateStr, deliveryRecords);

    return {
        ...sub,
        // Canonical dates
        start_date: metrics.startDate,
        startDate: metrics.startDate,
        end_date: metrics.endDate,
        endDate: metrics.endDate,
        expiry_date: metrics.expiryDate,
        expiryDate: metrics.expiryDate,

        // Duration & Calendar days
        duration_days: metrics.durationDays,
        durationDays: metrics.durationDays,
        total_duration: metrics.totalDuration,
        totalDuration: metrics.totalDuration,
        total_days: metrics.totalDays,
        totalDays: metrics.totalDays,
        elapsed_days: metrics.elapsedDays,
        elapsedDays: metrics.elapsedDays,
        remaining_days: metrics.remainingDays,
        remainingDays: metrics.remainingDays,
        progress_days_text: metrics.progressDaysText,
        progressDaysText: metrics.progressDaysText,

        // Scheduled deliveries
        total_deliveries: metrics.totalDeliveries,
        totalDeliveries: metrics.totalDeliveries,
        completed_deliveries: metrics.completedDeliveries,
        completedDeliveries: metrics.completedDeliveries,
        remaining_deliveries: metrics.remainingDeliveries,
        remainingDeliveries: metrics.remainingDeliveries,
        progress_deliveries_text: metrics.progressDeliveriesText,
        progressDeliveriesText: metrics.progressDeliveriesText,

        // Status
        is_expired: metrics.isExpired,
        isExpired: metrics.isExpired,
        is_paused: metrics.isPaused,
        isPaused: metrics.isPaused,
        is_pending_action: metrics.isPendingApproval,
        status: metrics.effectiveStatus
    };
}

module.exports = {
    getKolkataToday,
    normalizeDateString,
    addCalendarDays,
    getCalendarDayDiff,
    calculateSubscriptionDates,
    generateDeliverySchedule,
    calculateSubscriptionMetrics,
    enrichSubscriptionWithMetrics
};

