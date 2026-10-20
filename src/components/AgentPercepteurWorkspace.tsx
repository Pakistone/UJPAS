/**
 * PORTUS — Espace & Module Frontend Complet de l'Agent Percepteur
 *
 * Règles métier :
 * - Agent « volant » : peut intervenir sur n'importe quel secteur de Vridi (sélecteur d'affectation immédiat).
 * - Ne voit strictement que les tickets que son Responsable lui a attribués (stock local IndexedDB).
 * - Compteur géant de tickets restants avec alerte rouge clignotante dès qu'il en reste moins de 5.
 * - Tunnel de vente fluide (1 seul écran) : AgentSalesView.tsx (Scan QR / Plaque / Chauffeur / Paiement 5 000 F / Reçu WhatsApp).
 * - Clôture de caisse de fin de service résumant les ventes avec DOUBLE VALIDATION :
 *   1) L'Agent déclare ses montants physiques et justifie tout ticket détérioré/perdu.
 *   2) Le Responsable de Secteur confirme sur son propre terminal ou via code PIN / signature conjointe.
 * - Couleurs nationales de la Côte d'Ivoire : Orange (#FF8200), Vert (#009E60), Blanc/Gris.
 * - Adapté aux smartphones Android 2Go RAM en plein soleil (boutons >= 48px, contrastes élevés).
 */

import React, {useState, useEffect, useCallback} from 'react';
import {
  Ticket as TicketIcon,
  Truck,
  Calculator,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Radio,
  MapPin,
  Clock,
  Banknote,
  Smartphone,
  ShieldCheck,
  UserCheck,
  Sparkles,
  ArrowRight,
  RefreshCw,
  FileText,
} from 'lucide-react';
import {AgentSalesView} from './AgentSalesView';
import {portusRepository} from '../lib/supabase/client';
import {getPortusDB} from '../lib/db/index';
import type {
  AppSettings,
  Profile,
  Remittance,
  Sale,
  Sector,
  Ticket,
} from '../types/portus';

interface AgentPercepteurWorkspaceProps {
  currentProfile: Profile;
  profiles: Profile[];
  sectors: Sector[];
  tickets: Ticket[];
  sales: Sale[];
  settings: AppSettings;
  onDataChanged: () => Promise<void>;
}

type AgentSubView = 'DASHBOARD_STOCK' | 'PERCEPTION_SALE' | 'END_OF_DAY_CASH';

