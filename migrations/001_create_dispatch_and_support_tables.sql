-- THULIRVA PRODUCTION DATABASE MIGRATION 001
-- Dispatch Engine, Atomic Delivery Assignment & Support Ticket Infrastructure

-- ============================================================
-- 1. DISPATCH OFFERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS dispatch_offers (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(100) NOT NULL,
    subscription_id VARCHAR(100),
    delivery_type VARCHAR(50) DEFAULT 'order',
    partner_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    offer_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    response_time TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure order_id and partner_id are flexible VARCHAR
ALTER TABLE dispatch_offers ALTER COLUMN order_id TYPE VARCHAR(100);
ALTER TABLE dispatch_offers ALTER COLUMN partner_id TYPE VARCHAR(100);
ALTER TABLE dispatch_offers ALTER COLUMN subscription_id TYPE VARCHAR(100);

-- Indexes for ultra-fast lookup and active offer dedup
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_lookup ON dispatch_offers (order_id, partner_id, status);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_partner_pending ON dispatch_offers (partner_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_order_active ON dispatch_offers (order_id, status);

-- ============================================================
-- 2. DELIVERY ASSIGNMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_assignments (
    id SERIAL PRIMARY KEY,
    assignment_id VARCHAR(100) UNIQUE NOT NULL,
    order_id VARCHAR(100) NOT NULL,
    subscription_id VARCHAR(100),
    delivery_type VARCHAR(50) NOT NULL DEFAULT 'order',
    partner_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'assigned',
    assigned_by VARCHAR(100) DEFAULT 'smart_dispatch',
    pickup_time TIMESTAMP,
    delivered_time TIMESTAMP,
    failed_reason TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE delivery_assignments ALTER COLUMN order_id TYPE VARCHAR(100);
ALTER TABLE delivery_assignments ALTER COLUMN partner_id TYPE VARCHAR(100);
ALTER TABLE delivery_assignments ALTER COLUMN assignment_id TYPE VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_lookup ON delivery_assignments (order_id, partner_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_partner ON delivery_assignments (partner_id, status);

-- ============================================================
-- 3. CUSTOMER CARE & SUPPORT TICKETS
-- ============================================================
CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(150),
    user_phone VARCHAR(50),
    user_email VARCHAR(200),
    user_type VARCHAR(50) NOT NULL, -- 'customer' or 'delivery_partner'
    category VARCHAR(100) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    order_id VARCHAR(100),
    priority VARCHAR(50) DEFAULT 'NORMAL', -- 'LOW', 'NORMAL', 'HIGH', 'URGENT'
    status VARCHAR(50) DEFAULT 'OPEN',     -- 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_PARTNER', 'RESOLVED', 'CLOSED'
    assigned_admin_id VARCHAR(100),
    assigned_admin_name VARCHAR(150),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets (user_id, user_type);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_order ON support_tickets (order_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON support_tickets (created_at DESC);

-- ============================================================
-- 4. SUPPORT TICKET MESSAGES (CONVERSATION THREAD)
-- ============================================================
CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) NOT NULL,
    ticket_number VARCHAR(50),
    sender_id VARCHAR(100) NOT NULL,
    sender_name VARCHAR(150),
    sender_role VARCHAR(50) NOT NULL, -- 'customer', 'delivery_partner', 'admin', 'system'
    message TEXT NOT NULL,
    attachment_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_ticket_messages (ticket_id, created_at ASC);

-- ============================================================
-- 5. SUPPORT TICKET INTERNAL NOTES (ADMIN ONLY)
-- ============================================================
CREATE TABLE IF NOT EXISTS support_ticket_internal_notes (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) NOT NULL,
    admin_id VARCHAR(100) NOT NULL,
    admin_name VARCHAR(150),
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_notes_ticket ON support_ticket_internal_notes (ticket_id, created_at ASC);

-- ============================================================
-- 6. SUPPORT TICKET AUDIT EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS support_ticket_events (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL, -- 'CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'PRIORITY_CHANGED', 'REPLIED'
    actor_id VARCHAR(100) NOT NULL,
    actor_name VARCHAR(150),
    actor_role VARCHAR(50) NOT NULL,
    event_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_events_ticket ON support_ticket_events (ticket_id, created_at ASC);

