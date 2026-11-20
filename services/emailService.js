/**
 * THULIRVA Agro & Dairy — Centralized Enterprise Email Service
 * 
 * Single source of truth for all transactional email delivery across the Thulirva ecosystem:
 * - Customer Website & Web Authentication
 * - Customer Flutter App
 * - Admin Console & Management Portal
 * - Delivery Partner Care & Mobile App
 * - Customer Support & Helpdesk Ticket System
 * 
 * Connects directly to the Thulirva VPS Mail Server (mail.thulirva.com / 15.235.251.225)
 * Features dual-port fallback (port 25 / port 587 STARTTLS), connection verification,
 * high-fidelity responsive HTML templates, and zero exposure of credentials to clients.
 */

const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

class EmailService {
    constructor() {
        this.primaryTransporter = null;
        this.fallbackTransporter = null;
        this.activeTransporter = null;
        this.isInitialized = false;

        this.config = {
            host: process.env.SMTP_HOST || "mail.thulirva.com",
            port: parseInt(process.env.SMTP_PORT || "25", 10),
            secure: process.env.SMTP_SECURE === "true",
            user: process.env.SMTP_USER || "noreply@thulirva.com",
            pass: process.env.SMTP_PASS || "65284b3a049058d55b9ea557e10a8f0d",
            fromName: process.env.SMTP_FROM_NAME || "Thulirva",
            fromEmail: process.env.SMTP_FROM_EMAIL || "noreply@thulirva.com",
            replyTo: process.env.SMTP_REPLY_TO || "support@thulirva.com",
            vpsIp: "15.235.251.225"
        };
    }

    /**
     * Builds a Nodemailer transporter for a given host and port
     */
    _buildTransporter(host, port, secure = false) {
        const transportOpts = {
            host,
            port,
            secure, // false for port 25 and 587 (STARTTLS)
            connectionTimeout: 5000,
            greetingTimeout: 5000,
            socketTimeout: 10000,
            tls: {
                rejectUnauthorized: false
            }
        };

        if (this.config.user && this.config.pass) {
            transportOpts.auth = {
                user: this.config.user,
                pass: this.config.pass
            };
        }

        return nodemailer.createTransport(transportOpts);
    }

    /**
     * Get or create active transporter with automatic dual-port fallback.
     * Tries configured port (default 25); if blocked (e.g. ISP or firewall),
     * automatically falls back to submission port 587 with STARTTLS.
     */
    async getTransporter() {
        if (this.activeTransporter) {
            return this.activeTransporter;
        }

        const primaryPort = this.config.port || 25;
        this.primaryTransporter = this._buildTransporter(this.config.host, primaryPort, this.config.secure);

        try {
            // Test primary connection
            await this.primaryTransporter.verify();
            console.log(`✓ [SMTP] Connected to primary mail server at ${this.config.host}:${primaryPort}`);
            this.activeTransporter = this.primaryTransporter;
            return this.activeTransporter;
        } catch (err) {
            console.warn(`[SMTP NOTICE] Primary port ${primaryPort} check failed (${err.message}). Attempting submission port 587...`);
            
            // Fallback to port 587
            this.fallbackTransporter = this._buildTransporter(this.config.host, 587, false);
            try {
                await this.fallbackTransporter.verify();
                console.log(`✓ [SMTP] Connected to mail server via submission port 587 (STARTTLS)`);
                this.activeTransporter = this.fallbackTransporter;
                return this.activeTransporter;
            } catch (fbErr) {
                // If domain DNS has issues, try direct VPS IP on 587
                console.warn(`[SMTP NOTICE] Hostname probe failed (${fbErr.message}). Testing direct VPS IP ${this.config.vpsIp}:587...`);
                const ipTransporter = this._buildTransporter(this.config.vpsIp, 587, false);
                try {
                    await ipTransporter.verify();
                    console.log(`✓ [SMTP] Connected to Thulirva VPS mail server directly at ${this.config.vpsIp}:587`);
                    this.activeTransporter = ipTransporter;
                    return this.activeTransporter;
                } catch (ipErr) {
                    console.error(`[SMTP FATAL] All SMTP connection attempts failed: ${ipErr.message}`);
                    // Return primary anyway so callers receive descriptive error
                    return this.primaryTransporter;
                }
            }
        }
    }

