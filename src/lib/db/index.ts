/**
 * PORTUS — Base de données locale IndexedDB (Offline-First)
 * Implémentée avec `idb` pour garantir la résilience sur smartphones Android 2 Go RAM
 * et une 4G portuaire instable sur le corridor de Vridi.
 */

import {openDB, DBSchema, IDBPDatabase} from 'idb';
import type {
  AppSettings,
  Sector,
  Profile,
  Badge,
  TicketBatch,
  Ticket,
  Sale,
  FraudReport,
  Incident,
  AppNotification,
  AuditLog,
  MutationQueueItem,
  Remittance,
  TreasuryDeposit,
  ShiftHandover,
  DeviceBindingRecord,
  PushSubscriptionRecord,
  ExpenseReport,
  AgentSanction,
  BlacklistEntry,
} from '../../types/portus';

export interface PortusDBSchema extends DBSchema {
  app_settings: {
    key: number;
    value: AppSettings;
  };
  sectors: {
    key: string;
    value: Sector;
    indexes: {'by-code': string};
  };
  profiles: {
    key: string;
    value: Profile;
    indexes: {'by-matricule': string; 'by-sector': string};
  };
  badges: {
    key: string;
    value: Badge;
    indexes: {'by-number': string; 'by-profile': string};
  };
  ticket_batches: {
    key: string;
    value: TicketBatch;
    indexes: {'by-sector': string; 'by-code': string};
  };
  tickets: {
    key: string;
    value: Ticket;
    indexes: {'by-number': string; 'by-sector': string; 'by-status': string};
  };
  sales: {
    key: string;
    value: Sale;
    indexes: {
      'by-idempotency': string;
      'by-ticket': string;
      'by-plate': string;
      'by-sector': string;
    };
  };
  fraud_reports: {
    key: string;
    value: FraudReport;
    indexes: {'by-sector': string};
  };
  incidents: {
    key: string;
    value: Incident;
    indexes: {'by-sector': string};
  };
  notifications: {
    key: string;
    value: AppNotification;
    indexes: {'by-recipient': string};
  };
  audit_logs: {
    key: string;
    value: AuditLog;
  };
  mutation_queue: {
    key: string;
    value: MutationQueueItem;
    indexes: {'by-status': string; 'by-next-retry': number};
  };
  remittances: {
    key: string;
    value: Remittance;
    indexes: {'by-agent': string; 'by-sector': string};
  };
  treasury_deposits: {
    key: string;
    value: TreasuryDeposit;
    indexes: {'by-sector': string};
  };
  shift_handovers: {
    key: string;
    value: ShiftHandover;
    indexes: {'by-sector': string};
  };
  device_bindings: {
    key: string;
    value: DeviceBindingRecord;
    indexes: {'by-profile': string};
  };
  push_subscriptions: {
    key: string;
    value: PushSubscriptionRecord;
    indexes: {'by-profile': string};
  };
  expenses: {
    key: string;
    value: ExpenseReport;
    indexes: {'by-sector': string; 'by-status': string};
  };
  agent_sanctions: {
    key: string;
    value: AgentSanction;
    indexes: {'by-agent': string};
  };
  blacklist: {
    key: string;
    value: BlacklistEntry;
    indexes: {'by-plate': string};
  };
}

const DB_NAME = 'portus_ujpas_vridi_db';
const DB_VERSION = 5;

let dbPromise: Promise<IDBPDatabase<PortusDBSchema>> | null = null;

/**
 * Données initiales de seed local (strictement alignées sur le bloc 6 de schema.sql)
 */
export const INITIAL_SETTINGS: AppSettings = {
  id: 1,
  organization_name:
    "UJPAS — Union des Jeunes du Port pour l'Assistance et la Sécurisation (Vridi)",
  contribution_label: "Contribution d'Assistance et de Sécurisation",
  pending_regularization_label: 'En attente de régularisation',
  default_contribution_fcfa: 2500,
  standard_stay_hours: 24,
  grace_period_minutes: 60,
  ed25519_public_key_hex:
    'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  key_version: 1,
  emergency_radio_channel: 'CANAL 16 — VRIDI SECOURS (446.09375 MHz)',
  support_phone: '+225 07 07 88 99 00',
  updated_at: new Date().toISOString(),
};

