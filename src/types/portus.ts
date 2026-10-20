/**
 * PORTUS — UJPAS (Union des Jeunes du Port pour l'Assistance et la Sécurité)
 * Modèles de domaine TypeScript stricts alignés sur schema.sql (Phase 1)
 *
 * RÈGLE DE CONFORMITÉ TERMINOLOGIQUE :
 * Usage exclusif de "Contribution d'Assistance et de Sécurisation"
 * et "En attente de régularisation".
 */

// ============================================================================
// ENUMS CANONIQUES SUPABASE DDL (Source de Vérité - Schéma Phase 1 Validé)
// ============================================================================
export type DdlUserRole =
  | 'ADMINISTRATEUR'
  | 'RESPONSABLE'
  | 'AGENT'
  | 'CONTROLEUR'
  | 'AUDITEUR';

export type DdlTicketStatus =
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'SOLD'
  | 'CLOSED'
  | 'CANCELLED';

export type DdlPaymentMethod = 'CASH' | 'MOBILE_MONEY';

export type DdlMobilePaymentStatus =
  | 'NOT_APPLICABLE'
  | 'A_CONFIRMER'
  | 'CONFIRME'
  | 'REJETE';

export type UserRole =
  | DdlUserRole
  | 'ADMIN_PROJET'
  | 'SUPERVISEUR_UJPAS'
  | 'RESPONSABLE_SECTEUR'
  | 'AGENT_TERRAIN'
  | 'AUDITEUR_INSTITUTIONNEL';

export type TicketStatus =
  | DdlTicketStatus
  | 'IMPRIME'
  | 'ASSIGNE_SECTEUR'
  | 'ASSIGNE_AGENT'
  | 'SEJOUR_ACTIF'
  | 'EN_ATTENTE_PAIEMENT_MM'
  | 'EN_ATTENTE_REGULARISATION'
  | 'SORTIE_DECLAREE'
  | 'EXPIRE'
  | 'ANNULE_FRAUDE';

export type PaymentMethod =
  | DdlPaymentMethod
  | 'ESPECES'
  | 'WAVE'
  | 'ORANGE_MONEY'
  | 'MTN_MOMO'
  | 'MOOV_MONEY';

export type ControlVerdict =
  | 'CONFORME_ACTIF'
  | 'DEPASSEMENT_DUREE_EN_ATTENTE_REGULARISATION'
  | 'PLAQUE_NON_CONFORME'
  | 'SIGNATURE_CRYPTO_INVALIDE'
  | 'TICKET_DEJA_SORTI'
  | 'TICKET_INCONNU_OU_NON_SYNCHRONISE'
  | 'PAIEMENT_MM_NON_CONFIRME';

export type IncidentType =
  | 'PANNE_CAMION_OBSTRUCTION'
  | 'ACCIDENT_CORRIDOR'
  | 'TENTATIVE_CORRUPTION_OU_FALSIFICATION'
  | 'LITIGE_CHAUFFEUR_ASSISTANCE'
  | 'AGRESSION_SECURITE'
  | 'CONGESTION_CRITIQUE_TERMINAL'
  | 'AUTRE_ASSISTANCE';

export type IncidentSeverity =
  | 'MINEUR'
  | 'MODERE'
  | 'CRITIQUE'
  | 'URGENCE_ABSOLUE';

export interface AppSettings {
  id: number;
  organization_name: string;
  contribution_label: string;
  pending_regularization_label: string;
  default_contribution_fcfa: number;
  standard_stay_hours: number;
  grace_period_minutes: number;
  ed25519_public_key_hex: string;
  key_version: number;
  emergency_radio_channel: string;
  support_phone: string;
  updated_at: string;
}

