/**
 * PORTUS — Client Supabase & Adaptateur de secours Offline/Démo (Repository Pattern)
 *
 * - Si VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont configurés et joignables :
 *   les appels RPC et requêtes passent par Supabase PostgreSQL et synchronisent le cache IndexedDB.
 * - Si les variables d'environnement manquent ou si le terminal est hors-ligne :
 *   l'adaptateur Repository exécute l'intégralité de la logique transactionnelle PL/pgSQL
 *   directement sur IndexedDB (`portus_ujpas_vridi_db`), sans perte de données ni faux positifs.
 */

import {createClient, SupabaseClient} from '@supabase/supabase-js';
import {
  getPortusDB,
  ensureSeedDataInIndexedDB,
  INITIAL_SETTINGS,
} from '../db';
import type {
  AppSettings,
  Sector,
  Profile,
  TicketBatch,
  Ticket,
  Sale,
  FraudReport,
  Incident,
  AppNotification,
  Remittance,
  TreasuryDeposit,
  ShiftHandover,
  PaymentMethod,
  ControlVerdict,
  IncidentType,
  IncidentSeverity,
  TicketStatus,
  ExpenseReport,
  ExpenseCategory,
  AgentSanction,
  BlacklistEntry,
  SanctionLevel,
  UserRole,
} from '../../types/portus';

const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const rawSupabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const isSupabaseConfigured = Boolean(
  rawSupabaseUrl.startsWith('http') && rawSupabaseAnonKey.length > 20
);

let activeProfileHeaderId: string | null = null;

export function setActiveProfileHeader(profileId: string | null): void {
  activeProfileHeaderId = profileId;
}

export const supabaseClient: SupabaseClient | null = isSupabaseConfigured
  ? createClient(rawSupabaseUrl, rawSupabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      global: {
        fetch: (url, options = {}) => {
          const headers = new Headers(options.headers);
          if (activeProfileHeaderId) {
            headers.set('x-portus-profile-id', activeProfileHeaderId);
          }
          return fetch(url, {...options, headers});
        },
      },
    })
  : null;

export interface SyncSaleParams {
  p_idempotency_key: string;
  p_ticket_number: string;
  p_agent_id: string;
  p_truck_plate: string;
  p_trailer_plate?: string | null;
  p_container_number?: string | null;
  p_driver_name?: string | null;
  p_driver_phone?: string | null;
  p_driver_phone_secondary?: string | null;
  p_transport_company?: string | null;
  p_country_origin?: 'CI' | 'BF' | 'ML' | 'NE' | 'GH' | 'TG' | 'BJ' | 'GN' | 'SN' | 'AUTRE';
  p_payment_method?: PaymentMethod;
  p_mobile_money_ref?: string | null;
  p_mobile_money_screenshot_data_url?: string | null;
  p_mobile_money_screenshot_kb?: number | null;
  p_colleague_override_reason?: string | null;
  p_sold_at?: string;
  p_gps_lat?: number | null;
  p_gps_lng?: number | null;
  p_offline_created?: boolean;
}

export interface VerifyTicketParams {
  p_ticket_number: string;
  p_controller_id: string;
  p_observed_plate: string;
  p_ed25519_verified?: boolean;
  p_gps_lat?: number | null;
  p_gps_lng?: number | null;
  p_notes?: string | null;
}

export interface DeclareExitParams {
  p_ticket_number: string;
  p_agent_id: string;
  p_gps_lat?: number | null;
  p_gps_lng?: number | null;
}

export interface ConfirmMobilePaymentParams {
  p_ticket_number: string;
  p_mobile_money_ref: string;
  p_actor_id: string;
}

export interface ReportIncidentParams {
  p_reported_by: string;
  p_sector_id: string;
  p_incident_type: IncidentType;
  p_severity: IncidentSeverity;
  p_title: string;
  p_description: string;
  p_truck_plate?: string | null;
  p_reported_via_walkie_talkie?: boolean;
  p_walkie_talkie_callsign?: string | null;
  p_photo_data_url?: string | null;
  p_photo_size_kb?: number | null;
  p_gps_lat?: number | null;
  p_gps_lng?: number | null;
}

export interface AckNotificationParams {
  p_notification_id: string;
  p_actor_id: string;
}

/**
 * Interface du Repository PORTUS (Supabase + Fallback local IndexedDB isomorphe)
 */