export const INITIAL_SECTORS: Sector[] = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    code: 'VRD-SEC-01',
    name: 'Secteur 1 — Terminal à Conteneurs TC1 / TC2',
    corridor_zone: 'Boulevard du Port — Accès Sud TC1/TC2',
    gps_lat: 5.2594,
    gps_lng: -4.0128,
    radius_meters: 750,
    max_capacity_trucks: 160,
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
  },
  {
    id: '11111111-1111-4111-8111-111111111102',
    code: 'VRD-SEC-02',
    name: 'Secteur 2 — Rond-Point Anani & Tri Postal',
    corridor_zone: 'Axe Central Vridi — Zone Logistique',
    gps_lat: 5.2641,
    gps_lng: -4.0015,
    radius_meters: 650,
    max_capacity_trucks: 140,
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
  },
  {
    id: '11111111-1111-4111-8111-111111111103',
    code: 'VRD-SEC-03',
    name: 'Secteur 3 — Zone Hydrocarbures SIR / GESTOCI',
    corridor_zone: 'Corridor Pétrolier Est — Dépôts SIR',
    gps_lat: 5.2578,
    gps_lng: -3.9892,
    radius_meters: 800,
    max_capacity_trucks: 110,
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
  },
  {
    id: '11111111-1111-4111-8111-111111111104',
    code: 'VRD-SEC-04',
    name: 'Secteur 4 — Canal de Vridi & Port de Pêche',
    corridor_zone: 'Quai Ouest & Attente Embarquement',
    gps_lat: 5.2532,
    gps_lng: -4.0219,
    radius_meters: 600,
    max_capacity_trucks: 95,
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
  },
];

export const INITIAL_PROFILES: Profile[] = [
  {
    id: '22222222-2222-4222-8222-222222222201',
    matricule: 'UJPAS-ADM-001',
    full_name: 'Kouassi Jean-Marc Bédié',
    phone: '+2250701000001',
    role: 'ADMIN_PROJET',
    sector_id: '11111111-1111-4111-8111-111111111101',
    callsign: 'AIGLE-VRIDI-01',
    peut_vendre: true,
    peut_controler: true,
    peut_signaler: true,
    pin_hash: '1234',
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
    updated_at: '2026-10-01T06:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222202',
    matricule: 'UJPAS-SUP-001',
    full_name: 'Ouattara Ibrahim Sory',
    phone: '+2250701000002',
    role: 'SUPERVISEUR_UJPAS',
    sector_id: '11111111-1111-4111-8111-111111111101',
    callsign: 'CONDOR-UJPAS-01',
    peut_vendre: true,
    peut_controler: true,
    peut_signaler: true,
    pin_hash: '2222',
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
    updated_at: '2026-10-01T06:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222203',
    matricule: 'UJPAS-CHEF-101',
    full_name: 'Yao Koffi Aristide',
    phone: '+2250701000003',
    role: 'RESPONSABLE_SECTEUR',
    sector_id: '11111111-1111-4111-8111-111111111101',
    callsign: 'ALPHA-TC1-CHEF',
    peut_vendre: true,
    peut_controler: true,
    peut_signaler: true,
    pin_hash: '3333',
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
    updated_at: '2026-10-01T06:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222204',
    matricule: 'UJPAS-AGT-408',
    full_name: 'Koné Souleymane',
    phone: '+2250701000004',
    role: 'AGENT_TERRAIN',
    sector_id: '11111111-1111-4111-8111-111111111101',
    callsign: 'VIGIE-TC1-08',
    peut_vendre: true,
    peut_controler: true,
    peut_signaler: true,
    pin_hash: '4444',
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
    updated_at: '2026-10-01T06:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222205',
    matricule: 'UJPAS-AUD-009',
    full_name: "Aka Marie-Paule Épse N'Guessan",
    phone: '+2250701000005',
    role: 'AUDITEUR_INSTITUTIONNEL',
    sector_id: null,
    callsign: 'OBSERVATEUR-PAA-09',
    peut_vendre: false,
    peut_controler: true,
    peut_signaler: false,
    pin_hash: '5555',
    is_active: true,
    created_at: '2026-10-01T06:00:00.000Z',
    updated_at: '2026-10-01T06:00:00.000Z',
  },
];