export interface Sector {
  id: string;
  code: string;
  name: string;
  corridor_zone: string;
  gps_lat: number;
  gps_lng: number;
  radius_meters: number;
  max_capacity_trucks: number;
  is_active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  matricule: string;
  full_name: string;
  phone: string;
  role: UserRole;
  sector_id: string | null;
  callsign: string;
  peut_vendre: boolean;
  peut_controler: boolean;
  peut_signaler: boolean;
  pin_hash: string;
  photo_url?: string | null;
  is_active: boolean;
  last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Badge {
  id: string;
  badge_number: string;
  profile_id: string;
  sector_id: string | null;
  ed25519_signature_hex: string;
  qr_payload: string;
  issued_at: string;
  expires_at: string;
  is_revoked: boolean;
  revoked_reason?: string | null;
  revoked_at?: string | null;
  issued_by?: string | null;
}

export interface TicketBatch {
  id: string;
  batch_code: string;
  sector_id: string;
  assigned_supervisor_id?: string | null;
  assigned_agent_id?: string | null;
  serial_start: number;
  serial_end: number;
  ticket_count: number;
  unit_contribution_fcfa: number;
  key_version: number;
  status: 'IMPRIME' | 'ASSIGNE_SECTEUR' | 'ASSIGNE_AGENT' | 'EPUISE' | 'ARCHIVE';
  printed_by?: string | null;
  printed_at: string;
  created_at: string;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  serial_number: number;
  batch_id: string;
  sector_id: string;
  assigned_agent_id?: string | null;
  contribution_amount_fcfa: number;
  status: TicketStatus;
  ed25519_signature_hex: string;
  key_version: number;
  qr_static_payload: string;
  activated_at?: string | null;
  exited_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sale {
  id: string;
  idempotency_key: string;
  ticket_id: string;
  ticket_number: string;
  sector_id: string;
  agent_id: string;
  truck_plate: string;
  trailer_plate?: string | null;
  container_number?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  driver_phone_secondary?: string | null;
  transport_company?: string | null;
  country_origin: 'CI' | 'BF' | 'ML' | 'NE' | 'GH' | 'TG' | 'BJ' | 'GN' | 'SN' | 'AUTRE';
  contribution_amount_fcfa: number;
  payment_method: PaymentMethod;
  mobile_money_ref?: string | null;
  mobile_money_screenshot_data_url?: string | null;
  mobile_money_screenshot_kb?: number | null;
  colleague_override_reason?: string | null;
  payment_confirmed: boolean;
  payment_confirmed_at?: string | null;
  mobile_money_validation_status?: 'A_CONFIRMER' | 'CONFIRME' | 'REJETE';
  mobile_money_rejection_reason?: string | null;
  sold_at: string;
  max_stay_expires_at: string;
  exited_at?: string | null;
  exit_declared_by?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  offline_created: boolean;
  synced_at: string;
  remittance_id?: string | null;
}

export interface Remittance {
  id: string;
  remittance_code: string;
  sector_id: string;
  agent_id: string;
  received_by: string;
  tickets_assigned_count: number;
  sales_count: number;
  tickets_remaining_count: number;
  tickets_lost_count: number;
  lost_tickets_explanation?: string | null;
  expected_cash_fcfa: number;
  declared_cash_fcfa: number;
  mobile_money_total_fcfa: number;
  variance_fcfa: number;
  period_start: string;
  period_end: string;
  notes?: string | null;
  status?: 'EN_ATTENTE_RESPONSABLE' | 'VALIDE_RESPONSABLE' | 'REJETE';
  supervisor_confirmed_by?: string | null;
  supervisor_confirmed_at?: string | null;
  supervisor_notes?: string | null;
  created_at: string;
}

export interface TreasuryDeposit {
  id: string;
  deposit_reference: string;
  sector_id: string;
  deposited_by: string;
  verified_by?: string | null;
  bank_or_institution: string;
  slip_number: string;
  amount_fcfa: number;
  slip_photo_url?: string | null;
  status: 'DECLARE' | 'VERIFIE' | 'ECART_SIGNALE';
  deposited_at: string;
  created_at: string;
}

export interface ShiftHandover {
  id: string;
  sector_id: string;
  shift_period: 'JOUR' | 'NUIT';
  outgoing_agent_id: string;
  incoming_agent_id: string;
  supervisor_id?: string | null;
  active_trucks_count: number;
  pending_regularization_count: number;
  remaining_tickets_serial_start?: number | null;
  remaining_tickets_serial_end?: number | null;
  cash_handed_over_fcfa: number;
  handover_summary: string;
  handed_over_at: string;
}

export interface FraudReport {
  id: string;
  ticket_id?: string | null;
  ticket_number_scanned: string;
  controller_id: string;
  sector_id: string;
  observed_truck_plate: string;
  verdict: ControlVerdict;
  action_taken: string;
  ed25519_verified: boolean;
  gps_lat?: number | null;
  gps_lng?: number | null;
  notes?: string | null;
  controlled_at: string;
}

export interface Incident {
  id: string;
  incident_code: string;
  sector_id: string;
  reported_by: string;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  truck_plate?: string | null;
  title: string;
  description: string;
  reported_via_walkie_talkie?: boolean;
  walkie_talkie_callsign?: string | null;
  photo_data_url?: string | null;
  photo_size_kb?: number | null;
  status: 'OUVERT' | 'EN_INTERVENTION' | 'RESOLU' | 'CLOS';
  resolution_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  created_at: string;
}

export type NotificationCategory =
  | 'PERCEPTION_CONTRIBUTION'
  | 'ALERTE_REGULARISATION'
  | 'INCIDENT_SECURITE'
  | 'FRAUDE_DETECTEE'
  | 'VERSEMENT_CAISSE'
  | 'SYSTEME';

export interface AppNotification {
  id: string;
  recipient_id?: string | null;
  target_role?: UserRole | null;
  sector_id?: string | null;
  category: NotificationCategory;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id?: string | null;
  actor_role?: UserRole | null;
  sector_id?: string | null;
  action: string;
  entity_table: string;
  entity_id: string;
  payload: Record<string, unknown>;
  ip_or_device?: string | null;
  created_at: string;
}

export type MutationOperationType =
  | 'SYNC_SALE'
  | 'VERIFY_TICKET'
  | 'DECLARE_EXIT'
  | 'CONFIRM_MOBILE_PAYMENT'
  | 'REPORT_INCIDENT'
  | 'ACK_NOTIFICATION';

export type MutationStatus = 'PENDING' | 'SYNCING' | 'FAILED' | 'DEAD_LETTER';

export interface MutationQueueItem {
  id: string; // idempotency_key
  operation: MutationOperationType;
  label: string;
  payload: Record<string, unknown>;
  actor_id: string;
  sector_id: string | null;
  status: MutationStatus;
  attempts: number;
  max_attempts: number;
  next_retry_at: number; // timestamp ms
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceBindingRecord {
  device_id: string;
  profile_id: string;
  matricule: string;
  user_agent: string;
  bound_at: string;
  last_verified_at: string;
  is_revoked: boolean;
  revoked_at?: string | null;
  revoked_reason?: string | null;
  pbkdf2_salt_hex: string;
  pbkdf2_pin_hash_hex: string;
  pbkdf2_iterations: number;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  profile_id: string;
  vapid_public_key: string;
  keys_p256dh: string;
  keys_auth: string;
  subscribed_at: string;
  active: boolean;
}

// ============================================================================
// INTERFACES CANONIQUES TABLES SUPABASE (DDL Phase 1 Validé)
// ============================================================================
export interface DdlProfile {
  id: string;
  full_name: string;
  role: DdlUserRole;
  sector_id: string | null;
  peut_vendre: boolean;
  peut_controler: boolean;
  peut_signaler: boolean;
  radio_callsign: string | null;
  bound_device_id: string | null;
  is_active: boolean;
}

export interface DdlTicket {
  id: string;
  ticket_number: string;
  status: DdlTicketStatus;
  assigned_agent_id: string | null;
  qr_payload: string;
}

export interface DdlSale {
  id: string;
  sync_idempotency_key: string;
  ticket_id: string;
  ticket_number: string;
  agent_id: string;
  sector_id: string;
  normalized_plate: string;
  driver_phone_1: string;
  amount_fcfa: number;
  payment_method: DdlPaymentMethod;
  mobile_status: DdlMobilePaymentStatus;
  client_sold_at: string;
  server_received_at?: string;
}

export interface DdlNotification {
  id: string;
  recipient_id: string;
  type: string;
  priority?: string;
  title: string;
  body: string;
  read_at?: string | null;
}

export type ExpenseCategory =
  | 'CARBURANT_GROUPE'
  | 'FOURNITURES_TICKETS_SCELLES'
  | 'URGENCE_SANTE_SECOURS'
  | 'MAINTENANCE_POSTE'
  | 'RATIONNEMENT_EQUIPE'
  | 'AUTRE_LOGISTIQUE';

export interface ExpenseReport {
  id: string;
  expense_code: string;
  sector_id: string;
  submitted_by: string; // ID du superviseur/responsable de secteur
  title: string;
  category: ExpenseCategory;
  amount_fcfa: number;
  beneficiary?: string | null;
  justification_notes: string;
  receipt_photo_data_url?: string | null;
  receipt_photo_size_kb?: number | null;
  status: 'EN_ATTENTE_ADMIN' | 'VALIDE' | 'REJETE';
  admin_decision_by?: string | null;
  admin_decision_at?: string | null;
  admin_rejection_reason?: string | null;
  created_at: string;
}

export type SanctionLevel =
  | 'AVERTISSEMENT_VERBAL'
  | 'AVERTISSEMENT_ECRIT'
  | 'MISE_A_PIED_TEMPORAIRE'
  | 'REVOCATION_DEFINITIVE';

export interface AgentSanction {
  id: string;
  sanction_code: string;
  agent_id: string;
  issued_by: string; // admin profile id
  sanction_level: SanctionLevel;
  motif: string;
  details: string;
  duration_days?: number | null;
  is_active: boolean;
  created_at: string;
}

export interface BlacklistEntry {
  id: string;
  truck_plate: string;
  driver_name?: string | null;
  driver_phone?: string | null;
  reason: string;
  severity: 'ATTENTION' | 'INTERDICTION_ACCES' | 'POURSUITE_JUDICIAIRE';
  reported_by: string;
  is_active: boolean;
  created_at: string;
}