export class PortusRepository {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await ensureSeedDataInIndexedDB();
    this.initialized = true;
  }

  getModeLabel(): 'SUPABASE_CLOUD' | 'LOCAL_REPOSITORY_DEMO' {
    return isSupabaseConfigured ? 'SUPABASE_CLOUD' : 'LOCAL_REPOSITORY_DEMO';
  }

  async getSettings(): Promise<AppSettings> {
    await this.init();
    const db = await getPortusDB();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient
        .from('app_settings')
        .select('*')
        .eq('id', 1)
        .single();
      if (!error && data) {
        await db.put('app_settings', data as AppSettings);
        return data as AppSettings;
      }
    }
    return (await db.get('app_settings', 1)) ?? INITIAL_SETTINGS;
  }

  async getSectors(): Promise<Sector[]> {
    await this.init();
    const db = await getPortusDB();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient
        .from('sectors')
        .select('*')
        .order('code', {ascending: true});
      if (!error && data && data.length > 0) {
        const tx = db.transaction('sectors', 'readwrite');
        for (const s of data as Sector[]) {
          await tx.store.put(s);
        }
        await tx.done;
        return data as Sector[];
      }
    }
    return db.getAll('sectors');
  }

  async getProfiles(): Promise<Profile[]> {
    await this.init();
    const db = await getPortusDB();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient
        .from('profiles')
        .select('*')
        .order('matricule', {ascending: true});
      if (!error && data && data.length > 0) {
        const tx = db.transaction('profiles', 'readwrite');
        for (const p of data as Profile[]) {
          await tx.store.put(p);
        }
        await tx.done;
        return data as Profile[];
      }
    }
    return db.getAll('profiles');
  }

  async getTickets(): Promise<Ticket[]> {
    await this.init();
    const db = await getPortusDB();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient
        .from('tickets')
        .select('*')
        .order('serial_number', {ascending: true});
      if (!error && data && data.length > 0) {
        const tx = db.transaction('tickets', 'readwrite');
        for (const t of data as Ticket[]) {
          await tx.store.put(t);
        }
        await tx.done;
        return data as Ticket[];
      }
    }
    return db.getAll('tickets');
  }

  async getSales(): Promise<Sale[]> {
    await this.init();
    const db = await getPortusDB();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient
        .from('sales')
        .select('*')
        .order('sold_at', {ascending: false});
      if (!error && data) {
        const tx = db.transaction('sales', 'readwrite');
        for (const s of data as Sale[]) {
          await tx.store.put(s);
        }
        await tx.done;
        return data as Sale[];
      }
    }
    const all = await db.getAll('sales');
    return all.sort(
      (a, b) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime()
    );
  }

  async getNotificationsForProfile(profile: Profile): Promise<AppNotification[]> {
    await this.init();
    const db = await getPortusDB();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient
        .from('notifications')
        .select('*')
        .order('created_at', {ascending: false})
        .limit(50);
      if (!error && data) {
        const tx = db.transaction('notifications', 'readwrite');
        for (const n of data as AppNotification[]) {
          await tx.store.put(n);
        }
        await tx.done;
      }
    }
    const all = await db.getAll('notifications');
    return all
      .filter(
        (n) =>
          n.recipient_id === profile.id ||
          n.target_role === profile.role ||
          (profile.role === 'ADMIN_PROJET' && Boolean(n.id))
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }

  /**
   * RPC 1 : sync_sale
   */
  async rpcSyncSale(params: SyncSaleParams): Promise<Record<string, unknown>> {
    await this.init();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient.rpc('sync_sale', params);
      if (error) {
        throw new Error(error.message);
      }
      await this.executeLocalSyncSale(params);
      return data as Record<string, unknown>;
    }
    return this.executeLocalSyncSale(params);
  }

  private async executeLocalSyncSale(
    params: SyncSaleParams
  ): Promise<Record<string, unknown>> {
    const db = await getPortusDB();
    const existing = await db.getFromIndex(
      'sales',
      'by-idempotency',
      params.p_idempotency_key
    );
    if (existing) {
      return {
        status: 'IDEMPOTENT_ALREADY_SYNCED',
        sale_id: existing.id,
        ticket_number: existing.ticket_number,
        truck_plate: existing.truck_plate,
        max_stay_expires_at: existing.max_stay_expires_at,
        payment_confirmed: existing.payment_confirmed,
      };
    }

    const agent = await db.get('profiles', params.p_agent_id);
    if (!agent || !agent.is_active) {
      throw new Error(`Agent introuvable ou inactif (${params.p_agent_id}).`);
    }
    if (!agent.peut_vendre) {
      throw new Error(
        `HABILITATION REFUSÉE : L'agent ${agent.full_name} (${agent.matricule}) n'a pas la permission de percevoir la Contribution d'Assistance et de Sécurisation.`
      );
    }

    const normalizedTicketNumber = params.p_ticket_number.trim().toUpperCase();
    const ticket = await db.getFromIndex(
      'tickets',
      'by-number',
      normalizedTicketNumber
    );
    if (!ticket) {
      throw new Error(
        `Ticket ${normalizedTicketNumber} introuvable dans le référentiel UJPAS.`
      );
    }

    if (
      !['IMPRIME', 'ASSIGNE_SECTEUR', 'ASSIGNE_AGENT'].includes(ticket.status)
    ) {
      throw new Error(
        `CONFLIT DE TICKET : Le ticket ${ticket.ticket_number} est déjà au statut ${ticket.status}.`
      );
    }

    const settings = (await db.get('app_settings', 1)) ?? INITIAL_SETTINGS;
    const soldAtIso = params.p_sold_at ?? new Date().toISOString();
    const soldAtMs = new Date(soldAtIso).getTime();
    const expiresAtIso = new Date(
      soldAtMs + settings.standard_stay_hours * 3600 * 1000
    ).toISOString();

    const cleanPlate = params.p_truck_plate
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '-');

    const paymentMethod = params.p_payment_method ?? 'ESPECES';
    const mmRef = params.p_mobile_money_ref?.trim() ?? null;
    const paymentConfirmed =
      paymentMethod === 'ESPECES' || Boolean(mmRef && mmRef.length >= 4);
    const newTicketStatus: TicketStatus = paymentConfirmed
      ? 'SEJOUR_ACTIF'
      : 'EN_ATTENTE_PAIEMENT_MM';

    const saleId = crypto.randomUUID();
    const saleRecord: Sale = {
      id: saleId,
      idempotency_key: params.p_idempotency_key,
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      sector_id: ticket.sector_id,
      agent_id: agent.id,
      truck_plate: cleanPlate,
      trailer_plate: params.p_trailer_plate?.trim().toUpperCase() || null,
      driver_name: params.p_driver_name?.trim() || null,
      driver_phone: params.p_driver_phone?.trim() || null,
      transport_company: params.p_transport_company?.trim() || null,
      country_origin: params.p_country_origin ?? 'CI',
      contribution_amount_fcfa: ticket.contribution_amount_fcfa,
      payment_method: paymentMethod,
      mobile_money_ref: mmRef,
      payment_confirmed: paymentConfirmed,
      payment_confirmed_at: paymentConfirmed ? new Date().toISOString() : null,
      sold_at: soldAtIso,
      max_stay_expires_at: expiresAtIso,
      exited_at: null,
      exit_declared_by: null,
      gps_lat: params.p_gps_lat ?? null,
      gps_lng: params.p_gps_lng ?? null,
      offline_created: Boolean(params.p_offline_created),
      synced_at: new Date().toISOString(),
      remittance_id: null,
    };

    await db.put('sales', saleRecord);

    const updatedTicket: Ticket = {
      ...ticket,
      status: newTicketStatus,
      assigned_agent_id: ticket.assigned_agent_id ?? agent.id,
      activated_at: soldAtIso,
      updated_at: new Date().toISOString(),
    };
    await db.put('tickets', updatedTicket);

    // Notifications automatiques au RESPONSABLE (titulaire du carnet ou de secteur) et à l'ADMIN
    const batch = ticket.batch_id ? await db.get('ticket_batches', ticket.batch_id) : null;
    const allProfiles = await db.getAll('profiles');
    const recipients = allProfiles.filter(
      (p) =>
        p.is_active &&
        (p.role === 'ADMIN_PROJET' ||
          p.role === 'ADMINISTRATEUR' ||
          (batch?.assigned_supervisor_id && p.id === batch.assigned_supervisor_id) ||
          ((p.role === 'RESPONSABLE_SECTEUR' || p.role === 'RESPONSABLE') &&
            p.sector_id === ticket.sector_id))
    );

    for (const recipient of recipients) {
      const notif: AppNotification = {
        id: crypto.randomUUID(),
        recipient_id: recipient.id,
        target_role: recipient.role,
        sector_id: ticket.sector_id,
        category: 'PERCEPTION_CONTRIBUTION',
        title: `Nouvelle Contribution d'Assistance perçue (${ticket.ticket_number})`,
        message: `Camion ${cleanPlate} enregistré par ${agent.full_name} (${agent.callsign}) — ${ticket.contribution_amount_fcfa} FCFA (${paymentMethod}).`,
        metadata: {
          sale_id: saleId,
          ticket_number: ticket.ticket_number,
          truck_plate: cleanPlate,
          amount_fcfa: ticket.contribution_amount_fcfa,
          payment_method: paymentMethod,
          agent_callsign: agent.callsign,
        },
        is_read: false,
        created_at: new Date().toISOString(),
      };
      await db.put('notifications', notif);
    }

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: agent.id,
      actor_role: agent.role,
      sector_id: ticket.sector_id,
      action: 'PERCEPTION_CONTRIBUTION_ASSISTANCE',
      entity_table: 'sales',
      entity_id: saleId,
      payload: {
        ticket_number: ticket.ticket_number,
        truck_plate: cleanPlate,
        amount_fcfa: ticket.contribution_amount_fcfa,
        payment_method: paymentMethod,
      },
      created_at: new Date().toISOString(),
    });

    return {
      status: 'CREATED',
      sale_id: saleId,
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      truck_plate: cleanPlate,
      ticket_status: newTicketStatus,
      max_stay_expires_at: expiresAtIso,
      payment_confirmed: paymentConfirmed,
    };
  }

  /**
   * RPC 2 : verify_ticket
   */
  async rpcVerifyTicket(
    params: VerifyTicketParams
  ): Promise<Record<string, unknown>> {
    await this.init();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient.rpc('verify_ticket', params);
      if (error) {
        throw new Error(error.message);
      }
      await this.executeLocalVerifyTicket(params);
      return data as Record<string, unknown>;
    }
    return this.executeLocalVerifyTicket(params);
  }

  private async executeLocalVerifyTicket(
    params: VerifyTicketParams
  ): Promise<Record<string, unknown>> {
    const db = await getPortusDB();
    const controller = await db.get('profiles', params.p_controller_id);
    if (!controller || !controller.is_active || !controller.peut_controler) {
      throw new Error(
        "HABILITATION REFUSÉE : Cet agent n'est pas habilité au contrôle routier."
      );
    }

    const settings = (await db.get('app_settings', 1)) ?? INITIAL_SETTINGS;
    const cleanObserved = params.p_observed_plate
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '-');
    const ticketNum = params.p_ticket_number.trim().toUpperCase();
    const ticket = await db.getFromIndex('tickets', 'by-number', ticketNum);
    const ed25519Verified = params.p_ed25519_verified ?? true;

    let verdict: ControlVerdict;
    let actionTaken: string;
    let overstayHours = 0;
    let sale: Sale | undefined;

    if (!ed25519Verified) {
      verdict = 'SIGNATURE_CRYPTO_INVALIDE';
      actionTaken =
        'Ticket falsifié — Camion placé En attente de régularisation immédiate';
    } else if (!ticket) {
      verdict = 'TICKET_INCONNU_OU_NON_SYNCHRONISE';
      actionTaken = 'Vérification radio requise — En attente de régularisation';
    } else {
      sale = await db.getFromIndex('sales', 'by-ticket', ticket.id);
      if (!sale) {
        verdict = 'TICKET_INCONNU_OU_NON_SYNCHRONISE';
        actionTaken =
          'Ticket non activé en base — En attente de régularisation';
      } else if (ticket.status === 'SORTIE_DECLAREE' || sale.exited_at) {
        verdict = 'TICKET_DEJA_SORTI';
        actionTaken =
          "Tentative de réutilisation d'un ticket clôturé — En attente de régularisation";
      } else if (
        !sale.payment_confirmed ||
        ticket.status === 'EN_ATTENTE_PAIEMENT_MM'
      ) {
        verdict = 'PAIEMENT_MM_NON_CONFIRME';
        actionTaken =
          'Règlement Mobile Money non confirmé — En attente de régularisation';
      } else if (sale.truck_plate !== cleanObserved) {
        verdict = 'PLAQUE_NON_CONFORME';
        actionTaken = `Discordance de plaque (${sale.truck_plate} vs ${cleanObserved}) — En attente de régularisation`;
      } else {
        const expiresWithGraceMs =
          new Date(sale.max_stay_expires_at).getTime() +
          settings.grace_period_minutes * 60 * 1000;
        if (Date.now() > expiresWithGraceMs) {
          verdict = 'DEPASSEMENT_DUREE_EN_ATTENTE_REGULARISATION';
          overstayHours =
            Math.round(
              ((Date.now() - new Date(sale.max_stay_expires_at).getTime()) /
                3600000) *
                100
            ) / 100;
          actionTaken = `Dépassement de durée de séjour (+${overstayHours}h) — Camion placé En attente de régularisation`;
          await db.put('tickets', {
            ...ticket,
            status: 'EN_ATTENTE_REGULARISATION',
            updated_at: new Date().toISOString(),
          });
        } else {
          verdict = 'CONFORME_ACTIF';
          actionTaken = 'Séjour régulier — Assistance et sécurisation actives';
        }
      }
    }

    const reportId = crypto.randomUUID();
    const sectorId =
      ticket?.sector_id ??
      controller.sector_id ??
      '11111111-1111-4111-8111-111111111101';

    const report: FraudReport = {
      id: reportId,
      ticket_id: ticket?.id ?? null,
      ticket_number_scanned: ticketNum,
      controller_id: controller.id,
      sector_id: sectorId,
      observed_truck_plate: cleanObserved,
      verdict,
      action_taken: actionTaken,
      ed25519_verified: ed25519Verified,
      gps_lat: params.p_gps_lat ?? null,
      gps_lng: params.p_gps_lng ?? null,
      notes: params.p_notes ?? null,
      controlled_at: new Date().toISOString(),
    };
    await db.put('fraud_reports', report);

    if (verdict !== 'CONFORME_ACTIF') {
      const profiles = await db.getAll('profiles');
      for (const p of profiles) {
        if (
          p.is_active &&
          (p.role === 'ADMINISTRATEUR' ||
            p.role === 'ADMIN_PROJET' ||
            p.role === 'SUPERVISEUR_UJPAS' ||
            (p.role === 'RESPONSABLE_SECTEUR' && p.sector_id === sectorId))
        ) {
          await db.put('notifications', {
            id: crypto.randomUUID(),
            recipient_id: p.id,
            target_role: p.role,
            sector_id: sectorId,
            category:
              verdict === 'DEPASSEMENT_DUREE_EN_ATTENTE_REGULARISATION'
                ? 'ALERTE_REGULARISATION'
                : 'FRAUDE_DETECTEE',
            title: `Contrôle : ${cleanObserved} — En attente de régularisation`,
            message: `${actionTaken} (Contrôleur : ${controller.callsign}).`,
            metadata: {
              report_id: reportId,
              ticket_number: ticketNum,
              observed_plate: cleanObserved,
              verdict,
            },
            is_read: false,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    return {
      report_id: reportId,
      ticket_number: ticketNum,
      registered_plate: sale?.truck_plate ?? null,
      observed_plate: cleanObserved,
      verdict,
      status_label:
        verdict === 'CONFORME_ACTIF'
          ? 'Séjour régulier'
          : 'En attente de régularisation',
      action_taken: actionTaken,
      sold_at: sale?.sold_at ?? null,
      max_stay_expires_at: sale?.max_stay_expires_at ?? null,
      overstay_hours: overstayHours,
    };
  }

  /**
   * RPC 3 : declare_exit
   */
  async rpcDeclareExit(
    params: DeclareExitParams
  ): Promise<Record<string, unknown>> {
    await this.init();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient.rpc('declare_exit', params);
      if (error) {
        throw new Error(error.message);
      }
      await this.executeLocalDeclareExit(params);
      return data as Record<string, unknown>;
    }
    return this.executeLocalDeclareExit(params);
  }

  private async executeLocalDeclareExit(
    params: DeclareExitParams
  ): Promise<Record<string, unknown>> {
    const db = await getPortusDB();
    const ticketNum = params.p_ticket_number.trim().toUpperCase();
    const ticket = await db.getFromIndex('tickets', 'by-number', ticketNum);
    if (!ticket) {
      throw new Error(`Ticket ${ticketNum} introuvable.`);
    }
    const sale = await db.getFromIndex('sales', 'by-ticket', ticket.id);
    if (!sale) {
      throw new Error(`Aucune perception associée au ticket ${ticketNum}.`);
    }

    const nowIso = new Date().toISOString();
    await db.put('tickets', {
      ...ticket,
      status: 'SORTIE_DECLAREE',
      exited_at: nowIso,
      updated_at: nowIso,
    });
    await db.put('sales', {
      ...sale,
      exited_at: nowIso,
      exit_declared_by: params.p_agent_id,
    });

    const stayHours =
      Math.round(
        ((Date.now() - new Date(sale.sold_at).getTime()) / 3600000) * 100
      ) / 100;

    return {
      status: 'EXIT_RECORDED',
      ticket_number: ticket.ticket_number,
      truck_plate: sale.truck_plate,
      stay_duration_hours: stayHours,
      exited_at: nowIso,
    };
  }

  /**
   * RPC 4 : confirm_mobile_payment
   */
  async rpcConfirmMobilePayment(
    params: ConfirmMobilePaymentParams
  ): Promise<Record<string, unknown>> {
    await this.init();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient.rpc(
        'confirm_mobile_payment',
        params
      );
      if (error) {
        throw new Error(error.message);
      }
      await this.executeLocalConfirmMobilePayment(params);
      return data as Record<string, unknown>;
    }
    return this.executeLocalConfirmMobilePayment(params);
  }

  private async executeLocalConfirmMobilePayment(
    params: ConfirmMobilePaymentParams
  ): Promise<Record<string, unknown>> {
    const db = await getPortusDB();
    const ticketNum = params.p_ticket_number.trim().toUpperCase();
    const ticket = await db.getFromIndex('tickets', 'by-number', ticketNum);
    if (!ticket) {
      throw new Error(`Ticket ${ticketNum} introuvable.`);
    }
    const sale = await db.getFromIndex('sales', 'by-ticket', ticket.id);
    if (!sale) {
      throw new Error(
        `Aucune perception trouvée pour le ticket ${ticketNum}.`
      );
    }

    const cleanRef = params.p_mobile_money_ref.trim().toUpperCase();
    const nowIso = new Date().toISOString();

    await db.put('sales', {
      ...sale,
      mobile_money_ref: cleanRef,
      payment_confirmed: true,
      payment_confirmed_at: nowIso,
    });
    await db.put('tickets', {
      ...ticket,
      status: 'SEJOUR_ACTIF',
      updated_at: nowIso,
    });

    return {
      status: 'CONFIRMED',
      sale_id: sale.id,
      ticket_number: sale.ticket_number,
      mobile_money_ref: cleanRef,
      confirmed_at: nowIso,
    };
  }

  /**
   * RPC 5 : report_incident
   */
  async rpcReportIncident(
    params: ReportIncidentParams
  ): Promise<Record<string, unknown>> {
    await this.init();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient.rpc('report_incident', params);
      if (error) {
        throw new Error(error.message);
      }
      await this.executeLocalReportIncident(params);
      return data as Record<string, unknown>;
    }
    return this.executeLocalReportIncident(params);
  }

  private async executeLocalReportIncident(
    params: ReportIncidentParams
  ): Promise<Record<string, unknown>> {
    const db = await getPortusDB();
    const reporter = await db.get('profiles', params.p_reported_by);
    if (!reporter || !reporter.is_active || !reporter.peut_signaler) {
      throw new Error(
        "HABILITATION REFUSÉE : Cet agent ne peut pas déclarer d'incident."
      );
    }

    const incidentId = crypto.randomUUID();
    const shortRadioCode = Math.floor(1000 + Math.random() * 9000).toString();
    const incidentCode = `INC-${shortRadioCode}`;
    const nowIso = new Date().toISOString();

    const incident: Incident = {
      id: incidentId,
      incident_code: incidentCode,
      sector_id: params.p_sector_id,
      reported_by: reporter.id,
      incident_type: params.p_incident_type,
      severity: params.p_severity,
      truck_plate: params.p_truck_plate?.trim().toUpperCase() || null,
      title: params.p_title.trim(),
      description: params.p_description.trim(),
      reported_via_walkie_talkie: Boolean(params.p_reported_via_walkie_talkie),
      walkie_talkie_callsign:
        params.p_walkie_talkie_callsign?.trim().toUpperCase() ||
        reporter.callsign,
      photo_data_url: params.p_photo_data_url ?? null,
      photo_size_kb: params.p_photo_size_kb ?? null,
      status: 'OUVERT',
      gps_lat: params.p_gps_lat ?? null,
      gps_lng: params.p_gps_lng ?? null,
      created_at: nowIso,
    };
    await db.put('incidents', incident);

    const profiles = await db.getAll('profiles');
    for (const p of profiles) {
      if (
        p.is_active &&
        (p.role === 'ADMIN_PROJET' ||
          p.role === 'SUPERVISEUR_UJPAS' ||
          (p.role === 'RESPONSABLE_SECTEUR' &&
            p.sector_id === params.p_sector_id))
      ) {
        await db.put('notifications', {
          id: crypto.randomUUID(),
          recipient_id: p.id,
          target_role: p.role,
          sector_id: params.p_sector_id,
          category: 'INCIDENT_SECURITE',
          title: `[${incidentCode}] [${params.p_severity}] ${params.p_title.trim()}`,
          message: `Signalé par ${reporter.full_name} (${incident.walkie_talkie_callsign})${
            incident.reported_via_walkie_talkie ? ' [TALKIE-WALKIE]' : ''
          } : ${params.p_description.trim()}`,
          metadata: {
            incident_id: incidentId,
            incident_code: incidentCode,
            severity: params.p_severity,
            incident_type: params.p_incident_type,
            truck_plate: params.p_truck_plate ?? null,
            reported_via_walkie_talkie: incident.reported_via_walkie_talkie,
          },
          is_read: false,
          created_at: nowIso,
        });
      }
    }

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: reporter.id,
      actor_role: reporter.role,
      sector_id: params.p_sector_id,
      action: 'DECLARATION_INCIDENT_SECURITE_PROXIMITE',
      entity_table: 'incidents',
      entity_id: incidentId,
      payload: {
        incident_code: incidentCode,
        incident_type: params.p_incident_type,
        severity: params.p_severity,
        reported_via_walkie_talkie: incident.reported_via_walkie_talkie,
        walkie_talkie_callsign: incident.walkie_talkie_callsign,
        gps_lat: params.p_gps_lat ?? null,
        gps_lng: params.p_gps_lng ?? null,
      },
      created_at: nowIso,
    });

    return {
      status: 'REPORTED',
      incident_id: incidentId,
      incident_code: incidentCode,
      severity: params.p_severity,
      created_at: nowIso,
    };
  }

  /**
   * RPC 6 : ack_notification
   */
  async rpcAckNotification(
    params: AckNotificationParams
  ): Promise<Record<string, unknown>> {
    await this.init();
    if (supabaseClient && navigator.onLine) {
      const {data, error} = await supabaseClient.rpc(
        'ack_notification',
        params
      );
      if (!error && data) {
        await this.executeLocalAckNotification(params);
        return data as Record<string, unknown>;
      }
    }
    return this.executeLocalAckNotification(params);
  }

  private async executeLocalAckNotification(
    params: AckNotificationParams
  ): Promise<Record<string, unknown>> {
    const db = await getPortusDB();
    const existing = await db.get('notifications', params.p_notification_id);
    if (!existing) {
      throw new Error(`Notification ${params.p_notification_id} introuvable.`);
    }
    const nowIso = new Date().toISOString();
    await db.put('notifications', {
      ...existing,
      is_read: true,
      acknowledged_at: nowIso,
      acknowledged_by: params.p_actor_id,
    });
    return {
      status: 'ACKNOWLEDGED',
      notification_id: existing.id,
      acknowledged_at: nowIso,
    };
  }

  /**
   * Journalisation automatique de toute consultation de Fiche Ticket par un Contrôleur Routier
   * avec coordonnées GPS dans `audit_logs`
   */
  async logTicketConsultationAudit(params: {
    controller: Profile;
    ticketNumber: string;
    ticketId?: string | null;
    sectorId?: string | null;
    ed25519Verified: boolean;
    gpsLat: number;
    gpsLng: number;
  }): Promise<void> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const logId = crypto.randomUUID();

    await db.put('audit_logs', {
      id: logId,
      actor_id: params.controller.id,
      actor_role: params.controller.role,
      sector_id: params.sectorId ?? params.controller.sector_id ?? null,
      action: 'CONSULTATION_FICHE_TICKET_CONTROLEUR',
      entity_table: 'tickets',
      entity_id: params.ticketId ?? params.ticketNumber,
      payload: {
        ticket_number: params.ticketNumber,
        ed25519_verified: params.ed25519Verified,
        gps_lat: params.gpsLat,
        gps_lng: params.gpsLng,
        controller_callsign: params.controller.callsign,
      },
      ip_or_device: navigator.userAgent.slice(0, 80),
      created_at: nowIso,
    });
  }

  /**
   * Enregistre une allégation `A_VERIFIER` (sans sanction automatique) lorsque le chauffeur
   * présente un ticket papier non enregistré (`NOT_SOLD`) et désigne son vendeur dans la Galerie Photos des Agents
   */
  async recordUnsoldTicketSellerAllegation(params: {
    controller: Profile;
    ticketNumber: string;
    ticketId?: string | null;
    designatedAgent: Profile;
    observedTruckPlate: string;
    driverStatement?: string;
    gpsLat: number;
    gpsLng: number;
  }): Promise<FraudReport> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const reportId = crypto.randomUUID();
    const sectorId =
      params.designatedAgent.sector_id ??
      params.controller.sector_id ??
      '11111111-1111-4111-8111-111111111101';

    const report: FraudReport = {
      id: reportId,
      ticket_id: params.ticketId ?? null,
      ticket_number_scanned: params.ticketNumber.trim().toUpperCase(),
      controller_id: params.controller.id,
      sector_id: sectorId,
      observed_truck_plate: params.observedTruckPlate.trim().toUpperCase(),
      verdict: 'TICKET_INCONNU_OU_NON_SYNCHRONISE',
      action_taken: `ALLÉGATION [A_VERIFIER — SANS SANCTION AUTOMATIQUE] : Vendeur désigné sur trombinoscope = ${params.designatedAgent.full_name} (${params.designatedAgent.matricule} / ${params.designatedAgent.callsign}). Camion placé En attente de régularisation.`,
      ed25519_verified: true,
      gps_lat: params.gpsLat,
      gps_lng: params.gpsLng,
      notes:
        params.driverStatement?.trim() ||
        `Ticket papier non synchronisé (NOT_SOLD). Chauffeur a identifié visuellement ${params.designatedAgent.full_name}.`,
      controlled_at: nowIso,
    };

    await db.put('fraud_reports', report);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.controller.id,
      actor_role: params.controller.role,
      sector_id: sectorId,
      action: 'ALLEGATION_VENDEUR_TICKET_NON_ENREGISTRE_A_VERIFIER',
      entity_table: 'fraud_reports',
      entity_id: reportId,
      payload: {
        status: 'A_VERIFIER',
        automatic_sanction: false,
        ticket_number: params.ticketNumber,
        designated_agent_id: params.designatedAgent.id,
        designated_agent_matricule: params.designatedAgent.matricule,
        designated_agent_name: params.designatedAgent.full_name,
        observed_plate: params.observedTruckPlate,
        gps_lat: params.gpsLat,
        gps_lng: params.gpsLng,
      },
      created_at: nowIso,
    });

    const allProfiles = await db.getAll('profiles');
    for (const p of allProfiles) {
      if (
        p.is_active &&
        (p.role === 'ADMIN_PROJET' ||
          p.role === 'SUPERVISEUR_UJPAS' ||
          (p.role === 'RESPONSABLE_SECTEUR' && p.sector_id === sectorId))
      ) {
        await db.put('notifications', {
          id: crypto.randomUUID(),
          recipient_id: p.id,
          target_role: p.role,
          sector_id: sectorId,
          category: 'FRAUDE_DETECTEE',
          title: `[A_VERIFIER] Ticket non enregistré (${params.ticketNumber})`,
          message: `Le chauffeur du camion ${params.observedTruckPlate} a désigné ${params.designatedAgent.full_name} (${params.designatedAgent.callsign}) dans la galerie photos. Vérification contradictoire requise (aucune sanction automatique).`,
          metadata: {
            report_id: reportId,
            verification_status: 'A_VERIFIER',
            designated_agent_id: params.designatedAgent.id,
            ticket_number: params.ticketNumber,
          },
          is_read: false,
          created_at: nowIso,
        });
      }
    }

    return report;
  }

  /**
   * Envoi instantané d'un rapport de fraude ou d'anomalie directement à l'Administrateur UJPAS
   */
  async reportFraudDirectlyToAdmin(params: {
    controller: Profile;
    ticketNumber?: string | null;
    ticketId?: string | null;
    observedTruckPlate: string;
    verdict: ControlVerdict;
    motif: string;
    notes: string;
    photoDataUrl?: string | null;
    photoSizeKb?: number | null;
    gpsLat: number;
    gpsLng: number;
  }): Promise<FraudReport> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const reportId = crypto.randomUUID();
    const cleanPlate = params.observedTruckPlate.trim().toUpperCase();
    const cleanTicket = params.ticketNumber?.trim().toUpperCase() || 'SANS_TICKET';

    const report: FraudReport = {
      id: reportId,
      ticket_id: params.ticketId ?? null,
      ticket_number_scanned: cleanTicket,
      controller_id: params.controller.id,
      sector_id: params.controller.sector_id ?? '11111111-1111-4111-8111-111111111101',
      observed_truck_plate: cleanPlate,
      verdict: params.verdict,
      action_taken: `SIGNALEMENT FRAUDE TRANSMIS DIRECTEMENT À L'ADMINISTRATEUR : ${params.motif}. Véhicule placé En attente de régularisation.`,
      ed25519_verified: false,
      gps_lat: params.gpsLat,
      gps_lng: params.gpsLng,
      notes: `${params.notes}${params.photoSizeKb ? ` [Photo preuve jointe : ${params.photoSizeKb} Ko]` : ''}`,
      controlled_at: nowIso,
    };

    await db.put('fraud_reports', report);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.controller.id,
      actor_role: params.controller.role,
      sector_id: report.sector_id,
      action: 'SIGNALEMENT_FRAUDE_DIRECT_ADMINISTRATEUR',
      entity_table: 'fraud_reports',
      entity_id: reportId,
      payload: {
        controller_callsign: params.controller.callsign,
        observed_plate: cleanPlate,
        ticket_number: cleanTicket,
        verdict: params.verdict,
        motif: params.motif,
        has_photo: Boolean(params.photoDataUrl),
        gps_lat: params.gpsLat,
        gps_lng: params.gpsLng,
      },
      created_at: nowIso,
    });

    const allProfiles = await db.getAll('profiles');
    for (const p of allProfiles) {
      if (p.is_active && (p.role === 'ADMINISTRATEUR' || p.role === 'ADMIN_PROJET' || p.role === 'SUPERVISEUR_UJPAS')) {
        await db.put('notifications', {
          id: crypto.randomUUID(),
          recipient_id: p.id,
          target_role: p.role,
          sector_id: report.sector_id,
          category: 'FRAUDE_DETECTEE',
          title: `[ALERTE ADMIN FRAUDE] ${cleanPlate} — ${params.motif}`,
          message: `Rapport de fraude transmis par le Contrôleur ${params.controller.full_name} (${params.controller.callsign}) : ${params.notes}`,
          metadata: {
            report_id: reportId,
            controller_id: params.controller.id,
            observed_plate: cleanPlate,
            ticket_number: cleanTicket,
            verdict: params.verdict,
            photo_data_url: params.photoDataUrl ?? null,
          },
          is_read: false,
          created_at: nowIso,
        });
      }
    }

    return report;
  }

  /**
   * PHASE 6 : Incidents & Passation de service Jour/Nuit
   */
  async getIncidents(): Promise<Incident[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('incidents');
    return all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async updateIncidentStatus(params: {
    incidentId: string;
    actor: Profile;
    status: 'OUVERT' | 'EN_INTERVENTION' | 'RESOLU' | 'CLOS';
    resolutionNote?: string;
  }): Promise<Incident> {
    await this.init();
    const db = await getPortusDB();
    const existing = await db.get('incidents', params.incidentId);
    if (!existing) {
      throw new Error(`Incident ${params.incidentId} introuvable.`);
    }
    const nowIso = new Date().toISOString();
    const updated: Incident = {
      ...existing,
      status: params.status,
      resolution_note:
        params.resolutionNote?.trim() || existing.resolution_note || null,
      resolved_by:
        params.status === 'RESOLU' || params.status === 'CLOS'
          ? params.actor.id
          : existing.resolved_by ?? null,
      resolved_at:
        params.status === 'RESOLU' || params.status === 'CLOS'
          ? nowIso
          : existing.resolved_at ?? null,
    };
    await db.put('incidents', updated);
    return updated;
  }

  async getShiftHandovers(): Promise<ShiftHandover[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('shift_handovers');
    return all.sort(
      (a, b) =>
        new Date(b.handed_over_at).getTime() -
        new Date(a.handed_over_at).getTime()
    );
  }

  async recordShiftHandover(params: {
    sectorId: string;
    shiftPeriod: 'JOUR' | 'NUIT';
    outgoingAgentId: string;
    incomingAgentId: string;
    supervisorId?: string | null;
    activeTrucksCount: number;
    pendingRegularizationCount: number;
    remainingTicketsSerialStart?: number | null;
    remainingTicketsSerialEnd?: number | null;
    cashHandedOverFcfa: number;
    handoverSummary: string;
  }): Promise<ShiftHandover> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const record: ShiftHandover = {
      id: crypto.randomUUID(),
      sector_id: params.sectorId,
      shift_period: params.shiftPeriod,
      outgoing_agent_id: params.outgoingAgentId,
      incoming_agent_id: params.incomingAgentId,
      supervisor_id: params.supervisorId ?? null,
      active_trucks_count: params.activeTrucksCount,
      pending_regularization_count: params.pendingRegularizationCount,
      remaining_tickets_serial_start:
        params.remainingTicketsSerialStart ?? null,
      remaining_tickets_serial_end: params.remainingTicketsSerialEnd ?? null,
      cash_handed_over_fcfa: params.cashHandedOverFcfa,
      handover_summary: params.handoverSummary.trim(),
      handed_over_at: nowIso,
    };
    await db.put('shift_handovers', record);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.outgoingAgentId,
      sector_id: params.sectorId,
      action: `PASSATION_SERVICE_${params.shiftPeriod}`,
      entity_table: 'shift_handovers',
      entity_id: record.id,
      payload: {
        shift_period: params.shiftPeriod,
        outgoing_agent_id: params.outgoingAgentId,
        incoming_agent_id: params.incomingAgentId,
        active_trucks_count: params.activeTrucksCount,
        pending_regularization_count: params.pendingRegularizationCount,
        cash_handed_over_fcfa: params.cashHandedOverFcfa,
      },
      created_at: nowIso,
    });

    return record;
  }

  /**
   * PHASE 6 : Responsable de Secteur — Validation unitaire Mobile Money, Remises Espèces, Reversements Trésorerie
   */
  async validateMobileMoneySale(params: {
    saleId: string;
    supervisor: Profile;
    decision: 'CONFIRME' | 'REJETE' | 'A_CONFIRMER';
    mobileMoneyRefOverride?: string;
    rejectionReason?: string;
  }): Promise<Sale> {
    await this.init();
    const db = await getPortusDB();
    const sale = await db.get('sales', params.saleId);
    if (!sale) {
      throw new Error(`Perception ${params.saleId} introuvable.`);
    }
    const ticket = await db.get('tickets', sale.ticket_id);
    const nowIso = new Date().toISOString();

    const isConfirmed = params.decision === 'CONFIRME';
    const isPending = params.decision === 'A_CONFIRMER';

    const updatedSale: Sale = {
      ...sale,
      mobile_money_ref:
        params.mobileMoneyRefOverride?.trim().toUpperCase() ||
        sale.mobile_money_ref ||
        null,
      payment_confirmed: isConfirmed,
      payment_confirmed_at: isConfirmed ? nowIso : null,
      mobile_money_validation_status: params.decision,
      mobile_money_rejection_reason:
        params.decision === 'REJETE'
          ? params.rejectionReason?.trim() ||
            'Référence Mobile Money non reçue sur le compte Responsable Secteur'
          : isPending
          ? 'En attente de réception SMS opérateur — Réseau cellulaire 4G instable'
          : null,
    };
    await db.put('sales', updatedSale);

    if (ticket) {
      await db.put('tickets', {
        ...ticket,
        status: isConfirmed
          ? 'SEJOUR_ACTIF'
          : isPending
          ? 'EN_ATTENTE_PAIEMENT_MM'
          : 'EN_ATTENTE_REGULARISATION',
        updated_at: nowIso,
      });
    }

    const actionLabel = isConfirmed
      ? 'VALIDATION_UNITAIRE_MM_CONFIRME'
      : isPending
      ? 'MISE_EN_ATTENTE_MM_RESEAU_LENT'
      : 'VALIDATION_UNITAIRE_MM_REJETE';

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.supervisor.id,
      actor_role: params.supervisor.role,
      sector_id: sale.sector_id,
      action: actionLabel,
      entity_table: 'sales',
      entity_id: sale.id,
      payload: {
        ticket_number: sale.ticket_number,
        truck_plate: sale.truck_plate,
        payment_method: sale.payment_method,
        mobile_money_ref: updatedSale.mobile_money_ref,
        decision: params.decision,
        rejection_reason: updatedSale.mobile_money_rejection_reason,
      },
      created_at: nowIso,
    });

    const notifTitle = isConfirmed
      ? `Mobile Money confirmé (${sale.ticket_number})`
      : isPending
      ? `Mobile Money mis en attente réseau (${sale.ticket_number})`
      : `Mobile Money rejeté — En attente de régularisation (${sale.ticket_number})`;

    const notifMessage = isConfirmed
      ? `Paiement ${sale.payment_method} (${updatedSale.mobile_money_ref}) validé par ${params.supervisor.full_name}.`
      : isPending
      ? `Paiement ${sale.payment_method} mis en attente par ${params.supervisor.full_name} (vérification SMS différée).`
      : `Paiement ${sale.payment_method} rejeté par ${params.supervisor.full_name} : ${updatedSale.mobile_money_rejection_reason}.`;

    await db.put('notifications', {
      id: crypto.randomUUID(),
      recipient_id: sale.agent_id,
      sector_id: sale.sector_id,
      category: isConfirmed
        ? 'PERCEPTION_CONTRIBUTION'
        : 'ALERTE_REGULARISATION',
      title: notifTitle,
      message: notifMessage,
      metadata: {
        sale_id: sale.id,
        ticket_number: sale.ticket_number,
        decision: params.decision,
      },
      is_read: false,
      created_at: nowIso,
    });

    return updatedSale;
  }

  async getRemittances(): Promise<Remittance[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('remittances');
    return all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async getRemittancesForAgent(agentId: string): Promise<Remittance[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAllFromIndex('remittances', 'by-agent', agentId);
    return all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async recordEndOfDayRemittance(params: {
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
    notes?: string | null;
  }): Promise<Remittance> {
    const rem = await this.recordRemittance({
      sectorId: params.sector_id,
      agentId: params.agent_id,
      receivedBy: params.received_by,
      ticketsAssignedCount: params.tickets_assigned_count,
      salesCount: params.sales_count,
      ticketsRemainingCount: params.tickets_remaining_count,
      ticketsLostCount: params.tickets_lost_count,
      lostTicketsExplanation: params.lost_tickets_explanation,
      expectedCashFcfa: params.expected_cash_fcfa,
      declaredCashFcfa: params.declared_cash_fcfa,
      mobileMoneyTotalFcfa: params.mobile_money_total_fcfa,
      notes: params.notes,
    });

    // Lie les ventes de l'agent qui n'étaient pas encore clôturées
    const db = await getPortusDB();
    const allSales = await db.getAll('sales');
    for (const s of allSales) {
      if (s.agent_id === params.agent_id && !s.remittance_id) {
        await db.put('sales', {
          ...s,
          remittance_id: rem.id,
        });
      }
    }

    return rem;
  }

  async recordRemittance(params: {
    sectorId: string;
    agentId: string;
    receivedBy: string;
    ticketsAssignedCount: number;
    salesCount: number;
    ticketsRemainingCount: number;
    ticketsLostCount: number;
    lostTicketsExplanation?: string | null;
    expectedCashFcfa: number;
    declaredCashFcfa: number;
    mobileMoneyTotalFcfa: number;
    notes?: string | null;
  }): Promise<Remittance> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const dateStamp = nowIso.slice(2, 10).replace(/-/g, '');
    const shortCode = Math.floor(100 + Math.random() * 900);
    const remittance: Remittance = {
      id: crypto.randomUUID(),
      remittance_code: `REM-${dateStamp}-${shortCode}`,
      sector_id: params.sectorId,
      agent_id: params.agentId,
      received_by: params.receivedBy,
      tickets_assigned_count: params.ticketsAssignedCount,
      sales_count: params.salesCount,
      tickets_remaining_count: params.ticketsRemainingCount,
      tickets_lost_count: params.ticketsLostCount,
      lost_tickets_explanation: params.lostTicketsExplanation?.trim() || null,
      expected_cash_fcfa: params.expectedCashFcfa,
      declared_cash_fcfa: params.declaredCashFcfa,
      mobile_money_total_fcfa: params.mobileMoneyTotalFcfa,
      variance_fcfa: params.declaredCashFcfa - params.expectedCashFcfa,
      period_start: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      period_end: nowIso,
      notes: params.notes?.trim() || null,
      status: 'EN_ATTENTE_RESPONSABLE',
      supervisor_confirmed_by: null,
      supervisor_confirmed_at: null,
      supervisor_notes: null,
      created_at: nowIso,
    };

    await db.put('remittances', remittance);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.receivedBy,
      sector_id: params.sectorId,
      action: 'REMISE_ESPECES_AGENT_APPEND_ONLY',
      entity_table: 'remittances',
      entity_id: remittance.id,
      payload: {
        remittance_code: remittance.remittance_code,
        agent_id: params.agentId,
        expected_cash_fcfa: params.expectedCashFcfa,
        declared_cash_fcfa: params.declaredCashFcfa,
        variance_fcfa: remittance.variance_fcfa,
      },
      created_at: nowIso,
    });

    return remittance;
  }

  async confirmRemittanceBySupervisor(params: {
    remittanceId: string;
    supervisorId: string;
    decision: 'VALIDE_RESPONSABLE' | 'REJETE';
    notes?: string | null;
  }): Promise<Remittance> {
    await this.init();
    const db = await getPortusDB();
    const existing = await db.get('remittances', params.remittanceId);
    if (!existing) {
      throw new Error(`Remise ${params.remittanceId} introuvable.`);
    }
    const nowIso = new Date().toISOString();
    const updated: Remittance = {
      ...existing,
      status: params.decision,
      supervisor_confirmed_by: params.supervisorId,
      supervisor_confirmed_at: nowIso,
      supervisor_notes: params.notes?.trim() || null,
    };
    await db.put('remittances', updated);
    return updated;
  }

  async getTreasuryDeposits(): Promise<TreasuryDeposit[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('treasury_deposits');
    return all.sort(
      (a, b) =>
        new Date(b.deposited_at).getTime() - new Date(a.deposited_at).getTime()
    );
  }

  async recordTreasuryDeposit(params: {
    sectorId: string;
    depositedBy: string;
    bankOrInstitution: string;
    slipNumber: string;
    amountFcfa: number;
    slipPhotoUrl?: string | null;
  }): Promise<TreasuryDeposit> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const shortNum = Math.floor(100 + Math.random() * 900);
    const deposit: TreasuryDeposit = {
      id: crypto.randomUUID(),
      deposit_reference: `TRES-UJPAS-2026-${shortNum}`,
      sector_id: params.sectorId,
      deposited_by: params.depositedBy,
      verified_by: null,
      bank_or_institution: params.bankOrInstitution.trim(),
      slip_number: params.slipNumber.trim().toUpperCase(),
      amount_fcfa: params.amountFcfa,
      slip_photo_url: params.slipPhotoUrl ?? null,
      status: 'DECLARE',
      deposited_at: nowIso,
      created_at: nowIso,
    };

    await db.put('treasury_deposits', deposit);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.depositedBy,
      sector_id: params.sectorId,
      action: 'REVERSEMENT_TRESORERIE_CENTRALE_UJPAS',
      entity_table: 'treasury_deposits',
      entity_id: deposit.id,
      payload: {
        deposit_reference: deposit.deposit_reference,
        bank_or_institution: deposit.bank_or_institution,
        slip_number: deposit.slip_number,
        amount_fcfa: deposit.amount_fcfa,
      },
      created_at: nowIso,
    });

    return deposit;
  }

  async verifyTreasuryDeposit(params: {
    depositId: string;
    verifier: Profile;
    status: 'VERIFIE' | 'ECART_SIGNALE';
  }): Promise<TreasuryDeposit> {
    await this.init();
    const db = await getPortusDB();
    const existing = await db.get('treasury_deposits', params.depositId);
    if (!existing) {
      throw new Error(`Reversement ${params.depositId} introuvable.`);
    }
    const updated: TreasuryDeposit = {
      ...existing,
      verified_by: params.verifier.id,
      status: params.status,
    };
    await db.put('treasury_deposits', updated);
    return updated;
  }

  async getTicketBatches(): Promise<TicketBatch[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('ticket_batches');
    return all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async getFraudReports(): Promise<FraudReport[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('fraud_reports');
    return all.sort(
      (a, b) =>
        new Date(b.controlled_at).getTime() -
        new Date(a.controlled_at).getTime()
    );
  }

  async getRecentAuditLogs(limit = 15): Promise<
    Array<{
      id: string;
      action: string;
      entity_id: string;
      payload: Record<string, unknown>;
      created_at: string;
    }>
  > {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('audit_logs');
    return all
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, limit);
  }

  /**
   * Affecte une plage ou un lot de tickets à un agent (peu importe son secteur)
   */
  async assignTicketsToAgent(params: {
    supervisor: Profile;
    agentId: string;
    ticketIds: string[];
  }): Promise<Ticket[]> {
    await this.init();
    const db = await getPortusDB();
    const agent = await db.get('profiles', params.agentId);
    if (!agent) {
      throw new Error(`Agent introuvable (${params.agentId}).`);
    }
    const nowIso = new Date().toISOString();
    const updatedTickets: Ticket[] = [];

    for (const tid of params.ticketIds) {
      const ticket = await db.get('tickets', tid);
      if (
        ticket &&
        ['IMPRIME', 'ASSIGNE_SECTEUR', 'AVAILABLE', 'ASSIGNE_AGENT'].includes(
          ticket.status
        )
      ) {
        const updated: Ticket = {
          ...ticket,
          assigned_agent_id: agent.id,
          status: 'ASSIGNE_AGENT',
          updated_at: nowIso,
        };
        await db.put('tickets', updated);
        updatedTickets.push(updated);
      }
    }

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.supervisor.id,
      actor_role: params.supervisor.role,
      sector_id: params.supervisor.sector_id ?? null,
      action: 'AFFECTATION_PLAGE_TICKETS_AGENT',
      entity_table: 'tickets',
      entity_id: params.agentId,
      payload: {
        agent_matricule: agent.matricule,
        agent_name: agent.full_name,
        ticket_count: updatedTickets.length,
        ticket_numbers: updatedTickets.map((t) => t.ticket_number),
      },
      created_at: nowIso,
    });

    await db.put('notifications', {
      id: crypto.randomUUID(),
      recipient_id: agent.id,
      target_role: agent.role,
      sector_id: params.supervisor.sector_id ?? null,
      category: 'SYSTEME',
      title: `Dotation de ${updatedTickets.length} tickets attribuée`,
      message: `${params.supervisor.full_name} vous a affecté ${updatedTickets.length} tickets (${updatedTickets[0]?.ticket_number ?? ''} ...).`,
      metadata: {
        count: updatedTickets.length,
        assigned_by: params.supervisor.matricule,
      },
      is_read: false,
      created_at: nowIso,
    });

    return updatedTickets;
  }

  /**
   * Réattribue les tickets non vendus d'un agent vers un autre agent ou la réserve du secteur
   */
  async reassignUnsoldTickets(params: {
    supervisor: Profile;
    fromAgentId: string;
    toAgentId?: string | null;
    ticketIds: string[];
    reason?: string;
  }): Promise<Ticket[]> {
    await this.init();
    const db = await getPortusDB();
    const fromAgent = await db.get('profiles', params.fromAgentId);
    const toAgent = params.toAgentId
      ? await db.get('profiles', params.toAgentId)
      : null;
    const nowIso = new Date().toISOString();
    const updatedTickets: Ticket[] = [];

    for (const tid of params.ticketIds) {
      const ticket = await db.get('tickets', tid);
      if (
        ticket &&
        ['AVAILABLE', 'ASSIGNE_AGENT', 'ASSIGNE_SECTEUR', 'IMPRIME'].includes(
          ticket.status
        ) &&
        ticket.assigned_agent_id === params.fromAgentId
      ) {
        const updated: Ticket = {
          ...ticket,
          assigned_agent_id: toAgent ? toAgent.id : null,
          status: toAgent ? 'ASSIGNE_AGENT' : 'ASSIGNE_SECTEUR',
          updated_at: nowIso,
        };
        await db.put('tickets', updated);
        updatedTickets.push(updated);
      }
    }

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.supervisor.id,
      actor_role: params.supervisor.role,
      sector_id: params.supervisor.sector_id ?? null,
      action: 'REATTRIBUTION_TICKETS_NON_VENDUS',
      entity_table: 'tickets',
      entity_id: params.fromAgentId,
      payload: {
        from_agent: fromAgent?.matricule,
        to_agent: toAgent ? toAgent.matricule : 'RESERVE_SECTEUR',
        ticket_count: updatedTickets.length,
        reason: params.reason ?? 'Réattribution tickets non vendus',
      },
      created_at: nowIso,
    });

    return updatedTickets;
  }

  /**
   * Bloque ou débloque un agent avec traçabilité et alerte immédiate
   */
  async toggleAgentBlockStatus(params: {
    supervisor: Profile;
    agentId: string;
    isActive: boolean;
    reason: string;
  }): Promise<Profile> {
    await this.init();
    const db = await getPortusDB();
    const agent = await db.get('profiles', params.agentId);
    if (!agent) {
      throw new Error(`Agent introuvable (${params.agentId}).`);
    }
    const nowIso = new Date().toISOString();
    const updated: Profile = {
      ...agent,
      is_active: params.isActive,
      peut_vendre: params.isActive,
      updated_at: nowIso,
    };
    await db.put('profiles', updated);

    const action = params.isActive
      ? 'DEBLOCAGE_AGENT_TERRAIN'
      : 'BLOCAGE_SECURITE_AGENT_TERRAIN';

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.supervisor.id,
      actor_role: params.supervisor.role,
      sector_id: params.supervisor.sector_id ?? null,
      action,
      entity_table: 'profiles',
      entity_id: agent.id,
      payload: {
        agent_matricule: agent.matricule,
        agent_name: agent.full_name,
        is_active: params.isActive,
        reason: params.reason,
      },
      created_at: nowIso,
    });

    const allProfiles = await db.getAll('profiles');
    const adminRecipients = allProfiles.filter(
      (p) =>
        p.is_active &&
        (p.role === 'ADMIN_PROJET' || p.role === 'ADMINISTRATEUR')
    );
    for (const adm of adminRecipients) {
      await db.put('notifications', {
        id: crypto.randomUUID(),
        recipient_id: adm.id,
        target_role: adm.role,
        sector_id: params.supervisor.sector_id ?? null,
        category: 'INCIDENT_SECURITE',
        title: `${params.isActive ? 'Déblocage' : 'BLOCAGE'} de l'agent ${agent.full_name} (${agent.matricule})`,
        message: `${params.supervisor.full_name} a ${params.isActive ? 'débloqué' : 'bloqué'} l'agent ${agent.full_name}. Motif: ${params.reason}`,
        metadata: {
          agent_id: agent.id,
          agent_matricule: agent.matricule,
          supervisor_id: params.supervisor.id,
          reason: params.reason,
        },
        is_read: false,
        created_at: nowIso,
      });
    }

    return updated;
  }

  /**
   * Notes de dépense (Module Dépenses Responsable de Secteur)
   */
  async getExpenses(): Promise<ExpenseReport[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('expenses');
    return all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async recordExpenseReport(params: {
    supervisor: Profile;
    sectorId: string;
    title: string;
    category: ExpenseCategory;
    amountFcfa: number;
    beneficiary?: string;
    justificationNotes: string;
    receiptPhotoDataUrl?: string | null;
    receiptPhotoSizeKb?: number | null;
  }): Promise<ExpenseReport> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const shortNum = Math.floor(100 + Math.random() * 900);
    const exp: ExpenseReport = {
      id: crypto.randomUUID(),
      expense_code: `DEP-VRD-${nowIso.slice(2, 4)}${nowIso.slice(5, 7)}-${shortNum}`,
      sector_id: params.sectorId,
      submitted_by: params.supervisor.id,
      title: params.title.trim(),
      category: params.category,
      amount_fcfa: params.amountFcfa,
      beneficiary: params.beneficiary?.trim() || null,
      justification_notes: params.justificationNotes.trim(),
      receipt_photo_data_url: params.receiptPhotoDataUrl ?? null,
      receipt_photo_size_kb: params.receiptPhotoSizeKb ?? null,
      status: 'EN_ATTENTE_ADMIN',
      created_at: nowIso,
    };
    await db.put('expenses', exp);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.supervisor.id,
      actor_role: params.supervisor.role,
      sector_id: params.sectorId,
      action: 'SOUMISSION_NOTE_DEPENSE_RESPONSABLE',
      entity_table: 'expenses',
      entity_id: exp.id,
      payload: {
        expense_code: exp.expense_code,
        category: exp.category,
        amount_fcfa: exp.amount_fcfa,
        title: exp.title,
      },
      created_at: nowIso,
    });

    const allProfiles = await db.getAll('profiles');
    const admins = allProfiles.filter(
      (p) =>
        p.is_active &&
        (p.role === 'ADMIN_PROJET' || p.role === 'ADMINISTRATEUR')
    );
    for (const adm of admins) {
      await db.put('notifications', {
        id: crypto.randomUUID(),
        recipient_id: adm.id,
        target_role: adm.role,
        sector_id: params.sectorId,
        category: 'SYSTEME',
        title: `Note de dépense en attente (${exp.amount_fcfa} FCFA)`,
        message: `${params.supervisor.full_name} a soumis une dépense "${exp.title}" (${exp.amount_fcfa} FCFA). Validation requise.`,
        metadata: {
          expense_id: exp.id,
          expense_code: exp.expense_code,
          amount_fcfa: exp.amount_fcfa,
        },
        is_read: false,
        created_at: nowIso,
      });
    }

    return exp;
  }

  /**
   * ADMIN : Création ou mise à jour complète de compte utilisateur et attribution des rôles
   */
  async createProfile(params: {
    admin: Profile;
    matricule: string;
    fullName: string;
    phone: string;
    role: UserRole;
    sectorId?: string | null;
    callsign: string;
    peutVendre: boolean;
    peutControler: boolean;
    peutSignaler: boolean;
  }): Promise<Profile> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const newProfile: Profile = {
      id: crypto.randomUUID(),
      matricule: params.matricule.trim().toUpperCase(),
      full_name: params.fullName.trim(),
      phone: params.phone.trim(),
      role: params.role,
      sector_id: params.sectorId ?? null,
      callsign: params.callsign.trim().toUpperCase(),
      peut_vendre: params.peutVendre,
      peut_controler: params.peutControler,
      peut_signaler: params.peutSignaler,
      pin_hash: '1234',
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await db.put('profiles', newProfile);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.admin.id,
      actor_role: params.admin.role,
      sector_id: params.sectorId ?? null,
      action: 'CREATION_COMPTE_UTILISATEUR_ADMIN',
      entity_table: 'profiles',
      entity_id: newProfile.id,
      payload: {
        matricule: newProfile.matricule,
        role: newProfile.role,
        full_name: newProfile.full_name,
        peut_vendre: newProfile.peut_vendre,
        peut_controler: newProfile.peut_controler,
      },
      created_at: nowIso,
    });

    return newProfile;
  }

  async updateProfile(
    profileId: string,
    updates: Partial<Profile>,
    admin?: Profile
  ): Promise<Profile> {
    await this.init();
    const db = await getPortusDB();
    const existing = await db.get('profiles', profileId);
    if (!existing) {
      throw new Error(`Profil ${profileId} introuvable.`);
    }
    const nowIso = new Date().toISOString();
    const updated: Profile = {
      ...existing,
      ...updates,
      updated_at: nowIso,
    };
    await db.put('profiles', updated);

    if (admin) {
      await db.put('audit_logs', {
        id: crypto.randomUUID(),
        actor_id: admin.id,
        actor_role: admin.role,
        sector_id: updated.sector_id ?? null,
        action: 'MISE_A_JOUR_COMPTE_UTILISATEUR_ADMIN',
        entity_table: 'profiles',
        entity_id: updated.id,
        payload: {
          matricule: updated.matricule,
          role: updated.role,
          is_active: updated.is_active,
          peut_vendre: updated.peut_vendre,
          peut_controler: updated.peut_controler,
        },
        created_at: nowIso,
      });
    }

    return updated;
  }

  /**
   * ADMIN : Arbitrage des notes de frais soumises par les Responsables de secteur
   */
  async updateExpenseStatus(params: {
    expenseId: string;
    admin: Profile;
    decision: 'VALIDE' | 'REJETE';
    rejectionReason?: string;
  }): Promise<ExpenseReport> {
    await this.init();
    const db = await getPortusDB();
    const exp = await db.get('expenses', params.expenseId);
    if (!exp) {
      throw new Error(`Note de dépense ${params.expenseId} introuvable.`);
    }
    const nowIso = new Date().toISOString();
    const updated: ExpenseReport = {
      ...exp,
      status: params.decision,
      admin_decision_by: params.admin.id,
      admin_decision_at: nowIso,
      admin_rejection_reason:
        params.decision === 'REJETE' ? params.rejectionReason ?? null : null,
    };
    await db.put('expenses', updated);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.admin.id,
      actor_role: params.admin.role,
      sector_id: exp.sector_id,
      action:
        params.decision === 'VALIDE'
          ? 'VALIDATION_NOTE_DEPENSE_ADMIN'
          : 'REJET_NOTE_DEPENSE_ADMIN',
      entity_table: 'expenses',
      entity_id: exp.id,
      payload: {
        expense_code: exp.expense_code,
        decision: params.decision,
        amount_fcfa: exp.amount_fcfa,
        rejection_reason: updated.admin_rejection_reason,
      },
      created_at: nowIso,
    });

    // Notifier le responsable soumissionnaire
    await db.put('notifications', {
      id: crypto.randomUUID(),
      recipient_id: exp.submitted_by,
      sector_id: exp.sector_id,
      category: 'SYSTEME',
      title: `Note de dépense ${exp.expense_code} ${params.decision === 'VALIDE' ? 'VALIDÉE' : 'REJETÉE'}`,
      message: `Votre dépense "${exp.title}" (${exp.amount_fcfa} FCFA) a été ${params.decision === 'VALIDE' ? 'approuvée' : 'rejetée'} par l'Administration.${updated.admin_rejection_reason ? ' Motif: ' + updated.admin_rejection_reason : ''}`,
      metadata: {expense_id: exp.id, status: params.decision},
      is_read: false,
      created_at: nowIso,
    });

    return updated;
  }

  /**
   * ADMIN : Enregistrement d'une dépense directe de Trésorerie Centrale UJPAS
   */
  async recordCentralDirectExpense(params: {
    admin: Profile;
    title: string;
    category: ExpenseCategory;
    amountFcfa: number;
    beneficiary?: string;
    justificationNotes: string;
  }): Promise<ExpenseReport> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const shortNum = Math.floor(100 + Math.random() * 900);
    const exp: ExpenseReport = {
      id: crypto.randomUUID(),
      expense_code: `DEP-CENTRAL-${nowIso.slice(2, 4)}${nowIso.slice(5, 7)}-${shortNum}`,
      sector_id: params.admin.sector_id ?? '11111111-1111-4111-8111-111111111101',
      submitted_by: params.admin.id,
      title: params.title.trim(),
      category: params.category,
      amount_fcfa: params.amountFcfa,
      beneficiary: params.beneficiary?.trim() || 'Trésorerie Centrale UJPAS',
      justification_notes: params.justificationNotes.trim(),
      status: 'VALIDE',
      admin_decision_by: params.admin.id,
      admin_decision_at: nowIso,
      created_at: nowIso,
    };
    await db.put('expenses', exp);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.admin.id,
      actor_role: params.admin.role,
      action: 'DEPENSE_DIRECTE_TRESORERIE_CENTRALE',
      entity_table: 'expenses',
      entity_id: exp.id,
      payload: {
        expense_code: exp.expense_code,
        amount_fcfa: exp.amount_fcfa,
        title: exp.title,
      },
      created_at: nowIso,
    });

    return exp;
  }

  /**
   * LE TRIBUNAL : Liste Rouge (Blacklist) des camions & chauffeurs
   */
  async getBlacklist(): Promise<BlacklistEntry[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('blacklist');
    return all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async addToBlacklist(params: {
    admin: Profile;
    truckPlate: string;
    driverName?: string;
    driverPhone?: string;
    reason: string;
    severity?: 'ATTENTION' | 'INTERDICTION_ACCES' | 'POURSUITE_JUDICIAIRE';
  }): Promise<BlacklistEntry> {
    await this.init();
    const db = await getPortusDB();
    const nowIso = new Date().toISOString();
    const cleanPlate = params.truckPlate.trim().toUpperCase().replace(/\s+/g, '-');
    const entry: BlacklistEntry = {
      id: crypto.randomUUID(),
      truck_plate: cleanPlate,
      driver_name: params.driverName?.trim() || null,
      driver_phone: params.driverPhone?.trim() || null,
      reason: params.reason.trim(),
      severity: params.severity ?? 'INTERDICTION_ACCES',
      reported_by: params.admin.id,
      is_active: true,
      created_at: nowIso,
    };
    await db.put('blacklist', entry);

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.admin.id,
      actor_role: params.admin.role,
      action: 'INSCRIPTION_LISTE_ROUGE_TRIBUNAL',
      entity_table: 'blacklist',
      entity_id: entry.id,
      payload: {
        truck_plate: entry.truck_plate,
        reason: entry.reason,
        severity: entry.severity,
      },
      created_at: nowIso,
    });

    // Alerter tous les contrôleurs routiers
    const allProfiles = await db.getAll('profiles');
    const controllers = allProfiles.filter(
      (p) =>
        p.is_active &&
        (p.role === 'CONTROLEUR' ||
          p.role === 'AUDITEUR_INSTITUTIONNEL' ||
          p.peut_controler)
    );
    for (const ctrl of controllers) {
      await db.put('notifications', {
        id: crypto.randomUUID(),
        recipient_id: ctrl.id,
        category: 'FRAUDE_DETECTEE',
        title: `NOUVELLE INSCRIPTION LISTE ROUGE (${cleanPlate})`,
        message: `Le tribunal UJPAS a inscrit le véhicule ${cleanPlate} sur la Liste Rouge. Motif : ${entry.reason}. Vigilance maximale aux postes.`,
        metadata: {plate: cleanPlate, severity: entry.severity},
        is_read: false,
        created_at: nowIso,
      });
    }

    return entry;
  }

  async removeFromBlacklist(entryId: string, admin: Profile): Promise<void> {
    await this.init();
    const db = await getPortusDB();
    const existing = await db.get('blacklist', entryId);
    if (!existing) return;
    await db.put('blacklist', {...existing, is_active: false});

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: admin.id,
      actor_role: admin.role,
      action: 'LEVEE_INSCRIPTION_LISTE_ROUGE',
      entity_table: 'blacklist',
      entity_id: entryId,
      payload: {truck_plate: existing.truck_plate},
      created_at: new Date().toISOString(),
    });
  }

  /**
   * LE TRIBUNAL : Sanctions disciplinaires contre les agents
   */
  async getAgentSanctions(): Promise<AgentSanction[]> {
    await this.init();
    const db = await getPortusDB();
    const all = await db.getAll('agent_sanctions');
    return all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async issueAgentSanction(params: {
    admin: Profile;
    agentId: string;
    sanctionLevel: SanctionLevel;
    motif: string;
    details: string;
    durationDays?: number | null;
  }): Promise<AgentSanction> {
    await this.init();
    const db = await getPortusDB();
    const agent = await db.get('profiles', params.agentId);
    if (!agent) {
      throw new Error(`Agent ${params.agentId} introuvable.`);
    }
    const nowIso = new Date().toISOString();
    const shortCode = Math.floor(100 + Math.random() * 900);
    const sanction: AgentSanction = {
      id: crypto.randomUUID(),
      sanction_code: `SANC-${nowIso.slice(0, 4)}-${shortCode}`,
      agent_id: agent.id,
      issued_by: params.admin.id,
      sanction_level: params.sanctionLevel,
      motif: params.motif.trim(),
      details: params.details.trim(),
      duration_days: params.durationDays ?? null,
      is_active: true,
      created_at: nowIso,
    };
    await db.put('agent_sanctions', sanction);

    // Si mise à pied ou révocation définitive, désactiver immédiatement l'agent
    if (
      params.sanctionLevel === 'MISE_A_PIED_TEMPORAIRE' ||
      params.sanctionLevel === 'REVOCATION_DEFINITIVE'
    ) {
      await db.put('profiles', {
        ...agent,
        is_active: false,
        peut_vendre: false,
        updated_at: nowIso,
      });
    }

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.admin.id,
      actor_role: params.admin.role,
      action: 'SANCTION_DISCIPLINAIRE_AGENT',
      entity_table: 'agent_sanctions',
      entity_id: sanction.id,
      payload: {
        agent_matricule: agent.matricule,
        sanction_level: sanction.sanction_level,
        motif: sanction.motif,
      },
      created_at: nowIso,
    });

    // Notifier l'agent
    await db.put('notifications', {
      id: crypto.randomUUID(),
      recipient_id: agent.id,
      category: 'INCIDENT_SECURITE',
      title: `NOTIFICATION OFFICIELLE DE SANCTION : ${sanction.sanction_level}`,
      message: `L'Administration UJPAS a émis une sanction disciplinaire à votre encontre. Motif : ${sanction.motif}.`,
      metadata: {sanction_id: sanction.id, level: sanction.sanction_level},
      is_read: false,
      created_at: nowIso,
    });

    return sanction;
  }

  /**
   * ÉDITIQUE : Création d'un nouveau carnet de tickets
   */
  async createNewTicketBatch(params: {
    admin: Profile;
    sectorId: string;
    ticketCount: number;
    serialStart?: number;
  }): Promise<TicketBatch> {
    await this.init();
    const db = await getPortusDB();
    const allBatches = await db.getAll('ticket_batches');
    const nowIso = new Date().toISOString();
    const nextBatchNum = allBatches.length + 1;
    const batchCode = `CARNET-VRD-2026-${String(nextBatchNum).padStart(3, '0')}`;

    const lastTicket = (await db.getAll('tickets')).sort(
      (a, b) => b.serial_number - a.serial_number
    )[0];
    const serialStart = params.serialStart ?? (lastTicket ? lastTicket.serial_number + 1 : 100001);
    const serialEnd = serialStart + params.ticketCount - 1;

    const newBatch: TicketBatch = {
      id: crypto.randomUUID(),
      batch_code: batchCode,
      sector_id: params.sectorId,
      assigned_supervisor_id: null,
      assigned_agent_id: null,
      serial_start: serialStart,
      serial_end: serialEnd,
      ticket_count: params.ticketCount,
      unit_contribution_fcfa: 2500,
      key_version: 1,
      status: 'IMPRIME',
      printed_by: params.admin.id,
      printed_at: nowIso,
      created_at: nowIso,
    };
    await db.put('ticket_batches', newBatch);

    // Générer les tickets individuels du carnet
    const tx = db.transaction('tickets', 'readwrite');
    for (let s = serialStart; s <= serialEnd; s++) {
      const ticketNum = `UJPAS-VRD01-${s}`;
      const dummySig = `sig_ed25519_${s}_${Date.now().toString(16)}`;
      await tx.store.put({
        id: crypto.randomUUID(),
        ticket_number: ticketNum,
        serial_number: s,
        batch_id: newBatch.id,
        sector_id: params.sectorId,
        assigned_agent_id: null,
        contribution_amount_fcfa: 2500,
        status: 'AVAILABLE',
        ed25519_signature_hex: dummySig,
        key_version: 1,
        qr_static_payload: `PORTUS|v1|${ticketNum}|${s}|VRD-SEC-01|2500|${dummySig}`,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }
    await tx.done;

    await db.put('audit_logs', {
      id: crypto.randomUUID(),
      actor_id: params.admin.id,
      actor_role: params.admin.role,
      action: 'CREATION_NOUVEAU_CARNET_TICKETS',
      entity_table: 'ticket_batches',
      entity_id: newBatch.id,
      payload: {
        batch_code: newBatch.batch_code,
        serial_start: serialStart,
        serial_end: serialEnd,
        ticket_count: params.ticketCount,
      },
      created_at: nowIso,
    });

    return newBatch;
  }
}

export const portusRepository = new PortusRepository();

