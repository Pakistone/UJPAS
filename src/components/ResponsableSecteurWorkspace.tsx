/**
 * PORTUS — Module Frontend Complet du RESPONSABLE DE SECTEUR (UJPAS Vridi, Abidjan)
 *
 * RÈGLES MÉTIER :
 * 1. Gestion des tickets :
 *    - Le Responsable reçoit des carnets de l'Admin (ticket_batches).
 *    - Il affecte des plages de tickets aux agents, peu importe leur secteur (agents volants).
 *    - Il peut réattribuer les tickets non vendus (reprise et transfert à un autre agent ou réserve).
 *    - Il peut bloquer/débloquer un agent (désactivation instantanée + alerte immédiate Administrateur).
 * 2. Notifications :
 *    - Reçoit une alerte in-app à chaque fois qu'un de ses tickets est vendu par un agent.
 *    - Feed temps réel avec cloche et compteur d'alertes non lues.
 * 3. Trésorerie Agent (Double validation des caisses) :
 *    - L'agent déclare son Cash en fin de service.
 *    - Le Responsable vérifie le recomptage physique contradictoire vs attendu (variance/écart).
 *    - Bouton tactile géant « Confirmer Encaissement » (validation immuable signée).
 * 4. Mobile Money :
 *    - Le Responsable valide les paiements reçus sur son téléphone (Wave, Orange, MTN, Moov).
 *    - Boutons d'action rapide : « Confirmer », « En attente » (réseau lent), « Rejeter » avec motif.
 * 5. Dépenses :
 *    - Saisie de note de dépense avec justificatif photo compressé sur <canvas>.
 *    - Reste « En attente » jusqu'à validation par l'Administrateur central.
 * 6. Fraudes :
 *    - Accès en lecture seule aux dossiers de fraude et allégations impliquant ses tickets ou agents.
 * 7. Design :
 *    - Tableaux de bord de suivi d'équipe, filtres dynamiques, boutons tactiles >= 48px,
 *      palette nationale (Orange #FF8200, Vert #009E60, Blanc/Gris), fort contraste plein soleil.
 */

import React, {useState, useEffect, useMemo, useRef} from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Banknote,
  Smartphone,
  AlertTriangle,
  Users,
  Ticket as TicketIcon,
  Receipt,
  Plus,
  Search,
  Filter,
  ArrowRightLeft,
  Lock,
  Unlock,
  Camera,
  Image,
  FileText,
  Eye,
  RefreshCw,
  Bell,
  Layers,
  PhoneCall,
  Calendar,
  Sun,
  Moon,
  ChevronRight,
  TrendingUp,
  FileCheck2,
  Upload,
  AlertOctagon,
  Building2,
} from 'lucide-react';
import {portusRepository} from '../lib/supabase/client';
import type {
  AppSettings,
  Profile,
  Remittance,
  Sale,
  Sector,
  Ticket,
  TicketBatch,
  FraudReport,
  ExpenseReport,
  ExpenseCategory,
  AppNotification,
  PaymentMethod,
} from '../types/portus';

interface ResponsableSecteurWorkspaceProps {
  currentProfile: Profile;
  profiles: Profile[];
  sectors: Sector[];
  tickets: Ticket[];
  sales: Sale[];
  settings: AppSettings;
  onDataChanged: () => void;
}

type MainTab =
  | 'DASHBOARD'
  | 'GESTION_TICKETS'
  | 'TRESORERIE_CAISSES'
  | 'MOBILE_MONEY'
  | 'DEPENSES'
  | 'FRAUDES_AUDIT'
  | 'NOTIFICATIONS';

export const ResponsableSecteurWorkspace: React.FC<
  ResponsableSecteurWorkspaceProps
