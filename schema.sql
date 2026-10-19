-- =============================================================================
-- PORTUS — UJPAS (Union des Jeunes du Port pour l'Assistance et la Sécurité)
-- Corridor Portuaire de Vridi — Abidjan, Côte d'Ivoire
-- MIGRATION COMPLÈTE & EXÉCUTABLE : schema.sql (PostgreSQL 15+ / Supabase)
-- =============================================================================
-- CONFORMITÉ TERMINOLOGIQUE STRICTE :
-- Usage exclusif de "Contribution d'Assistance et de Sécurisation"
-- et du statut opérationnel "EN_ATTENTE_REGULARISATION" (En attente de régularisation).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. TYPES ENUM
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM (
        'ADMIN_PROJET',
        'SUPERVISEUR_UJPAS',
        'RESPONSABLE_SECTEUR',
        'AGENT_TERRAIN',
        'AUDITEUR_INSTITUTIONNEL'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE public.ticket_status AS ENUM (
        'IMPRIME',
        'ASSIGNE_SECTEUR',
        'ASSIGNE_AGENT',
        'SEJOUR_ACTIF',
        'EN_ATTENTE_PAIEMENT_MM',
        'EN_ATTENTE_REGULARISATION',
        'SORTIE_DECLAREE',
        'EXPIRE',
        'ANNULE_FRAUDE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE public.payment_method AS ENUM (
        'ESPECES',
        'WAVE',
        'ORANGE_MONEY',
        'MTN_MOMO',
        'MOOV_MONEY'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE public.control_verdict AS ENUM (
        'CONFORME_ACTIF',
        'DEPASSEMENT_DUREE_EN_ATTENTE_REGULARISATION',
        'PLAQUE_NON_CONFORME',
        'SIGNATURE_CRYPTO_INVALIDE',
        'TICKET_DEJA_SORTI',
        'TICKET_INCONNU_OU_NON_SYNCHRONISE',
        'PAIEMENT_MM_NON_CONFIRME'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE public.incident_type AS ENUM (
        'PANNE_CAMION_OBSTRUCTION',
        'ACCIDENT_CORRIDOR',
        'TENTATIVE_CORRUPTION_OU_FALSIFICATION',
        'LITIGE_CHAUFFEUR_ASSISTANCE',
        'AGRESSION_SECURITE',
        'CONGESTION_CRITIQUE_TERMINAL',
        'AUTRE_ASSISTANCE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE public.incident_severity AS ENUM (
        'MINEUR',
        'MODERE',
        'CRITIQUE',
        'URGENCE_ABSOLUE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 2. TABLES FONDAMENTALES
-- -----------------------------------------------------------------------------

-- 2.1 Paramètres globaux du projet (Singleton)
CREATE TABLE IF NOT EXISTS public.app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    organization_name TEXT NOT NULL DEFAULT 'UJPAS — Union des Jeunes du Port pour l''Assistance et la Sécurité',
    contribution_label TEXT NOT NULL DEFAULT 'Contribution d''Assistance et de Sécurisation',
    pending_regularization_label TEXT NOT NULL DEFAULT 'En attente de régularisation',
    default_contribution_fcfa INTEGER NOT NULL DEFAULT 2500 CHECK (default_contribution_fcfa > 0),
    standard_stay_hours INTEGER NOT NULL DEFAULT 24 CHECK (standard_stay_hours > 0),
    grace_period_minutes INTEGER NOT NULL DEFAULT 60 CHECK (grace_period_minutes >= 0),
    ed25519_public_key_hex TEXT NOT NULL CHECK (char_length(ed25519_public_key_hex) = 64),
    key_version INTEGER NOT NULL DEFAULT 1,
    emergency_radio_channel TEXT NOT NULL DEFAULT 'CANAL 16 — VRIDI SECOURS (446.09375 MHz)',
    support_phone TEXT NOT NULL DEFAULT '+225 07 00 00 00 01',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID
);

-- 2.2 Secteurs du corridor portuaire de Vridi
CREATE TABLE IF NOT EXISTS public.sectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{3,16}$'),
    name TEXT NOT NULL,
    corridor_zone TEXT NOT NULL,
    gps_lat NUMERIC(9,6) NOT NULL,
    gps_lng NUMERIC(9,6) NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 600 CHECK (radius_meters > 50),
    max_capacity_trucks INTEGER NOT NULL DEFAULT 120 CHECK (max_capacity_trucks > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3 Profils utilisateurs (liés ou synchronisables avec auth.users)
-- Permissions cumulables : peut_vendre, peut_controler, peut_signaler + callsign radio
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY,
    matricule TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    role public.user_role NOT NULL DEFAULT 'AGENT_TERRAIN',
    sector_id UUID REFERENCES public.sectors(id) ON DELETE SET NULL,
    callsign TEXT NOT NULL UNIQUE,
    peut_vendre BOOLEAN NOT NULL DEFAULT FALSE,
    peut_controler BOOLEAN NOT NULL DEFAULT TRUE,
    peut_signaler BOOLEAN NOT NULL DEFAULT TRUE,
    pin_hash TEXT NOT NULL,
    photo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.4 Badges professionnels UJPAS signés Ed25519
CREATE TABLE IF NOT EXISTS public.badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    badge_number TEXT NOT NULL UNIQUE,
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sector_id UUID REFERENCES public.sectors(id) ON DELETE SET NULL,
    ed25519_signature_hex TEXT NOT NULL CHECK (char_length(ed25519_signature_hex) = 128),
    qr_payload TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_reason TEXT,
    revoked_at TIMESTAMPTZ,
    issued_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- 2.5 Lots de carnets de tickets pré-imprimés
CREATE TABLE IF NOT EXISTS public.ticket_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_code TEXT NOT NULL UNIQUE,
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    assigned_supervisor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    serial_start INTEGER NOT NULL CHECK (serial_start > 0),
    serial_end INTEGER NOT NULL CHECK (serial_end >= serial_start),
    ticket_count INTEGER GENERATED ALWAYS AS (serial_end - serial_start + 1) STORED,
    unit_contribution_fcfa INTEGER NOT NULL DEFAULT 2500 CHECK (unit_contribution_fcfa > 0),
    key_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'IMPRIME' CHECK (status IN ('IMPRIME', 'ASSIGNE_SECTEUR', 'ASSIGNE_AGENT', 'EPUISE', 'ARCHIVE')),
    printed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    printed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.6 Tickets individuels pré-signés Ed25519
CREATE TABLE IF NOT EXISTS public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT NOT NULL UNIQUE,
    serial_number INTEGER NOT NULL UNIQUE,
    batch_id UUID NOT NULL REFERENCES public.ticket_batches(id) ON DELETE RESTRICT,
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    assigned_agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    contribution_amount_fcfa INTEGER NOT NULL DEFAULT 2500 CHECK (contribution_amount_fcfa > 0),
    status public.ticket_status NOT NULL DEFAULT 'IMPRIME',
    ed25519_signature_hex TEXT NOT NULL CHECK (char_length(ed25519_signature_hex) = 128),
    key_version INTEGER NOT NULL DEFAULT 1,
    qr_static_payload TEXT NOT NULL,
    activated_at TIMESTAMPTZ,
    exited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.7 Chaîne de garde physique des carnets (Custody Logs)
CREATE TABLE IF NOT EXISTS public.custody_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.ticket_batches(id) ON DELETE RESTRICT,
    from_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    to_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    action_type TEXT NOT NULL CHECK (action_type IN ('DOTATION_SECTEUR', 'REMISE_AGENT', 'RETOUR_INVENDUS', 'RETRAIT_SECURITE')),
    serial_from INTEGER NOT NULL,
    serial_to INTEGER NOT NULL,
    handover_note TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.8 Perception de la Contribution d'Assistance et de Sécurisation (Sales)
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    ticket_id UUID NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE RESTRICT,
    ticket_number TEXT NOT NULL,
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    agent_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    truck_plate TEXT NOT NULL CHECK (char_length(trim(truck_plate)) >= 4),
    trailer_plate TEXT,
    driver_name TEXT,
    driver_phone TEXT,
    transport_company TEXT,
    country_origin TEXT NOT NULL DEFAULT 'CI' CHECK (country_origin IN ('CI', 'BF', 'ML', 'NE', 'GH', 'TG', 'BJ', 'GN', 'SN', 'AUTRE')),
    contribution_amount_fcfa INTEGER NOT NULL DEFAULT 2500 CHECK (contribution_amount_fcfa > 0),
    payment_method public.payment_method NOT NULL DEFAULT 'ESPECES',
    mobile_money_ref TEXT,
    payment_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
    payment_confirmed_at TIMESTAMPTZ,
    sold_at TIMESTAMPTZ NOT NULL,
    max_stay_expires_at TIMESTAMPTZ NOT NULL,
    exited_at TIMESTAMPTZ,
    exit_declared_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    gps_lat NUMERIC(9,6),
    gps_lng NUMERIC(9,6),
    offline_created BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    remittance_id UUID
);

-- 2.9 Corrections de plaques d'immatriculation (traçabilité anti-fraude)
CREATE TABLE IF NOT EXISTS public.plate_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
    ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE RESTRICT,
    old_plate TEXT NOT NULL,
    new_plate TEXT NOT NULL,
    justification TEXT NOT NULL CHECK (char_length(trim(justification)) >= 10),
    requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'APPROUVE' CHECK (status IN ('EN_ATTENTE', 'APPROUVE', 'REJETE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.10 Versements journaliers des agents aux Responsables de Secteur (IMMUTABLE / APPEND-ONLY)
CREATE TABLE IF NOT EXISTS public.remittances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remittance_code TEXT NOT NULL UNIQUE,
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    agent_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    received_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sales_count INTEGER NOT NULL CHECK (sales_count >= 0),
    expected_cash_fcfa INTEGER NOT NULL CHECK (expected_cash_fcfa >= 0),
    declared_cash_fcfa INTEGER NOT NULL CHECK (declared_cash_fcfa >= 0),
    mobile_money_total_fcfa INTEGER NOT NULL DEFAULT 0 CHECK (mobile_money_total_fcfa >= 0),
    variance_fcfa INTEGER GENERATED ALWAYS AS (declared_cash_fcfa - expected_cash_fcfa) STORED,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ajout de la contrainte FK différée entre sales et remittances
DO $$ BEGIN
    ALTER TABLE public.sales
        ADD CONSTRAINT fk_sales_remittance
        FOREIGN KEY (remittance_id) REFERENCES public.remittances(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2.11 Ajustements comptables sur versements (car remittances est append-only)
CREATE TABLE IF NOT EXISTS public.remittance_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remittance_id UUID NOT NULL REFERENCES public.remittances(id) ON DELETE RESTRICT,
    adjustment_amount_fcfa INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 10),
    authorized_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.12 Dépôts en trésorerie centrale / banque (Superviseur UJPAS / Admin)
CREATE TABLE IF NOT EXISTS public.treasury_deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deposit_reference TEXT NOT NULL UNIQUE,
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    deposited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    bank_or_institution TEXT NOT NULL,
    slip_number TEXT NOT NULL,
    amount_fcfa INTEGER NOT NULL CHECK (amount_fcfa > 0),
    slip_photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'VERIFIE' CHECK (status IN ('DECLARE', 'VERIFIE', 'ECART_SIGNALE')),
    deposited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.13 Contrôles routiers & Signalements anti-fraude
CREATE TABLE IF NOT EXISTS public.fraud_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
    ticket_number_scanned TEXT NOT NULL,
    controller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    observed_truck_plate TEXT NOT NULL,
    verdict public.control_verdict NOT NULL,
    action_taken TEXT NOT NULL DEFAULT 'Maintien en zone — En attente de régularisation',
    ed25519_verified BOOLEAN NOT NULL DEFAULT FALSE,
    gps_lat NUMERIC(9,6),
    gps_lng NUMERIC(9,6),
    notes TEXT,
    controlled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.14 Incidents de sécurité et d'assistance corridor Vridi
CREATE TABLE IF NOT EXISTS public.incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_code TEXT NOT NULL UNIQUE,
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    reported_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    incident_type public.incident_type NOT NULL,
    severity public.incident_severity NOT NULL DEFAULT 'MODERE',
    truck_plate TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OUVERT' CHECK (status IN ('OUVERT', 'EN_INTERVENTION', 'RESOLU', 'CLOS')),
    resolution_note TEXT,
    resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    gps_lat NUMERIC(9,6),
    gps_lng NUMERIC(9,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.15 Passations de quart (Shift Handovers)
CREATE TABLE IF NOT EXISTS public.shift_handovers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
    outgoing_agent_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    incoming_agent_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    supervisor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    active_trucks_count INTEGER NOT NULL DEFAULT 0,
    pending_regularization_count INTEGER NOT NULL DEFAULT 0,
    remaining_tickets_serial_start INTEGER,
    remaining_tickets_serial_end INTEGER,
    cash_handed_over_fcfa INTEGER NOT NULL DEFAULT 0 CHECK (cash_handed_over_fcfa >= 0),
    handover_summary TEXT NOT NULL,
    handed_over_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.16 Notifications temps réel (Responsables Secteur, Superviseurs, Admins)
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_role public.user_role,
    sector_id UUID REFERENCES public.sectors(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('PERCEPTION_CONTRIBUTION', 'ALERTE_REGULARISATION', 'INCIDENT_SECURITE', 'FRAUDE_DETECTEE', 'VERSEMENT_CAISSE', 'SYSTEME')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.17 Journal d'audit immuable (APPEND-ONLY)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_role public.user_role,
    sector_id UUID REFERENCES public.sectors(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_table TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_or_device TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index de performance pour smartphones bas de gamme et requêtes terrain
CREATE INDEX IF NOT EXISTS idx_tickets_number ON public.tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_sector_status ON public.tickets(sector_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_truck_plate ON public.sales(truck_plate);
CREATE INDEX IF NOT EXISTS idx_sales_sector_sold_at ON public.sales(sector_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_expires_at ON public.sales(max_stay_expires_at) WHERE exited_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON public.notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_sector_status ON public.incidents(sector_id, status);
CREATE INDEX IF NOT EXISTS idx_fraud_reports_sector_date ON public.fraud_reports(sector_id, controlled_at DESC);

-- -----------------------------------------------------------------------------
-- 3. TRIGGERS D'IMMUABILITÉ (APPEND-ONLY) SUR AUDIT_LOGS ET REMITTANCES
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_append_only_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'VIOLATION SÉCURITÉ PORTUS : La table "%" est strictement immuable (append-only). Les opérations % sont interdites. Utilisez remittance_adjustments pour tout ajustement comptable.', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_ledger();

DROP TRIGGER IF EXISTS trg_remittances_immutable ON public.remittances;
CREATE TRIGGER trg_remittances_immutable
BEFORE UPDATE OR DELETE ON public.remittances
FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_ledger();

-- -----------------------------------------------------------------------------
-- 4. POLITIQUES RLS (ROW LEVEL SECURITY) PAR RÔLE ET SECTEUR
-- -----------------------------------------------------------------------------

-- Fonctions utilitaires d'identification du profil courant (compatible Auth Supabase & en-tête x-portus-profile-id en mode démo/terrain)
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID;
    v_header_uid TEXT;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NOT NULL THEN
        RETURN v_uid;
    END IF;
    BEGIN
        v_header_uid := current_setting('request.headers', true)::json->>'x-portus-profile-id';
        IF v_header_uid IS NOT NULL AND v_header_uid <> '' THEN
            RETURN v_header_uid::UUID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = public.current_profile_id() AND is_active = TRUE;
$$;

CREATE OR REPLACE FUNCTION public.current_user_sector_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT sector_id FROM public.profiles WHERE id = public.current_profile_id() AND is_active = TRUE;
$$;

-- Activation RLS sur les 16 tables
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plate_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4.1 app_settings & sectors : Lecture pour tout agent actif, modification par ADMIN_PROJET uniquement
DROP POLICY IF EXISTS pol_app_settings_select ON public.app_settings;
CREATE POLICY pol_app_settings_select ON public.app_settings
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_app_settings_admin ON public.app_settings;
CREATE POLICY pol_app_settings_admin ON public.app_settings
    FOR ALL USING (public.current_user_role() = 'ADMIN_PROJET');

DROP POLICY IF EXISTS pol_sectors_select ON public.sectors;
CREATE POLICY pol_sectors_select ON public.sectors
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_sectors_admin ON public.sectors;
CREATE POLICY pol_sectors_admin ON public.sectors
    FOR ALL USING (public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS'));

-- 4.2 profiles : Lecture globale pour l'annuaire radio et vérification badges ; édition par ADMIN_PROJET
DROP POLICY IF EXISTS pol_profiles_select ON public.profiles;
CREATE POLICY pol_profiles_select ON public.profiles
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_profiles_update_own_or_admin ON public.profiles;
CREATE POLICY pol_profiles_update_own_or_admin ON public.profiles
    FOR UPDATE USING (
        id = public.current_profile_id()
        OR public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS')
    );

DROP POLICY IF EXISTS pol_profiles_insert_admin ON public.profiles;
CREATE POLICY pol_profiles_insert_admin ON public.profiles
    FOR INSERT WITH CHECK (public.current_user_role() = 'ADMIN_PROJET');

-- 4.3 badges : Lecture publique pour contrôle QR hors-ligne/en-ligne ; gestion par ADMIN_PROJET & SUPERVISEUR_UJPAS
DROP POLICY IF EXISTS pol_badges_select ON public.badges;
CREATE POLICY pol_badges_select ON public.badges
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_badges_manage ON public.badges;
CREATE POLICY pol_badges_manage ON public.badges
    FOR ALL USING (public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS'));

-- 4.4 ticket_batches & tickets & custody_logs : Isolation par secteur pour RESPONSABLE_SECTEUR / AGENT_TERRAIN, vue globale pour ADMIN / SUPERVISEUR / AUDITEUR
DROP POLICY IF EXISTS pol_batches_select ON public.ticket_batches;
CREATE POLICY pol_batches_select ON public.ticket_batches
    FOR SELECT USING (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS', 'AUDITEUR_INSTITUTIONNEL')
        OR sector_id = public.current_user_sector_id()
        OR public.current_profile_id() IS NULL
    );

DROP POLICY IF EXISTS pol_batches_write ON public.ticket_batches;
CREATE POLICY pol_batches_write ON public.ticket_batches
    FOR ALL USING (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS')
        OR (public.current_user_role() = 'RESPONSABLE_SECTEUR' AND sector_id = public.current_user_sector_id())
    );

DROP POLICY IF EXISTS pol_tickets_select ON public.tickets;
CREATE POLICY pol_tickets_select ON public.tickets
    FOR SELECT USING (TRUE); -- Tout agent contrôleur peut vérifier un ticket d'un camion en transit inter-secteurs

DROP POLICY IF EXISTS pol_tickets_write ON public.tickets;
CREATE POLICY pol_tickets_write ON public.tickets
    FOR ALL USING (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS')
        OR sector_id = public.current_user_sector_id()
    );

DROP POLICY IF EXISTS pol_custody_select ON public.custody_logs;
CREATE POLICY pol_custody_select ON public.custody_logs
    FOR SELECT USING (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS', 'AUDITEUR_INSTITUTIONNEL')
        OR sector_id = public.current_user_sector_id()
        OR public.current_profile_id() IS NULL
    );

DROP POLICY IF EXISTS pol_custody_insert ON public.custody_logs;
CREATE POLICY pol_custody_insert ON public.custody_logs
    FOR INSERT WITH CHECK (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS', 'RESPONSABLE_SECTEUR')
    );

-- 4.5 sales & plate_corrections
DROP POLICY IF EXISTS pol_sales_select ON public.sales;
CREATE POLICY pol_sales_select ON public.sales
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_sales_insert ON public.sales;
CREATE POLICY pol_sales_insert ON public.sales
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = COALESCE(public.current_profile_id(), agent_id)
              AND p.is_active = TRUE
              AND p.peut_vendre = TRUE
        )
    );

DROP POLICY IF EXISTS pol_plate_corrections_select ON public.plate_corrections;
CREATE POLICY pol_plate_corrections_select ON public.plate_corrections
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_plate_corrections_insert ON public.plate_corrections;
CREATE POLICY pol_plate_corrections_insert ON public.plate_corrections
    FOR INSERT WITH CHECK (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS', 'RESPONSABLE_SECTEUR', 'AGENT_TERRAIN')
    );

-- 4.6 remittances, remittance_adjustments, treasury_deposits
DROP POLICY IF EXISTS pol_remittances_select ON public.remittances;
CREATE POLICY pol_remittances_select ON public.remittances
    FOR SELECT USING (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS', 'AUDITEUR_INSTITUTIONNEL')
        OR sector_id = public.current_user_sector_id()
        OR agent_id = public.current_profile_id()
        OR public.current_profile_id() IS NULL
    );

DROP POLICY IF EXISTS pol_remittances_insert ON public.remittances;
CREATE POLICY pol_remittances_insert ON public.remittances
    FOR INSERT WITH CHECK (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS', 'RESPONSABLE_SECTEUR')
    );

DROP POLICY IF EXISTS pol_remittance_adj_select ON public.remittance_adjustments;
CREATE POLICY pol_remittance_adj_select ON public.remittance_adjustments
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_remittance_adj_insert ON public.remittance_adjustments;
CREATE POLICY pol_remittance_adj_insert ON public.remittance_adjustments
    FOR INSERT WITH CHECK (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS')
    );

DROP POLICY IF EXISTS pol_treasury_select ON public.treasury_deposits;
CREATE POLICY pol_treasury_select ON public.treasury_deposits
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_treasury_insert ON public.treasury_deposits;
CREATE POLICY pol_treasury_insert ON public.treasury_deposits
    FOR INSERT WITH CHECK (
        public.current_user_role() IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS', 'RESPONSABLE_SECTEUR')
    );

-- 4.7 fraud_reports, incidents, shift_handovers, notifications, audit_logs
DROP POLICY IF EXISTS pol_fraud_select ON public.fraud_reports;
CREATE POLICY pol_fraud_select ON public.fraud_reports
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_fraud_insert ON public.fraud_reports;
CREATE POLICY pol_fraud_insert ON public.fraud_reports
    FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS pol_incidents_select ON public.incidents;
CREATE POLICY pol_incidents_select ON public.incidents
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_incidents_write ON public.incidents;
CREATE POLICY pol_incidents_write ON public.incidents
    FOR ALL USING (TRUE);

DROP POLICY IF EXISTS pol_handovers_select ON public.shift_handovers;
CREATE POLICY pol_handovers_select ON public.shift_handovers
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_handovers_insert ON public.shift_handovers;
CREATE POLICY pol_handovers_insert ON public.shift_handovers
    FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS pol_notifications_select ON public.notifications;
CREATE POLICY pol_notifications_select ON public.notifications
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_notifications_update ON public.notifications;
CREATE POLICY pol_notifications_update ON public.notifications
    FOR UPDATE USING (TRUE);

DROP POLICY IF EXISTS pol_audit_select ON public.audit_logs;
CREATE POLICY pol_audit_select ON public.audit_logs
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_audit_insert ON public.audit_logs;
CREATE POLICY pol_audit_insert ON public.audit_logs
    FOR INSERT WITH CHECK (TRUE);

-- -----------------------------------------------------------------------------
-- 5. FONCTIONS RPC PL/pgSQL TRANSACTIONNELLES
-- -----------------------------------------------------------------------------

-- 5.1 RPC : sync_sale
-- Enregistre de façon idempotente la perception d'une Contribution d'Assistance et de Sécurisation,
-- active le ticket, calcule max_stay_expires_at (+24h), journalise l'audit,
-- et notifie automatiquement le RESPONSABLE_SECTEUR et l'ADMIN_PROJET.
CREATE OR REPLACE FUNCTION public.sync_sale(
    p_idempotency_key TEXT,
    p_ticket_number TEXT,
    p_agent_id UUID,
    p_truck_plate TEXT,
    p_trailer_plate TEXT DEFAULT NULL,
    p_driver_name TEXT DEFAULT NULL,
    p_driver_phone TEXT DEFAULT NULL,
    p_transport_company TEXT DEFAULT NULL,
    p_country_origin TEXT DEFAULT 'CI',
    p_payment_method public.payment_method DEFAULT 'ESPECES',
    p_mobile_money_ref TEXT DEFAULT NULL,
    p_sold_at TIMESTAMPTZ DEFAULT NOW(),
    p_gps_lat NUMERIC DEFAULT NULL,
    p_gps_lng NUMERIC DEFAULT NULL,
    p_offline_created BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_sale public.sales%ROWTYPE;
    v_ticket public.tickets%ROWTYPE;
    v_agent public.profiles%ROWTYPE;
    v_settings public.app_settings%ROWTYPE;
    v_expires_at TIMESTAMPTZ;
    v_payment_confirmed BOOLEAN;
    v_new_ticket_status public.ticket_status;
    v_sale_id UUID;
    v_clean_plate TEXT;
BEGIN
    -- 1. Vérification d'idempotence (retour immédiat si déjà synchronisé)
    SELECT * INTO v_existing_sale
    FROM public.sales
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'status', 'IDEMPOTENT_ALREADY_SYNCED',
            'sale_id', v_existing_sale.id,
            'ticket_number', v_existing_sale.ticket_number,
            'truck_plate', v_existing_sale.truck_plate,
            'max_stay_expires_at', v_existing_sale.max_stay_expires_at,
            'payment_confirmed', v_existing_sale.payment_confirmed
        );
    END IF;

    -- 2. Vérification de l'agent et de son habilitation `peut_vendre`
    SELECT * INTO v_agent
    FROM public.profiles
    WHERE id = p_agent_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agent introuvable ou inactif (ID: %).', p_agent_id;
    END IF;

    IF NOT v_agent.peut_vendre THEN
        RAISE EXCEPTION 'HABILITATION REFUSÉE : L''agent % (%) n''a pas la permission de percevoir la Contribution d''Assistance et de Sécurisation.', v_agent.full_name, v_agent.matricule;
    END IF;

    -- 3. Verrouillage et vérification du ticket
    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE ticket_number = trim(upper(p_ticket_number))
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket % introuvable dans le référentiel UJPAS.', p_ticket_number;
    END IF;

    IF v_ticket.status NOT IN ('IMPRIME', 'ASSIGNE_SECTEUR', 'ASSIGNE_AGENT') THEN
        RAISE EXCEPTION 'CONFLIT DE TICKET : Le ticket % est déjà au statut %.', v_ticket.ticket_number, v_ticket.status;
    END IF;

    -- 4. Lecture des paramètres de durée de séjour
    SELECT * INTO v_settings FROM public.app_settings WHERE id = 1;
    v_expires_at := p_sold_at + make_interval(hours => COALESCE(v_settings.standard_stay_hours, 24));
    v_clean_plate := upper(regexp_replace(trim(p_truck_plate), '\s+', '-', 'g'));

    -- 5. Statut selon mode de règlement (Espèces confirmé d'office, Mobile Money confirmé si réf fournie ou mis en attente)
    IF p_payment_method = 'ESPECES' OR (p_mobile_money_ref IS NOT NULL AND length(trim(p_mobile_money_ref)) >= 4) THEN
        v_payment_confirmed := TRUE;
        v_new_ticket_status := 'SEJOUR_ACTIF';
    ELSE
        v_payment_confirmed := FALSE;
        v_new_ticket_status := 'EN_ATTENTE_PAIEMENT_MM';
    END IF;

    -- 6. Insertion de la perception (sale)
    INSERT INTO public.sales (
        idempotency_key,
        ticket_id,
        ticket_number,
        sector_id,
        agent_id,
        truck_plate,
        trailer_plate,
        driver_name,
        driver_phone,
        transport_company,
        country_origin,
        contribution_amount_fcfa,
        payment_method,
        mobile_money_ref,
        payment_confirmed,
        payment_confirmed_at,
        sold_at,
        max_stay_expires_at,
        gps_lat,
        gps_lng,
        offline_created
    ) VALUES (
        p_idempotency_key,
        v_ticket.id,
        v_ticket.ticket_number,
        v_ticket.sector_id,
        v_agent.id,
        v_clean_plate,
        NULLIF(upper(trim(COALESCE(p_trailer_plate, ''))), ''),
        NULLIF(trim(COALESCE(p_driver_name, '')), ''),
        NULLIF(trim(COALESCE(p_driver_phone, '')), ''),
        NULLIF(trim(COALESCE(p_transport_company, '')), ''),
        COALESCE(p_country_origin, 'CI'),
        v_ticket.contribution_amount_fcfa,
        p_payment_method,
        NULLIF(trim(COALESCE(p_mobile_money_ref, '')), ''),
        v_payment_confirmed,
        CASE WHEN v_payment_confirmed THEN NOW() ELSE NULL END,
        p_sold_at,
        v_expires_at,
        p_gps_lat,
        p_gps_lng,
        p_offline_created
    )
    RETURNING id INTO v_sale_id;

    -- 7. Mise à jour du ticket
    UPDATE public.tickets
    SET status = v_new_ticket_status,
        assigned_agent_id = COALESCE(assigned_agent_id, v_agent.id),
        activated_at = p_sold_at,
        updated_at = NOW()
    WHERE id = v_ticket.id;

    -- 8. Notifications automatiques au RESPONSABLE_SECTEUR du secteur concerné
    INSERT INTO public.notifications (
        recipient_id,
        target_role,
        sector_id,
        category,
        title,
        message,
        metadata
    )
    SELECT
        p.id,
        'RESPONSABLE_SECTEUR',
        v_ticket.sector_id,
        'PERCEPTION_CONTRIBUTION',
        'Nouvelle Contribution d''Assistance perçue (' || v_ticket.ticket_number || ')',
        'Camion ' || v_clean_plate || ' enregistré par ' || v_agent.full_name || ' (' || v_agent.callsign || ') — ' || v_ticket.contribution_amount_fcfa || ' FCFA (' || p_payment_method || '). Fin de séjour autorisé : ' || to_char(v_expires_at AT TIME ZONE 'UTC', 'DD/MM HH24:MI') || ' UTC.',
        jsonb_build_object(
            'sale_id', v_sale_id,
            'ticket_number', v_ticket.ticket_number,
            'truck_plate', v_clean_plate,
            'amount_fcfa', v_ticket.contribution_amount_fcfa,
            'payment_method', p_payment_method,
            'agent_callsign', v_agent.callsign
        )
    FROM public.profiles p
    WHERE p.role = 'RESPONSABLE_SECTEUR'
      AND p.sector_id = v_ticket.sector_id
      AND p.is_active = TRUE;

    -- 9. Notification automatique à l'ADMIN_PROJET
    INSERT INTO public.notifications (
        recipient_id,
        target_role,
        sector_id,
        category,
        title,
        message,
        metadata
    )
    SELECT
        p.id,
        'ADMIN_PROJET',
        v_ticket.sector_id,
        'PERCEPTION_CONTRIBUTION',
        'Perception Secteur — Ticket ' || v_ticket.ticket_number,
        'Contribution d''Assistance et de Sécurisation (' || v_ticket.contribution_amount_fcfa || ' FCFA) validée sur le camion ' || v_clean_plate || ' par ' || v_agent.matricule || '.',
        jsonb_build_object(
            'sale_id', v_sale_id,
            'ticket_number', v_ticket.ticket_number,
            'truck_plate', v_clean_plate,
            'amount_fcfa', v_ticket.contribution_amount_fcfa,
            'offline_created', p_offline_created
        )
    FROM public.profiles p
    WHERE p.role = 'ADMIN_PROJET'
      AND p.is_active = TRUE;

    -- 10. Trace dans audit_logs
    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        sector_id,
        action,
        entity_table,
        entity_id,
        payload
    ) VALUES (
        v_agent.id,
        v_agent.role,
        v_ticket.sector_id,
        'PERCEPTION_CONTRIBUTION_ASSISTANCE',
        'sales',
        v_sale_id::TEXT,
        jsonb_build_object(
            'ticket_number', v_ticket.ticket_number,
            'truck_plate', v_clean_plate,
            'amount_fcfa', v_ticket.contribution_amount_fcfa,
            'payment_method', p_payment_method,
            'max_stay_expires_at', v_expires_at,
            'offline_created', p_offline_created
        )
    );

    RETURN jsonb_build_object(
        'status', 'CREATED',
        'sale_id', v_sale_id,
        'ticket_id', v_ticket.id,
        'ticket_number', v_ticket.ticket_number,
        'truck_plate', v_clean_plate,
        'ticket_status', v_new_ticket_status,
        'max_stay_expires_at', v_expires_at,
        'payment_confirmed', v_payment_confirmed
    );
END;
$$;

-- 5.2 RPC : verify_ticket
-- Contrôle routier anti-fraude d'un ticket sur le corridor de Vridi.
-- Bascule automatiquement le camion en "EN_ATTENTE_REGULARISATION" si la durée de séjour autorisée est dépassée.
CREATE OR REPLACE FUNCTION public.verify_ticket(
    p_ticket_number TEXT,
    p_controller_id UUID,
    p_observed_plate TEXT,
    p_ed25519_verified BOOLEAN DEFAULT TRUE,
    p_gps_lat NUMERIC DEFAULT NULL,
    p_gps_lng NUMERIC DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket public.tickets%ROWTYPE;
    v_sale public.sales%ROWTYPE;
    v_controller public.profiles%ROWTYPE;
    v_settings public.app_settings%ROWTYPE;
    v_verdict public.control_verdict;
    v_action_taken TEXT;
    v_clean_observed TEXT;
    v_report_id UUID;
    v_overstay_hours NUMERIC(8,2) := 0;
BEGIN
    SELECT * INTO v_controller FROM public.profiles WHERE id = p_controller_id AND is_active = TRUE;
    IF NOT FOUND OR NOT v_controller.peut_controler THEN
        RAISE EXCEPTION 'HABILITATION REFUSÉE : Cet agent n''est pas habilité au contrôle routier.';
    END IF;

    SELECT * INTO v_settings FROM public.app_settings WHERE id = 1;
    v_clean_observed := upper(regexp_replace(trim(p_observed_plate), '\s+', '-', 'g'));

    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE ticket_number = trim(upper(p_ticket_number));

    -- Cas 1 : Signature cryptographique Ed25519 invalide détectée par le terminal
    IF NOT p_ed25519_verified THEN
        v_verdict := 'SIGNATURE_CRYPTO_INVALIDE';
        v_action_taken := 'Ticket falsifié — Camion placé En attente de régularisation immédiate';
    -- Cas 2 : Ticket inconnu en base
    ELSIF NOT FOUND THEN
        v_verdict := 'TICKET_INCONNU_OU_NON_SYNCHRONISE';
        v_action_taken := 'Vérification radio requise — En attente de régularisation';
    ELSE
        SELECT * INTO v_sale FROM public.sales WHERE ticket_id = v_ticket.id;

        IF NOT FOUND THEN
            v_verdict := 'TICKET_INCONNU_OU_NON_SYNCHRONISE';
            v_action_taken := 'Ticket non activé en base — En attente de régularisation';
        ELSIF v_ticket.status = 'SORTIE_DECLAREE' OR v_sale.exited_at IS NOT NULL THEN
            v_verdict := 'TICKET_DEJA_SORTI';
            v_action_taken := 'Tentative de réutilisation d''un ticket clôturé — En attente de régularisation';
        ELSIF NOT v_sale.payment_confirmed OR v_ticket.status = 'EN_ATTENTE_PAIEMENT_MM' THEN
            v_verdict := 'PAIEMENT_MM_NON_CONFIRME';
            v_action_taken := 'Règlement Mobile Money non confirmé — En attente de régularisation';
        ELSIF v_sale.truck_plate <> v_clean_observed THEN
            v_verdict := 'PLAQUE_NON_CONFORME';
            v_action_taken := 'Discordance de plaque (' || v_sale.truck_plate || ' vs ' || v_clean_observed || ') — En attente de régularisation';
        ELSIF NOW() > (v_sale.max_stay_expires_at + make_interval(mins => COALESCE(v_settings.grace_period_minutes, 60))) THEN
            v_verdict := 'DEPASSEMENT_DUREE_EN_ATTENTE_REGULARISATION';
            v_overstay_hours := ROUND(EXTRACT(EPOCH FROM (NOW() - v_sale.max_stay_expires_at)) / 3600.0, 2);
            v_action_taken := 'Dépassement de durée de séjour (+' || v_overstay_hours || 'h) — Camion placé En attente de régularisation';

            UPDATE public.tickets
            SET status = 'EN_ATTENTE_REGULARISATION',
                updated_at = NOW()
            WHERE id = v_ticket.id;
        ELSE
            v_verdict := 'CONFORME_ACTIF';
            v_action_taken := 'Séjour régulier — Assistance et sécurisation actives';
        END IF;
    END IF;

    -- Enregistrement du rapport de contrôle
    INSERT INTO public.fraud_reports (
        ticket_id,
        ticket_number_scanned,
        controller_id,
        sector_id,
        observed_truck_plate,
        verdict,
        action_taken,
        ed25519_verified,
        gps_lat,
        gps_lng,
        notes
    ) VALUES (
        v_ticket.id,
        trim(upper(p_ticket_number)),
        v_controller.id,
        COALESCE(v_ticket.sector_id, v_controller.sector_id),
        v_clean_observed,
        v_verdict,
        v_action_taken,
        p_ed25519_verified,
        p_gps_lat,
        p_gps_lng,
        p_notes
    )
    RETURNING id INTO v_report_id;

    -- Si anomalie ou mise en attente de régularisation, alerter le Responsable de Secteur
    IF v_verdict <> 'CONFORME_ACTIF' THEN
        INSERT INTO public.notifications (
            recipient_id,
            target_role,
            sector_id,
            category,
            title,
            message,
            metadata
        )
        SELECT
            p.id,
            'RESPONSABLE_SECTEUR',
            COALESCE(v_ticket.sector_id, v_controller.sector_id),
            CASE WHEN v_verdict = 'DEPASSEMENT_DUREE_EN_ATTENTE_REGULARISATION' THEN 'ALERTE_REGULARISATION' ELSE 'FRAUDE_DETECTEE' END,
            'Contrôle : ' || v_clean_observed || ' — En attente de régularisation',
            v_action_taken || ' (Contrôleur : ' || v_controller.callsign || ').',
            jsonb_build_object(
                'report_id', v_report_id,
                'ticket_number', p_ticket_number,
                'observed_plate', v_clean_observed,
                'verdict', v_verdict
            )
        FROM public.profiles p
        WHERE p.role IN ('RESPONSABLE_SECTEUR', 'SUPERVISEUR_UJPAS')
          AND (p.sector_id = COALESCE(v_ticket.sector_id, v_controller.sector_id) OR p.role = 'SUPERVISEUR_UJPAS')
          AND p.is_active = TRUE;
    END IF;

    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        sector_id,
        action,
        entity_table,
        entity_id,
        payload
    ) VALUES (
        v_controller.id,
        v_controller.role,
        COALESCE(v_ticket.sector_id, v_controller.sector_id),
        'CONTROLE_ROUTIER_TICKET',
        'fraud_reports',
        v_report_id::TEXT,
        jsonb_build_object(
            'ticket_number', p_ticket_number,
            'observed_plate', v_clean_observed,
            'verdict', v_verdict,
            'action_taken', v_action_taken
        )
    );

    RETURN jsonb_build_object(
        'report_id', v_report_id,
        'ticket_number', p_ticket_number,
        'registered_plate', v_sale.truck_plate,
        'observed_plate', v_clean_observed,
        'verdict', v_verdict,
        'status_label', CASE WHEN v_verdict = 'CONFORME_ACTIF' THEN 'Séjour régulier' ELSE 'En attente de régularisation' END,
        'action_taken', v_action_taken,
        'sold_at', v_sale.sold_at,
        'max_stay_expires_at', v_sale.max_stay_expires_at,
        'overstay_hours', v_overstay_hours
    );
END;
$$;

-- 5.3 RPC : declare_exit
-- Déclare la sortie effective d'un poids lourd du corridor de Vridi et libère la capacité du secteur.
CREATE OR REPLACE FUNCTION public.declare_exit(
    p_ticket_number TEXT,
    p_agent_id UUID,
    p_gps_lat NUMERIC DEFAULT NULL,
    p_gps_lng NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket public.tickets%ROWTYPE;
    v_sale public.sales%ROWTYPE;
    v_agent public.profiles%ROWTYPE;
    v_stay_hours NUMERIC(8,2);
BEGIN
    SELECT * INTO v_agent FROM public.profiles WHERE id = p_agent_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agent non autorisé.';
    END IF;

    SELECT * INTO v_ticket
    FROM public.tickets
    WHERE ticket_number = trim(upper(p_ticket_number))
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket % introuvable.', p_ticket_number;
    END IF;

    SELECT * INTO v_sale
    FROM public.sales
    WHERE ticket_id = v_ticket.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Aucune perception associée au ticket %.', p_ticket_number;
    END IF;

    IF v_ticket.status = 'SORTIE_DECLAREE' THEN
        RETURN jsonb_build_object(
            'status', 'ALREADY_EXITED',
            'ticket_number', v_ticket.ticket_number,
            'truck_plate', v_sale.truck_plate,
            'exited_at', v_sale.exited_at
        );
    END IF;

    UPDATE public.tickets
    SET status = 'SORTIE_DECLAREE',
        exited_at = NOW(),
        updated_at = NOW()
    WHERE id = v_ticket.id;

    UPDATE public.sales
    SET exited_at = NOW(),
        exit_declared_by = v_agent.id
    WHERE id = v_sale.id;

    v_stay_hours := ROUND(EXTRACT(EPOCH FROM (NOW() - v_sale.sold_at)) / 3600.0, 2);

    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        sector_id,
        action,
        entity_table,
        entity_id,
        payload
    ) VALUES (
        v_agent.id,
        v_agent.role,
        v_ticket.sector_id,
        'SORTIE_CORRIDOR_CAMION',
        'sales',
        v_sale.id::TEXT,
        jsonb_build_object(
            'ticket_number', v_ticket.ticket_number,
            'truck_plate', v_sale.truck_plate,
            'stay_duration_hours', v_stay_hours,
            'gps_lat', p_gps_lat,
            'gps_lng', p_gps_lng
        )
    );

    RETURN jsonb_build_object(
        'status', 'EXIT_RECORDED',
        'ticket_number', v_ticket.ticket_number,
        'truck_plate', v_sale.truck_plate,
        'stay_duration_hours', v_stay_hours,
        'exited_at', NOW()
    );
END;
$$;

-- 5.4 RPC : confirm_mobile_payment
-- Confirme une transaction Mobile Money (Wave, Orange Money, MTN, Moov) et active le séjour du camion.
CREATE OR REPLACE FUNCTION public.confirm_mobile_payment(
    p_ticket_number TEXT,
    p_mobile_money_ref TEXT,
    p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale public.sales%ROWTYPE;
    v_actor public.profiles%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Opérateur non identifié.';
    END IF;

    IF p_mobile_money_ref IS NULL OR length(trim(p_mobile_money_ref)) < 4 THEN
        RAISE EXCEPTION 'Référence de transaction Mobile Money invalide.';
    END IF;

    SELECT * INTO v_sale
    FROM public.sales
    WHERE ticket_number = trim(upper(p_ticket_number))
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Aucune perception trouvée pour le ticket %.', p_ticket_number;
    END IF;

    UPDATE public.sales
    SET mobile_money_ref = trim(upper(p_mobile_money_ref)),
        payment_confirmed = TRUE,
        payment_confirmed_at = NOW()
    WHERE id = v_sale.id;

    UPDATE public.tickets
    SET status = 'SEJOUR_ACTIF',
        updated_at = NOW()
    WHERE id = v_sale.ticket_id;

    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        sector_id,
        action,
        entity_table,
        entity_id,
        payload
    ) VALUES (
        v_actor.id,
        v_actor.role,
        v_sale.sector_id,
        'CONFIRMATION_MOBILE_MONEY',
        'sales',
        v_sale.id::TEXT,
        jsonb_build_object(
            'ticket_number', v_sale.ticket_number,
            'mobile_money_ref', trim(upper(p_mobile_money_ref)),
            'payment_method', v_sale.payment_method
        )
    );

    RETURN jsonb_build_object(
        'status', 'CONFIRMED',
        'sale_id', v_sale.id,
        'ticket_number', v_sale.ticket_number,
        'mobile_money_ref', trim(upper(p_mobile_money_ref)),
        'confirmed_at', NOW()
    );
END;
$$;

-- 5.5 RPC : report_incident
-- Déclare un incident de sécurité ou d'assistance sur le corridor de Vridi et diffuse l'alerte aux superviseurs.
CREATE OR REPLACE FUNCTION public.report_incident(
    p_reported_by UUID,
    p_sector_id UUID,
    p_incident_type public.incident_type,
    p_severity public.incident_severity,
    p_title TEXT,
    p_description TEXT,
    p_truck_plate TEXT DEFAULT NULL,
    p_gps_lat NUMERIC DEFAULT NULL,
    p_gps_lng NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reporter public.profiles%ROWTYPE;
    v_incident_id UUID;
    v_incident_code TEXT;
BEGIN
    SELECT * INTO v_reporter FROM public.profiles WHERE id = p_reported_by AND is_active = TRUE;
    IF NOT FOUND OR NOT v_reporter.peut_signaler THEN
        RAISE EXCEPTION 'HABILITATION REFUSÉE : Cet agent ne peut pas déclarer d''incident.';
    END IF;

    v_incident_code := 'INC-' || to_char(NOW(), 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 4));

    INSERT INTO public.incidents (
        incident_code,
        sector_id,
        reported_by,
        incident_type,
        severity,
        truck_plate,
        title,
        description,
        gps_lat,
        gps_lng
    ) VALUES (
        v_incident_code,
        p_sector_id,
        v_reporter.id,
        p_incident_type,
        p_severity,
        NULLIF(upper(trim(COALESCE(p_truck_plate, ''))), ''),
        trim(p_title),
        trim(p_description),
        p_gps_lat,
        p_gps_lng
    )
    RETURNING id INTO v_incident_id;

    -- Alerte immédiate au Responsable de Secteur, Superviseur UJPAS et Admin Projet
    INSERT INTO public.notifications (
        recipient_id,
        target_role,
        sector_id,
        category,
        title,
        message,
        metadata
    )
    SELECT
        p.id,
        p.role,
        p_sector_id,
        'INCIDENT_SECURITE',
        '[' || p_severity || '] ' || trim(p_title),
        'Signalé par ' || v_reporter.full_name || ' (' || v_reporter.callsign || ') : ' || trim(p_description),
        jsonb_build_object(
            'incident_id', v_incident_id,
            'incident_code', v_incident_code,
            'severity', p_severity,
            'incident_type', p_incident_type,
            'truck_plate', p_truck_plate
        )
    FROM public.profiles p
    WHERE p.is_active = TRUE
      AND (
          p.role IN ('ADMIN_PROJET', 'SUPERVISEUR_UJPAS')
          OR (p.role = 'RESPONSABLE_SECTEUR' AND p.sector_id = p_sector_id)
      );

    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        sector_id,
        action,
        entity_table,
        entity_id,
        payload
    ) VALUES (
        v_reporter.id,
        v_reporter.role,
        p_sector_id,
        'SIGNALEMENT_INCIDENT_CORRIDOR',
        'incidents',
        v_incident_id::TEXT,
        jsonb_build_object(
            'incident_code', v_incident_code,
            'severity', p_severity,
            'incident_type', p_incident_type,
            'truck_plate', p_truck_plate
        )
    );

    RETURN jsonb_build_object(
        'status', 'REPORTED',
        'incident_id', v_incident_id,
        'incident_code', v_incident_code,
        'severity', p_severity,
        'created_at', NOW()
    );
END;
$$;

-- 5.6 RPC : ack_notification
-- Accuse réception d'une notification opérationnelle.
CREATE OR REPLACE FUNCTION public.ack_notification(
    p_notification_id UUID,
    p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_notif public.notifications%ROWTYPE;
BEGIN
    UPDATE public.notifications
    SET is_read = TRUE,
        acknowledged_at = NOW(),
        acknowledged_by = p_actor_id
    WHERE id = p_notification_id
    RETURNING * INTO v_notif;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Notification % introuvable.', p_notification_id;
    END IF;

    RETURN jsonb_build_object(
        'status', 'ACKNOWLEDGED',
        'notification_id', v_notif.id,
        'acknowledged_at', v_notif.acknowledged_at
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. DONNÉES DE SEED (DÉMO EXÉCUTABLE : 4 SECTEURS, 5 RÔLES, 1 LOT, 1 TICKET)
-- -----------------------------------------------------------------------------

-- 6.1 Paramètres globaux UJPAS Vridi (Clé publique Ed25519 déterministe de référence)
INSERT INTO public.app_settings (
    id,
    organization_name,
    contribution_label,
    pending_regularization_label,
    default_contribution_fcfa,
    standard_stay_hours,
    grace_period_minutes,
    ed25519_public_key_hex,
    key_version,
    emergency_radio_channel,
    support_phone
) VALUES (
    1,
    'UJPAS — Union des Jeunes du Port pour l''Assistance et la Sécurisation (Vridi)',
    'Contribution d''Assistance et de Sécurisation',
    'En attente de régularisation',
    2500,
    24,
    60,
    'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    1,
    'CANAL 16 — VRIDI SECOURS (446.09375 MHz)',
    '+225 07 07 88 99 00'
) ON CONFLICT (id) DO UPDATE SET
    contribution_label = EXCLUDED.contribution_label,
    pending_regularization_label = EXCLUDED.pending_regularization_label,
    ed25519_public_key_hex = EXCLUDED.ed25519_public_key_hex;

-- 6.2 Les 4 Secteurs du Corridor Portuaire de Vridi (Abidjan)
INSERT INTO public.sectors (id, code, name, corridor_zone, gps_lat, gps_lng, radius_meters, max_capacity_trucks)
VALUES
    ('11111111-1111-4111-8111-111111111101', 'VRD-SEC-01', 'Secteur 1 — Terminal à Conteneurs TC1 / TC2', 'Boulevard du Port — Accès Sud TC1/TC2', 5.259400, -4.012800, 750, 160),
    ('11111111-1111-4111-8111-111111111102', 'VRD-SEC-02', 'Secteur 2 — Rond-Point Anani & Tri Postal', 'Axe Central Vridi — Zone Logistique', 5.264100, -4.001500, 650, 140),
    ('11111111-1111-4111-8111-111111111103', 'VRD-SEC-03', 'Secteur 3 — Zone Hydrocarbures SIR / GESTOCI', 'Corridor Pétrolier Est — Dépôts SIR', 5.257800, -3.989200, 800, 110),
    ('11111111-1111-4111-8111-111111111104', 'VRD-SEC-04', 'Secteur 4 — Canal de Vridi & Port de Pêche', 'Quai Ouest & Attente Embarquement', 5.253200, -4.021900, 600, 95)
ON CONFLICT (code) DO NOTHING;

-- 6.3 Les 5 Comptes de test couvrant les 5 rôles avec permissions cumulables et indicatifs radio
INSERT INTO public.profiles (
    id, matricule, full_name, phone, role, sector_id, callsign,
    peut_vendre, peut_controler, peut_signaler, pin_hash, is_active
) VALUES
    (
        '22222222-2222-4222-8222-222222222201',
        'UJPAS-ADM-001',
        'Kouassi Jean-Marc Bédié',
        '+2250701000001',
        'ADMIN_PROJET',
        '11111111-1111-4111-8111-111111111101',
        'AIGLE-VRIDI-01',
        TRUE, TRUE, TRUE,
        '1234',
        TRUE
    ),
    (
        '22222222-2222-4222-8222-222222222202',
        'UJPAS-SUP-001',
        'Ouattara Ibrahim Sory',
        '+2250701000002',
        'SUPERVISEUR_UJPAS',
        '11111111-1111-4111-8111-111111111101',
        'CONDOR-UJPAS-01',
        TRUE, TRUE, TRUE,
        '2222',
        TRUE
    ),
    (
        '22222222-2222-4222-8222-222222222203',
        'UJPAS-CHEF-101',
        'Yao Koffi Aristide',
        '+2250701000003',
        'RESPONSABLE_SECTEUR',
        '11111111-1111-4111-8111-111111111101',
        'ALPHA-TC1-CHEF',
        TRUE, TRUE, TRUE,
        '3333',
        TRUE
    ),
    (
        '22222222-2222-4222-8222-222222222204',
        'UJPAS-AGT-408',
        'Koné Souleymane',
        '+2250701000004',
        'AGENT_TERRAIN',
        '11111111-1111-4111-8111-111111111101',
        'VIGIE-TC1-08',
        TRUE, TRUE, TRUE,
        '4444',
        TRUE
    ),
    (
        '22222222-2222-4222-8222-222222222205',
        'UJPAS-AUD-009',
        'Aka Marie-Paule Épse N''Guessan',
        '+2250701000005',
        'AUDITEUR_INSTITUTIONNEL',
        NULL,
        'OBSERVATEUR-PAA-09',
        FALSE, TRUE, FALSE,
        '5555',
        TRUE
    )
ON CONFLICT (id) DO NOTHING;

-- 6.4 Badge professionnel signé Ed25519 pour l'Agent Terrain Koné Souleymane
INSERT INTO public.badges (
    id, badge_number, profile_id, sector_id, ed25519_signature_hex, qr_payload, expires_at, issued_by
) VALUES (
    '33333333-3333-4333-8333-333333333301',
    'BDG-UJPAS-2026-0408',
    '22222222-2222-4222-8222-222222222204',
    '11111111-1111-4111-8111-111111111101',
    '8f4e2b9a1c6d3e7f0a5b8c2d4e6f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d1e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e1f3a00',
    'PORTUS-BADGE|v1|BDG-UJPAS-2026-0408|UJPAS-AGT-408|VRD-SEC-01|VIGIE-TC1-08',
    NOW() + INTERVAL '365 days',
    '22222222-2222-4222-8222-222222222201'
) ON CONFLICT (badge_number) DO NOTHING;

-- 6.5 Lot de carnets de tickets (Carnet #01 du Secteur 1 TC1/TC2 : séries 100001 à 100050)
INSERT INTO public.ticket_batches (
    id, batch_code, sector_id, assigned_supervisor_id, assigned_agent_id,
    serial_start, serial_end, unit_contribution_fcfa, key_version, status, printed_by
) VALUES (
    '44444444-4444-4444-8444-444444444401',
    'CARNET-VRD01-2026-001',
    '11111111-1111-4111-8111-111111111101',
    '22222222-2222-4222-8222-222222222203',
    '22222222-2222-4222-8222-222222222204',
    100001,
    100050,
    2500,
    1,
    'ASSIGNE_AGENT',
    '22222222-2222-4222-8222-222222222201'
) ON CONFLICT (batch_code) DO NOTHING;

-- 6.6 Journal de chaîne de garde correspondant à la dotation du lot
INSERT INTO public.custody_logs (
    id, batch_id, from_profile_id, to_profile_id, sector_id, action_type, serial_from, serial_to, handover_note
) VALUES (
    '55555555-5555-4555-8555-555555555501',
    '44444444-4444-4444-8444-444444444401',
    '22222222-2222-4222-8222-222222222203',
    '22222222-2222-4222-8222-222222222204',
    '11111111-1111-4111-8111-111111111101',
    'REMISE_AGENT',
    100001,
    100050,
    'Dotation matinale Quart 06h-14h — Terminal à Conteneurs TC1'
) ON CONFLICT (id) DO NOTHING;

-- 6.7 Ticket de test prêt à l'emploi (assigné à l'agent Koné Souleymane, prêt pour perception ou contrôle)
INSERT INTO public.tickets (
    id, ticket_number, serial_number, batch_id, sector_id, assigned_agent_id,
    contribution_amount_fcfa, status, ed25519_signature_hex, key_version, qr_static_payload
) VALUES (
    '66666666-6666-4666-8666-666666666601',
    'UJPAS-VRD01-100001',
    100001,
    '44444444-4444-4444-8444-444444444401',
    '11111111-1111-4111-8111-111111111101',
    '22222222-2222-4222-8222-222222222204',
    2500,
    'ASSIGNE_AGENT',
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    1,
    'PORTUS|v1|UJPAS-VRD01-100001|100001|VRD-SEC-01|2500|e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
) ON CONFLICT (ticket_number) DO NOTHING;

COMMIT;
