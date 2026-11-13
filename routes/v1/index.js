const express = require("express");
const router = express.Router();

const healthRoutes = require("./health");
const authRoutes = require("./auth");
const customerRoutes = require("./customers");
const partnerRoutes = require("./partners");
const adminRoutes = require("./admin");
const kycRoutes = require("./kyc");
const gpsRoutes = require("./gps");
const orderRoutes = require("./orders");
const assignmentRoutes = require("./assignments");
const subscriptionRoutes = require("./subscriptions");
const attendanceRoutes = require("./attendance");
const notificationRoutes = require("./notifications");
const earningRoutes = require("./earnings");
const bankAccountRoutes = require("./bankAccounts");
const withdrawalRoutes = require("./withdrawals");
const settlementRoutes = require("./settlements");
const hubRoutes = require("./hubs");
const serviceabilityRoutes = require("./serviceability");
const reportRoutes = require("./reports");
const deliveryProofRoutes = require("./deliveryProof");

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/customers", customerRoutes);
router.use("/partners", partnerRoutes);
router.use("/admin", adminRoutes);
router.use("/kyc", kycRoutes);
router.use("/gps", gpsRoutes);
router.use("/orders", orderRoutes);
router.use("/assignments", assignmentRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/notifications", notificationRoutes);
router.use("/earnings", earningRoutes);
router.use("/bank-accounts", bankAccountRoutes);
router.use("/withdrawals", withdrawalRoutes);
router.use("/settlements", settlementRoutes);
router.use("/hubs", hubRoutes);
router.use("/serviceability", serviceabilityRoutes);
router.use("/reports", reportRoutes);
router.use("/delivery-proof", deliveryProofRoutes);

module.exports = router;