> = ({
  currentProfile,
  profiles,
  sectors,
  tickets,
  sales,
  settings,
  onDataChanged,
}) => {
  // Navigation & vue
  const [activeTab, setActiveTab] = useState<MainTab>('DASHBOARD');
  const [highContrastSunMode, setHighContrastSunMode] = useState<boolean>(false);

  // Données chargées
  const [batches, setBatches] = useState<TicketBatch[]>([]);
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [expenses, setExpenses] = useState<ExpenseReport[]>([]);
  const [fraudReports, setFraudReports] = useState<FraudReport[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Feedback & bannières
  const [banner, setBanner] = useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
  } | null>(null);

  // Modales d'actions
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [showReassignModal, setShowReassignModal] = useState<boolean>(false);
  const [showBlockModal, setShowBlockModal] = useState<boolean>(false);
  const [showMmRejectModal, setShowMmRejectModal] = useState<boolean>(false);
  const [showConfirmCashModal, setShowConfirmCashModal] = useState<boolean>(false);
  const [showExpenseModal, setShowExpenseModal] = useState<boolean>(false);
  const [viewingPhotoModal, setViewingPhotoModal] = useState<{
    title: string;
    url: string;
  } | null>(null);

  // Cible d'action courante
  const [targetAgent, setTargetAgent] = useState<Profile | null>(null);
  const [targetSale, setTargetSale] = useState<Sale | null>(null);
  const [targetRemittance, setTargetRemittance] = useState<Remittance | null>(null);

  // Formulaire d'affectation de plage de tickets
  const [assignAgentId, setAssignAgentId] = useState<string>('');
  const [assignBatchId, setAssignBatchId] = useState<string>('');
  const [assignQuantity, setAssignQuantity] = useState<number>(25);

  // Formulaire de réattribution de tickets non vendus
  const [reassignFromAgentId, setReassignFromAgentId] = useState<string>('');
  const [reassignToAgentId, setReassignToAgentId] = useState<string>('');
  const [reassignQuantity, setReassignQuantity] = useState<number>(10);
  const [reassignReason, setReassignReason] = useState<string>(
    'Réattribution opérationnelle suite à changement de poste sur le corridor'
  );

  // Formulaire de blocage / déblocage agent
  const [blockReason, setBlockReason] = useState<string>('');
  const [blockActionType, setBlockActionType] = useState<'BLOCK' | 'UNBLOCK'>('BLOCK');

  // Formulaire de rejet Mobile Money
  const [mmRejectReason, setMmRejectReason] = useState<string>(
    'Référence introuvable sur le relevé de compte — Transaction non créditée'
  );

  // Formulaire de confirmation d'encaissement de caisse
  const [cashConfirmNotes, setCashConfirmNotes] = useState<string>(
    'Contrôle contradictoire physique conforme. Billets recomptés et validés.'
  );

  // Formulaire de note de dépense
  const [expTitle, setExpTitle] = useState<string>('');
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('CARBURANT_GROUPE');
  const [expAmountFcfa, setExpAmountFcfa] = useState<number>(10000);
  const [expBeneficiary, setExpBeneficiary] = useState<string>('');
  const [expJustification, setExpJustification] = useState<string>('');
  const [expPhotoUrl, setExpPhotoUrl] = useState<string | null>(null);
  const [expPhotoSizeKb, setExpPhotoSizeKb] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filtres de recherche
  const [searchAgentQuery, setSearchAgentQuery] = useState<string>('');
  const [searchSaleQuery, setSearchSaleQuery] = useState<string>('');
  const [filterMmStatus, setFilterMmStatus] = useState<string>('TOUS');
  const [filterMmMethod, setFilterMmMethod] = useState<string>('TOUS');

  // Chargement initial des données
  const loadData = async () => {
    setLoading(true);
    try {
      const [allBatches, allRem, allExp, allFrauds, allNotifs] =
        await Promise.all([
          portusRepository.getTicketBatches(),
          portusRepository.getRemittances(),
          portusRepository.getExpenses(),
          portusRepository.getFraudReports(),
          portusRepository.getNotificationsForProfile(currentProfile),
        ]);
      setBatches(allBatches);
      setRemittances(allRem);
      setExpenses(allExp);
      setFraudReports(allFrauds);
      setNotifications(allNotifs);
    } catch (err) {
      console.error('Erreur chargement données Responsable:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [sales, tickets]);

  // Alertes tickets vendus non lues
  const unreadTicketSaleNotifs = useMemo(() => {
    return notifications.filter(
      (n) => !n.is_read && n.category === 'PERCEPTION_CONTRIBUTION'
    );
  }, [notifications]);

  // Tous les agents disponibles (agents de terrain et volants)
  const agentProfiles = useMemo(() => {
    return profiles.filter(
      (p) =>
        p.role === 'AGENT' ||
        p.role === 'AGENT_TERRAIN' ||
        p.peut_vendre === true
    );
  }, [profiles]);

  // Carnets du Responsable (attribués à lui ou à son secteur)
  const myBatches = useMemo(() => {
    return batches.filter(
      (b) =>
        b.assigned_supervisor_id === currentProfile.id ||
        b.sector_id === currentProfile.sector_id ||
        currentProfile.role === 'ADMINISTRATEUR' ||
        currentProfile.role === 'ADMIN_PROJET'
    );
  }, [batches, currentProfile]);

  // Statistiques en temps réel du secteur
  const todayStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todaySales = sales.filter((s) => s.sold_at.startsWith(today));
    const totalSalesAmount = todaySales.reduce(
      (sum, s) => sum + s.contribution_amount_fcfa,
      0
    );
    const cashSales = todaySales.filter((s) => s.payment_method === 'ESPECES');
    const cashTotal = cashSales.reduce(
      (sum, s) => sum + s.contribution_amount_fcfa,
      0
    );
    const mmSales = todaySales.filter((s) => s.payment_method !== 'ESPECES');
    const mmTotal = mmSales.reduce(
      (sum, s) => sum + s.contribution_amount_fcfa,
      0
    );

    // Tickets disponibles en stock secteur (non encore assignés aux agents ou en réserve)
    const availableSectorTickets = tickets.filter(
      (t) =>
        ['IMPRIME', 'ASSIGNE_SECTEUR', 'AVAILABLE'].includes(t.status) &&
        !t.assigned_agent_id
    ).length;

    // Nombre d'agents avec stock critique (< 5 tickets)
    let agentsLowStockCount = 0;
    for (const agent of agentProfiles) {
      const remaining = tickets.filter(
        (t) =>
          t.assigned_agent_id === agent.id &&
          ['ASSIGNE_AGENT', 'AVAILABLE'].includes(t.status)
      ).length;
      if (agent.is_active && remaining < 5) {
        agentsLowStockCount++;
      }
    }

    const pendingMmValidation = sales.filter(
      (s) =>
        s.payment_method !== 'ESPECES' &&
        (!s.payment_confirmed ||
          s.mobile_money_validation_status === 'A_CONFIRMER')
    ).length;

    const pendingCashValidation = remittances.filter(
      (r) => r.status === 'EN_ATTENTE_RESPONSABLE'
    ).length;

    return {
      todaySalesCount: todaySales.length,
      totalSalesAmount,
      cashTotal,
      mmTotal,
      availableSectorTickets,
      agentsLowStockCount,
      pendingMmValidation,
      pendingCashValidation,
    };
  }, [sales, tickets, agentProfiles, remittances]);

  // Ventes Mobile Money avec filtres
  const filteredMmSales = useMemo(() => {
    return sales
      .filter((s) => s.payment_method !== 'ESPECES')
      .filter((s) => {
        if (filterMmStatus === 'A_CONFIRMER') {
          return (
            !s.payment_confirmed ||
            s.mobile_money_validation_status === 'A_CONFIRMER'
          );
        }
        if (filterMmStatus === 'CONFIRME') {
          return (
            s.payment_confirmed &&
            s.mobile_money_validation_status === 'CONFIRME'
          );
        }
        if (filterMmStatus === 'REJETE') {
          return s.mobile_money_validation_status === 'REJETE';
        }
        return true;
      })
      .filter((s) => {
        if (filterMmMethod === 'TOUS') return true;
        return s.payment_method === filterMmMethod;
      })
      .filter((s) => {
        if (!searchSaleQuery.trim()) return true;
        const q = searchSaleQuery.toLowerCase();
        return (
          s.ticket_number.toLowerCase().includes(q) ||
          s.truck_plate.toLowerCase().includes(q) ||
          (s.mobile_money_ref && s.mobile_money_ref.toLowerCase().includes(q)) ||
          (s.driver_name && s.driver_name.toLowerCase().includes(q))
        );
      });
  }, [sales, filterMmStatus, filterMmMethod, searchSaleQuery]);

  // Fraudes impliquant les tickets ou agents du secteur
  const relevantFraudReports = useMemo(() => {
    const mySectorId = currentProfile.sector_id;
    const myAgentIds = new Set(agentProfiles.map((a) => a.id));

    return fraudReports.filter((f) => {
      if (currentProfile.role === 'ADMINISTRATEUR' || currentProfile.role === 'ADMIN_PROJET') {
        return true;
      }
      if (f.sector_id === mySectorId) return true;
      // Vérifie si le ticket est rattaché à son secteur
      const t = tickets.find((tk) => tk.ticket_number === f.ticket_number_scanned);
      if (t && (t.sector_id === mySectorId || (t.assigned_agent_id && myAgentIds.has(t.assigned_agent_id)))) {
        return true;
      }
      return false;
    });
  }, [fraudReports, currentProfile, agentProfiles, tickets]);

  // Actions métier : Affectation de plage de tickets
  const handleAssignTicketRange = async () => {
    if (!assignAgentId) {
      setBanner({type: 'error', text: 'Veuillez sélectionner un agent bénéficiaire.'});
      return;
    }
    const agent = profiles.find((p) => p.id === assignAgentId);
    if (!agent) return;

    // Trouver les tickets disponibles du carnet ou de la réserve
    const availableTickets = tickets.filter((t) => {
      const matchBatch = assignBatchId ? t.batch_id === assignBatchId : true;
      return (
        matchBatch &&
        ['IMPRIME', 'ASSIGNE_SECTEUR', 'AVAILABLE'].includes(t.status) &&
        !t.assigned_agent_id
      );
    });

    if (availableTickets.length === 0) {
      setBanner({
        type: 'error',
        text: 'Aucun ticket disponible dans le carnet sélectionné.',
      });
      return;
    }

    const selectedTickets = availableTickets.slice(0, assignQuantity);
    const ids = selectedTickets.map((t) => t.id);

    try {
      await portusRepository.assignTicketsToAgent({
        supervisor: currentProfile,
        agentId: agent.id,
        ticketIds: ids,
      });
      setShowAssignModal(false);
      onDataChanged();
      await loadData();
      setBanner({
        type: 'success',
        text: `Dotation réussie : ${ids.length} tickets affectés à ${agent.full_name} (${agent.matricule}).`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de l’affectation.',
      });
    }
  };

  // Actions métier : Réattribution de tickets non vendus
  const handleReassignUnsold = async () => {
    if (!reassignFromAgentId) {
      setBanner({type: 'error', text: 'Agent source introuvable.'});
      return;
    }

    const unsoldTickets = tickets.filter(
      (t) =>
        t.assigned_agent_id === reassignFromAgentId &&
        ['ASSIGNE_AGENT', 'AVAILABLE'].includes(t.status)
    );

    if (unsoldTickets.length === 0) {
      setBanner({
        type: 'error',
        text: 'Cet agent ne dispose d’aucun ticket non vendu à réattribuer.',
      });
      return;
    }

    const ticketsToMove = unsoldTickets.slice(0, reassignQuantity);
    const ids = ticketsToMove.map((t) => t.id);

    try {
      await portusRepository.reassignUnsoldTickets({
        supervisor: currentProfile,
        fromAgentId: reassignFromAgentId,
        toAgentId: reassignToAgentId || null,
        ticketIds: ids,
        reason: reassignReason,
      });
      setShowReassignModal(false);
      onDataChanged();
      await loadData();
      setBanner({
        type: 'success',
        text: `${ids.length} tickets non vendus réattribués avec succès.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de la réattribution.',
      });
    }
  };

  // Actions métier : Blocage / Déblocage d'un agent
  const handleToggleAgentBlock = async () => {
    if (!targetAgent) return;
    if (blockActionType === 'BLOCK' && !blockReason.trim()) {
      setBanner({
        type: 'error',
        text: 'Un motif explicite est requis pour bloquer un agent.',
      });
      return;
    }

    try {
      await portusRepository.toggleAgentBlockStatus({
        supervisor: currentProfile,
        agentId: targetAgent.id,
        isActive: blockActionType === 'UNBLOCK',
        reason: blockReason.trim() || 'Rétablissement des droits de perception',
      });
      setShowBlockModal(false);
      onDataChanged();
      await loadData();
      setBanner({
        type: blockActionType === 'BLOCK' ? 'warning' : 'success',
        text:
          blockActionType === 'BLOCK'
            ? `Agent ${targetAgent.full_name} bloqué avec succès. Rapport transmis à l’Administrateur.`
            : `Agent ${targetAgent.full_name} réactivé avec succès.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur lors de l’opération.',
      });
    }
  };

  // Actions métier : Décision Mobile Money
  const handleMobileMoneyDecision = async (
    sale: Sale,
    decision: 'CONFIRME' | 'A_CONFIRMER' | 'REJETE',
    rejectionReason?: string
  ) => {
    try {
      await portusRepository.validateMobileMoneySale({
        saleId: sale.id,
        supervisor: currentProfile,
        decision,
        rejectionReason,
      });
      setShowMmRejectModal(false);
      onDataChanged();
      await loadData();
      setBanner({
        type:
          decision === 'CONFIRME'
            ? 'success'
            : decision === 'A_CONFIRMER'
            ? 'info'
            : 'warning',
        text:
          decision === 'CONFIRME'
            ? `Paiement ${sale.payment_method} (${sale.ticket_number}) confirmé sur votre téléphone. Camion en séjour actif.`
            : decision === 'A_CONFIRMER'
            ? `Paiement ${sale.payment_method} mis en attente (Réseau lent / En cours).`
            : `Paiement ${sale.payment_method} rejeté avec motif. Camion basculé « En attente de régularisation ».`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur de traitement Mobile Money.',
      });
    }
  };

  // Actions métier : Confirmation d'encaissement d'espèces (Double validation de caisse)
  const handleConfirmCashRemittance = async () => {
    if (!targetRemittance) return;
    try {
      await portusRepository.confirmRemittanceBySupervisor({
        remittanceId: targetRemittance.id,
        supervisorId: currentProfile.id,
        decision: 'VALIDE_RESPONSABLE',
        notes: cashConfirmNotes,
      });
      setShowConfirmCashModal(false);
      onDataChanged();
      await loadData();
      setBanner({
        type: 'success',
        text: `Encaissement de ${targetRemittance.declared_cash_fcfa.toLocaleString()} FCFA confirmé pour ${targetRemittance.remittance_code}. Recompte contradictoire archivé.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur validation caisse.',
      });
    }
  };

  // Capture et compression de justificatif pour note de dépense
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 800;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.65);
          const sizeKb = Math.round((compressed.length * 3) / 4 / 1024);
          setExpPhotoUrl(compressed);
          setExpPhotoSizeKb(sizeKb);
        }
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Soumission de la note de dépense
  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expTitle.trim() || expAmountFcfa <= 0) {
      setBanner({type: 'error', text: 'Intitulé et montant valide requis.'});
      return;
    }

    try {
      await portusRepository.recordExpenseReport({
        supervisor: currentProfile,
        sectorId: currentProfile.sector_id ?? sectors[0]?.id ?? '11111111-1111-4111-8111-111111111101',
        title: expTitle,
        category: expCategory,
        amountFcfa: expAmountFcfa,
        beneficiary: expBeneficiary,
        justificationNotes: expJustification,
        receiptPhotoDataUrl: expPhotoUrl,
        receiptPhotoSizeKb: expPhotoSizeKb,
      });

      setShowExpenseModal(false);
      setExpTitle('');
      setExpAmountFcfa(10000);
      setExpBeneficiary('');
      setExpJustification('');
      setExpPhotoUrl(null);
      await loadData();
      setBanner({
        type: 'success',
        text: 'Note de dépense enregistrée. Statut « En attente » de validation par l’Administrateur.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur enregistrement dépense.',
      });
    }
  };

  // Acquitter une notification
  const handleAckNotif = async (notifId: string) => {
    try {
      await portusRepository.rpcAckNotification({
        p_notification_id: notifId,
        p_actor_id: currentProfile.id,
      });
      await loadData();
    } catch (err) {
      console.error('Erreur ack notif:', err);
    }
  };

  return (
    <div
      className={`min-h-screen pb-20 transition-colors ${
        highContrastSunMode
          ? 'bg-amber-50 text-black font-semibold'
          : 'bg-slate-900 text-slate-100'
      }`}
    >
      {/* BANDEAU EN-TÊTE HIERARCHIQUE & SUPERVISION */}
      <div
        className={`border-b px-4 py-3 shadow-md ${
          highContrastSunMode
            ? 'border-black bg-white text-black'
            : 'border-slate-800 bg-slate-950 text-white'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#FF8200] text-slate-950 shadow-md">
              <ShieldCheck className="h-6 w-6 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#009E60] px-2 py-0.5 text-xs font-black tracking-wider text-white">
                  RESPONSABLE DE SECTEUR
                </span>
                <span className="text-xs font-bold text-slate-400">
                  {currentProfile.matricule}
                </span>
                <span className="hidden rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300 sm:inline">
                  {currentProfile.callsign}
                </span>
              </div>
              <h1 className="text-base font-black tracking-tight sm:text-lg">
                Supervision Équipe, Tickets & Trésorerie
              </h1>
            </div>
          </div>

          {/* Outils & Mode Soleil */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHighContrastSunMode(!highContrastSunMode)}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition active:scale-95 ${
                highContrastSunMode
                  ? 'border-black bg-amber-300 text-black shadow'
                  : 'border-slate-700 bg-slate-800 text-amber-300 hover:bg-slate-700'
              }`}
              title="Basculer le mode Plein Soleil (contraste élevé)"
            >
              {highContrastSunMode ? (
                <>
                  <Moon className="h-4 w-4" />
                  <span>Mode Nuit</span>
                </>
              ) : (
                <>
                  <Sun className="h-4 w-4 text-[#FF8200]" />
                  <span>Mode Plein Soleil</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                void loadData();
                onDataChanged();
              }}
              disabled={loading}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition active:scale-95 ${
                highContrastSunMode
                  ? 'border-black bg-slate-200 text-black'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Actualiser</span>
            </button>
          </div>
        </div>

        {/* FEED ALERTES IN-APP EN DIRECT (VENTES TICKETS AGENTS) */}
        {unreadTicketSaleNotifs.length > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-[#FF8200] bg-orange-950/60 p-2 text-xs text-orange-200">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 animate-bounce text-[#FF8200]" />
              <span className="font-bold text-white">
                {unreadTicketSaleNotifs.length} ticket(s) vendu(s) récemment par
                vos agents :
              </span>
              <span className="truncate">
                {unreadTicketSaleNotifs[0]?.message}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('NOTIFICATIONS')}
              className="ml-2 font-bold text-[#FF8200] underline hover:text-orange-100"
            >
              Voir tout ({unreadTicketSaleNotifs.length})
            </button>
          </div>
        )}
      </div>

      {/* BANNIÈRE DE NOTIFICATION D'ACTION */}
      {banner && (
        <div
          className={`mx-4 mt-3 flex items-center justify-between rounded-lg p-3 text-sm font-bold shadow-md ${
            banner.type === 'success'
              ? 'border border-[#009E60] bg-emerald-950 text-emerald-200'
              : banner.type === 'error'
              ? 'border border-red-600 bg-red-950 text-red-200'
              : banner.type === 'warning'
              ? 'border border-[#FF8200] bg-orange-950 text-orange-200'
              : 'border border-blue-600 bg-blue-950 text-blue-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-[#009E60]" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-[#FF8200]" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs font-black underline"
          >
            Fermer
          </button>
        </div>
      )}

      {/* NAVIGATION ONGLET PRINCIPAL TACTILE */}
      <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 pt-2 shadow backdrop-blur">
        <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('DASHBOARD')}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
              activeTab === 'DASHBOARD'
                ? 'bg-[#FF8200] text-slate-950 shadow-md'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <TrendingUp className="h-4 w-4" />
            <span>Tableau de Bord</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('GESTION_TICKETS')}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
              activeTab === 'GESTION_TICKETS'
                ? 'bg-[#FF8200] text-slate-950 shadow-md'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <TicketIcon className="h-4 w-4" />
            <span>Gestion des Tickets</span>
            {todayStats.agentsLowStockCount > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-black text-white">
                {todayStats.agentsLowStockCount} bas
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('TRESORERIE_CAISSES')}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
              activeTab === 'TRESORERIE_CAISSES'
                ? 'bg-[#009E60] text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <Banknote className="h-4 w-4" />
            <span>Caisses & Espèces</span>
            {todayStats.pendingCashValidation > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-black text-white">
                {todayStats.pendingCashValidation}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('MOBILE_MONEY')}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
              activeTab === 'MOBILE_MONEY'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <Smartphone className="h-4 w-4" />
            <span>Mobile Money</span>
            {todayStats.pendingMmValidation > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-black text-white animate-pulse">
                {todayStats.pendingMmValidation}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DEPENSES')}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
              activeTab === 'DEPENSES'
                ? 'bg-[#FF8200] text-slate-950 shadow-md'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <Receipt className="h-4 w-4" />
            <span>Notes de Dépense</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('FRAUDES_AUDIT')}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
              activeTab === 'FRAUDES_AUDIT'
                ? 'bg-red-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <AlertOctagon className="h-4 w-4" />
            <span>Fraudes ({relevantFraudReports.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('NOTIFICATIONS')}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition ${
              activeTab === 'NOTIFICATIONS'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <Bell className="h-4 w-4" />
            <span>Alertes</span>
            {unreadTicketSaleNotifs.length > 0 && (
              <span className="rounded-full bg-[#FF8200] px-1.5 py-0.2 text-[10px] font-black text-slate-950">
                {unreadTicketSaleNotifs.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* CONTENU PRINCIPAL PAR ONGLET */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* =========================================================================
            ONGLET 1 : TABLEAU DE BORD DE SUIVI D'ÉQUIPE (KPIs & État global)
        ========================================================================= */}
        {activeTab === 'DASHBOARD' && (
          <div className="space-y-6">
            {/* GRILLE DES KPIS DU JOUR */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div
                className={`rounded-xl border p-4 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                  <span>Encaissé Aujourd'hui</span>
                  <Banknote className="h-4 w-4 text-[#009E60]" />
                </div>
                <div className="mt-2 text-2xl font-black text-[#009E60]">
                  {todayStats.totalSalesAmount.toLocaleString()} FCFA
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400 font-semibold">
                  <span>Espèces : {todayStats.cashTotal.toLocaleString()}</span>
                  <span>MM : {todayStats.mmTotal.toLocaleString()}</span>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                  <span>Ventes Effectuées</span>
                  <TicketIcon className="h-4 w-4 text-[#FF8200]" />
                </div>
                <div className="mt-2 text-2xl font-black text-white">
                  {todayStats.todaySalesCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-400 font-semibold">
                  Taux perception : 100% déclaré
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                  <span>Stock Tickets Secteur</span>
                  <Layers className="h-4 w-4 text-amber-400" />
                </div>
                <div className="mt-2 text-2xl font-black text-amber-400">
                  {todayStats.availableSectorTickets}
                </div>
                <div className="mt-1 text-[11px] text-slate-400 font-semibold">
                  En réserve non attribuée
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 shadow-sm ${
                  todayStats.agentsLowStockCount > 0
                    ? 'border-red-600 bg-red-950/40 text-red-100'
                    : highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                  <span>Alerte Stock Critique</span>
                  <AlertTriangle
                    className={`h-4 w-4 ${
                      todayStats.agentsLowStockCount > 0
                        ? 'text-red-500 animate-pulse'
                        : 'text-slate-400'
                    }`}
                  />
                </div>
                <div
                  className={`mt-2 text-2xl font-black ${
                    todayStats.agentsLowStockCount > 0
                      ? 'text-red-400'
                      : 'text-slate-200'
                  }`}
                >
                  {todayStats.agentsLowStockCount} agent(s)
                </div>
                <div className="mt-1 text-[11px] font-semibold text-slate-400">
                  Stock inférieur à 5 tickets
                </div>
              </div>
            </div>

            {/* SUIVI D'ÉQUIPE : VUE PAR AGENT */}
            <div
              className={`rounded-xl border p-5 shadow-sm ${
                highContrastSunMode
                  ? 'border-black bg-white'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-[#FF8200]" />
                  <h2 className="text-base font-black">
                    Dispositif Équipe Terrain & Agents Volants
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAssignAgentId(agentProfiles[0]?.id ?? '');
                      setShowAssignModal(true);
                    }}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#FF8200] px-3 py-2 text-xs font-black text-slate-950 shadow transition hover:bg-orange-400 active:scale-95"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Affecter une Plage de Tickets</span>
                  </button>
                </div>
              </div>

              {/* LISTE DES AGENTS */}
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {agentProfiles.map((agent) => {
                  const agentSales = sales.filter((s) => s.agent_id === agent.id);
                  const agentTicketsRemaining = tickets.filter(
                    (t) =>
                      t.assigned_agent_id === agent.id &&
                      ['ASSIGNE_AGENT', 'AVAILABLE'].includes(t.status)
                  ).length;
                  const isLow = agentTicketsRemaining < 5 && agent.is_active;

                  return (
                    <div
                      key={agent.id}
                      className={`flex flex-col justify-between rounded-lg border p-4 transition ${
                        !agent.is_active
                          ? 'border-red-900/60 bg-red-950/20 opacity-80'
                          : isLow
                          ? 'border-red-500/80 bg-red-950/10'
                          : highContrastSunMode
                          ? 'border-black bg-slate-100'
                          : 'border-slate-800 bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-black text-white shadow ${
                              !agent.is_active
                                ? 'bg-red-600'
                                : isLow
                                ? 'bg-red-500'
                                : 'bg-[#009E60]'
                            }`}
                          >
                            {agent.full_name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-black text-white">
                                {agent.full_name}
                              </span>
                              {!agent.is_active ? (
                                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                                  BLOQUÉ
                                </span>
                              ) : isLow ? (
                                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-black text-white animate-pulse">
                                  STOCK CRITIQUE (&lt; 5)
                                </span>
                              ) : (
                                <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                                  ACTIF
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400">
                              Matricule: <span className="font-bold">{agent.matricule}</span> ·
                              Radio: <span className="font-bold">{agent.callsign}</span>
                            </div>
                            <div className="text-xs text-slate-400">
                              Tél: {agent.phone}
                            </div>
                          </div>
                        </div>

                        {/* Compteur de tickets restants de l'agent */}
                        <div className="text-right">
                          <div
                            className={`text-xl font-black ${
                              isLow ? 'text-red-400' : 'text-[#FF8200]'
                            }`}
                          >
                            {agentTicketsRemaining}
                          </div>
                          <div className="text-[10px] text-slate-400 font-bold uppercase">
                            Tickets en main
                          </div>
                        </div>
                      </div>

                      {/* STATS DE VENTE AGENT */}
                      <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs">
                        <span className="text-slate-400">
                          Ventes totales :{' '}
                          <strong className="text-white">
                            {agentSales.length}
                          </strong>
                        </span>
                        <span className="text-slate-400">
                          Total perçu :{' '}
                          <strong className="text-[#009E60]">
                            {(
                              agentSales.length * settings.default_contribution_fcfa
                            ).toLocaleString()}{' '}
                            FCFA
                          </strong>
                        </span>
                      </div>

                      {/* ACTIONS RAPIDES SUR L'AGENT */}
                      <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-slate-800/60">
                        <button
                          type="button"
                          onClick={() => {
                            setAssignAgentId(agent.id);
                            setShowAssignModal(true);
                          }}
                          className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded bg-slate-800 px-2 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 active:scale-95"
                        >
                          <Plus className="h-3.5 w-3.5 text-[#FF8200]" />
                          <span>Dotation</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setReassignFromAgentId(agent.id);
                            setReassignQuantity(Math.min(agentTicketsRemaining, 10));
                            setShowReassignModal(true);
                          }}
                          disabled={agentTicketsRemaining === 0}
                          className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded bg-slate-800 px-2 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40 active:scale-95"
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5 text-amber-400" />
                          <span>Réattribuer</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setTargetAgent(agent);
                            setBlockActionType(agent.is_active ? 'BLOCK' : 'UNBLOCK');
                            setBlockReason('');
                            setShowBlockModal(true);
                          }}
                          className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-bold active:scale-95 ${
                            agent.is_active
                              ? 'bg-red-950/60 text-red-300 hover:bg-red-900 border border-red-800/50'
                              : 'bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900 border border-emerald-800/50'
                          }`}
                        >
                          {agent.is_active ? (
                            <>
                              <Lock className="h-3.5 w-3.5" />
                              <span>Bloquer</span>
                            </>
                          ) : (
                            <>
                              <Unlock className="h-3.5 w-3.5" />
                              <span>Débloquer</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            ONGLET 2 : GESTION DES TICKETS & CARNETS (Affectation & Réattribution)
        ========================================================================= */}
        {activeTab === 'GESTION_TICKETS' && (
          <div className="space-y-6">
            {/* CARNETS RECUS DE L'ADMIN */}
            <div
              className={`rounded-xl border p-5 shadow-sm ${
                highContrastSunMode
                  ? 'border-black bg-white'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-[#FF8200]" />
                  <h2 className="text-base font-black">
                    Carnets Dotés par l'Administration UJPAS
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAssignAgentId(agentProfiles[0]?.id ?? '');
                    setShowAssignModal(true);
                  }}
                  className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#FF8200] px-4 py-2 text-xs font-black text-slate-950 shadow transition hover:bg-orange-400 active:scale-95"
                >
                  <Plus className="h-4 w-4" />
                  <span>Affecter Plage aux Agents</span>
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {myBatches.map((batch) => {
                  const batchTickets = tickets.filter((t) => t.batch_id === batch.id);
                  const soldCount = batchTickets.filter((t) =>
                    ['SEJOUR_ACTIF', 'SORTIE_DECLAREE', 'SOLD', 'CLOSED'].includes(
                      t.status
                    )
                  ).length;
                  const assignedCount = batchTickets.filter(
                    (t) =>
                      Boolean(t.assigned_agent_id) &&
                      !['SEJOUR_ACTIF', 'SORTIE_DECLAREE', 'SOLD'].includes(t.status)
                  ).length;
                  const unassignedCount = batchTickets.filter(
                    (t) =>
                      !t.assigned_agent_id &&
                      ['IMPRIME', 'ASSIGNE_SECTEUR', 'AVAILABLE'].includes(t.status)
                  ).length;

                  return (
                    <div
                      key={batch.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-mono text-sm font-black text-[#FF8200]">
                            {batch.batch_code}
                          </div>
                          <div className="text-xs text-slate-400">
                            Série : #{batch.serial_start} à #{batch.serial_end} ({batch.ticket_count} tickets)
                          </div>
                        </div>
                        <span className="rounded bg-emerald-950 px-2 py-0.5 text-xs font-bold text-emerald-300 border border-emerald-800">
                          {batch.status}
                        </span>
                      </div>

                      {/* Barre de progression d'écoulement du carnet */}
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>Écoulement carnet</span>
                          <span className="font-bold text-white">
                            {soldCount} / {batch.ticket_count} vendus
                          </span>
                        </div>
                        <div className="mt-1 h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-[#009E60]"
                            style={{
                              width: `${(soldCount / Math.max(batch.ticket_count, 1)) * 100}%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded bg-slate-800/80 p-2">
                          <div className="font-black text-[#009E60]">{soldCount}</div>
                          <div className="text-[10px] text-slate-400">Vendus</div>
                        </div>
                        <div className="rounded bg-slate-800/80 p-2">
                          <div className="font-black text-amber-400">{assignedCount}</div>
                          <div className="text-[10px] text-slate-400">Chez agents</div>
                        </div>
                        <div className="rounded bg-slate-800/80 p-2">
                          <div className="font-black text-blue-400">{unassignedCount}</div>
                          <div className="text-[10px] text-slate-400">Réserve</div>
                        </div>
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAssignBatchId(batch.id);
                            setShowAssignModal(true);
                          }}
                          className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded bg-slate-800 text-xs font-bold text-slate-200 hover:bg-slate-700 active:scale-95"
                        >
                          <Plus className="h-3.5 w-3.5 text-[#FF8200]" />
                          <span>Distribuer aux Agents</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* VUE DÉTAILLÉE DES TICKETS AVEC FILTRE PAR STATUT ET AGENT */}
            <div
              className={`rounded-xl border p-5 shadow-sm ${
                highContrastSunMode
                  ? 'border-black bg-white'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <TicketIcon className="h-5 w-5 text-[#009E60]" />
                  <h2 className="text-base font-black">
                    Inventaire Unitaire des Tickets du Secteur
                  </h2>
                </div>
                <div className="text-xs text-slate-400">
                  Total : <strong className="text-white">{tickets.length}</strong> tickets
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-slate-400 uppercase">
                    <tr>
                      <th className="p-2">Numéro</th>
                      <th className="p-2">Série</th>
                      <th className="p-2">Statut</th>
                      <th className="p-2">Agent Assigné</th>
                      <th className="p-2">Carnet</th>
                      <th className="p-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {tickets.slice(0, 20).map((t) => {
                      const assignedAgent = profiles.find(
                        (p) => p.id === t.assigned_agent_id
                      );
                      const isUnsold = ['ASSIGNE_AGENT', 'AVAILABLE'].includes(t.status);

                      return (
                        <tr key={t.id} className="hover:bg-slate-900/60">
                          <td className="p-2 font-mono font-bold text-white">
                            {t.ticket_number}
                          </td>
                          <td className="p-2 text-slate-400">#{t.serial_number}</td>
                          <td className="p-2">
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-black ${
                                t.status === 'SEJOUR_ACTIF'
                                  ? 'bg-[#009E60] text-white'
                                  : t.status === 'ASSIGNE_AGENT'
                                  ? 'bg-amber-600/80 text-white'
                                  : t.status === 'EN_ATTENTE_PAIEMENT_MM'
                                  ? 'bg-[#FF8200] text-slate-950'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {t.status}
                            </span>
                          </td>
                          <td className="p-2">
                            {assignedAgent ? (
                              <span className="font-bold text-slate-200">
                                {assignedAgent.full_name} ({assignedAgent.matricule})
                              </span>
                            ) : (
                              <span className="italic text-slate-500">Non assigné (Réserve)</span>
                            )}
                          </td>
                          <td className="p-2 font-mono text-slate-400 text-[11px]">
                            {t.batch_id.slice(0, 8)}...
                          </td>
                          <td className="p-2 text-right">
                            {isUnsold && t.assigned_agent_id && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReassignFromAgentId(t.assigned_agent_id ?? '');
                                  setReassignQuantity(1);
                                  setShowReassignModal(true);
                                }}
                                className="rounded bg-slate-800 px-2 py-1 text-[11px] font-bold text-amber-400 hover:bg-slate-700 active:scale-95"
                              >
                                Réattribuer
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            ONGLET 3 : TRÉSORERIE & CAISSES (Double validation des espèces)
        ========================================================================= */}
        {activeTab === 'TRESORERIE_CAISSES' && (
          <div className="space-y-6">
            <div
              className={`rounded-xl border p-5 shadow-sm ${
                highContrastSunMode
                  ? 'border-black bg-white'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Banknote className="h-5 w-5 text-[#009E60]" />
                  <h2 className="text-base font-black">
                    Pointage Contradictoire & Double Validation des Caisses Agents
                  </h2>
                </div>
                <div className="text-xs text-slate-400">
                  L'agent déclare son Cash · Le Responsable valide l'encaissement
                </div>
              </div>

              {/* LISTE DES REMISES EN ATTENTE DE CONFIRMATION */}
              <div className="mt-4 space-y-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
                  Remises d'espèces soumises par les agents ({remittances.length})
                </h3>

                {remittances.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                    Aucune remise de caisse enregistrée pour l'instant.
                  </div>
                ) : (
                  remittances.map((rem) => {
                    const agent = profiles.find((p) => p.id === rem.agent_id);
                    const isPending =
                      rem.status === 'EN_ATTENTE_RESPONSABLE' || !rem.status;
                    const hasVariance = rem.variance_fcfa !== 0;

                    return (
                      <div
                        key={rem.id}
                        className={`rounded-xl border p-4 transition ${
                          isPending
                            ? 'border-[#FF8200] bg-orange-950/20'
                            : rem.status === 'VALIDE_RESPONSABLE'
                            ? 'border-[#009E60] bg-emerald-950/20'
                            : 'border-slate-800 bg-slate-900/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-black text-white">
                                {rem.remittance_code}
                              </span>
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-black ${
                                  isPending
                                    ? 'bg-[#FF8200] text-slate-950 animate-pulse'
                                    : rem.status === 'VALIDE_RESPONSABLE'
                                    ? 'bg-[#009E60] text-white'
                                    : 'bg-red-600 text-white'
                                }`}
                              >
                                {isPending
                                  ? 'EN ATTENTE CONFIRMATION RESPONSABLE'
                                  : rem.status === 'VALIDE_RESPONSABLE'
                                  ? 'ENCAISSEMENT VALIDÉ'
                                  : 'REJETÉ'}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              Agent :{' '}
                              <strong className="text-white">
                                {agent?.full_name ?? rem.agent_id}
                              </strong>{' '}
                              ({agent?.matricule}) · Poste : {agent?.callsign}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Période : {new Date(rem.created_at).toLocaleString()}
                            </div>
                          </div>

                          {/* MONTANTS & VARIANCE */}
                          <div className="text-right">
                            <div className="text-xs text-slate-400 font-bold">
                              Espèces déclarées par l'agent
                            </div>
                            <div className="text-2xl font-black text-[#009E60]">
                              {rem.declared_cash_fcfa.toLocaleString()} FCFA
                            </div>
                            <div className="text-xs text-slate-400">
                              Attendu : {rem.expected_cash_fcfa.toLocaleString()} FCFA
                            </div>
                            {hasVariance && (
                              <div
                                className={`text-xs font-bold ${
                                  rem.variance_fcfa > 0
                                    ? 'text-emerald-400'
                                    : 'text-red-400'
                                }`}
                              >
                                Écart : {rem.variance_fcfa > 0 ? '+' : ''}
                                {rem.variance_fcfa.toLocaleString()} FCFA
                              </div>
                            )}
                          </div>
                        </div>

                        {/* DÉTAILS VENTES & TICKETS */}
                        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-950/60 p-2.5 text-xs sm:grid-cols-4">
                          <div>
                            <span className="text-slate-400">Ventes déclarées :</span>{' '}
                            <strong className="text-white">{rem.sales_count}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400">Tickets restants :</span>{' '}
                            <strong className="text-amber-400">
                              {rem.tickets_remaining_count}
                            </strong>
                          </div>
                          <div>
                            <span className="text-slate-400">Tickets perdus :</span>{' '}
                            <strong
                              className={
                                rem.tickets_lost_count > 0
                                  ? 'text-red-400'
                                  : 'text-white'
                              }
                            >
                              {rem.tickets_lost_count}
                            </strong>
                          </div>
                          <div>
                            <span className="text-slate-400">Mobile Money :</span>{' '}
                            <strong className="text-white">
                              {rem.mobile_money_total_fcfa.toLocaleString()} FCFA
                            </strong>
                          </div>
                        </div>

                        {rem.notes && (
                          <div className="mt-2 text-xs italic text-slate-300">
                            Note agent : "{rem.notes}"
                          </div>
                        )}

                        {rem.supervisor_confirmed_at && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>
                              Validé par {currentProfile.full_name} le{' '}
                              {new Date(rem.supervisor_confirmed_at).toLocaleString()}
                            </span>
                          </div>
                        )}

                        {/* BOUTON GÉANT CONFIRMER ENCAISSEMENT (DOUBLE VALIDATION) */}
                        {isPending && (
                          <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                            <button
                              type="button"
                              onClick={() => {
                                setTargetRemittance(rem);
                                setCashConfirmNotes(
                                  `Recompte contradictoire effectué devant l'agent ${agent?.full_name}. Montant de ${rem.declared_cash_fcfa.toLocaleString()} FCFA encaissé dans le coffre du secteur.`
                                );
                                setShowConfirmCashModal(true);
                              }}
                              className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-[#009E60] px-4 py-2.5 text-sm font-black text-white shadow-lg transition hover:bg-emerald-600 active:scale-95"
                            >
                              <FileCheck2 className="h-5 w-5" />
                              <span>Confirmer Encaissement ({rem.declared_cash_fcfa.toLocaleString()} FCFA)</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            ONGLET 4 : VALIDATION UNITAIRE MOBILE MONEY (Wave, Orange, MTN, Moov)
        ========================================================================= */}
        {activeTab === 'MOBILE_MONEY' && (
          <div className="space-y-6">
            <div
              className={`rounded-xl border p-5 shadow-sm ${
                highContrastSunMode
                  ? 'border-black bg-white'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-[#FF8200]" />
                  <h2 className="text-base font-black">
                    Validation des Transactions Mobile Money Reçues
                  </h2>
                </div>
                <div className="text-xs text-slate-400">
                  Vérifiez la réception sur votre téléphone avant de confirmer
                </div>
              </div>

              {/* FILTRES RAPIDES */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs">
                  <Filter className="h-3.5 w-3.5 text-slate-400 ml-1" />
                  <button
                    type="button"
                    onClick={() => setFilterMmStatus('TOUS')}
                    className={`rounded px-2.5 py-1 font-bold ${
                      filterMmStatus === 'TOUS'
                        ? 'bg-[#FF8200] text-slate-950'
                        : 'text-slate-300'
                    }`}
                  >
                    Tous
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMmStatus('A_CONFIRMER')}
                    className={`rounded px-2.5 py-1 font-bold ${
                      filterMmStatus === 'A_CONFIRMER'
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-300'
                    }`}
                  >
                    À Confirmer ({todayStats.pendingMmValidation})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMmStatus('CONFIRME')}
                    className={`rounded px-2.5 py-1 font-bold ${
                      filterMmStatus === 'CONFIRME'
                        ? 'bg-[#009E60] text-white'
                        : 'text-slate-300'
                    }`}
                  >
                    Confirmés
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMmStatus('REJETE')}
                    className={`rounded px-2.5 py-1 font-bold ${
                      filterMmStatus === 'REJETE'
                        ? 'bg-red-600 text-white'
                        : 'text-slate-300'
                    }`}
                  >
                    Rejetés
                  </button>
                </div>

                {/* Champ recherche */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={searchSaleQuery}
                    onChange={(e) => setSearchSaleQuery(e.target.value)}
                    placeholder="Recherche plaque, ticket, référence..."
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 py-1.5 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-[#FF8200] focus:outline-none"
                  />
                </div>
              </div>

              {/* LISTE DES TRANSACTIONS MM */}
              <div className="mt-4 space-y-3">
                {filteredMmSales.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                    Aucune transaction Mobile Money correspondant aux critères.
                  </div>
                ) : (
                  filteredMmSales.map((sale) => {
                    const isPending =
                      !sale.payment_confirmed ||
                      sale.mobile_money_validation_status === 'A_CONFIRMER';
                    const isConfirmed =
                      sale.payment_confirmed &&
                      sale.mobile_money_validation_status === 'CONFIRME';
                    const isRejected =
                      sale.mobile_money_validation_status === 'REJETE';

                    return (
                      <div
                        key={sale.id}
                        className={`rounded-xl border p-4 transition ${
                          isPending
                            ? 'border-amber-500/80 bg-amber-950/20'
                            : isConfirmed
                            ? 'border-[#009E60] bg-emerald-950/20'
                            : 'border-red-600 bg-red-950/20'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-black text-amber-300">
                                {sale.payment_method}
                              </span>
                              <span className="font-mono text-sm font-black text-white">
                                {sale.ticket_number}
                              </span>
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-black ${
                                  isConfirmed
                                    ? 'bg-[#009E60] text-white'
                                    : isRejected
                                    ? 'bg-red-600 text-white'
                                    : 'bg-amber-500 text-slate-950'
                                }`}
                              >
                                {isConfirmed
                                  ? 'CONFIRMÉ'
                                  : isRejected
                                  ? 'REJETÉ'
                                  : 'EN ATTENTE VALIDATION'}
                              </span>
                            </div>

                            <div className="mt-2 text-xs text-slate-300">
                              Camion :{' '}
                              <strong className="text-white text-sm">
                                {sale.truck_plate}
                              </strong>{' '}
                              · Chauffeur : {sale.driver_name ?? 'Non renseigné'} (
                              {sale.driver_phone ?? 'N/A'})
                            </div>

                            <div className="mt-1 flex items-center gap-2 text-xs">
                              <span className="text-slate-400">Réf. transaction :</span>
                              <span className="font-mono font-bold text-amber-300">
                                {sale.mobile_money_ref ?? 'AUCUNE RÉFÉRENCE'}
                              </span>
                            </div>

                            <div className="text-[11px] text-slate-400">
                              Date : {new Date(sale.sold_at).toLocaleString()}
                            </div>
                          </div>

                          {/* MONTANT & JUSTIFICATIF PHOTO */}
                          <div className="text-right">
                            <div className="text-xl font-black text-white">
                              {sale.contribution_amount_fcfa.toLocaleString()} FCFA
                            </div>

                            {sale.mobile_money_screenshot_data_url && (
                              <button
                                type="button"
                                onClick={() =>
                                  setViewingPhotoModal({
                                    title: `Capture Mobile Money — ${sale.ticket_number} (${sale.truck_plate})`,
                                    url: sale.mobile_money_screenshot_data_url!,
                                  })
                                }
                                className="mt-2 flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs font-bold text-amber-400 hover:bg-slate-700"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>Voir Capture Reçu</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {sale.mobile_money_rejection_reason && (
                          <div className="mt-2 text-xs text-red-300 bg-red-950/40 p-2 rounded border border-red-900/60">
                            Motif du rejet : {sale.mobile_money_rejection_reason}
                          </div>
                        )}

                        {/* BOUTONS D'ACTION RAPIDE (CONFIRMER, EN ATTENTE RÉSEAU, REJETER) */}
                        {isPending && (
                          <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                            {/* BOUTON CONFIRMER (ACTION PRIMAIRE) */}
                            <button
                              type="button"
                              onClick={() => handleMobileMoneyDecision(sale, 'CONFIRME')}
                              className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-[#009E60] px-4 py-2 text-xs font-black text-white shadow-md transition hover:bg-emerald-600 active:scale-95"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              <span>Confirmer Paiement</span>
                            </button>

                            {/* BOUTON EN ATTENTE (RÉSEAU LENT) */}
                            <button
                              type="button"
                              onClick={() => handleMobileMoneyDecision(sale, 'A_CONFIRMER')}
                              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-lg border border-amber-600 bg-amber-950/40 px-3 py-2 text-xs font-black text-amber-300 transition hover:bg-amber-900/60 active:scale-95"
                              title="Marquer comme en attente (réseau 4G lent ou SMS différé)"
                            >
                              <Clock className="h-4 w-4" />
                              <span>En attente (Réseau lent)</span>
                            </button>

                            {/* BOUTON REJETER AVEC MOTIF */}
                            <button
                              type="button"
                              onClick={() => {
                                setTargetSale(sale);
                                setShowMmRejectModal(true);
                              }}
                              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-lg border border-red-600 bg-red-950/40 px-3 py-2 text-xs font-black text-red-300 transition hover:bg-red-900/60 active:scale-95"
                            >
                              <XCircle className="h-4 w-4" />
                              <span>Rejeter avec motif</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            ONGLET 5 : MODULE DÉPENSES DU RESPONSABLE (En attente validation Admin)
        ========================================================================= */}
        {activeTab === 'DEPENSES' && (
          <div className="space-y-6">
            <div
              className={`rounded-xl border p-5 shadow-sm ${
                highContrastSunMode
                  ? 'border-black bg-white'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-[#FF8200]" />
                  <h2 className="text-base font-black">
                    Notes de Frais & Dépenses Opérationnelles de Secteur
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(true)}
                  className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#FF8200] px-4 py-2 text-xs font-black text-slate-950 shadow transition hover:bg-orange-400 active:scale-95"
                >
                  <Plus className="h-4 w-4" />
                  <span>Saisir une Note de Dépense</span>
                </button>
              </div>

              <div className="mt-3 rounded-lg bg-slate-900/60 p-3 text-xs text-slate-300 border border-slate-800">
                <span className="font-bold text-[#FF8200]">Règle financière UJPAS :</span>{' '}
                Toute dépense saisie reste au statut <strong className="text-amber-400">« En attente »</strong>{' '}
                jusqu'à validation contradictoire formelle par l'Administrateur central.
              </div>

              {/* LISTE DES DÉPENSES DU SECTEUR */}
              <div className="mt-4 space-y-3">
                {expenses.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                    Aucune note de dépense saisie pour ce secteur.
                  </div>
                ) : (
                  expenses.map((exp) => (
                    <div
                      key={exp.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 transition"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-black text-[#FF8200]">
                              {exp.expense_code}
                            </span>
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-black ${
                                exp.status === 'VALIDE'
                                  ? 'bg-[#009E60] text-white'
                                  : exp.status === 'REJETE'
                                  ? 'bg-red-600 text-white'
                                  : 'bg-amber-500 text-slate-950'
                              }`}
                            >
                              {exp.status === 'EN_ATTENTE_ADMIN'
                                ? 'EN ATTENTE VALIDATION ADMIN'
                                : exp.status === 'VALIDE'
                                ? 'VALIDÉ PAR ADMIN'
                                : 'REJETÉ'}
                            </span>
                          </div>

                          <h3 className="mt-1 text-sm font-black text-white">
                            {exp.title}
                          </h3>

                          <div className="text-xs text-slate-400">
                            Catégorie :{' '}
                            <strong className="text-slate-200">
                              {exp.category.replace(/_/g, ' ')}
                            </strong>{' '}
                            {exp.beneficiary && `· Bénéficiaire : ${exp.beneficiary}`}
                          </div>

                          <div className="mt-1 text-xs text-slate-300">
                            Motif : {exp.justification_notes}
                          </div>

                          <div className="mt-1 text-[11px] text-slate-500">
                            Saisie le {new Date(exp.created_at).toLocaleString()}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-2xl font-black text-[#009E60]">
                            {exp.amount_fcfa.toLocaleString()} FCFA
                          </div>

                          {exp.receipt_photo_data_url && (
                            <button
                              type="button"
                              onClick={() =>
                                setViewingPhotoModal({
                                  title: `Justificatif Dépense — ${exp.expense_code}`,
                                  url: exp.receipt_photo_data_url!,
                                })
                              }
                              className="mt-2 flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs font-bold text-amber-400 hover:bg-slate-700"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Voir Reçu ({exp.receipt_photo_size_kb ?? 0} Ko)</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            ONGLET 6 : FRAUDES ET ANOMALIES (Accès en Lecture Seule pour Responsable)
        ========================================================================= */}
        {activeTab === 'FRAUDES_AUDIT' && (
          <div className="space-y-6">
            <div
              className={`rounded-xl border p-5 shadow-sm ${
                highContrastSunMode
                  ? 'border-black bg-white'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <AlertOctagon className="h-5 w-5 text-red-500" />
                  <div>
                    <h2 className="text-base font-black">
                      Signalements de Fraude Impliquant vos Tickets ou Agents
                    </h2>
                    <span className="text-xs font-bold text-slate-400">
                      Accès en LECTURE SEULE · Enquêtes menées par le Contrôleur et l'Administrateur
                    </span>
                  </div>
                </div>
                <span className="rounded bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-300">
                  {relevantFraudReports.length} dossier(s)
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {relevantFraudReports.length === 0 ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                    Aucun rapport de fraude ou anomalie répertorié sur votre secteur.
                  </div>
                ) : (
                  relevantFraudReports.map((report) => (
                    <div
                      key={report.id}
                      className="rounded-lg border border-red-900/60 bg-red-950/20 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-black text-white">
                              {report.verdict}
                            </span>
                            <span className="font-mono text-xs text-slate-400">
                              Ticket : {report.ticket_number_scanned}
                            </span>
                          </div>

                          <div className="mt-2 text-sm font-bold text-white">
                            Camion observé : {report.observed_truck_plate}
                          </div>

                          <div className="mt-1 text-xs text-slate-300">
                            Action engagée : {report.action_taken}
                          </div>

                          {report.notes && (
                            <div className="mt-1 text-xs italic text-slate-400">
                              Constat du contrôleur : "{report.notes}"
                            </div>
                          )}

                          <div className="mt-2 text-[11px] text-slate-500">
                            Contrôlé le {new Date(report.controlled_at).toLocaleString()}
                          </div>
                        </div>

                        <div className="rounded border border-amber-600/60 bg-amber-950/40 p-2 text-right text-[11px] text-amber-200">
                          <div className="font-black">DOSSIER SOUS ENQUÊTE</div>
                          <div>Décision réservée à l'Administrateur</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            ONGLET 7 : NOTIFICATIONS TEMPS RÉEL (Ventes tickets par les agents)
        ========================================================================= */}
        {activeTab === 'NOTIFICATIONS' && (
          <div className="space-y-6">
            <div
              className={`rounded-xl border p-5 shadow-sm ${
                highContrastSunMode
                  ? 'border-black bg-white'
                  : 'border-slate-800 bg-slate-950'
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-[#FF8200]" />
                  <h2 className="text-base font-black">
                    Historique des Alertes & Ventes Tickets Agents
                  </h2>
                </div>
                <div className="text-xs text-slate-400">
                  {notifications.length} notification(s) au total
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    Aucune notification pour le moment.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-start justify-between rounded-lg border p-3 transition ${
                        !n.is_read
                          ? 'border-[#FF8200] bg-orange-950/30'
                          : 'border-slate-800 bg-slate-900/40 text-slate-400'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                            !n.is_read
                              ? 'bg-[#FF8200] text-slate-950'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <TicketIcon className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <div className="font-bold text-white text-xs">{n.title}</div>
                          <div className="text-xs text-slate-300 mt-0.5">{n.message}</div>
                          <div className="text-[10px] text-slate-500 mt-1">
                            {new Date(n.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {!n.is_read && (
                        <button
                          type="button"
                          onClick={() => handleAckNotif(n.id)}
                          className="shrink-0 rounded bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-200 hover:bg-slate-700"
                        >
                          Marquer lu
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          MODALES DE TRAITEMENT (Affectation, Réattribution, Blocage, MM, Caisses, Dépenses)
      ========================================================================= */}

      {/* MODALE 1 : AFFECTATION PLAGE DE TICKETS */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-black text-white">
                Affectation d'une Plage de Tickets aux Agents
              </h3>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300">
                  Agent bénéficiaire (y compris agents volants)
                </label>
                <select
                  value={assignAgentId}
                  onChange={(e) => setAssignAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                >
                  {agentProfiles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name} ({a.matricule} · {a.callsign})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300">
                  Carnet source (Administration UJPAS)
                </label>
                <select
                  value={assignBatchId}
                  onChange={(e) => setAssignBatchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                >
                  <option value="">Tous les carnets disponibles</option>
                  {myBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_code} (#{b.serial_start} - #{b.serial_end})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300">
                  Nombre de tickets à affecter
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={assignQuantity}
                  onChange={(e) => setAssignQuantity(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white font-mono"
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="flex-1 rounded-lg bg-slate-800 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleAssignTicketRange}
                  className="flex-1 rounded-lg bg-[#FF8200] py-2.5 text-xs font-black text-slate-950 hover:bg-orange-400 active:scale-95 shadow"
                >
                  Confirmer l'affectation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODALE 2 : RÉATTRIBUTION TICKETS NON VENDUS */}
      {showReassignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-black text-white">
                Réattribution des Tickets Non Vendus
              </h3>
              <button
                type="button"
                onClick={() => setShowReassignModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300">
                  Agent détenteur actuel
                </label>
                <select
                  value={reassignFromAgentId}
                  onChange={(e) => setReassignFromAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                >
                  {agentProfiles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name} ({a.matricule})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300">
                  Nouvel Agent destinataire (ou Laisser vide pour Réserve secteur)
                </label>
                <select
                  value={reassignToAgentId}
                  onChange={(e) => setReassignToAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                >
                  <option value="">-- Remettre en Réserve du Secteur --</option>
                  {agentProfiles
                    .filter((a) => a.id !== reassignFromAgentId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.full_name} ({a.matricule} · {a.callsign})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300">
                  Nombre de tickets à réattribuer
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={reassignQuantity}
                  onChange={(e) => setReassignQuantity(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300">
                  Motif de la réattribution
                </label>
                <input
                  type="text"
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowReassignModal(false)}
                  className="flex-1 rounded-lg bg-slate-800 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleReassignUnsold}
                  className="flex-1 rounded-lg bg-amber-500 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-400 active:scale-95 shadow"
                >
                  Valider la réattribution
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODALE 3 : BLOCAGE / DÉBLOCAGE D'AGENT */}
      {showBlockModal && targetAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-700 bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-base font-black">
                {blockActionType === 'BLOCK' ? 'Blocage Sécuritaire' : 'Réactivation'} de l'Agent
              </h3>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <p>
                Agent ciblé :{' '}
                <strong className="text-white text-sm">
                  {targetAgent.full_name} ({targetAgent.matricule})
                </strong>
              </p>
              {blockActionType === 'BLOCK' ? (
                <div className="rounded bg-red-950/60 p-3 text-red-200 border border-red-900">
                  Le blocage désactivera immédiatement l'autorisation de vente et le
                  compte de l'agent. Une alerte d'urgence sera transmise à l'Administrateur.
                </div>
              ) : (
                <div className="rounded bg-emerald-950/60 p-3 text-emerald-200 border border-emerald-900">
                  La réactivation rétablira le droit de perception et l'accès de l'agent.
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-300">
                  Motif formel ({blockActionType === 'BLOCK' ? 'obligatoire' : 'optionnel'}) :
                </label>
                <textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Ex : Écart de caisse récurrent, refus d'obtempérer aux consignes corridor..."
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowBlockModal(false)}
                  className="flex-1 rounded-lg bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleToggleAgentBlock}
                  className={`flex-1 rounded-lg py-2.5 font-black text-white active:scale-95 shadow ${
                    blockActionType === 'BLOCK'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-[#009E60] hover:bg-emerald-600'
                  }`}
                >
                  {blockActionType === 'BLOCK' ? 'Confirmer le Blocage' : 'Réactiver l’Agent'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODALE 4 : REJET MOBILE MONEY AVEC MOTIF */}
      {showMmRejectModal && targetSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-700 bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-red-400">
              <XCircle className="h-5 w-5" />
              <h3 className="text-base font-black">
                Rejet du Paiement Mobile Money
              </h3>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <p>
                Ticket : <strong>{targetSale.ticket_number}</strong> · Camion :{' '}
                <strong className="text-white">{targetSale.truck_plate}</strong>
              </p>
              <div className="rounded bg-red-950/60 p-3 text-red-200 border border-red-900">
                Le rejet placera immédiatement le véhicule au statut « En attente de régularisation »
                et alertera le Contrôleur Routier et l'Agent percepteur.
              </div>

              <div>
                <label className="block font-bold text-slate-300">
                  Motif du rejet :
                </label>
                <select
                  value={mmRejectReason}
                  onChange={(e) => setMmRejectReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                >
                  <option value="Référence introuvable sur le relevé de compte — Transaction non créditée">
                    Référence introuvable sur le relevé opérateur
                  </option>
                  <option value="Montant perçu non conforme au tarif officiel (2 500 FCFA)">
                    Montant insuffisant ou incohérent
                  </option>
                  <option value="Référence de paiement déjà utilisée pour un autre véhicule">
                    Référence frauduleusement dupliquée
                  </option>
                  <option value="Numéro émetteur ou capture falsifiée">
                    Preuve ou capture d'écran falsifiée
                  </option>
                </select>
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowMmRejectModal(false)}
                  className="flex-1 rounded-lg bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleMobileMoneyDecision(targetSale, 'REJETE', mmRejectReason)
                  }
                  className="flex-1 rounded-lg bg-red-600 py-2.5 font-black text-white hover:bg-red-700 active:scale-95 shadow"
                >
                  Confirmer le Rejet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODALE 5 : DOUBLE VALIDATION D'ENCAISSEMENT CAISSE */}
      {showConfirmCashModal && targetRemittance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[#009E60] bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-[#009E60]">
              <FileCheck2 className="h-6 w-6" />
              <h3 className="text-base font-black">
                Confirmation d'Encaissement des Espèces (Double Validation)
              </h3>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="rounded-lg bg-slate-950 p-4 border border-slate-800">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Montant en espèces à encaisser :</span>
                  <span className="text-2xl font-black text-[#009E60]">
                    {targetRemittance.declared_cash_fcfa.toLocaleString()} FCFA
                  </span>
                </div>
                <div className="mt-2 text-slate-400">
                  Remise code : <strong className="text-white">{targetRemittance.remittance_code}</strong>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300">
                  Note contradictoire du Responsable de Secteur :
                </label>
                <textarea
                  value={cashConfirmNotes}
                  onChange={(e) => setCashConfirmNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowConfirmCashModal(false)}
                  className="flex-1 rounded-lg bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCashRemittance}
                  className="flex-1 rounded-lg bg-[#009E60] py-3 text-sm font-black text-white hover:bg-emerald-600 active:scale-95 shadow-lg"
                >
                  Confirmer Encaissement
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODALE 6 : SAISIE D'UNE NOTE DE DÉPENSE */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-black text-white">
                Nouvelle Note de Dépense Opérationnelle
              </h3>
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitExpense} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300">
                  Intitulé de la dépense *
                </label>
                <input
                  type="text"
                  required
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  placeholder="Ex : Carburant groupe électrogène poste corridor TC1"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">
                    Catégorie *
                  </label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                  >
                    <option value="CARBURANT_GROUPE">Carburant Groupe</option>
                    <option value="FOURNITURES_TICKETS_SCELLES">Fournitures & Scellés</option>
                    <option value="URGENCE_SANTE_SECOURS">Urgence Santé & Secours</option>
                    <option value="MAINTENANCE_POSTE">Maintenance Poste</option>
                    <option value="RATIONNEMENT_EQUIPE">Rationnement Équipe</option>
                    <option value="AUTRE_LOGISTIQUE">Autre Logistique</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-300">
                    Montant (FCFA) *
                  </label>
                  <input
                    type="number"
                    min="500"
                    step="500"
                    required
                    value={expAmountFcfa}
                    onChange={(e) => setExpAmountFcfa(parseInt(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300">
                  Bénéficiaire / Fournisseur
                </label>
                <input
                  type="text"
                  value={expBeneficiary}
                  onChange={(e) => setExpBeneficiary(e.target.value)}
                  placeholder="Ex : Station TotalEnergies Vridi Port"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300">
                  Justification détaillée circonstanciée *
                </label>
                <textarea
                  required
                  value={expJustification}
                  onChange={(e) => setExpJustification(e.target.value)}
                  placeholder="Préciser l'urgence, l'heure et l'impact opérationnel..."
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white"
                  rows={3}
                />
              </div>

              {/* JUSTIFICATIF PHOTO COMPRESSÉ */}
              <div>
                <label className="block font-bold text-slate-300">
                  Justificatif / Reçu Photo (compression automatique &lt;canvas&gt;)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={fileInputRef}
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
                <div className="mt-1 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
                  >
                    <Camera className="h-4 w-4 text-[#FF8200]" />
                    <span>Prendre photo reçu</span>
                  </button>
                  {expPhotoUrl && (
                    <span className="text-xs text-[#009E60] font-bold">
                      ✓ Reçu capturé ({expPhotoSizeKb} Ko)
                    </span>
                  )}
                </div>

                {expPhotoUrl && (
                  <div className="mt-2 h-28 w-28 overflow-hidden rounded border border-slate-700">
                    <img
                      src={expPhotoUrl}
                      alt="Reçu"
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="flex-1 rounded-lg bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-[#FF8200] py-2.5 font-black text-slate-950 hover:bg-orange-400 active:scale-95 shadow"
                >
                  Soumettre pour Validation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE VISIONNEUSE PHOTO */}
      {viewingPhotoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="text-xs font-black text-white">
                {viewingPhotoModal.title}
              </h4>
              <button
                type="button"
                onClick={() => setViewingPhotoModal(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 flex justify-center overflow-hidden rounded-lg bg-black">
              <img
                src={viewingPhotoModal.url}
                alt="Preuve"
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