export const INITIAL_BATCH: TicketBatch = {
  id: '44444444-4444-4444-8444-444444444401',
  batch_code: 'CARNET-VRD01-2026-001',
  sector_id: '11111111-1111-4111-8111-111111111101',
  assigned_supervisor_id: '22222222-2222-4222-8222-222222222203',
  assigned_agent_id: '22222222-2222-4222-8222-222222222204',
  serial_start: 100001,
  serial_end: 100050,
  ticket_count: 50,
  unit_contribution_fcfa: 2500,
  key_version: 1,
  status: 'ASSIGNE_AGENT',
  printed_by: '22222222-2222-4222-8222-222222222201',
  printed_at: '2026-10-18T07:30:00.000Z',
  created_at: '2026-10-18T07:30:00.000Z',
};

export const INITIAL_DORMANT_BATCH: TicketBatch = {
  id: '44444444-4444-4444-8444-444444444402',
  batch_code: 'CARNET-VRD02-2026-009',
  sector_id: '11111111-1111-4111-8111-111111111102',
  assigned_supervisor_id: '22222222-2222-4222-8222-222222222203',
  assigned_agent_id: '22222222-2222-4222-8222-222222222204',
  serial_start: 200001,
  serial_end: 200050,
  ticket_count: 50,
  unit_contribution_fcfa: 2500,
  key_version: 1,
  status: 'ASSIGNE_AGENT',
  printed_by: '22222222-2222-4222-8222-222222222201',
  printed_at: '2026-09-25T08:00:00.000Z',
  created_at: '2026-09-25T08:00:00.000Z', // Carnet dormant (> 14 jours sans perception)
};

export const INITIAL_TICKETS: Ticket[] = [
  {
    id: '66666666-6666-4666-8666-666666666601',
    ticket_number: 'UJPAS-VRD01-100001',
    serial_number: 100001,
    batch_id: '44444444-4444-4444-8444-444444444401',
    sector_id: '11111111-1111-4111-8111-111111111101',
    assigned_agent_id: '22222222-2222-4222-8222-222222222204',
    contribution_amount_fcfa: 2500,
    status: 'ASSIGNE_AGENT',
    ed25519_signature_hex:
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    key_version: 1,
    qr_static_payload:
      'PORTUS|v1|UJPAS-VRD01-100001|100001|VRD-SEC-01|2500|e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    created_at: '2026-10-18T07:30:00.000Z',
    updated_at: '2026-10-18T07:30:00.000Z',
  },
  {
    id: '66666666-6666-4666-8666-666666666602',
    ticket_number: 'UJPAS-VRD01-100002',
    serial_number: 100002,
    batch_id: '44444444-4444-4444-8444-444444444401',
    sector_id: '11111111-1111-4111-8111-111111111101',
    assigned_agent_id: '22222222-2222-4222-8222-222222222204',
    contribution_amount_fcfa: 2500,
    status: 'ASSIGNE_AGENT',
    ed25519_signature_hex:
      'a1564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100c',
    key_version: 1,
    qr_static_payload:
      'PORTUS|v1|UJPAS-VRD01-100002|100002|VRD-SEC-01|2500|a1564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100c',
    created_at: '2026-10-18T07:30:00.000Z',
    updated_at: '2026-10-18T07:30:00.000Z',
  },
  {
    id: '66666666-6666-4666-8666-666666666603',
    ticket_number: 'UJPAS-VRD01-100003',
    serial_number: 100003,
    batch_id: '44444444-4444-4444-8444-444444444401',
    sector_id: '11111111-1111-4111-8111-111111111101',
    assigned_agent_id: '22222222-2222-4222-8222-222222222204',
    contribution_amount_fcfa: 2500,
    status: 'EN_ATTENTE_PAIEMENT_MM',
    ed25519_signature_hex:
      'b2564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100d',
    key_version: 1,
    qr_static_payload:
      'PORTUS|v1|UJPAS-VRD01-100003|100003|VRD-SEC-01|2500|b2564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100d',
    activated_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    created_at: '2026-10-18T07:30:00.000Z',
    updated_at: '2026-10-18T07:30:00.000Z',
  },
  {
    id: '66666666-6666-4666-8666-666666666604',
    ticket_number: 'UJPAS-VRD01-100004',
    serial_number: 100004,
    batch_id: '44444444-4444-4444-8444-444444444401',
    sector_id: '11111111-1111-4111-8111-111111111101',
    assigned_agent_id: '22222222-2222-4222-8222-222222222203', // Attribué au collègue Yao Koffi Aristide (ALPHA-TC1-CHEF)
    contribution_amount_fcfa: 2500,
    status: 'ASSIGNE_AGENT',
    ed25519_signature_hex:
      'c3564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100e',
    key_version: 1,
    qr_static_payload:
      'PORTUS|v1|UJPAS-VRD01-100004|100004|VRD-SEC-01|2500|c3564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100e',
    created_at: '2026-10-18T07:30:00.000Z',
    updated_at: '2026-10-18T07:30:00.000Z',
  },
  {
    id: '66666666-6666-4666-8666-666666666605',
    ticket_number: 'UJPAS-VRD01-100005',
    serial_number: 100005,
    batch_id: '44444444-4444-4444-8444-444444444401',
    sector_id: '11111111-1111-4111-8111-111111111101',
    assigned_agent_id: '22222222-2222-4222-8222-222222222204',
    contribution_amount_fcfa: 2500,
    status: 'SEJOUR_ACTIF',
    ed25519_signature_hex:
      'd4564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100f',
    key_version: 1,
    qr_static_payload:
      'PORTUS|v1|UJPAS-VRD01-100005|100005|VRD-SEC-01|2500|d4564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100f',
    activated_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    created_at: '2026-10-18T07:30:00.000Z',
    updated_at: '2026-10-18T07:30:00.000Z',
  },
];