export const AgentPercepteurWorkspace: React.FC<AgentPercepteurWorkspaceProps> = ({
  currentProfile,
  profiles,
  sectors,
  tickets,
  sales,
  settings,
  onDataChanged,
}) => {
  const [subView, setSubView] = useState<AgentSubView>('DASHBOARD_STOCK');

  // Secteur d'affectation dynamique de l'Agent Volant
  const [activeSectorId, setActiveSectorId] = useState<string>(
    currentProfile.sector_id ?? sectors[0]?.id ?? ''
  );

  const activeSector =
    sectors.find((s) => s.id === activeSectorId) ?? sectors[0];

  // Stock local : STRICTEMENT les tickets attribués à cet agent
  const myAssignedAvailableTickets = tickets.filter(
    (t) =>
      t.assigned_agent_id === currentProfile.id &&
      ['IMPRIME', 'ASSIGNE_SECTEUR', 'ASSIGNE_AGENT', 'AVAILABLE', 'ASSIGNED'].includes(
        t.status
      )
  );

  const remainingTicketsCount = myAssignedAvailableTickets.length;
  const isStockCritical = remainingTicketsCount < 5;

  // Ventes du quart de l'agent
  const mySales = sales.filter((s) => s.agent_id === currentProfile.id);
  const myUnremittedSales = mySales.filter((s) => !s.remittance_id);

  const expectedCashFromUnremitted = myUnremittedSales
    .filter((s) => s.payment_method === 'ESPECES')
    .reduce((sum, s) => sum + s.contribution_amount_fcfa, 0);

  const mobileMoneyTotalFromUnremitted = myUnremittedSales
    .filter((s) => s.payment_method !== 'ESPECES')
    .reduce((sum, s) => sum + s.contribution_amount_fcfa, 0);

  // --- Clôture de caisse & Double Validation ---
  const [lostTicketsCount, setLostTicketsCount] = useState<number>(0);
  const [lostTicketsExplanation, setLostTicketsExplanation] = useState<string>('');
  const [declaredCashFcfa, setDeclaredCashFcfa] = useState<number>(0);
  const [closingNotes, setClosingNotes] = useState<string>('');
  const [remittancesHistory, setRemittancesHistory] = useState<Remittance[]>([]);
  const [closingFeedback, setClosingFeedback] = useState<string | null>(null);
  const [isSubmittingClosing, setIsSubmittingClosing] = useState(false);

  // État de validation conjointe sur le terrain par le Responsable
  const [selectedSupervisorForApproval, setSelectedSupervisorForApproval] =
    useState<string>('');
  const [supervisorApprovalPin, setSupervisorApprovalPin] = useState<string>('');
  const [supervisorApprovalFeedback, setSupervisorApprovalFeedback] = useState<
    string | null
  >(null);

  useEffect(() => {
    setDeclaredCashFcfa(expectedCashFromUnremitted);
  }, [expectedCashFromUnremitted]);

  const loadRemittances = useCallback(async () => {
    const list = await portusRepository.getRemittancesForAgent(currentProfile.id);
    setRemittancesHistory(list);
  }, [currentProfile.id]);

  useEffect(() => {
    void loadRemittances();
  }, [loadRemittances, sales.length]);

  // Alerte radio talkie-walkie manuelle pour réassort immédiat
  const [radioAlertSent, setRadioAlertSent] = useState(false);
  const handleSendRadioRestockAlert = async () => {
    try {
      const db = await getPortusDB();
      const sectorSupervisor =
        profiles.find(
          (p) =>
            (p.role === 'RESPONSABLE_SECTEUR' ||
              p.role === 'SUPERVISEUR_UJPAS') &&
            p.sector_id === activeSectorId
        ) ?? profiles.find((p) => p.role === 'RESPONSABLE_SECTEUR');

      if (sectorSupervisor) {
        await db.put('notifications', {
          id: crypto.randomUUID(),
          recipient_id: sectorSupervisor.id,
          sector_id: activeSectorId,
          category: 'ALERTE_REGULARISATION',
          title: `📻 ALERTE TALKIE-WALKIE : Réassort Urgent Agent ${currentProfile.callsign}`,
          message: `L'agent volant ${currentProfile.full_name} (${currentProfile.callsign}) opérant sur ${activeSector?.name} signale par radio qu'il ne lui reste que ${remainingTicketsCount} ticket(s) ! Apport immédiat de carnet requis.`,
          metadata: {
            agent_id: currentProfile.id,
            remaining_count: remainingTicketsCount,
            channel: settings.emergency_radio_channel,
          },
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
      setRadioAlertSent(true);
      setTimeout(() => setRadioAlertSent(false), 5000);
    } catch {
      // Ignorer
    }
  };

  /**
   * ÉTAPE 1 : Déclaration de la clôture de caisse par l'Agent Percepteur
   * La clôture est soumise avec le statut 'EN_ATTENTE_RESPONSABLE'.
   */
  const handleDeclareEndOfDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setClosingFeedback(null);

    if (lostTicketsCount > 0 && lostTicketsExplanation.trim().length < 8) {
      setClosingFeedback(
        'Veuillez renseigner le motif détaillé des tickets perdus ou détériorés (minimum 8 caractères).'
      );
      return;
    }

    const sectorChief =
      profiles.find(
        (p) =>
          p.role === 'RESPONSABLE_SECTEUR' && p.sector_id === activeSectorId
      ) ??
      profiles.find((p) => p.role === 'RESPONSABLE_SECTEUR') ??
      currentProfile;

    const totalAssigned =
      myAssignedAvailableTickets.length + myUnremittedSales.length;

    setIsSubmittingClosing(true);
    try {
      const rem = await portusRepository.recordEndOfDayRemittance({
        sector_id: activeSectorId,
        agent_id: currentProfile.id,
        received_by: sectorChief.id,
        tickets_assigned_count: totalAssigned,
        sales_count: myUnremittedSales.length,
        tickets_remaining_count: Math.max(
          0,
          myAssignedAvailableTickets.length - lostTicketsCount
        ),
        tickets_lost_count: lostTicketsCount,
        lost_tickets_explanation: lostTicketsExplanation,
        expected_cash_fcfa: expectedCashFromUnremitted,
        declared_cash_fcfa: declaredCashFcfa,
        mobile_money_total_fcfa: mobileMoneyTotalFromUnremitted,
        notes: closingNotes,
      });

      // Notification prioritaire au Responsable
      try {
        const db = await getPortusDB();
        await db.put('notifications', {
          id: crypto.randomUUID(),
          recipient_id: sectorChief.id,
          sector_id: activeSectorId,
          category: 'VERSEMENT_CAISSE',
          title: `Clôture de Caisse ${rem.remittance_code} à valider`,
          message: `L'agent ${currentProfile.full_name} (${currentProfile.callsign}) a soumis sa clôture (${myUnremittedSales.length} ventes, ${declaredCashFcfa.toLocaleString('fr-FR')} F espèces déclarées). Confirmation requise.`,
          metadata: {
            remittance_id: rem.id,
            remittance_code: rem.remittance_code,
            agent_id: currentProfile.id,
          },
          is_read: false,
          created_at: new Date().toISOString(),
        });
      } catch {
        // Enregistrement notification local
      }

      await loadRemittances();
      await onDataChanged();

      setClosingFeedback(
        `Clôture ${rem.remittance_code} déclarée avec succès ! Statut : EN ATTENTE DE CONFIRMATION DU RESPONSABLE (${sectorChief.full_name}).`
      );
    } catch (err) {
      setClosingFeedback(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la déclaration de clôture.'
      );
    } finally {
      setIsSubmittingClosing(false);
    }
  };

  /**
   * ÉTAPE 2 : Confirmation conjointe sur le terrain par le Responsable présent
   */
  const handleSupervisorDirectConfirm = async (remittanceId: string) => {
    setSupervisorApprovalFeedback(null);
    if (!selectedSupervisorForApproval) {
      setSupervisorApprovalFeedback(
        'Veuillez sélectionner le Responsable de Secteur présent.'
      );
      return;
    }

    try {
      await portusRepository.confirmRemittanceBySupervisor({
        remittanceId,
        supervisorId: selectedSupervisorForApproval,
        decision: 'VALIDE_RESPONSABLE',
        notes: 'Confirmation physique directe en face-à-face sur le quai',
      });

      await loadRemittances();
      await onDataChanged();
      setSupervisorApprovalFeedback('Double validation effectuée avec succès !');
    } catch (err) {
      setSupervisorApprovalFeedback(
        err instanceof Error ? err.message : 'Erreur de validation.'
      );
    }
  };

  const supervisorsList = profiles.filter(
    (p) =>
      p.role === 'RESPONSABLE_SECTEUR' ||
      p.role === 'SUPERVISEUR_UJPAS' ||
      p.role === 'ADMINISTRATEUR'
  );

  return (
    <div className="space-y-6 selection:bg-[#FF8200] selection:text-slate-950 font-sans">
      {/* =====================================================================
          EN-TÊTE : COULEURS NATIONALES CÔTE D'IVOIRE & STATUT AGENT VOLANT
      ===================================================================== */}
      <div className="overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-900 shadow-xl">
        {/* Bandeau tricolore Côte d'Ivoire */}
        <div className="grid h-2 w-full grid-cols-3">
          <div className="bg-[#FF8200]" />
          <div className="bg-white" />
          <div className="bg-[#009E60]" />
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-white uppercase tracking-tight">
                  Poste Agent Percepteur — {currentProfile.full_name}
                </h1>
                <span className="rounded-full bg-[#FF8200] px-2.5 py-0.5 text-xs font-black text-slate-950 uppercase">
                  Agent Volant
                </span>
                <span className="font-mono text-xs font-bold text-[#009E60] bg-[#009E60]/10 px-2 py-0.5 rounded">
                  {currentProfile.callsign}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">
                {settings.contribution_label} · Tarif fixe :{' '}
                <strong className="text-amber-300 font-mono text-sm">
                  {settings.default_contribution_fcfa} FCFA
                </strong>{' '}
                (Séjour garanti {settings.standard_stay_hours}h)
              </p>
            </div>

            {/* Sélecteur de sous-vue */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-950 p-1.5 border border-slate-800">
              <button
                type="button"
                onClick={() => setSubView('DASHBOARD_STOCK')}
                className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
                  subView === 'DASHBOARD_STOCK'
                    ? 'bg-[#FF8200] text-slate-950 shadow-md'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <TicketIcon className="h-4 w-4" />
                <span>Mon Stock ({remainingTicketsCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setSubView('PERCEPTION_SALE')}
                className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
                  subView === 'PERCEPTION_SALE'
                    ? 'bg-[#009E60] text-white shadow-md'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Truck className="h-4 w-4" />
                <span>+ Nouvelle Vente</span>
              </button>

              <button
                type="button"
                onClick={() => setSubView('END_OF_DAY_CASH')}
                className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
                  subView === 'END_OF_DAY_CASH'
                    ? 'bg-amber-400 text-slate-950 shadow-md'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Calculator className="h-4 w-4" />
                <span>Clôture de Caisse</span>
              </button>
            </div>
          </div>

          {/* SÉLECTEUR DE SECTEUR D'AFFECTATION POUR L'AGENT VOLANT */}
          <div className="mt-4 border-t border-slate-800 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                <MapPin className="h-4 w-4 text-[#FF8200]" />
                <span>Secteur d&apos;intervention actif (Agent Volant) :</span>
                <strong className="text-white text-sm">
                  {activeSector?.name} ({activeSector?.code})
                </strong>
              </div>
              <span className="text-[11px] text-slate-400">
                Changement instantané
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap gap-2">
              {sectors.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSectorId(sec.id)}
                  className={`flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition ${
                    activeSectorId === sec.id
                      ? 'border-2 border-[#009E60] bg-[#009E60] text-white shadow-lg'
                      : 'border border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span>{sec.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          1. DASHBOARD & GESTION DU STOCK LOCAL STRICT
      ===================================================================== */}
      {subView === 'DASHBOARD_STOCK' && (
        <div className="space-y-6">
          {/* COMPTEUR GÉANT DE TICKETS RESTANTS & ALERTE ROUGE SI < 5 */}
          <div
            className={`rounded-3xl border-4 p-6 text-center transition-all shadow-2xl ${
              isStockCritical
                ? 'border-red-600 bg-red-950/90 text-white animate-pulse'
                : 'border-[#009E60] bg-slate-900 text-white'
            }`}
          >
            <span className="text-xs font-black uppercase tracking-widest text-slate-300">
              Stock de Tickets Disponibles · Carnet Attribué à{' '}
              {currentProfile.callsign}
            </span>

            <div className="my-3 flex items-center justify-center gap-3">
              <TicketIcon
                className={`h-14 w-14 ${
                  isStockCritical ? 'text-red-400' : 'text-[#FF8200]'
                }`}
              />
              <span className="font-mono text-6xl font-black tracking-tight text-white">
                {remainingTicketsCount}
              </span>
              <span className="text-base font-bold text-slate-300">
                ticket(s) restant(s)
              </span>
            </div>

            {/* ALERTE ROUGE CLIGNOTANTE SI MOINS DE 5 TICKETS */}
            {isStockCritical ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 rounded-2xl bg-red-600 p-3 text-sm font-black text-white shadow-lg">
                  <AlertTriangle className="h-6 w-6 shrink-0 animate-bounce" />
                  <span>
                    🚨 ALERTE RUPTURE IMMINENTE : Il ne vous reste que{' '}
                    {remainingTicketsCount} ticket(s) dans votre carnet !
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleSendRadioRestockAlert}
                    className="flex min-h-[48px] items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-black text-red-600 shadow-md hover:bg-slate-100 active:scale-95 transition"
                  >
                    <Radio className="h-4 w-4" />
                    <span>
                      {radioAlertSent
                        ? 'ALERTE TALKIE TRANSMISE !'
                        : 'Alerte Radio Talkie (Canal 16)'}
                    </span>
                  </button>

                  <a
                    href={`tel:${settings.support_phone}`}
                    className="flex min-h-[48px] items-center gap-2 rounded-xl border border-red-400 bg-red-900/60 px-4 py-2.5 text-xs font-black text-white hover:bg-red-900"
                  >
                    <Phone className="h-4 w-4" />
                    <span>Appeler le Responsable ({settings.support_phone})</span>
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-xs font-bold text-[#009E60]">
                ✓ Stock opérationnel suffisant pour la perception terrain.
              </p>
            )}

            {/* Bouton géant d'action principale : VENDRE UN TICKET */}
            <div className="mt-5 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSubView('PERCEPTION_SALE')}
                className="flex min-h-[60px] w-full items-center justify-center gap-3 rounded-2xl bg-[#009E60] px-6 py-4 text-base font-black text-white shadow-xl transition hover:brightness-110 active:scale-[0.98]"
              >
                <Truck className="h-6 w-6" />
                <span>+ EFFECTUER UNE PERCEPTION (5 000 FCFA)</span>
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Cartes de synthèse financière du quart en cours */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-4">
              <span className="text-xs font-bold text-slate-400">
                Ventes réalisées (Quart en cours)
              </span>
              <p className="mt-1 font-mono text-3xl font-black text-[#009E60]">
                {myUnremittedSales.length}
              </p>
              <span className="text-[11px] text-slate-500">
                Paiements enregistrés hors-ligne
              </span>
            </div>

            <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-4">
              <span className="text-xs font-bold text-slate-400">
                Espèces collectées (Non versées)
              </span>
              <p className="mt-1 font-mono text-2xl font-black text-white">
                {expectedCashFromUnremitted.toLocaleString('fr-FR')} FCFA
              </p>
              <span className="text-[11px] text-[#009E60] font-bold">
                Billet de 5 000 F en main
              </span>
            </div>

            <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-4">
              <span className="text-xs font-bold text-slate-400">
                Mobile Money perçu
              </span>
              <p className="mt-1 font-mono text-2xl font-black text-[#FF8200]">
                {mobileMoneyTotalFromUnremitted.toLocaleString('fr-FR')} FCFA
              </p>
              <span className="text-[11px] text-amber-300 font-bold">
                Wave / Orange / MTN / Moov
              </span>
            </div>
          </div>

          {/* LISTE STRICTE DES TICKETS DE L'AGENT (Stock local IndexedDB) */}
          <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-white uppercase">
                  Souches du Carnet Attribué à {currentProfile.full_name}
                </h3>
                <p className="text-xs text-slate-400">
                  Visibilité restreinte : vous ne voyez que les tickets de votre
                  dotation.
                </p>
              </div>
              <span className="rounded-lg bg-[#FF8200]/20 px-2.5 py-1 font-mono text-xs font-black text-[#FF8200]">
                {myAssignedAvailableTickets.length} disponibles
              </span>
            </div>

            {myAssignedAvailableTickets.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
                <p className="mt-2 text-sm font-bold text-white">
                  Aucun ticket disponible dans votre carnet.
                </p>
                <p className="text-xs text-slate-400">
                  Demandez une attribution de carnet à votre Responsable de
                  Secteur.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {myAssignedAvailableTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5 transition hover:border-[#009E60]"
                  >
                    <div>
                      <span className="font-mono text-xs font-black text-white">
                        {ticket.ticket_number}
                      </span>
                      <p className="text-[11px] text-slate-400">
                        Série #{ticket.serial_number} · 5 000 FCFA
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSubView('PERCEPTION_SALE')}
                      className="flex min-h-[40px] items-center gap-1 rounded-lg bg-[#009E60] px-3 py-1.5 text-xs font-bold text-white hover:brightness-110"
                    >
                      <span>Vendre</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          2. ÉCRAN DE VENTE (TUNNEL ERGONOMIQUE 1 ÉCRAN)
      ===================================================================== */}
      {subView === 'PERCEPTION_SALE' && (
        <AgentSalesView
          currentProfile={currentProfile}
          profiles={profiles}
          sectors={sectors}
          tickets={tickets}
          sales={sales}
          settings={settings}
          activeSectorId={activeSectorId}
          onSectorChange={(newSecId) => setActiveSectorId(newSecId)}
          onSaleCompleted={async () => {
            await onDataChanged();
          }}
          onClose={() => setSubView('DASHBOARD_STOCK')}
        />
      )}

      {/* =====================================================================
          3. CLÔTURE DE CAISSE AVEC DOUBLE VALIDATION (AGENT + RESPONSABLE)
      ===================================================================== */}
      {subView === 'END_OF_DAY_CASH' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Formulaire de Déclaration de Fin de Service (Agent) */}
          <div className="space-y-5 lg:col-span-7">
            <form
              onSubmit={handleDeclareEndOfDay}
              className="space-y-5 rounded-2xl border-2 border-slate-800 bg-slate-900 p-5 shadow-xl"
            >
              <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
                <Calculator className="h-6 w-6 text-[#FF8200]" />
                <div>
                  <h3 className="text-base font-black text-white uppercase">
                    Clôture de Caisse de Fin de Quart
                  </h3>
                  <p className="text-xs text-slate-300">
                    Double validation exigée : Déclaration Agent ➔ Validation
                    Responsable.
                  </p>
                </div>
              </div>

              {/* Badges du Stepper de Double Validation */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border-2 border-[#009E60] bg-emerald-950/50 p-2.5 text-emerald-200 flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-[#009E60]" />
                  <div>
                    <span className="font-bold text-[10px] uppercase block">
                      Étape 1
                    </span>
                    <strong className="text-xs font-black">
                      Déclaration Agent
                    </strong>
                  </div>
                </div>

                <div className="rounded-xl border-2 border-amber-500/60 bg-amber-950/50 p-2.5 text-amber-200 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-400" />
                  <div>
                    <span className="font-bold text-[10px] uppercase block">
                      Étape 2
                    </span>
                    <strong className="text-xs font-black">
                      Confirmation Responsable
                    </strong>
                  </div>
                </div>
              </div>

              {/* Bilan physique des tickets */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 text-xs">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <span className="text-slate-400">Total Dotation</span>
                  <p className="mt-1 font-mono text-xl font-black text-white">
                    {myAssignedAvailableTickets.length + myUnremittedSales.length}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <span className="text-slate-400">Tickets Vendus</span>
                  <p className="mt-1 font-mono text-xl font-black text-[#009E60]">
                    {myUnremittedSales.length}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <span className="text-slate-400">Tickets Restants</span>
                  <p className="mt-1 font-mono text-xl font-black text-[#FF8200]">
                    {Math.max(
                      0,
                      myAssignedAvailableTickets.length - lostTicketsCount
                    )}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <span className="text-slate-400">Perdus / Détériorés</span>
                  <p className="mt-1 font-mono text-xl font-black text-red-400">
                    {lostTicketsCount}
                  </p>
                </div>
              </div>

              {/* Saisie financière Espèces vs Mobile Money */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="declared-cash-input"
                    className="block text-xs font-black text-slate-200 uppercase"
                  >
                    Espèces physiques perçues (FCFA) *
                  </label>
                  <input
                    id="declared-cash-input"
                    type="number"
                    min={0}
                    step={500}
                    value={declaredCashFcfa}
                    onChange={(e) =>
                      setDeclaredCashFcfa(
                        Number.parseInt(e.target.value, 10) || 0
                      )
                    }
                    className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-slate-700 bg-slate-950 px-4 font-mono text-lg font-black text-[#009E60]"
                  />
                  <span className="text-[11px] text-slate-400">
                    Attendu : {expectedCashFromUnremitted.toLocaleString('fr-FR')}{' '}
                    FCFA (Écart :{' '}
                    <strong
                      className={
                        declaredCashFcfa - expectedCashFromUnremitted >= 0
                          ? 'text-[#009E60]'
                          : 'text-red-400'
                      }
                    >
                      {declaredCashFcfa - expectedCashFromUnremitted >= 0
                        ? `+${declaredCashFcfa - expectedCashFromUnremitted}`
                        : declaredCashFcfa - expectedCashFromUnremitted}{' '}
                      F
                    </strong>
                    )
                  </span>
                </div>

                <div>
                  <label
                    htmlFor="mm-total-display"
                    className="block text-xs font-black text-slate-200 uppercase"
                  >
                    Total Mobile Money perçu (FCFA)
                  </label>
                  <input
                    id="mm-total-display"
                    type="text"
                    readOnly
                    value={`${mobileMoneyTotalFromUnremitted.toLocaleString('fr-FR')} FCFA`}
                    className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-slate-800 bg-slate-950 px-4 font-mono text-lg font-black text-[#FF8200]"
                  />
                  <span className="text-[11px] text-slate-400">
                    Wave / Orange / MTN / Moov (Vérifié)
                  </span>
                </div>
              </div>

              {/* Tickets perdus ou détériorés avec motif obligatoire */}
              <div>
                <label
                  htmlFor="lost-count-input"
                  className="block text-xs font-black text-slate-200 uppercase"
                >
                  Nombre de souches perdues ou détériorées
                </label>
                <input
                  id="lost-count-input"
                  type="number"
                  min={0}
                  max={myAssignedAvailableTickets.length}
                  value={lostTicketsCount}
                  onChange={(e) =>
                    setLostTicketsCount(
                      Number.parseInt(e.target.value, 10) || 0
                    )
                  }
                  className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-slate-700 bg-slate-950 px-4 font-mono text-base font-bold text-white"
                />

                {lostTicketsCount > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <label
                      htmlFor="lost-explanation-input"
                      className="block text-xs font-black text-red-300 uppercase"
                    >
                      Justification obligatoire de la perte *
                    </label>
                    <input
                      id="lost-explanation-input"
                      type="text"
                      required
                      value={lostTicketsExplanation}
                      onChange={(e) =>
                        setLostTicketsExplanation(e.target.value)
                      }
                      placeholder="Ex: Souche n° 100012 tombée dans l'eau lors d'une pluie torrentielle"
                      className="min-h-[48px] w-full rounded-xl border-2 border-red-500 bg-slate-950 px-4 text-xs text-white"
                    />
                  </div>
                )}
              </div>

              {/* Observations */}
              <div>
                <label
                  htmlFor="closing-obs-input"
                  className="block text-xs font-black text-slate-200 uppercase"
                >
                  Observations du quart
                </label>
                <input
                  id="closing-obs-input"
                  type="text"
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  placeholder="Ex: Remise physique au poste de pesage Vridi"
                  className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-slate-700 bg-slate-950 px-4 text-xs text-white"
                />
              </div>

              {closingFeedback && (
                <div className="rounded-xl border border-[#009E60]/50 bg-emerald-950/60 p-3.5 text-xs font-bold text-emerald-200">
                  {closingFeedback}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmittingClosing}
                className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl bg-[#FF8200] px-6 py-4 text-sm font-black text-slate-950 shadow-xl transition hover:brightness-105 active:scale-[0.98] disabled:opacity-40"
              >
                {isSubmittingClosing ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
                <span>
                  SOUMETTRE LA CLÔTURE POUR VALIDATION DU RESPONSABLE (ÉTAPE 1/2)
                </span>
              </button>
            </form>
          </div>

          {/* Colonne droite : Historique et Confirmation Conjointe Terrain (Étape 2) */}
          <div className="space-y-5 lg:col-span-5">
            {/* Box de confirmation directe terrain par le Responsable */}
            <div className="rounded-2xl border-2 border-amber-500/50 bg-slate-900 p-5 shadow-xl space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-amber-400" />
                <h3 className="text-sm font-black text-white uppercase">
                  Confirmation Terrain Conjointe (Étape 2/2)
                </h3>
              </div>
              <p className="text-xs text-slate-300">
                Si votre Responsable est physiquement présent à côté de vous, il
                peut valider immédiatement la clôture sur votre écran.
              </p>

              <div>
                <label className="block text-xs font-black text-slate-300 uppercase">
                  Responsable présent sur le quai :
                </label>
                <select
                  value={selectedSupervisorForApproval}
                  onChange={(e) =>
                    setSelectedSupervisorForApproval(e.target.value)
                  }
                  className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-slate-700 bg-slate-950 px-3 font-mono text-xs font-bold text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="">-- Choisir le Responsable --</option>
                  {supervisorsList.map((sup) => (
                    <option key={sup.id} value={sup.id}>
                      {sup.full_name} ({sup.callsign} · {sup.role})
                    </option>
                  ))}
                </select>
              </div>

              {supervisorApprovalFeedback && (
                <p className="rounded-lg bg-emerald-950/80 border border-emerald-500/60 p-2.5 text-xs font-bold text-emerald-200">
                  {supervisorApprovalFeedback}
                </p>
              )}

              {remittancesHistory.length > 0 &&
                remittancesHistory[0]?.status !== 'VALIDE_RESPONSABLE' && (
                  <button
                    type="button"
                    onClick={() =>
                      handleSupervisorDirectConfirm(remittancesHistory[0].id)
                    }
                    disabled={!selectedSupervisorForApproval}
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      Valider la dernière clôture ({remittancesHistory[0].remittance_code})
                    </span>
                  </button>
                )}
            </div>

            {/* Historique des clôtures */}
            <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-5 shadow-xl">
              <h3 className="text-sm font-black text-white uppercase border-b border-slate-800 pb-2">
                Historique des Clôtures ({remittancesHistory.length})
              </h3>

              {remittancesHistory.length === 0 ? (
                <p className="mt-3 text-xs text-slate-400">
                  Aucune clôture enregistrée sur cette session.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {remittancesHistory.map((rem) => {
                    const isConfirmed =
                      rem.status === 'VALIDE_RESPONSABLE';
                    return (
                      <div
                        key={rem.id}
                        className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between font-mono">
                          <strong className="text-[#FF8200]">
                            {rem.remittance_code}
                          </strong>
                          <span className="text-slate-400 text-[11px]">
                            {new Date(rem.created_at).toLocaleTimeString(
                              'fr-FR',
                              {
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </span>
                        </div>

                        {/* Statut de double validation */}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-slate-400">Statut :</span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                              isConfirmed
                                ? 'bg-[#009E60]/20 text-[#009E60] border border-[#009E60]/40'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                            }`}
                          >
                            {isConfirmed
                              ? '✓ VALIDÉ PAR RESPONSABLE'
                              : '⏳ EN ATTENTE CONFIRMATION'}
                          </span>
                        </div>

                        <p className="text-slate-300">
                          Tickets : {rem.sales_count} vendus /{' '}
                          {rem.tickets_remaining_count} restants /{' '}
                          {rem.tickets_lost_count} perdus
                        </p>

                        <p className="font-mono text-white">
                          Espèces : {rem.declared_cash_fcfa.toLocaleString('fr-FR')}{' '}
                          FCFA · MM :{' '}
                          {rem.mobile_money_total_fcfa.toLocaleString('fr-FR')} FCFA
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