    /**
     * Diagnostic connection test
     */
    async verifyConnection() {
        try {
            const transporter = await this.getTransporter();
            await transporter.verify();
            return {
                success: true,
                host: this.config.host,
                sender: this.config.fromEmail,
                status: "operational"
            };
        } catch (err) {
            return {
                success: false,
                host: this.config.host,
                error: err.message
            };
        }
    }

    /**
     * Core Mail Dispatcher
     */
    async sendMail({ to, subject, html, text, from = null, replyTo = null, attachments = [] }) {
        if (!to) {
            throw new Error("Recipient email address ('to') is required.");
        }

        const transporter = await this.getTransporter();
        const fromAddress = from || `"${this.config.fromName}" <${this.config.fromEmail}>`;
        const replyToAddress = replyTo || this.config.replyTo;

        const mailOptions = {
            from: fromAddress,
            to: Array.isArray(to) ? to.join(", ") : to,
            replyTo: replyToAddress,
            subject: subject || "Notification from Thulirva",
            text: text || "",
            html: html || text,
            attachments
        };

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log(`✉ [SMTP DISPATCH] Sent to ${to} | Subject: "${subject}" | MsgId: ${info.messageId}`);
            return {
                success: true,
                messageId: info.messageId,
                response: info.response
            };
        } catch (err) {
            console.error(`❌ [SMTP ERROR] Failed to send email to ${to}:`, err.message);
            // If primary failed during active send, reset activeTransporter to retry on fallback
            this.activeTransporter = null;
            throw new Error(`Email delivery failed via Thulirva mail server: ${err.message}`);
        }
    }

    /* =========================================================================
       BRANDED EMAIL TEMPLATES
       ========================================================================= */

    /**
     * Wrap content in the official Thulirva brand email layout
     */
    _wrapTemplate({ title, preheader, bodyHtml }) {
        const logoUrl = "https://thulirva.com/thulirva-logo-transparent.png";
        const replyTo = this.config.replyTo;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title || "Thulirva"}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FAF8EF; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1E293B;">
    <!-- Preheader text for inbox preview -->
    <div style="display: none; max-height: 0px; overflow: hidden;">
        ${preheader || title}
    </div>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #FAF8EF; padding: 32px 14px;">
        <tr>
            <td align="center">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border-radius: 18px; border: 1px solid #EADBBE; box-shadow: 0 4px 24px rgba(20, 90, 36, 0.08); overflow: hidden;">
                    
                    <!-- Forest-Green Brand Header -->
                    <tr>
                        <td align="center" style="background-color: #123F2B; padding: 26px 20px;">
                            <img src="${logoUrl}" alt="Thulirva" style="max-height: 46px; width: auto; display: block; border: 0;" />
                            <div style="color: #FAF8EF; font-size: 11px; font-weight: 600; letter-spacing: 2.2px; text-transform: uppercase; margin-top: 8px;">
                                Rooted in Nature • Pure Goodness
                            </div>
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding: 34px 28px 24px;">
                            ${bodyHtml}
                        </td>
                    </tr>

                    <!-- Brand Footer -->
                    <tr>
                        <td style="background-color: #FAF7EE; padding: 22px 28px; border-top: 1px solid #EADBBE; text-align: center;">
                            <p style="color: #123F2B; font-size: 13.5px; font-weight: 700; margin: 0 0 4px;">
                                Thulirva Customer Care &amp; Support
                            </p>
                            <p style="color: #64748B; font-size: 12px; margin: 0 0 10px;">
                                Padur Delivery Hub • Chennai &amp; Kanchipuram
                            </p>
                            <p style="color: #94A3B8; font-size: 11.5px; margin: 0;">
                                Questions? Reach out to us at <a href="mailto:${replyTo}" style="color: #123F2B; font-weight: 600; text-decoration: underline;">${replyTo}</a>
                            </p>
                            <p style="color: #A0AEC0; font-size: 10.5px; margin: 10px 0 0;">
                                © 2026 Thulirva Agro &amp; Dairy Products. All rights reserved.
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
    }

    /**
     * Send Branded 6-Digit Verification / Reset OTP Email
     */
    async sendOtpEmail({ to, name = "Customer", otp, purpose = "Verification", expiryMinutes = 5 }) {
        const formattedOtp = otp.split("").join("  ");
        const subject = `${otp} is your Thulirva ${purpose} Code`;

        const bodyHtml = `
            <h2 style="color: #123F2B; font-size: 22px; font-weight: 800; margin: 0 0 14px; text-align: left;">
                ${purpose === "Password Reset" ? "Reset Your Password" : "Verify Your Account"}
            </h2>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">
                Hello ${name || ""},
            </p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                ${purpose === "Password Reset" 
                    ? "We received a request to reset the password for your Thulirva account. Enter the verification code below to proceed:" 
                    : "Use the following 6-digit verification code to complete your verification with Thulirva:"}
            </p>

            <!-- Prominent OTP Card -->
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #FAF8EF; border: 2px dashed #C2A649; border-radius: 14px; margin: 20px 0;">
                <tr>
                    <td align="center" style="padding: 20px 16px;">
                        <div style="font-size: 11px; font-weight: 700; color: #64748B; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px;">
                            ${purpose} Code
                        </div>
                        <div style="font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #123F2B; font-family: 'Courier New', Courier, monospace; margin: 6px 0; padding-left: 10px;">
                            ${formattedOtp}
                        </div>
                        <div style="font-size: 12px; font-weight: 600; color: #D32F2F; margin-top: 6px;">
                            ⏱ Expires in ${expiryMinutes} minutes
                        </div>
                    </td>
                </tr>
            </table>

            <p style="color: #64748B; font-size: 13.5px; line-height: 1.5; margin: 18px 0 0;">
                <strong>Security Notice:</strong> If you did not request this verification code, please ignore this email. Your Thulirva account remains secure and no changes have been made.
            </p>
        `;

        const text = `Hello ${name || ""},\n\nYour Thulirva ${purpose} code is: ${otp}\n\nThis code expires in ${expiryMinutes} minutes.\n\nIf you did not request this code, please safely disregard this email.\n\nThulirva Customer Care`;

        const html = this._wrapTemplate({
            title: `${purpose} Code - Thulirva`,
            preheader: `Your verification code is ${otp}. Valid for ${expiryMinutes} minutes.`,
            bodyHtml
        });

        return this.sendMail({ to, subject, html, text });
    }

    /**
     * Send Enterprise 2-Step Verification (2FA) Email for Admin Access
     */
    async sendAdmin2StepVerificationEmail({
        to = "admin@thulirva.com",
        adminName = "System Administrator",
        otp,
        ipAddress = "127.0.0.1",
        userAgent = "Admin Portal",
        expiryMinutes = 10
    }) {
        const formattedOtp = String(otp).split("").join("  ");
        const subject = `🔐 ${otp} is your Thulirva Admin 2-Step Verification Code`;

        const bodyHtml = `
            <div style="background-color: #FEF3C7; border-left: 4px solid #D97706; padding: 12px 16px; border-radius: 6px; margin-bottom: 18px;">
                <strong style="color: #92400E; font-size: 13.5px;">Security Alert: Administrative Login Attempt Detected</strong>
            </div>

            <h2 style="color: #123F2B; font-size: 22px; font-weight: 800; margin: 0 0 14px; text-align: left;">
                Admin Two-Step Verification
            </h2>
            <p style="color: #334155; font-size: 14.5px; line-height: 1.6; margin: 0 0 12px;">
                Hello <strong>${adminName}</strong>,
            </p>
            <p style="color: #334155; font-size: 14.5px; line-height: 1.6; margin: 0 0 20px;">
                An administrative sign-in was requested for the Thulirva Operations & Management Console. Please enter the two-step verification code below to authorize this session:
            </p>

            <!-- Prominent OTP Card -->
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #FAF8EF; border: 2px solid #C2A649; border-radius: 14px; margin: 20px 0;">
                <tr>
                    <td align="center" style="padding: 24px 16px;">
                        <div style="font-size: 11px; font-weight: 800; color: #123F2B; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px;">
                            Two-Step Verification Code
                        </div>
                        <div style="font-size: 38px; font-weight: 900; letter-spacing: 12px; color: #123F2B; font-family: 'Courier New', Courier, monospace; margin: 8px 0; padding-left: 12px;">
                            ${formattedOtp}
                        </div>
                        <div style="font-size: 12px; font-weight: 700; color: #DC2626; margin-top: 6px;">
                            ⏱ Code expires in ${expiryMinutes} minutes
                        </div>
                    </td>
                </tr>
            </table>

            <!-- Session Metadata -->
            <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 16px; margin: 20px 0; font-size: 12.5px; color: #475569; line-height: 1.7;">
                <div><strong>Requested From IP:</strong> ${ipAddress}</div>
                <div><strong>Client Platform:</strong> ${userAgent}</div>
                <div><strong>Timestamp:</strong> ${new Date().toUTCString()}</div>
            </div>

            <p style="color: #DC2626; font-size: 13px; line-height: 1.5; margin: 18px 0 0;">
                <strong>Do not share this code with anyone.</strong> Thulirva IT staff will never ask for your verification code. If you did not initiate this login, please investigate and change your master administrative password immediately.
            </p>
        `;

        const text = `Thulirva Admin Two-Step Verification\n\nCode: ${otp}\nExpires in: ${expiryMinutes} minutes\nIP: ${ipAddress}\nTime: ${new Date().toISOString()}\n\nDo not share this code with anyone.`;

        const html = this._wrapTemplate({
            title: `Admin 2-Step Verification - Thulirva`,
            preheader: `Admin verification code: ${otp}. Valid for ${expiryMinutes} minutes.`,
            bodyHtml
        });

        return this.sendMail({ to, subject, html, text });
    }

    /**
     * Send Welcome Registration Email
     */
    async sendWelcomeEmail({ to, name = "Valued Customer", role = "customer" }) {
        const subject = "Welcome to Thulirva! 🌿 Freshness You Can Trust";
        const isPartner = role === "delivery_partner" || role === "partner";

        const bodyHtml = `
            <h2 style="color: #123F2B; font-size: 22px; font-weight: 800; margin: 0 0 14px;">
                Welcome to the Thulirva Family! 🌿
            </h2>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 14px;">
                Hello <strong>${name}</strong>,
            </p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                ${isPartner 
                    ? "Thank you for joining Thulirva as a Delivery Partner. We are thrilled to partner with you to deliver farm-fresh goodness to our community."
                    : "Thank you for creating an account with Thulirva. You now have direct access to authentic farm-fresh A2 milk, pure country cow ghee, paneer, and natural cold-pressed groceries delivered straight from our pastures."}
            </p>
            
            <div style="background-color: #FAF8EF; border-left: 4px solid #123F2B; padding: 14px 18px; border-radius: 6px; margin: 20px 0;">
                <p style="color: #123F2B; font-size: 14px; font-weight: 700; margin: 0 0 4px;">
                    Account Highlights:
                </p>
                <ul style="color: #475569; font-size: 13.5px; line-height: 1.6; margin: 4px 0 0; padding-left: 18px;">
                    <li>Daily morning milk doorstep delivery before 7:00 AM</li>
                    <li>Flexible subscription management & pause anytime</li>
                    <li>100% natural, laboratory-tested agro & dairy products</li>
                    <li>Direct support via our Helpdesk ticketing system</li>
                </ul>
            </div>

            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 20px 0 0;">
                Warm regards,<br>
                <strong>The Thulirva Team</strong>
            </p>
        `;

        const text = `Welcome to Thulirva, ${name}!\n\nThank you for joining Thulirva. Explore authentic farm-fresh dairy and groceries delivered to your doorstep.\n\nWarm regards,\nThe Thulirva Team`;

        const html = this._wrapTemplate({
            title: "Welcome to Thulirva",
            preheader: `Welcome to Thulirva, ${name}! Freshness you can trust.`,
            bodyHtml
        });

        return this.sendMail({ to, subject, html, text });
    }

    /**
     * Send Support Ticket Creation Confirmation Email
     */
    async sendTicketConfirmationEmail({ to, name = "Customer", ticketNumber, subject: ticketSubject, category, description }) {
        if (!to) return;
        const subject = `[${ticketNumber}] Ticket Received: ${ticketSubject}`;

        const bodyHtml = `
            <div style="display: inline-block; background-color: #E8F0E0; color: #123F2B; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 12px; text-transform: uppercase; margin-bottom: 12px;">
                Support Ticket Created
            </div>
            <h2 style="color: #123F2B; font-size: 21px; font-weight: 800; margin: 0 0 12px;">
                We've Received Your Support Request
            </h2>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 14px;">
                Hello <strong>${name}</strong>,
            </p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
                Your support ticket has been logged in our centralized helpdesk system. A dedicated member of our customer care team is reviewing it.
            </p>

            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #FAF8EF; border: 1px solid #EADBBE; border-radius: 12px; margin: 16px 0;">
                <tr>
                    <td style="padding: 16px 20px;">
                        <p style="margin: 0 0 8px; font-size: 13px; color: #64748B;">
                            <strong>Ticket Reference:</strong> <span style="color: #123F2B; font-weight: 700;">${ticketNumber}</span>
                        </p>
                        <p style="margin: 0 0 8px; font-size: 13px; color: #64748B;">
                            <strong>Category:</strong> ${category || "General Support"}
                        </p>
                        <p style="margin: 0 0 8px; font-size: 13px; color: #64748B;">
                            <strong>Subject:</strong> ${ticketSubject}
                        </p>
                        <p style="margin: 0; font-size: 13px; color: #64748B;">
                            <strong>Message:</strong> ${description ? description.slice(0, 200) : "No description provided"}
                        </p>
                    </td>
                </tr>
            </table>

            <p style="color: #475569; font-size: 13.5px; line-height: 1.5; margin: 18px 0 0;">
                You can track updates or reply directly via the Thulirva App or website helpdesk.
            </p>
        `;

        const text = `Hello ${name},\n\nYour support ticket ${ticketNumber} has been received.\n\nSubject: ${ticketSubject}\nCategory: ${category}\n\nOur team is reviewing your request.\n\nThulirva Customer Care`;

        const html = this._wrapTemplate({
            title: `Support Ticket ${ticketNumber}`,
            preheader: `Ticket ${ticketNumber} received: ${ticketSubject}`,
            bodyHtml
        });

        return this.sendMail({ to, subject, html, text });
    }

    /**
     * Send Support Ticket Update / Reply Email
     */
    async sendTicketUpdateEmail({ to, name = "Customer", ticketNumber, subject: ticketSubject, updateType = "reply", message = "", senderName = "Support Agent", status = null }) {
        if (!to) return;
        const subject = `[Update: ${ticketNumber}] ${ticketSubject}`;

        const isResolved = status && (status.toUpperCase() === "RESOLVED" || status.toUpperCase() === "CLOSED");

        const bodyHtml = `
            <div style="display: inline-block; background-color: ${isResolved ? '#DCFCE7' : '#E0F2FE'}; color: ${isResolved ? '#15803D' : '#0369A1'}; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 12px; text-transform: uppercase; margin-bottom: 12px;">
                ${isResolved ? 'Ticket Resolved' : 'New Response on Ticket'}
            </div>
            <h2 style="color: #123F2B; font-size: 21px; font-weight: 800; margin: 0 0 12px;">
                ${isResolved ? 'Your Ticket Has Been Resolved' : 'New Update on Your Support Ticket'}
            </h2>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 14px;">
                Hello <strong>${name}</strong>,
            </p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                ${isResolved 
                    ? `Your support ticket <strong>${ticketNumber}</strong> has been marked as resolved.`
                    : `<strong>${senderName}</strong> has posted a response to your ticket <strong>${ticketNumber}</strong>:`}
            </p>

            ${message ? `
            <div style="background-color: #FAF8EF; border-left: 4px solid #123F2B; padding: 14px 18px; border-radius: 6px; margin: 16px 0; font-size: 14px; color: #334155; line-height: 1.6;">
                "${message}"
            </div>` : ""}

            <p style="color: #475569; font-size: 13.5px; line-height: 1.5; margin: 18px 0 0;">
                If your issue is not fully addressed, you may reopen or reply to this ticket directly through your Thulirva mobile app or account dashboard.
            </p>
        `;

        const text = `Hello ${name},\n\nUpdate on ticket ${ticketNumber}: ${ticketSubject}\n\nMessage: ${message}\n\nThulirva Customer Care`;

        const html = this._wrapTemplate({
            title: `Update on Ticket ${ticketNumber}`,
            preheader: `Update on your ticket ${ticketNumber}`,
            bodyHtml
        });

        return this.sendMail({ to, subject, html, text });
    }
}

// Export singleton instance
module.exports = new EmailService();