export const INITIAL_SALES: Sale[] = [
  {
    id: '88888888-8888-4888-8888-888888888801',
    idempotency_key: 'SEED-SALE-MM-100003',
    ticket_id: '66666666-6666-4666-8666-666666666603',
    ticket_number: 'UJPAS-VRD01-100003',
    sector_id: '11111111-1111-4111-8111-111111111101',
    agent_id: '22222222-2222-4222-8222-222222222204',
    truck_plate: 'BF-4410-KL',
    trailer_plate: 'BF-902-RM',
    driver_name: 'Sawadogo Moussa',
    driver_phone: '+22670223344',
    country_origin: 'BF',
    contribution_amount_fcfa: 2500,
    payment_method: 'WAVE',
    mobile_money_ref: 'WAVE-CI-883920',
    payment_confirmed: false,
    mobile_money_validation_status: 'A_CONFIRMER',
    sold_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    max_stay_expires_at: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
    offline_created: false,
    synced_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    id: '88888888-8888-4888-8888-888888888802',
    idempotency_key: 'SEED-SALE-CASH-100005',
    ticket_id: '66666666-6666-4666-8666-666666666605',
    ticket_number: 'UJPAS-VRD01-100005',
    sector_id: '11111111-1111-4111-8111-111111111101',
    agent_id: '22222222-2222-4222-8222-222222222204',
    truck_plate: 'ML-9821-MD',
    trailer_plate: 'ML-331-TR',
    driver_name: 'Traoré Bakary',
    driver_phone: '+22376441122',
    country_origin: 'ML',
    contribution_amount_fcfa: 2500,
    payment_method: 'ESPECES',
    payment_confirmed: true,
    payment_confirmed_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    sold_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    max_stay_expires_at: new Date(Date.now() + 21 * 3600 * 1000).toISOString(),
    offline_created: false,
    synced_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  },
];

export const INITIAL_REMITTANCES: Remittance[] = [
  {
    id: '99999999-9999-4999-8999-999999999901',
    remittance_code: 'REM-VRD01-261018-01',
    sector_id: '11111111-1111-4111-8111-111111111101',
    agent_id: '22222222-2222-4222-8222-222222222204',
    received_by: '22222222-2222-4222-8222-222222222203',
    tickets_assigned_count: 50,
    sales_count: 18,
    tickets_remaining_count: 32,
    tickets_lost_count: 0,
    expected_cash_fcfa: 35000,
    declared_cash_fcfa: 35000,
    mobile_money_total_fcfa: 10000,
    variance_fcfa: 0,
    period_start: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    period_end: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    notes: 'Remise conforme fin de quart TC1/TC2 — Zéro écart.',
    created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
  },
];

export const INITIAL_TREASURY_DEPOSITS: TreasuryDeposit[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
    deposit_reference: 'TRES-UJPAS-2026-084',
    sector_id: '11111111-1111-4111-8111-111111111101',
    deposited_by: '22222222-2222-4222-8222-222222222203',
    verified_by: '22222222-2222-4222-8222-222222222201',
    bank_or_institution: 'Trésorerie Centrale UJPAS — Compte Séquestre BNI Vridi',
    slip_number: 'BNI-VRD-774829',
    amount_fcfa: 35000,
    status: 'VERIFIE',
    deposited_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    created_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
  },
];

export const INITIAL_SHIFT_HANDOVERS: ShiftHandover[] = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
    sector_id: '11111111-1111-4111-8111-111111111101',
    shift_period: 'JOUR',
    outgoing_agent_id: '22222222-2222-4222-8222-222222222204',
    incoming_agent_id: '22222222-2222-4222-8222-222222222203',
    supervisor_id: '22222222-2222-4222-8222-222222222202',
    active_trucks_count: 27,
    pending_regularization_count: 3,
    remaining_tickets_serial_start: 100006,
    remaining_tickets_serial_end: 100050,
    cash_handed_over_fcfa: 35000,
    handover_summary:
      'Fluidité normale sur accès Sud TC1/TC2. 3 ensembles routiers en attente de régularisation signalés sur la voie de délestage Est. Radio Canal 16 opérationnelle.',
    handed_over_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
  },
];

export const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    incident_code: 'INC-8492',
    sector_id: '11111111-1111-4111-8111-111111111101',
    reported_by: '22222222-2222-4222-8222-222222222204',
    incident_type: 'PANNE_CAMION_OBSTRUCTION',
    severity: 'CRITIQUE',
    truck_plate: 'BF-6612-ou',
    title: 'Rupture essieu remorque — Voie d’accès TC1',
    description:
      'Ensemble articulé bloquant la file droite face au portail TC1. Balisage UJPAS posé, dépanneuse portuaire demandée sur Canal 16.',
    reported_via_walkie_talkie: true,
    walkie_talkie_callsign: 'VIGIE-TC1-08',
    status: 'EN_INTERVENTION',
    gps_lat: 5.2594,
    gps_lng: -4.0128,
    created_at: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
  },
];

export const INITIAL_NOTIFICATIONS: AppNotification[] = [
  {
    id: '77777777-7777-4777-8777-777777777701',
    recipient_id: '22222222-2222-4222-8222-222222222203',
    target_role: 'RESPONSABLE_SECTEUR',
    sector_id: '11111111-1111-4111-8111-111111111101',
    category: 'SYSTEME',
    title: 'Ouverture du Quart Vridi TC1 / TC2',
    message:
      "Dotation du carnet CARNET-VRD01-2026-001 (50 tickets) remise à l'agent Koné Souleymane (VIGIE-TC1-08). Canal radio de secours : CANAL 16.",
    metadata: {
      batch_code: 'CARNET-VRD01-2026-001',
      agent_callsign: 'VIGIE-TC1-08',
    },
    is_read: false,
    created_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
  },
  {
    id: '77777777-7777-4777-8777-777777777702',
    recipient_id: '22222222-2222-4222-8222-222222222201',
    target_role: 'ADMIN_PROJET',
    sector_id: '11111111-1111-4111-8111-111111111101',
    category: 'ALERTE_REGULARISATION',
    title: 'Surveillance Séjour — Secteur 1 TC1/TC2',
    message:
      "Tous les véhicules en dépassement de durée de séjour basculent automatiquement au statut « En attente de régularisation ».",
    metadata: {
      sector_code: 'VRD-SEC-01',
    },
    is_read: false,
    created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
];

/**
 * Initialise et retourne l'instance IndexedDB PORTUS
 */
export async function getPortusDB(): Promise<IDBPDatabase<PortusDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PortusDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('app_settings')) {
          db.createObjectStore('app_settings', {keyPath: 'id'});
        }

        if (!db.objectStoreNames.contains('sectors')) {
          const store = db.createObjectStore('sectors', {keyPath: 'id'});
          store.createIndex('by-code', 'code', {unique: true});
        }

        if (!db.objectStoreNames.contains('profiles')) {
          const store = db.createObjectStore('profiles', {keyPath: 'id'});
          store.createIndex('by-matricule', 'matricule', {unique: true});
          store.createIndex('by-sector', 'sector_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('badges')) {
          const store = db.createObjectStore('badges', {keyPath: 'id'});
          store.createIndex('by-number', 'badge_number', {unique: true});
          store.createIndex('by-profile', 'profile_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('ticket_batches')) {
          const store = db.createObjectStore('ticket_batches', {keyPath: 'id'});
          store.createIndex('by-sector', 'sector_id', {unique: false});
          store.createIndex('by-code', 'batch_code', {unique: true});
        }

        if (!db.objectStoreNames.contains('tickets')) {
          const store = db.createObjectStore('tickets', {keyPath: 'id'});
          store.createIndex('by-number', 'ticket_number', {unique: true});
          store.createIndex('by-sector', 'sector_id', {unique: false});
          store.createIndex('by-status', 'status', {unique: false});
        }

        if (!db.objectStoreNames.contains('sales')) {
          const store = db.createObjectStore('sales', {keyPath: 'id'});
          store.createIndex('by-idempotency', 'idempotency_key', {unique: true});
          store.createIndex('by-ticket', 'ticket_id', {unique: true});
          store.createIndex('by-plate', 'truck_plate', {unique: false});
          store.createIndex('by-sector', 'sector_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('fraud_reports')) {
          const store = db.createObjectStore('fraud_reports', {keyPath: 'id'});
          store.createIndex('by-sector', 'sector_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('incidents')) {
          const store = db.createObjectStore('incidents', {keyPath: 'id'});
          store.createIndex('by-sector', 'sector_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('notifications')) {
          const store = db.createObjectStore('notifications', {keyPath: 'id'});
          store.createIndex('by-recipient', 'recipient_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('audit_logs')) {
          db.createObjectStore('audit_logs', {keyPath: 'id'});
        }

        if (!db.objectStoreNames.contains('mutation_queue')) {
          const store = db.createObjectStore('mutation_queue', {keyPath: 'id'});
          store.createIndex('by-status', 'status', {unique: false});
          store.createIndex('by-next-retry', 'next_retry_at', {unique: false});
        }

        if (!db.objectStoreNames.contains('remittances')) {
          const store = db.createObjectStore('remittances', {keyPath: 'id'});
          store.createIndex('by-agent', 'agent_id', {unique: false});
          store.createIndex('by-sector', 'sector_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('treasury_deposits')) {
          const store = db.createObjectStore('treasury_deposits', {
            keyPath: 'id',
          });
          store.createIndex('by-sector', 'sector_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('shift_handovers')) {
          const store = db.createObjectStore('shift_handovers', {
            keyPath: 'id',
          });
          store.createIndex('by-sector', 'sector_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('device_bindings')) {
          const store = db.createObjectStore('device_bindings', {
            keyPath: 'device_id',
          });
          store.createIndex('by-profile', 'profile_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('push_subscriptions')) {
          const store = db.createObjectStore('push_subscriptions', {
            keyPath: 'endpoint',
          });
          store.createIndex('by-profile', 'profile_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('expenses')) {
          const store = db.createObjectStore('expenses', {keyPath: 'id'});
          store.createIndex('by-sector', 'sector_id', {unique: false});
          store.createIndex('by-status', 'status', {unique: false});
        }

        if (!db.objectStoreNames.contains('agent_sanctions')) {
          const store = db.createObjectStore('agent_sanctions', {keyPath: 'id'});
          store.createIndex('by-agent', 'agent_id', {unique: false});
        }

        if (!db.objectStoreNames.contains('blacklist')) {
          const store = db.createObjectStore('blacklist', {keyPath: 'id'});
          store.createIndex('by-plate', 'truck_plate', {unique: false});
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Peuple IndexedDB avec les données de référence UJPAS Vridi si la base locale est vierge
 */
export async function ensureSeedDataInIndexedDB(): Promise<void> {
  const db = await getPortusDB();

  const existingSettings = await db.get('app_settings', 1);
  if (!existingSettings) {
    await db.put('app_settings', INITIAL_SETTINGS);
  }

  const sectorCount = await db.count('sectors');
  if (sectorCount === 0) {
    const tx = db.transaction('sectors', 'readwrite');
    for (const s of INITIAL_SECTORS) {
      await tx.store.put(s);
    }
    await tx.done;
  }

  const profileCount = await db.count('profiles');
  if (profileCount === 0) {
    const tx = db.transaction('profiles', 'readwrite');
    for (const p of INITIAL_PROFILES) {
      await tx.store.put(p);
    }
    await tx.done;
  }

  const batchCount = await db.count('ticket_batches');
  if (batchCount < 2) {
    await db.put('ticket_batches', INITIAL_BATCH);
    await db.put('ticket_batches', INITIAL_DORMANT_BATCH);
  }

  const ticketCount = await db.count('tickets');
  if (ticketCount < INITIAL_TICKETS.length) {
    const tx = db.transaction('tickets', 'readwrite');
    for (const t of INITIAL_TICKETS) {
      const existing = await tx.store.get(t.id);
      if (!existing) {
        await tx.store.put(t);
      }
    }
    await tx.done;
  }

  const salesCount = await db.count('sales');
  if (salesCount < INITIAL_SALES.length) {
    const tx = db.transaction('sales', 'readwrite');
    for (const s of INITIAL_SALES) {
      const existing = await tx.store.get(s.id);
      if (!existing) {
        await tx.store.put(s);
      }
    }
    await tx.done;
  }

  const remCount = await db.count('remittances');
  if (remCount === 0) {
    const tx = db.transaction('remittances', 'readwrite');
    for (const r of INITIAL_REMITTANCES) {
      await tx.store.put(r);
    }
    await tx.done;
  }

  const depCount = await db.count('treasury_deposits');
  if (depCount === 0) {
    const tx = db.transaction('treasury_deposits', 'readwrite');
    for (const d of INITIAL_TREASURY_DEPOSITS) {
      await tx.store.put(d);
    }
    await tx.done;
  }

  const shiftCount = await db.count('shift_handovers');
  if (shiftCount === 0) {
    const tx = db.transaction('shift_handovers', 'readwrite');
    for (const sh of INITIAL_SHIFT_HANDOVERS) {
      await tx.store.put(sh);
    }
    await tx.done;
  }

  const incCount = await db.count('incidents');
  if (incCount === 0) {
    const tx = db.transaction('incidents', 'readwrite');
    for (const inc of INITIAL_INCIDENTS) {
      await tx.store.put(inc);
    }
    await tx.done;
  }

  const notifCount = await db.count('notifications');
  if (notifCount === 0) {
    const tx = db.transaction('notifications', 'readwrite');
    for (const n of INITIAL_NOTIFICATIONS) {
      await tx.store.put(n);
    }
    await tx.done;
  }

  const expCount = await db.count('expenses');
  if (expCount === 0) {
    const tx = db.transaction('expenses', 'readwrite');
    await tx.store.put({
      id: '99999999-9999-4999-8999-999999999901',
      expense_code: 'DEP-VRD01-2026-001',
      sector_id: '11111111-1111-4111-8111-111111111101',
      submitted_by: '22222222-2222-4222-8222-222222222203',
      title: 'Carburant d’appoint Groupe Électrogène Poste TC1',
      category: 'CARBURANT_GROUPE',
      amount_fcfa: 15000,
      beneficiary: 'Station TotalEnergies Vridi Port',
      justification_notes: 'Coupure réseau électrique CIE survenue à 02h40 — Maintien impératif de l’éclairage du poste de contrôle et de la borne Wi-Fi/4G.',
      status: 'EN_ATTENTE_ADMIN',
      created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    });
    await tx.done;
  }

  const blCount = await db.count('blacklist');
  if (blCount === 0) {
    const tx = db.transaction('blacklist', 'readwrite');
    await tx.store.put({
      id: 'bbbbbbbb-1111-4bbb-8bbb-111111111101',
      truck_plate: 'BF-9902-MD',
      driver_name: 'Sanogo Drissa',
      driver_phone: '+22678001122',
      reason: 'Récidive de falsification de ticket papier et refus d’obtempérer au poste corridor TC2',
      severity: 'INTERDICTION_ACCES',
      reported_by: '22222222-2222-4222-8222-222222222201',
      is_active: true,
      created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    });
    await tx.done;
  }

  const sancCount = await db.count('agent_sanctions');
  if (sancCount === 0) {
    const tx = db.transaction('agent_sanctions', 'readwrite');
    await tx.store.put({
      id: 'ssssssss-1111-4sss-8sss-111111111101',
      sanction_code: 'SANC-2026-001',
      agent_id: '22222222-2222-4222-8222-222222222204',
      issued_by: '22222222-2222-4222-8222-222222222201',
      sanction_level: 'AVERTISSEMENT_ECRIT',
      motif: 'Retard injustifié de clôture de caisse et discordance de 2 500 FCFA',
      details: 'Rappel formel à l’ordre sur le pointage contradictoire systématique avant 18h00.',
      duration_days: null,
      is_active: true,
      created_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
    });
    await tx.done;
  }
}

/**
 * Opérations sur la file de mutations hors-ligne (`mutation_queue`)
 */
export async function enqueueOfflineMutation(
  item: Omit<
    MutationQueueItem,
    'status' | 'attempts' | 'max_attempts' | 'next_retry_at' | 'created_at' | 'updated_at'
  >
): Promise<MutationQueueItem> {
  const db = await getPortusDB();
  const existing = await db.get('mutation_queue', item.id);
  if (existing) {
    return existing;
  }

  const nowIso = new Date().toISOString();
  const record: MutationQueueItem = {
    ...item,
    status: 'PENDING',
    attempts: 0,
    max_attempts: 8,
    next_retry_at: Date.now(),
    last_error: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  await db.put('mutation_queue', record);
  return record;
}

export async function getAllMutationQueueItems(): Promise<MutationQueueItem[]> {
  const db = await getPortusDB();
  const items = await db.getAll('mutation_queue');
  return items.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function getPendingMutationsDue(
  nowMs: number = Date.now()
): Promise<MutationQueueItem[]> {
  const db = await getPortusDB();
  const all = await db.getAll('mutation_queue');
  return all
    .filter(
      (item) =>
        (item.status === 'PENDING' || item.status === 'FAILED') &&
        item.attempts < item.max_attempts &&
        item.next_retry_at <= nowMs
    )
    .sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
}

export async function updateMutationItem(
  item: MutationQueueItem
): Promise<void> {
  const db = await getPortusDB();
  await db.put('mutation_queue', {
    ...item,
    updated_at: new Date().toISOString(),
  });
}

export async function removeMutationItem(id: string): Promise<void> {
  const db = await getPortusDB();
  await db.delete('mutation_queue', id);
}

export async function resetFailedMutationForImmediateRetry(
  id: string
): Promise<void> {
  const db = await getPortusDB();
  const item = await db.get('mutation_queue', id);
  if (!item) return;
  await db.put('mutation_queue', {
    ...item,
    status: 'PENDING',
    attempts: 0,
    next_retry_at: Date.now(),
    last_error: null,
    updated_at: new Date().toISOString(),
  });
}
