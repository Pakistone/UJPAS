/**
 * PORTUS — Module Frontend Complet de l'ADMINISTRATEUR (UJPAS Vridi, Abidjan)
 *
 * RÈGLES MÉTIER :
 * 1. Omnipotence :
 *    - L'Admin crée les comptes, attribue les rôles (ADMINISTRATEUR, RESPONSABLE, AGENT, CONTROLEUR, AUDITEUR).
 *    - Gestion fine des permissions cumulables (peut_vendre, peut_controler, peut_signaler, secteur, indicatif radio).
 *    - Il peut lui-même enregistrer une vente directe ou effectuer un contrôle routier.
 * 2. Tableau de bord matinal :
 *    - Affiche en GÉANT l'argent total encaissé la veille et les recettes du jour.
 *    - Suivi des problèmes critiques ouverts (fraudes, incidents de sécurité, alertes régularisation).
 * 3. Éditique :
 *    - Moteur de génération PDF (`jspdf`) souple pour imprimer les carnets de 6 tickets A4
 *      et les badges professionnels CR80 (bandeau couleur réglementaire par rôle).
 *    - Réimpression libre d'anciens carnets ou de badges individuels.
 * 4. Trésorerie & Dépenses :
 *    - Trésorier central : encaisse et vérifie les reversements des Responsables (treasury_deposits).
 *    - Enregistre des dépenses directes de la Trésorerie Centrale.
 *    - Valide ou rejette les notes de frais soumises par les Responsables de secteur.
 * 5. Le Tribunal (Sanctions) :
 *    - Arbitrage des rapports de contrôleurs routiers.
 *    - Émission d'avertissements, mise à pied ou révocation définitive d'agents.
 *    - Inscription de chauffeurs et camions sur la Liste Rouge (Blacklist) avec motif.
 * 6. Design ERP :
 *    - Menu latéral complet (Sidebar), vues denses et structurées, graphiques de suivi financier.
 */

import React, {useState, useEffect, useMemo, useRef} from 'react';
import {
  BarChart3,
  Users,
  Printer,
  Scale,
  Banknote,
  AlertOctagon,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  Plus,
  Search,
  Filter,
  FileText,
  Layers,
  Calendar,
  TrendingUp,
  UserCheck,
  UserX,
  ShieldCheck,
  Eye,
  RefreshCw,
  Truck,
  FileSpreadsheet,
  Lock,
  Unlock,
  Clock,
  ArrowUpRight,
  Sun,
  Moon,
  FileCheck2,
  Receipt,
  UserPlus,
  Edit,
  Radio,
  BookOpen,
  Sliders,
} from 'lucide-react';
import {portusRepository} from '../lib/supabase/client';
import {
  generateTicketsLandscapePdfSheet,
  generateBadgesPortraitPdfSheet,
  generateWeeklyPartnerAuditReportPDF,
} from '../lib/pdf/generator';
import type {
  AppSettings,
  PaymentMethod,
  Profile,
  Remittance,
  Sale,
  Sector,
  Ticket,
  TicketBatch,
  TreasuryDeposit,
  ExpenseReport,
  ExpenseCategory,
  FraudReport,
  Incident,
  BlacklistEntry,
  AgentSanction,
  SanctionLevel,
  UserRole,
} from '../types/portus';

interface AdminAuditeurWorkspaceProps {
  currentProfile: Profile;
  profiles: Profile[];
  sectors: Sector[];
  tickets: Ticket[];
  sales: Sale[];
  settings: AppSettings;
  onDataChanged?: () => void;
}

type AdminView =
  | 'MATIN_DASHBOARD'
  | 'COMPTES_ROLES'
  | 'OPERATIONS_DIRECTES'
  | 'EDITIQUE_PDF'
  | 'TRESORERIE_DEPENSES'
  | 'LE_TRIBUNAL'
  | 'FINANCE_AUDIT';

export const AdminAuditeurWorkspace: React.FC<AdminAuditeurWorkspaceProps> = ({
  currentProfile,
  profiles,
  sectors,
  tickets,
  sales,
  settings,
  onDataChanged,
}) => {
  // Navigation ERP
  const [activeView, setActiveView] = useState<AdminView>('MATIN_DASHBOARD');
  const [highContrastSunMode, setHighContrastSunMode] = useState<boolean>(false);

  // Données chargées
  const [batches, setBatches] = useState<TicketBatch[]>([]);
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [deposits, setDeposits] = useState<TreasuryDeposit[]>([]);
  const [expenses, setExpenses] = useState<ExpenseReport[]>([]);
  const [fraudReports, setFraudReports] = useState<FraudReport[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [sanctions, setSanctions] = useState<AgentSanction[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Bannières & Feedback
  const [banner, setBanner] = useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
  } | null>(null);

  // Modales d'administration
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showSanctionModal, setShowSanctionModal] = useState<boolean>(false);
  const [targetAgentSanction, setTargetAgentSanction] = useState<Profile | null>(null);
  const [showBlacklistModal, setShowBlacklistModal] = useState<boolean>(false);
  const [showDirectExpenseModal, setShowDirectExpenseModal] = useState<boolean>(false);
  const [showDirectSaleModal, setShowDirectSaleModal] = useState<boolean>(false);
  const [showDirectControlModal, setShowDirectControlModal] = useState<boolean>(false);
  const [showNewBatchModal, setShowNewBatchModal] = useState<boolean>(false);

  // Formulaire Utilisateur (Omnipotence)
  const [userMatricule, setUserMatricule] = useState<string>('');
  const [userFullName, setUserFullName] = useState<string>('');
  const [userPhone, setUserPhone] = useState<string>('');
  const [userRole, setUserRole] = useState<UserRole>('AGENT');
  const [userSectorId, setUserSectorId] = useState<string>('');
  const [userCallsign, setUserCallsign] = useState<string>('');
  const [userPeutVendre, setUserPeutVendre] = useState<boolean>(true);
  const [userPeutControler, setUserPeutControler] = useState<boolean>(false);
  const [userPeutSignaler, setUserPeutSignaler] = useState<boolean>(true);
  const [userIsActive, setUserIsActive] = useState<boolean>(true);

  // Formulaire Sanction Agent (Le Tribunal)
  const [sanctionLevel, setSanctionLevel] = useState<SanctionLevel>('AVERTISSEMENT_ECRIT');
  const [sanctionMotif, setSanctionMotif] = useState<string>('');
  const [sanctionDetails, setSanctionDetails] = useState<string>('');
  const [sanctionDays, setSanctionDays] = useState<number>(7);

  // Formulaire Liste Rouge / Blacklist
  const [blTruckPlate, setBlTruckPlate] = useState<string>('');
  const [blDriverName, setBlDriverName] = useState<string>('');
  const [blDriverPhone, setBlDriverPhone] = useState<string>('');
  const [blReason, setBlReason] = useState<string>('');
  const [blSeverity, setBlSeverity] = useState<
    'ATTENTION' | 'INTERDICTION_ACCES' | 'POURSUITE_JUDICIAIRE'
  >('INTERDICTION_ACCES');

  // Formulaire Dépense Directe Centrale
  const [dirExpTitle, setDirExpTitle] = useState<string>('');
  const [dirExpCategory, setDirExpCategory] = useState<ExpenseCategory>('AUTRE_LOGISTIQUE');
  const [dirExpAmount, setDirExpAmount] = useState<number>(25000);
  const [dirExpBeneficiary, setDirExpBeneficiary] = useState<string>('');
  const [dirExpJustification, setDirExpJustification] = useState<string>('');

  // Formulaire Vente Directe Administrateur (Omnipotence)
  const [dirSalePlate, setDirSalePlate] = useState<string>('');
  const [dirSaleCountry, setDirSaleCountry] = useState<'CI' | 'BF' | 'ML' | 'NE' | 'GH' | 'TG'>('CI');
  const [dirSaleDriver, setDirSaleDriver] = useState<string>('');
  const [dirSalePhone, setDirSalePhone] = useState<string>('');
  const [dirSalePaymentMethod, setDirSalePaymentMethod] = useState<PaymentMethod>('ESPECES');
  const [dirSaleMmRef, setDirSaleMmRef] = useState<string>('');

  // Formulaire Contrôle Routier Direct
  const [dirCtrlPlateOrTicket, setDirCtrlPlateOrTicket] = useState<string>('');
  const [dirCtrlResult, setDirCtrlResult] = useState<{
    found: boolean;
    ticket?: Ticket;
    sale?: Sale;
    verdict?: string;
  } | null>(null);

  // Formulaire Nouveau Carnet
  const [newBatchSectorId, setNewBatchSectorId] = useState<string>('');
  const [newBatchCount, setNewBatchCount] = useState<number>(50);

  // Éditique PDF & Curseurs de calibrage (mémorisés dans localStorage)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [selectedBatchForReprint, setSelectedBatchForReprint] = useState<string>('');
  const [calibOffsetX, setCalibOffsetX] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('portus_printer_offset_x_mm');
      return saved ? Number(saved) : 0;
    }
    return 0;
  });
  const [calibOffsetY, setCalibOffsetY] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('portus_printer_offset_y_mm');
      return saved ? Number(saved) : 0;
    }
    return 0;
  });

  const handleUpdateOffsetX = (val: number) => {
    setCalibOffsetX(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('portus_printer_offset_x_mm', String(val));
    }
  };

  const handleUpdateOffsetY = (val: number) => {
    setCalibOffsetY(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('portus_printer_offset_y_mm', String(val));
    }
  };

  // Recherche comptes
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('TOUS');

  // Chargement global
  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [
        allBatches,
        allRem,
        allDep,
        allExp,
        allFrauds,
        allIncidents,
        allBlacklist,
        allSanctions,
      ] = await Promise.all([
        portusRepository.getTicketBatches(),
        portusRepository.getRemittances(),
        portusRepository.getTreasuryDeposits(),
        portusRepository.getExpenses(),
        portusRepository.getFraudReports(),
        portusRepository.getIncidents(),
        portusRepository.getBlacklist(),
        portusRepository.getAgentSanctions(),
      ]);
      setBatches(allBatches);
      setRemittances(allRem);
      setDeposits(allDep);
      setExpenses(allExp);
      setFraudReports(allFrauds);
      setIncidents(allIncidents);
      setBlacklist(allBlacklist);
      setSanctions(allSanctions);
    } catch (err) {
      console.error('Erreur chargement données Admin:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, [sales, tickets]);

  // =========================================================================
  // CALCULS STATISTIQUES MATINALES & FINANCIÈRES
  // =========================================================================

  const morningBriefing = useMemo(() => {
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const yesterdayDate = new Date(now.getTime() - 24 * 3600 * 1000);
    const yesterdayIso = yesterdayDate.toISOString().slice(0, 10);

    // Ventes d'hier
    const yesterdaySales = sales.filter((s) => s.sold_at.startsWith(yesterdayIso));
    const yesterdayTotalFcfa = yesterdaySales.reduce(
      (sum, s) => sum + s.contribution_amount_fcfa,
      0
    );
    const yesterdayCashFcfa = yesterdaySales
      .filter((s) => s.payment_method === 'ESPECES')
      .reduce((sum, s) => sum + s.contribution_amount_fcfa, 0);
    const yesterdayMmFcfa = yesterdaySales
      .filter((s) => s.payment_method !== 'ESPECES')
      .reduce((sum, s) => sum + s.contribution_amount_fcfa, 0);

    // Ventes d'aujourd'hui en cours
    const todaySales = sales.filter((s) => s.sold_at.startsWith(todayIso));
    const todayTotalFcfa = todaySales.reduce(
      (sum, s) => sum + s.contribution_amount_fcfa,
      0
    );

    // Recettes cumulées globales
    const totalCollectedHistorical = sales.reduce(
      (sum, s) => sum + s.contribution_amount_fcfa,
      0
    );

    // Problèmes critiques ouverts
    const openIncidents = incidents.filter(
      (inc) => inc.status === 'OUVERT' || inc.severity === 'CRITIQUE' || inc.severity === 'URGENCE_ABSOLUE'
    );
    const unresolvedFrauds = fraudReports.filter(
      (f) => f.verdict !== 'CONFORME_ACTIF'
    );
    const pendingExpenses = expenses.filter(
      (e) => e.status === 'EN_ATTENTE_ADMIN'
    );
    const activeBlacklistCount = blacklist.filter((b) => b.is_active).length;
    const suspendedAgents = profiles.filter(
      (p) => !p.is_active && (p.role === 'AGENT' || p.role === 'AGENT_TERRAIN')
    );

    return {
      yesterdayTotalFcfa,
      yesterdayCashFcfa,
      yesterdayMmFcfa,
      yesterdaySalesCount: yesterdaySales.length,
      todayTotalFcfa,
      todaySalesCount: todaySales.length,
      totalCollectedHistorical,
      openIncidentsCount: openIncidents.length,
      unresolvedFraudsCount: unresolvedFrauds.length,
      pendingExpensesCount: pendingExpenses.length,
      activeBlacklistCount,
      suspendedAgentsCount: suspendedAgents.length,
      criticalAlertsTotal:
        openIncidents.length +
        unresolvedFrauds.length +
        pendingExpenses.length +
        activeBlacklistCount,
    };
  }, [sales, incidents, fraudReports, expenses, blacklist, profiles]);

  // =========================================================================
  // ACTIONS MÉTIER : GESTION DES COMPTES (OMNIPOTENCE)
  // =========================================================================

  const handleOpenCreateUser = () => {
    setEditingProfile(null);
    setUserMatricule(`UJPAS-${userRole.slice(0, 3)}-${String(profiles.length + 1).padStart(3, '0')}`);
    setUserFullName('');
    setUserPhone('+22507');
    setUserRole('AGENT');
    setUserSectorId(sectors[0]?.id ?? '');
    setUserCallsign(`VRIDI-${profiles.length + 1}`);
    setUserPeutVendre(true);
    setUserPeutControler(false);
    setUserPeutSignaler(true);
    setUserIsActive(true);
    setShowUserModal(true);
  };

  const handleOpenEditUser = (p: Profile) => {
    setEditingProfile(p);
    setUserMatricule(p.matricule);
    setUserFullName(p.full_name);
    setUserPhone(p.phone);
    setUserRole(p.role);
    setUserSectorId(p.sector_id ?? '');
    setUserCallsign(p.callsign);
    setUserPeutVendre(p.peut_vendre);
    setUserPeutControler(p.peut_controler);
    setUserPeutSignaler(p.peut_signaler);
    setUserIsActive(p.is_active);
    setShowUserModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userFullName.trim() || !userMatricule.trim()) {
      setBanner({type: 'error', text: 'Nom complet et matricule requis.'});
      return;
    }

    try {
      if (editingProfile) {
        await portusRepository.updateProfile(
          editingProfile.id,
          {
            full_name: userFullName,
            phone: userPhone,
            role: userRole,
            sector_id: userSectorId || null,
            callsign: userCallsign,
            peut_vendre: userPeutVendre,
            peut_controler: userPeutControler,
            peut_signaler: userPeutSignaler,
            is_active: userIsActive,
          },
          currentProfile
        );
        setBanner({
          type: 'success',
          text: `Compte ${editingProfile.matricule} mis à jour avec succès.`,
        });
      } else {
        await portusRepository.createProfile({
          admin: currentProfile,
          matricule: userMatricule,
          fullName: userFullName,
          phone: userPhone,
          role: userRole,
          sectorId: userSectorId || null,
          callsign: userCallsign,
          peutVendre: userPeutVendre,
          peutControler: userPeutControler,
          peutSignaler: userPeutSignaler,
        });
        setBanner({
          type: 'success',
          text: `Nouveau profil ${userMatricule} créé avec succès.`,
        });
      }
      setShowUserModal(false);
      onDataChanged?.();
      await loadAdminData();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur sauvegarde utilisateur.',
      });
    }
  };

  // =========================================================================
  // ACTIONS MÉTIER : VENTE DIRECTE PAR L'ADMINISTRATEUR (OMNIPOTENCE)
  // =========================================================================

  const handleExecuteDirectAdminSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirSalePlate.trim()) {
      setBanner({type: 'error', text: 'Immatriculation du camion requise.'});
      return;
    }

    // Trouver un ticket disponible
    const availableTicket = tickets.find((t) =>
      ['AVAILABLE', 'IMPRIME', 'ASSIGNE_SECTEUR'].includes(t.status)
    );
    if (!availableTicket) {
      setBanner({
        type: 'error',
        text: 'Aucun ticket disponible en réserve pour la vente directe.',
      });
      return;
    }

    try {
      const idempotencyKey = `ADMIN-SALE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await portusRepository.rpcSyncSale({
        p_idempotency_key: idempotencyKey,
        p_agent_id: currentProfile.id,
        p_ticket_number: availableTicket.ticket_number,
        p_truck_plate: dirSalePlate,
        p_driver_name: dirSaleDriver || 'Chauffeur Vente Admin',
        p_driver_phone: dirSalePhone || '+22507000000',
        p_country_origin: dirSaleCountry,
        p_payment_method: dirSalePaymentMethod,
        p_mobile_money_ref: dirSaleMmRef || undefined,
        p_offline_created: false,
      });

      setShowDirectSaleModal(false);
      setDirSalePlate('');
      setDirSaleDriver('');
      setDirSalePhone('');
      setDirSaleMmRef('');
      onDataChanged?.();
      await loadAdminData();
      setBanner({
        type: 'success',
        text: `Vente directe enregistrée par l’Administration UJPAS pour le camion ${dirSalePlate} (Ticket ${availableTicket.ticket_number}).`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur vente directe Admin.',
      });
    }
  };

  // =========================================================================
  // ACTIONS MÉTIER : CONTRÔLE ROUTIER DIRECT PAR L'ADMINISTRATEUR
  // =========================================================================

  const handleExecuteDirectControl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirCtrlPlateOrTicket.trim()) return;

    const query = dirCtrlPlateOrTicket.trim().toUpperCase().replace(/\s+/g, '-');
    const matchedSale = sales.find(
      (s) => s.truck_plate === query || s.ticket_number === query
    );
    const matchedTicket = tickets.find((t) => t.ticket_number === query);

    if (matchedSale) {
      const isExpired = new Date(matchedSale.max_stay_expires_at).getTime() < Date.now();
      const verdict = isExpired
        ? 'DÉPASSEMENT DE DURÉE DE SÉJOUR (> 24H)'
        : matchedSale.payment_confirmed
        ? 'CONFORME — SÉJOUR EN COURS ACTIF'
        : 'PAIEMENT MOBILE MONEY NON CONFIRMÉ';

      setDirCtrlResult({
        found: true,
        sale: matchedSale,
        ticket: matchedTicket,
        verdict,
      });
    } else if (matchedTicket) {
      setDirCtrlResult({
        found: true,
        ticket: matchedTicket,
        verdict: `TICKET RÉPERTORIÉ (${matchedTicket.status}) — AUCUNE VENTE LIÉE`,
      });
    } else {
      setDirCtrlResult({
        found: false,
        verdict: 'VÉHICULE OU TICKET INCONNU DANS LE SYSTÈME UJPAS',
      });
    }
  };

  // =========================================================================
  // ACTIONS MÉTIER : TRÉSORERIE & DÉPENSES
  // =========================================================================

  const handleVerifyDeposit = async (depositId: string, status: 'VERIFIE' | 'ECART_SIGNALE') => {
    try {
      await portusRepository.verifyTreasuryDeposit({
        depositId,
        verifier: currentProfile,
        status,
      });
      onDataChanged?.();
      await loadAdminData();
      setBanner({
        type: 'success',
        text: `Versement Trésorerie marqué : ${status}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur validation versement.',
      });
    }
  };

  const handleArbitrateExpense = async (
    expenseId: string,
    decision: 'VALIDE' | 'REJETE',
    rejectionReason?: string
  ) => {
    try {
      await portusRepository.updateExpenseStatus({
        expenseId,
        admin: currentProfile,
        decision,
        rejectionReason,
      });
      onDataChanged?.();
      await loadAdminData();
      setBanner({
        type: decision === 'VALIDE' ? 'success' : 'warning',
        text: `Note de dépense ${decision === 'VALIDE' ? 'validée et ordonnancée' : 'rejetée'}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur arbitrage note de frais.',
      });
    }
  };

  const handleRecordDirectCentralExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirExpTitle.trim() || dirExpAmount <= 0) {
      setBanner({type: 'error', text: 'Intitulé et montant valides requis.'});
      return;
    }

    try {
      await portusRepository.recordCentralDirectExpense({
        admin: currentProfile,
        title: dirExpTitle,
        category: dirExpCategory,
        amountFcfa: dirExpAmount,
        beneficiary: dirExpBeneficiary,
        justificationNotes: dirExpJustification,
      });
      setShowDirectExpenseModal(false);
      setDirExpTitle('');
      setDirExpAmount(25000);
      setDirExpBeneficiary('');
      setDirExpJustification('');
      await loadAdminData();
      setBanner({
        type: 'success',
        text: `Dépense directe de ${dirExpAmount.toLocaleString()} FCFA enregistrée à la Trésorerie Centrale.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur dépense directe.',
      });
    }
  };

  // =========================================================================
  // ACTIONS MÉTIER : LE TRIBUNAL (SANCTIONS & LISTE ROUGE)
  // =========================================================================

  const handleIssueSanction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAgentSanction || !sanctionMotif.trim()) {
      setBanner({type: 'error', text: 'Agent et motif obligatoire.'});
      return;
    }

    try {
      await portusRepository.issueAgentSanction({
        admin: currentProfile,
        agentId: targetAgentSanction.id,
        sanctionLevel,
        motif: sanctionMotif,
        details: sanctionDetails,
        durationDays: sanctionLevel === 'MISE_A_PIED_TEMPORAIRE' ? sanctionDays : null,
      });
      setShowSanctionModal(false);
      setSanctionMotif('');
      setSanctionDetails('');
      onDataChanged?.();
      await loadAdminData();
      setBanner({
        type: 'warning',
        text: `Sanction prononcée contre ${targetAgentSanction.full_name} (${sanctionLevel}). Compte suspendu si mise à pied/révocation.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur émission sanction.',
      });
    }
  };

  const handleAddToBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blTruckPlate.trim() || !blReason.trim()) {
      setBanner({type: 'error', text: 'Immatriculation et motif obligatoires.'});
      return;
    }

    try {
      await portusRepository.addToBlacklist({
        admin: currentProfile,
        truckPlate: blTruckPlate,
        driverName: blDriverName,
        driverPhone: blDriverPhone,
        reason: blReason,
        severity: blSeverity,
      });
      setShowBlacklistModal(false);
      setBlTruckPlate('');
      setBlDriverName('');
      setBlDriverPhone('');
      setBlReason('');
      await loadAdminData();
      setBanner({
        type: 'warning',
        text: `Véhicule ${blTruckPlate} inscrit sur la Liste Rouge. Alerte générale diffusée aux contrôleurs.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur inscription liste rouge.',
      });
    }
  };

  const handleRemoveFromBlacklist = async (entryId: string) => {
    try {
      await portusRepository.removeFromBlacklist(entryId, currentProfile);
      await loadAdminData();
      setBanner({
        type: 'success',
        text: 'Véhicule retiré de la Liste Rouge avec succès.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur levée inscription.',
      });
    }
  };

  // =========================================================================
  // ACTIONS ÉDITIQUE : CRÉATION & RÉIMPRESSION LIBRE PDF
  // =========================================================================

  const handleCreateNewBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const sector = sectors.find((s) => s.id === newBatchSectorId) ?? sectors[0];
    if (!sector) return;

    try {
      const batch = await portusRepository.createNewTicketBatch({
        admin: currentProfile,
        sectorId: sector.id,
        ticketCount: newBatchCount,
      });
      setShowNewBatchModal(false);
      onDataChanged?.();
      await loadAdminData();
      setBanner({
        type: 'success',
        text: `Carnet ${batch.batch_code} créé avec ${batch.ticket_count} tickets (#{${batch.serial_start}} à #{${batch.serial_end}}). Prêt pour impression PDF.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur création carnet.',
      });
    }
  };

  const handlePrintBatchTicketsA4 = async (batchId: string) => {
    setIsGeneratingPdf(true);
    try {
      const batchTickets = tickets.filter((t) => t.batch_id === batchId);
      const batch = batches.find((b) => b.id === batchId);
      const sector = sectors.find((s) => s.id === batch?.sector_id) ?? sectors[0];

      const specs = batchTickets.slice(0, 18).map((t) => ({
        ticketNumber: t.ticket_number,
        serialNumber: t.serial_number,
        sectorCode: sector?.code ?? 'VRD-SEC-01',
        sectorName: sector?.name ?? 'Terminal Vridi',
        batchCode: batch?.batch_code ?? 'CARNET-VRD',
        amountFcfa: t.contribution_amount_fcfa,
        kid: `k${t.key_version}`,
        qrPayloadP1: t.qr_static_payload,
      }));

      await generateTicketsLandscapePdfSheet({
        tickets: specs,
        settings,
        calibration: {offset_x_mm: calibOffsetX, offset_y_mm: calibOffsetY},
      });

      setBanner({
        type: 'success',
        text: `Planche A4 de 6 tickets générée avec succès pour le carnet ${batch?.batch_code} (Calibrage X:${calibOffsetX}mm Y:${calibOffsetY}mm).`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur génération PDF planche.',
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePrintAllBadgesCR80 = async () => {
    setIsGeneratingPdf(true);
    try {
      const badgeSpecs = profiles.slice(0, 8).map((p, idx) => ({
        badgeNumber: `BDG-VRD-${1000 + idx}`,
        profile: p,
        sector: sectors.find((s) => s.id === p.sector_id) ?? null,
        expiresDate: '2027-12-31',
        kid: 'k1',
      }));

      await generateBadgesPortraitPdfSheet({
        badges: badgeSpecs,
        settings,
        calibration: {offset_x_mm: calibOffsetX, offset_y_mm: calibOffsetY},
      });

      setBanner({
        type: 'success',
        text: 'Planche de 8 Badges CR80 (bandeau officiel par rôle) générée avec succès.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur impression badges.',
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Filtrage des comptes
  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      if (roleFilter !== 'TOUS' && p.role !== roleFilter) return false;
      if (!userSearchQuery.trim()) return true;
      const q = userSearchQuery.toLowerCase();
      return (
        p.full_name.toLowerCase().includes(q) ||
        p.matricule.toLowerCase().includes(q) ||
        p.callsign.toLowerCase().includes(q)
      );
    });
  }, [profiles, roleFilter, userSearchQuery]);

  return (
    <div
      className={`min-h-screen transition-colors ${
        highContrastSunMode
          ? 'bg-amber-50 text-black font-semibold'
          : 'bg-slate-900 text-slate-100'
      }`}
    >
      {/* =========================================================================
          EN-TÊTE SUPÉRIEUR ERP & BRIEFING MATINAL
      ========================================================================= */}
      <header
        className={`border-b px-4 py-3 shadow-md ${
          highContrastSunMode
            ? 'border-black bg-white text-black'
            : 'border-slate-800 bg-slate-950 text-white'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#009E60] text-white shadow-lg">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#FF8200] px-2 py-0.5 text-xs font-black tracking-wider text-slate-950">
                  ADMINISTRATION CENTRALE UJPAS
                </span>
                <span className="text-xs font-bold text-slate-400">
                  {currentProfile.matricule}
                </span>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold text-slate-300">
                  SUPER-ADMIN (OMNIPOTENCE)
                </span>
              </div>
              <h1 className="text-lg font-black tracking-tight sm:text-xl">
                Portus ERP — Console de Commandement & Direction Générale
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
            >
              {highContrastSunMode ? (
                <>
                  <Moon className="h-4 w-4" />
                  <span>Mode Normal</span>
                </>
              ) : (
                <>
                  <Sun className="h-4 w-4 text-[#FF8200]" />
                  <span>Plein Soleil</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                void loadAdminData();
                onDataChanged?.();
              }}
              disabled={loading}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition active:scale-95 ${
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
      </header>

      {/* BANNIÈRE DE NOTIFICATION */}
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

      {/* =========================================================================
          LAYOUT ERP : SIDEBAR GAUCHE + CONTENU CENTRAL
      ========================================================================= */}
      <div className="mx-auto flex max-w-7xl flex-col md:flex-row gap-6 p-4">
        {/* SIDEBAR NAVIGATION ERP */}
        <aside className="w-full shrink-0 md:w-64 space-y-1 rounded-xl border border-slate-800 bg-slate-950 p-3 shadow-lg h-fit">
          <div className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
            Console de Direction
          </div>

          <button
            type="button"
            onClick={() => setActiveView('MATIN_DASHBOARD')}
            className={`flex w-full min-h-[44px] items-center justify-between rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              activeView === 'MATIN_DASHBOARD'
                ? 'bg-[#FF8200] text-slate-950 font-black shadow'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sun className="h-4 w-4" />
              <span>Tableau Matinal</span>
            </div>
            {morningBriefing.criticalAlertsTotal > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-black text-white">
                {morningBriefing.criticalAlertsTotal}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveView('COMPTES_ROLES')}
            className={`flex w-full min-h-[44px] items-center justify-between rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              activeView === 'COMPTES_ROLES'
                ? 'bg-[#FF8200] text-slate-950 font-black shadow'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Users className="h-4 w-4" />
              <span>Comptes & Rôles</span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {profiles.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('OPERATIONS_DIRECTES')}
            className={`flex w-full min-h-[44px] items-center justify-between rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              activeView === 'OPERATIONS_DIRECTES'
                ? 'bg-[#009E60] text-white font-black shadow'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4" />
              <span>Opérations Directes</span>
            </div>
            <span className="rounded bg-emerald-950 px-1.5 py-0.2 text-[10px] font-bold text-emerald-300">
              Omnipotent
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('EDITIQUE_PDF')}
            className={`flex w-full min-h-[44px] items-center justify-between rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              activeView === 'EDITIQUE_PDF'
                ? 'bg-[#FF8200] text-slate-950 font-black shadow'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Printer className="h-4 w-4" />
              <span>Éditique & Badges</span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {batches.length} carnets
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('TRESORERIE_DEPENSES')}
            className={`flex w-full min-h-[44px] items-center justify-between rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              activeView === 'TRESORERIE_DEPENSES'
                ? 'bg-[#009E60] text-white font-black shadow'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Banknote className="h-4 w-4" />
              <span>Trésorerie & Frais</span>
            </div>
            {morningBriefing.pendingExpensesCount > 0 && (
              <span className="rounded-full bg-[#FF8200] px-1.5 py-0.2 text-[10px] font-black text-slate-950">
                {morningBriefing.pendingExpensesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveView('LE_TRIBUNAL')}
            className={`flex w-full min-h-[44px] items-center justify-between rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              activeView === 'LE_TRIBUNAL'
                ? 'bg-red-600 text-white font-black shadow'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Scale className="h-4 w-4" />
              <span>Le Tribunal</span>
            </div>
            {blacklist.filter((b) => b.is_active).length > 0 && (
              <span className="rounded-full bg-red-950 text-red-200 border border-red-800 px-1.5 py-0.2 text-[10px] font-black">
                {blacklist.filter((b) => b.is_active).length} rouge
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveView('FINANCE_AUDIT')}
            className={`flex w-full min-h-[44px] items-center justify-between rounded-lg px-3 py-2.5 text-xs font-bold transition ${
              activeView === 'FINANCE_AUDIT'
                ? 'bg-blue-600 text-white font-black shadow'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <BarChart3 className="h-4 w-4" />
              <span>Audit & Statistiques</span>
            </div>
          </button>
        </aside>

        {/* =========================================================================
            ZONE DE CONTENU ERP PRINCIPALE
        ========================================================================= */}
        <main className="flex-1 space-y-6">
          {/* =======================================================================
              VUE 1 : TABLEAU DE BORD MATINAL (Morning Briefing Géant)
          ======================================================================= */}
          {activeView === 'MATIN_DASHBOARD' && (
            <div className="space-y-6">
              {/* CHIFFRES CLÉS EN GÉANT DE LA VEILLE & DU JOUR */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* ENCAISSÉ LA VEILLE (GÉANT) */}
                <div
                  className={`rounded-2xl border p-6 shadow-xl relative overflow-hidden ${
                    highContrastSunMode
                      ? 'border-black bg-white'
                      : 'border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-[#FF8200]" />
                      ARGENT TOTAL ENCAISSÉ LA VEILLE
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                      J-1 Conforme
                    </span>
                  </div>

                  <div className="mt-3 text-4xl sm:text-5xl font-black text-[#009E60] tracking-tight">
                    {morningBriefing.yesterdayTotalFcfa.toLocaleString()} FCFA
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-800/80 pt-3 text-xs text-slate-300 font-semibold">
                    <div>
                      Espèces :{' '}
                      <strong className="text-white">
                        {morningBriefing.yesterdayCashFcfa.toLocaleString()} FCFA
                      </strong>
                    </div>
                    <div>
                      Mobile Money :{' '}
                      <strong className="text-amber-400">
                        {morningBriefing.yesterdayMmFcfa.toLocaleString()} FCFA
                      </strong>
                    </div>
                    <div>
                      Ventes enregistrées :{' '}
                      <strong className="text-white">
                        {morningBriefing.yesterdaySalesCount}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* RECETTES EN COURS DU JOUR */}
                <div
                  className={`rounded-2xl border p-6 shadow-xl relative overflow-hidden ${
                    highContrastSunMode
                      ? 'border-black bg-white'
                      : 'border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <TrendingUp className="h-4 w-4 text-[#009E60]" />
                      RECETTES EN COURS AUJOURD'HUI
                    </span>
                    <span className="rounded bg-emerald-950 px-2 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-800">
                      En direct
                    </span>
                  </div>

                  <div className="mt-3 text-4xl sm:text-5xl font-black text-white tracking-tight">
                    {morningBriefing.todayTotalFcfa.toLocaleString()} FCFA
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-800/80 pt-3 text-xs text-slate-300 font-semibold">
                    <div>
                      Ventes du jour :{' '}
                      <strong className="text-[#009E60]">
                        {morningBriefing.todaySalesCount} perceptions
                      </strong>
                    </div>
                    <div>
                      Total cumulé historique :{' '}
                      <strong className="text-white">
                        {morningBriefing.totalCollectedHistorical.toLocaleString()} FCFA
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION PROBLÈMES CRITIQUES OUVERTS */}
              <div
                className={`rounded-xl border p-5 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <AlertOctagon className="h-5 w-5 text-red-500" />
                    <h2 className="text-base font-black text-white">
                      Problèmes Critiques Ouverts Nécessitant Décision Admin
                    </h2>
                  </div>
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-black text-white">
                    {morningBriefing.criticalAlertsTotal} alertes
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {/* FRAUDES OUVERTES */}
                  <div className="rounded-lg border border-red-800/80 bg-red-950/20 p-4">
                    <div className="text-xs text-red-300 font-bold uppercase">
                      Fraudes Signalées
                    </div>
                    <div className="mt-2 text-3xl font-black text-red-400">
                      {morningBriefing.unresolvedFraudsCount}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Rapports de contrôleurs à juger
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveView('LE_TRIBUNAL')}
                      className="mt-3 text-xs font-bold text-red-300 underline"
                    >
                      Arbitrer au Tribunal →
                    </button>
                  </div>

                  {/* NOTES DE FRAIS EN ATTENTE */}
                  <div className="rounded-lg border border-amber-800/80 bg-amber-950/20 p-4">
                    <div className="text-xs text-amber-300 font-bold uppercase">
                      Notes de Dépense
                    </div>
                    <div className="mt-2 text-3xl font-black text-amber-400">
                      {morningBriefing.pendingExpensesCount}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Frais de secteur à valider
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveView('TRESORERIE_DEPENSES')}
                      className="mt-3 text-xs font-bold text-amber-300 underline"
                    >
                      Gérer la Trésorerie →
                    </button>
                  </div>

                  {/* INCIDENTS DE SÉCURITÉ */}
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
                    <div className="text-xs text-slate-300 font-bold uppercase">
                      Incidents Corridor
                    </div>
                    <div className="mt-2 text-3xl font-black text-white">
                      {morningBriefing.openIncidentsCount}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Urgences & obstructions ouvertes
                    </div>
                  </div>

                  {/* LISTE ROUGE / BLACKLIST */}
                  <div className="rounded-lg border border-red-900 bg-red-950/30 p-4">
                    <div className="text-xs text-red-200 font-bold uppercase">
                      Véhicules Liste Rouge
                    </div>
                    <div className="mt-2 text-3xl font-black text-red-300">
                      {morningBriefing.activeBlacklistCount}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Interdits d'accès au port
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveView('LE_TRIBUNAL')}
                      className="mt-3 text-xs font-bold text-red-300 underline"
                    >
                      Voir la Blacklist →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =======================================================================
              VUE 2 : GESTION DES COMPTES & ATTRIBUTION DES RÔLES (OMNIPOTENCE)
          ======================================================================= */}
          {activeView === 'COMPTES_ROLES' && (
            <div className="space-y-6">
              <div
                className={`rounded-xl border p-5 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-black text-white">
                      Annuaire & Attribution des Rôles Hiérarchiques
                    </h2>
                    <span className="text-xs text-slate-400">
                      Création, permissions cumulables (vente, contrôle, signalement) et statut des comptes
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenCreateUser}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#009E60] px-4 py-2 text-xs font-black text-white shadow transition hover:bg-emerald-600 active:scale-95"
                  >
                    <UserPlus className="h-4 w-4" />
                    <span>Créer un Compte</span>
                  </button>
                </div>

                {/* FILTRES & RECHERCHE */}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      placeholder="Rechercher nom, matricule, indicatif radio..."
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 py-1.5 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-[#FF8200] focus:outline-none"
                    />
                  </div>

                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs text-white"
                  >
                    <option value="TOUS">Tous les rôles</option>
                    <option value="ADMINISTRATEUR">Administrateur</option>
                    <option value="RESPONSABLE">Responsable</option>
                    <option value="AGENT">Agent</option>
                    <option value="CONTROLEUR">Contrôleur</option>
                    <option value="AUDITEUR">Auditeur</option>
                  </select>
                </div>

                {/* TABLEAU DES COMPTES */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 text-slate-400 uppercase">
                      <tr>
                        <th className="p-2.5">Matricule</th>
                        <th className="p-2.5">Nom & Contact</th>
                        <th className="p-2.5">Rôle</th>
                        <th className="p-2.5">Secteur</th>
                        <th className="p-2.5">Radio</th>
                        <th className="p-2.5">Permissions</th>
                        <th className="p-2.5">Statut</th>
                        <th className="p-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {filteredProfiles.map((p) => {
                        const sec = sectors.find((s) => s.id === p.sector_id);
                        return (
                          <tr key={p.id} className="hover:bg-slate-900/60">
                            <td className="p-2.5 font-mono font-bold text-white">
                              {p.matricule}
                            </td>
                            <td className="p-2.5">
                              <div className="font-bold text-slate-100">
                                {p.full_name}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {p.phone}
                              </div>
                            </td>
                            <td className="p-2.5">
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-black ${
                                  p.role === 'ADMINISTRATEUR' || p.role === 'ADMIN_PROJET'
                                    ? 'bg-[#FF8200] text-slate-950'
                                    : p.role === 'RESPONSABLE' || p.role === 'RESPONSABLE_SECTEUR'
                                    ? 'bg-rose-900 text-rose-200'
                                    : p.role === 'CONTROLEUR' || p.role === 'AUDITEUR'
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'bg-[#009E60] text-white'
                                }`}
                              >
                                {p.role}
                              </span>
                            </td>
                            <td className="p-2.5 text-slate-300">
                              {sec ? sec.code : 'Tous secteurs (Volant)'}
                            </td>
                            <td className="p-2.5 font-mono text-slate-400">
                              {p.callsign}
                            </td>
                            <td className="p-2.5">
                              <div className="flex gap-1">
                                {p.peut_vendre && (
                                  <span className="rounded bg-emerald-950 px-1 py-0.2 text-[9px] font-bold text-emerald-300 border border-emerald-800">
                                    Vendre
                                  </span>
                                )}
                                {p.peut_controler && (
                                  <span className="rounded bg-amber-950 px-1 py-0.2 text-[9px] font-bold text-amber-300 border border-amber-800">
                                    Contrôler
                                  </span>
                                )}
                                {p.peut_signaler && (
                                  <span className="rounded bg-blue-950 px-1 py-0.2 text-[9px] font-bold text-blue-300 border border-blue-800">
                                    Signaler
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-2.5">
                              {p.is_active ? (
                                <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                  Actif
                                </span>
                              ) : (
                                <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-black text-white">
                                  Suspendu
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 text-right">
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditUser(p)}
                                  className="rounded bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white"
                                  title="Modifier compte"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTargetAgentSanction(p);
                                    setShowSanctionModal(true);
                                  }}
                                  className="rounded bg-red-950/60 border border-red-800/80 p-1.5 text-red-300 hover:bg-red-900"
                                  title="Sanctionner au Tribunal"
                                >
                                  <Scale className="h-3.5 w-3.5" />
                                </button>
                              </div>
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

          {/* =======================================================================
              VUE 3 : OPÉRATIONS DIRECTES TERRAIN (OMNIPOTENCE)
          ======================================================================= */}
          {activeView === 'OPERATIONS_DIRECTES' && (
            <div className="space-y-6">
              <div
                className={`rounded-xl border p-5 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="border-b border-slate-800 pb-3">
                  <h2 className="text-base font-black text-white">
                    Prérogative d'Omnipotence : Opérations de Terrain Directes
                  </h2>
                  <p className="text-xs text-slate-400">
                    En tant qu'Administrateur, vous disposez des droits complets pour enregistrer
                    une perception de Contribution ou effectuer un contrôle routier inopiné.
                  </p>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                  {/* CARTE 1 : VENTE DIRECTE ADMIN */}
                  <div className="rounded-xl border border-[#009E60]/60 bg-emerald-950/10 p-5">
                    <div className="flex items-center gap-2 text-[#009E60]">
                      <Banknote className="h-6 w-6" />
                      <h3 className="text-base font-black">
                        Perception Directe Administrateur
                      </h3>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      Enregistre une vente immédiate de Contribution d'Assistance (2 500 FCFA)
                      directement affectée et archivée sous votre matricule d'autorité.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowDirectSaleModal(true)}
                      className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#009E60] px-4 py-2.5 text-sm font-black text-white shadow-lg transition hover:bg-emerald-600 active:scale-95"
                    >
                      <Plus className="h-5 w-5" />
                      <span>Enregistrer une Vente Directe</span>
                    </button>
                  </div>

                  {/* CARTE 2 : CONTRÔLE ROUTIER DIRECT */}
                  <div className="rounded-xl border border-[#FF8200]/60 bg-orange-950/10 p-5">
                    <div className="flex items-center gap-2 text-[#FF8200]">
                      <ShieldCheck className="h-6 w-6" />
                      <h3 className="text-base font-black">
                        Contrôle Routier Inopiné
                      </h3>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      Vérifie instantanément la validité d'une plaque ou d'un ticket physique
                      avec accès aux fiches complètes et détection de fraudes.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setDirCtrlResult(null);
                        setShowDirectControlModal(true);
                      }}
                      className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#FF8200] px-4 py-2.5 text-sm font-black text-slate-950 shadow-lg transition hover:bg-orange-400 active:scale-95"
                    >
                      <Search className="h-5 w-5" />
                      <span>Lancer un Contrôle Routier</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =======================================================================
              VUE 4 : CENTRE ÉDITIQUE PDF & RÉIMPRESSION LIBRE
          ======================================================================= */}
          {activeView === 'EDITIQUE_PDF' && (
            <div className="space-y-6">
              <div
                className={`rounded-xl border p-5 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-black text-white">
                      Centre Éditique PDF — Carnets & Badges Officiels
                    </h2>
                    <span className="text-xs text-slate-400">
                      Génération dynamique jsPDF : Planches A4 de 6 tickets et Badges CR80 réglementaires
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewBatchModal(true)}
                      className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#FF8200] px-4 py-2 text-xs font-black text-slate-950 shadow transition hover:bg-orange-400 active:scale-95"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Créer Nouveau Carnet</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePrintAllBadgesCR80}
                      disabled={isGeneratingPdf}
                      className="flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white shadow transition hover:bg-blue-500 active:scale-95 disabled:opacity-50"
                    >
                      <Printer className="h-4 w-4" />
                      <span>Imprimer Planche Badges CR80</span>
                    </button>
                  </div>
                </div>

                {/* CURSEURS DE CALIBRAGE DE L'IMPRIMANTE (MÉMORISÉS DANS LOCALSTORAGE) */}
                <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-950/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-amber-400" />
                      <h3 className="text-xs font-black uppercase tracking-wider text-amber-300">
                        Curseurs de Calibrage Imprimante (Grille Éditique)
                      </h3>
                    </div>
                    <span className="font-mono text-[11px] text-amber-200/80">
                      Mémorisé dans le terminal local (localStorage)
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-slate-300">
                    Ajustez les décalages millimétriques pour aligner parfaitement les découpes et les repères d'angles sur votre massicot ou grille pré-imprimée.
                  </p>

                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-300">
                          Décalage Horizontal (Offset X) :
                        </label>
                        <span className="font-mono text-xs font-extrabold text-amber-400">
                          {calibOffsetX >= 0 ? `+${calibOffsetX}` : calibOffsetX} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-15"
                        max="15"
                        step="0.5"
                        value={calibOffsetX}
                        onChange={(e) => handleUpdateOffsetX(Number(e.target.value))}
                        className="mt-2 w-full accent-amber-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>-15 mm (Gauche)</span>
                        <span>0 mm (Défaut)</span>
                        <span>+15 mm (Droite)</span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-300">
                          Décalage Vertical (Offset Y) :
                        </label>
                        <span className="font-mono text-xs font-extrabold text-amber-400">
                          {calibOffsetY >= 0 ? `+${calibOffsetY}` : calibOffsetY} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-15"
                        max="15"
                        step="0.5"
                        value={calibOffsetY}
                        onChange={(e) => handleUpdateOffsetY(Number(e.target.value))}
                        className="mt-2 w-full accent-amber-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>-15 mm (Haut)</span>
                        <span>0 mm (Défaut)</span>
                        <span>+15 mm (Bas)</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        handleUpdateOffsetX(0);
                        handleUpdateOffsetY(0);
                      }}
                      className="text-[11px] text-slate-400 hover:text-white underline transition"
                    >
                      Réinitialiser le calibrage à zéro (0, 0)
                    </button>
                  </div>
                </div>

                {/* LISTE DES CARNETS AVEC BOUTON DE RÉIMPRESSION LIBRE */}
                <div className="mt-5">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Carnets Émis & Réimpression Libre ({batches.length} carnets)
                  </h3>

                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                    {batches.map((batch) => {
                      const batchTickets = tickets.filter((t) => t.batch_id === batch.id);
                      const sec = sectors.find((s) => s.id === batch.sector_id);

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
                                {sec ? sec.name : 'Secteur Vridi'} · Série #{batch.serial_start} à #{batch.serial_end}
                              </div>
                            </div>
                            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-300">
                              {batch.ticket_count} tickets
                            </span>
                          </div>

                          <div className="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-2 text-xs text-slate-400">
                            <span>Émis le : {new Date(batch.created_at).toLocaleDateString()}</span>
                            <span>Tickets créés : {batchTickets.length}</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handlePrintBatchTicketsA4(batch.id)}
                            disabled={isGeneratingPdf}
                            className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded bg-slate-800 text-xs font-bold text-slate-200 hover:bg-slate-700 active:scale-95 disabled:opacity-50"
                          >
                            <Download className="h-3.5 w-3.5 text-[#009E60]" />
                            <span>Générer Planche PDF (6 tickets A4 Paysage)</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =======================================================================
              VUE 5 : TRÉSORERIE CENTRALE & DÉPENSES
          ======================================================================= */}
          {activeView === 'TRESORERIE_DEPENSES' && (
            <div className="space-y-6">
              <div
                className={`rounded-xl border p-5 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-black text-white">
                      Trésorerie Centrale UJPAS & Arbitrage des Dépenses
                    </h2>
                    <span className="text-xs text-slate-400">
                      Validation des versements bancaires Responsables et validation des notes de frais
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDirectExpenseModal(true)}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#FF8200] px-4 py-2 text-xs font-black text-slate-950 shadow transition hover:bg-orange-400 active:scale-95"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Dépense Directe Centrale</span>
                  </button>
                </div>

                {/* 1. NOTES DE FRAIS EN ATTENTE DE VALIDATION ADMIN */}
                <div className="mt-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-amber-400">
                    Notes de frais soumises par les Responsables de secteur ({expenses.length})
                  </h3>

                  <div className="mt-3 space-y-3">
                    {expenses.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        Aucune note de frais enregistrée.
                      </div>
                    ) : (
                      expenses.map((exp) => {
                        const supervisor = profiles.find((p) => p.id === exp.submitted_by);
                        const isPending = exp.status === 'EN_ATTENTE_ADMIN';

                        return (
                          <div
                            key={exp.id}
                            className={`rounded-lg border p-4 transition ${
                              isPending
                                ? 'border-amber-600/80 bg-amber-950/20'
                                : exp.status === 'VALIDE'
                                ? 'border-[#009E60]/80 bg-emerald-950/20'
                                : 'border-red-900 bg-red-950/20'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs font-black text-[#FF8200]">
                                    {exp.expense_code}
                                  </span>
                                  <span
                                    className={`rounded px-2 py-0.5 text-[10px] font-black ${
                                      isPending
                                        ? 'bg-amber-500 text-slate-950 animate-pulse'
                                        : exp.status === 'VALIDE'
                                        ? 'bg-[#009E60] text-white'
                                        : 'bg-red-600 text-white'
                                    }`}
                                  >
                                    {exp.status}
                                  </span>
                                </div>
                                <h4 className="mt-1 font-bold text-white text-sm">
                                  {exp.title}
                                </h4>
                                <div className="text-xs text-slate-400">
                                  Soumis par :{' '}
                                  <strong className="text-slate-200">
                                    {supervisor?.full_name ?? exp.submitted_by}
                                  </strong>{' '}
                                  ({supervisor?.matricule}) · Catégorie :{' '}
                                  {exp.category}
                                </div>
                                <div className="mt-1 text-xs text-slate-300">
                                  Motif : {exp.justification_notes}
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-xl font-black text-[#009E60]">
                                  {exp.amount_fcfa.toLocaleString()} FCFA
                                </div>
                                {exp.receipt_photo_data_url && (
                                  <a
                                    href={exp.receipt_photo_data_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1 inline-block text-xs text-amber-400 underline"
                                  >
                                    Voir justificatif photo
                                  </a>
                                )}
                              </div>
                            </div>

                            {isPending && (
                              <div className="mt-3 flex gap-2 border-t border-slate-800 pt-2">
                                <button
                                  type="button"
                                  onClick={() => handleArbitrateExpense(exp.id, 'VALIDE')}
                                  className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded bg-[#009E60] px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 active:scale-95"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  <span>Valider Dépense</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleArbitrateExpense(
                                      exp.id,
                                      'REJETE',
                                      'Justificatif insuffisant ou non conforme aux règles budgétaires'
                                    )
                                  }
                                  className="flex min-h-[40px] items-center justify-center gap-1.5 rounded border border-red-600 bg-red-950/60 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-900"
                                >
                                  <XCircle className="h-4 w-4" />
                                  <span>Rejeter</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 2. VERSEMENTS DES RESPONSABLES (TREASURY DEPOSITS) */}
                <div className="mt-6 border-t border-slate-800 pt-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-[#009E60]">
                    Reversements Bancaires & Encaissements Responsables ({deposits.length})
                  </h3>

                  <div className="mt-3 space-y-3">
                    {deposits.map((dep) => (
                      <div
                        key={dep.id}
                        className="flex flex-wrap items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3"
                      >
                        <div>
                          <div className="font-mono text-xs font-bold text-white">
                            {dep.deposit_reference} · Bordereau : {dep.slip_number}
                          </div>
                          <div className="text-xs text-slate-400">
                            Banque : {dep.bank_or_institution} · Date :{' '}
                            {new Date(dep.deposited_at).toLocaleDateString()}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-sm font-black text-white">
                            {dep.amount_fcfa.toLocaleString()} FCFA
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              dep.status === 'VERIFIE'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-amber-950 text-amber-300 border border-amber-800'
                            }`}
                          >
                            {dep.status}
                          </span>
                          {dep.status === 'DECLARE' && (
                            <button
                              type="button"
                              onClick={() => handleVerifyDeposit(dep.id, 'VERIFIE')}
                              className="rounded bg-[#009E60] px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-600"
                            >
                              Valider Versement
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =======================================================================
              VUE 6 : LE TRIBUNAL (Rapports Contrôleurs, Sanctions & Liste Rouge)
          ======================================================================= */}
          {activeView === 'LE_TRIBUNAL' && (
            <div className="space-y-6">
              <div
                className={`rounded-xl border p-5 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-black text-red-400 flex items-center gap-2">
                      <Scale className="h-5 w-5" />
                      Le Tribunal UJPAS — Discipline, Arbitrage & Liste Rouge
                    </h2>
                    <span className="text-xs text-slate-400">
                      Gestion des rapports de contrôleurs, sanctions agents (avertissements / révocations) et Blacklist
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBlacklistModal(true)}
                      className="flex min-h-[44px] items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-black text-white shadow transition hover:bg-red-700 active:scale-95"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Inscrire sur Liste Rouge</span>
                    </button>
                  </div>
                </div>

                {/* 1. RAPPORTS DE FRAUDES TRANSMIS PAR LES CONTRÔLEURS */}
                <div className="mt-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                    Rapports d'Anomalies & Fraudes des Contrôleurs Routiers ({fraudReports.length})
                  </h3>

                  <div className="mt-3 space-y-3">
                    {fraudReports.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        Aucun rapport de fraude transmis pour le moment.
                      </div>
                    ) : (
                      fraudReports.map((fraud) => {
                        const ctrl = profiles.find((p) => p.id === fraud.controller_id);
                        return (
                          <div
                            key={fraud.id}
                            className="rounded-lg border border-red-900/60 bg-red-950/20 p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-black text-white">
                                    {fraud.verdict}
                                  </span>
                                  <span className="font-mono text-xs text-slate-300">
                                    Plaque : <strong>{fraud.observed_truck_plate}</strong>
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                  Signalé par : {ctrl?.full_name ?? fraud.controller_id} ({ctrl?.matricule}) · Ticket : {fraud.ticket_number_scanned}
                                </div>
                                {fraud.notes && (
                                  <div className="mt-1 text-xs italic text-slate-300">
                                    Détails : "{fraud.notes}"
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBlTruckPlate(fraud.observed_truck_plate);
                                    setBlReason(`Signalé en fraude par le contrôleur : ${fraud.verdict}`);
                                    setShowBlacklistModal(true);
                                  }}
                                  className="rounded bg-red-800 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700"
                                >
                                  Inscrire Blacklist
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 2. LISTE ROUGE (BLACKLIST) OFFICIELLE */}
                <div className="mt-6 border-t border-slate-800 pt-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-red-400">
                    Liste Rouge (Blacklist) des Camions & Chauffeurs Interdits ({blacklist.filter((b) => b.is_active).length})
                  </h3>

                  <div className="mt-3 space-y-2">
                    {blacklist.filter((b) => b.is_active).length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        Aucun véhicule sur la Liste Rouge.
                      </div>
                    ) : (
                      blacklist
                        .filter((b) => b.is_active)
                        .map((b) => (
                          <div
                            key={b.id}
                            className="flex flex-wrap items-center justify-between rounded-lg border border-red-900 bg-red-950/40 p-3"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-black text-red-200">
                                  {b.truck_plate}
                                </span>
                                <span className="rounded bg-red-600 px-1.5 py-0.2 text-[10px] font-black text-white">
                                  {b.severity}
                                </span>
                              </div>
                              <div className="text-xs text-slate-300">
                                Motif : {b.reason}
                              </div>
                              {b.driver_name && (
                                <div className="text-[11px] text-slate-400">
                                  Chauffeur : {b.driver_name} ({b.driver_phone ?? 'N/A'})
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveFromBlacklist(b.id)}
                              className="rounded bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
                            >
                              Lever la sanction
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                {/* 3. HISTORIQUE DES SANCTIONS AGENTS */}
                <div className="mt-6 border-t border-slate-800 pt-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                    Registre des Sanctions Disciplinaires Prononcées ({sanctions.length})
                  </h3>

                  <div className="mt-3 space-y-2">
                    {sanctions.map((s) => {
                      const agent = profiles.find((p) => p.id === s.agent_id);
                      return (
                        <div
                          key={s.id}
                          className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-[#FF8200]">
                                {s.sanction_code}
                              </span>
                              <span className="font-black text-white">
                                {s.sanction_level}
                              </span>
                              <span className="text-slate-400">
                                Agent : {agent?.full_name} ({agent?.matricule})
                              </span>
                            </div>
                            <div className="text-slate-300 mt-1">
                              Motif : {s.motif} · {s.details}
                            </div>
                          </div>
                          <span className="text-[11px] text-slate-500">
                            {new Date(s.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =======================================================================
              VUE 7 : AUDIT & STATISTIQUES FINANCIÈRES
          ======================================================================= */}
          {activeView === 'FINANCE_AUDIT' && (
            <div className="space-y-6">
              <div
                className={`rounded-xl border p-5 shadow-sm ${
                  highContrastSunMode
                    ? 'border-black bg-white'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-black text-white">
                      Rapports Financiers Consolidés & Partenaires
                    </h2>
                    <span className="text-xs text-slate-400">
                      Ventilation des recettes, pyramide financière et export comptable officiel
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setIsGeneratingPdf(true);
                      try {
                        const totalCol = sales.reduce((sum, s) => sum + s.contribution_amount_fcfa, 0);
                        const cashCol = sales.filter((s) => s.payment_method === 'ESPECES').reduce((sum, s) => sum + s.contribution_amount_fcfa, 0);
                        const mmCol = sales.filter((s) => s.payment_method !== 'ESPECES').reduce((sum, s) => sum + s.contribution_amount_fcfa, 0);
                        const remitted = remittances.reduce((sum, r) => sum + r.declared_cash_fcfa, 0);
                        const dep = deposits.reduce((sum, d) => sum + d.amount_fcfa, 0);
                        const activeTrucks = sales.filter((s) => s.payment_confirmed && !s.exited_at).length;
                        const pendingReg = sales.filter((s) => !s.payment_confirmed || s.mobile_money_validation_status === 'REJETE').length;
                        const dormant = batches.filter((b) => b.status === 'IMPRIME').length;

                        const breakdown = (['ESPECES', 'WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY'] as PaymentMethod[]).map((m) => ({
                          method: m,
                          count: sales.filter((s) => s.payment_method === m).length,
                          amountFcfa: sales.filter((s) => s.payment_method === m).reduce((sum, s) => sum + s.contribution_amount_fcfa, 0),
                        }));

                        const secSummaries = sectors.map((sec) => ({
                          sectorCode: sec.code,
                          sectorName: sec.name,
                          salesCount: sales.filter((s) => s.sector_id === sec.id).length,
                          amountFcfa: sales.filter((s) => s.sector_id === sec.id).reduce((sum, s) => sum + s.contribution_amount_fcfa, 0),
                        }));

                        await generateWeeklyPartnerAuditReportPDF({
                          settings,
                          generatedBy: currentProfile,
                          totalCollectedFcfa: totalCol,
                          cashCollectedFcfa: cashCol,
                          mobileMoneyCollectedFcfa: mmCol,
                          remittedByAgentsFcfa: remitted,
                          depositedToTreasuryFcfa: dep,
                          activeTrucksCount: activeTrucks,
                          pendingRegularizationCount: pendingReg,
                          dormantBatchesCount: dormant,
                          paymentBreakdown: breakdown,
                          sectorSummaries: secSummaries,
                        });
                        setBanner({
                          type: 'success',
                          text: 'Rapport Hebdomadaire Partenaires PDF certifié conforme généré.',
                        });
                      } catch (err) {
                        setBanner({
                          type: 'error',
                          text: 'Erreur génération rapport partenaires.',
                        });
                      } finally {
                        setIsGeneratingPdf(false);
                      }
                    }}
                    disabled={isGeneratingPdf}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[#009E60] px-4 py-2 text-xs font-black text-white shadow transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    <span>Télécharger Rapport Partenaires PDF</span>
                  </button>
                </div>

                {/* VENTILATION DES MODES DE PAIEMENT */}
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                      Ventilation des Recettes par Mode de Règlement
                    </h3>
                    <div className="mt-3 space-y-3">
                      {(['ESPECES', 'WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY'] as PaymentMethod[]).map(
                        (method) => {
                          const matching = sales.filter((s) => s.payment_method === method);
                          const total = matching.reduce(
                            (sum, s) => sum + s.contribution_amount_fcfa,
                            0
                          );
                          const percent = Math.round(
                            (total / Math.max(morningBriefing.totalCollectedHistorical, 1)) * 100
                          );

                          return (
                            <div key={method} className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="font-bold text-white">{method}</span>
                                <span className="text-slate-400">
                                  {total.toLocaleString()} FCFA ({percent}%)
                                </span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                                <div
                                  className={`h-full ${
                                    method === 'ESPECES' ? 'bg-[#009E60]' : 'bg-[#FF8200]'
                                  }`}
                                  style={{width: `${percent}%`}}
                                />
                              </div>
                            </div>
                          );
                        }
                      )}
                    </div>
                  </div>

                  {/* RÉPARTITION PAR SECTEUR */}
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                      Activité par Secteur Portuaire
                    </h3>
                    <div className="mt-3 space-y-3">
                      {sectors.map((sec) => {
                        const secSales = sales.filter((s) => s.sector_id === sec.id);
                        const secTotal = secSales.reduce(
                          (sum, s) => sum + s.contribution_amount_fcfa,
                          0
                        );
                        return (
                          <div
                            key={sec.id}
                            className="flex items-center justify-between border-b border-slate-800 pb-2 text-xs"
                          >
                            <div>
                              <div className="font-bold text-white">{sec.name}</div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                {sec.code}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-black text-[#009E60]">
                                {secTotal.toLocaleString()} FCFA
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {secSales.length} camions
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* =========================================================================
          MODALES DE DIALOGUE (Comptes, Sanctions, Liste Rouge, Vente, Contrôle, etc.)
      ========================================================================= */}

      {/* MODALE 1 : CRÉATION / MODIFICATION COMPTE UTILISATEUR */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-black text-white">
                {editingProfile ? 'Modifier le Compte' : 'Créer un Compte Utilisateur'}
              </h3>
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">Matricule *</label>
                  <input
                    type="text"
                    required
                    value={userMatricule}
                    onChange={(e) => setUserMatricule(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">Rôle *</label>
                  <select
                    value={userRole}
                    onChange={(e) => {
                      const r = e.target.value as UserRole;
                      setUserRole(r);
                      setUserPeutVendre(r === 'AGENT');
                      setUserPeutControler(r === 'CONTROLEUR' || r === 'AUDITEUR');
                    }}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  >
                    <option value="ADMINISTRATEUR">ADMINISTRATEUR</option>
                    <option value="RESPONSABLE">RESPONSABLE</option>
                    <option value="AGENT">AGENT</option>
                    <option value="CONTROLEUR">CONTROLEUR</option>
                    <option value="AUDITEUR">AUDITEUR</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300">Nom Complet *</label>
                <input
                  type="text"
                  required
                  value={userFullName}
                  onChange={(e) => setUserFullName(e.target.value)}
                  placeholder="Ex : Kouadio Jean-Marc"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300">Téléphone</label>
                  <input
                    type="text"
                    value={userPhone}
                    onChange={(e) => setUserPhone(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">Indicatif Radio</label>
                  <input
                    type="text"
                    value={userCallsign}
                    onChange={(e) => setUserCallsign(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300">Secteur Rattaché</label>
                <select
                  value={userSectorId}
                  onChange={(e) => setUserSectorId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                >
                  <option value="">Tous les secteurs (Volant / Central)</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* PERMISSIONS FINES */}
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
                <span className="font-bold text-slate-300">Permissions Opérationnelles :</span>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={userPeutVendre}
                      onChange={(e) => setUserPeutVendre(e.target.checked)}
                      className="rounded"
                    />
                    <span>Peut Vendre</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={userPeutControler}
                      onChange={(e) => setUserPeutControler(e.target.checked)}
                      className="rounded"
                    />
                    <span>Peut Contrôler</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={userPeutSignaler}
                      onChange={(e) => setUserPeutSignaler(e.target.checked)}
                      className="rounded"
                    />
                    <span>Peut Signaler</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="userActive"
                  checked={userIsActive}
                  onChange={(e) => setUserIsActive(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="userActive" className="font-bold text-slate-200">
                  Compte Actif (accès autorisé à l'application)
                </label>
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 rounded bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded bg-[#009E60] py-2.5 font-black text-white hover:bg-emerald-600 active:scale-95 shadow"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE 2 : SANCTION DU TRIBUNAL CONTRE UN AGENT */}
      {showSanctionModal && targetAgentSanction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-700 bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-red-400">
              <Scale className="h-5 w-5" />
              <h3 className="text-base font-black">
                Prononcer une Sanction Disciplinaire
              </h3>
            </div>

            <form onSubmit={handleIssueSanction} className="mt-4 space-y-3 text-xs">
              <p>
                Agent poursuivi :{' '}
                <strong className="text-white text-sm">
                  {targetAgentSanction.full_name} ({targetAgentSanction.matricule})
                </strong>
              </p>

              <div>
                <label className="block font-bold text-slate-300">Degré de sanction *</label>
                <select
                  value={sanctionLevel}
                  onChange={(e) => setSanctionLevel(e.target.value as SanctionLevel)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                >
                  <option value="AVERTISSEMENT_VERBAL">Avertissement Verbal</option>
                  <option value="AVERTISSEMENT_ECRIT">Avertissement Écrit (Dossier)</option>
                  <option value="MISE_A_PIED_TEMPORAIRE">Mise à Pied Temporaire (Suspension)</option>
                  <option value="REVOCATION_DEFINITIVE">Révocation Définitive (Exclusion)</option>
                </select>
              </div>

              {sanctionLevel === 'MISE_A_PIED_TEMPORAIRE' && (
                <div>
                  <label className="block font-bold text-slate-300">Durée (jours)</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={sanctionDays}
                    onChange={(e) => setSanctionDays(parseInt(e.target.value) || 1)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-300">Motif légal *</label>
                <input
                  type="text"
                  required
                  value={sanctionMotif}
                  onChange={(e) => setSanctionMotif(e.target.value)}
                  placeholder="Ex : Discordance de caisse non déclarée, vente hors plage..."
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300">Circonstances détaillées</label>
                <textarea
                  value={sanctionDetails}
                  onChange={(e) => setSanctionDetails(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSanctionModal(false)}
                  className="flex-1 rounded bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded bg-red-600 py-2.5 font-black text-white hover:bg-red-700 active:scale-95 shadow"
                >
                  Prononcer la Sanction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE 3 : INSCRIPTION SUR LA LISTE ROUGE (BLACKLIST) */}
      {showBlacklistModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-700 bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-red-400">
              <AlertOctagon className="h-5 w-5" />
              <h3 className="text-base font-black">
                Inscription d'un Camion sur la Liste Rouge
              </h3>
            </div>

            <form onSubmit={handleAddToBlacklist} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-300">Plaque d'immatriculation *</label>
                <input
                  type="text"
                  required
                  value={blTruckPlate}
                  onChange={(e) => setBlTruckPlate(e.target.value)}
                  placeholder="Ex : BF-4410-KL ou CI-8842-GT"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white font-mono uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300">Chauffeur (optionnel)</label>
                  <input
                    type="text"
                    value={blDriverName}
                    onChange={(e) => setBlDriverName(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">Téléphone</label>
                  <input
                    type="text"
                    value={blDriverPhone}
                    onChange={(e) => setBlDriverPhone(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300">Niveau de Sanction *</label>
                <select
                  value={blSeverity}
                  onChange={(e) =>
                    setBlSeverity(
                      e.target.value as 'ATTENTION' | 'INTERDICTION_ACCES' | 'POURSUITE_JUDICIAIRE'
                    )
                  }
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                >
                  <option value="INTERDICTION_ACCES">INTERDICTION ACCÈS CORRIDOR</option>
                  <option value="ATTENTION">VIGILANCE & FOUILLE SYSTÉMATIQUE</option>
                  <option value="POURSUITE_JUDICIAIRE">POURSUITE JUDICIAIRE PORTUAIRE</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300">Motif de l'inscription *</label>
                <textarea
                  required
                  value={blReason}
                  onChange={(e) => setBlReason(e.target.value)}
                  placeholder="Ex : Faux ticket récidiviste, tentative de corruption, refus de paiement..."
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowBlacklistModal(false)}
                  className="flex-1 rounded bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded bg-red-600 py-2.5 font-black text-white hover:bg-red-700 active:scale-95 shadow"
                >
                  Inscrire sur Liste Rouge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE 4 : VENTE DIRECTE ADMINISTRATEUR */}
      {showDirectSaleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#009E60] bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 text-[#009E60]">
              <Banknote className="h-5 w-5" />
              <h3 className="text-base font-black">
                Perception Directe Administrateur
              </h3>
            </div>

            <form onSubmit={handleExecuteDirectAdminSale} className="mt-4 space-y-3 text-xs">
              <div className="rounded bg-slate-950 p-3 text-slate-300 border border-slate-800">
                Montant officiel de la Contribution :{' '}
                <strong className="text-white text-base">2 500 FCFA</strong>
              </div>

              <div>
                <label className="block font-bold text-slate-300">Immatriculation Camion *</label>
                <input
                  type="text"
                  required
                  value={dirSalePlate}
                  onChange={(e) => setDirSalePlate(e.target.value)}
                  placeholder="Ex : CI-8842-GT"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white font-mono uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300">Pays Provenance</label>
                  <select
                    value={dirSaleCountry}
                    onChange={(e) => setDirSaleCountry(e.target.value as any)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  >
                    <option value="CI">Côte d'Ivoire (CI)</option>
                    <option value="BF">Burkina Faso (BF)</option>
                    <option value="ML">Mali (ML)</option>
                    <option value="NE">Niger (NE)</option>
                    <option value="GH">Ghana (GH)</option>
                    <option value="TG">Togo (TG)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-300">Mode Paiement</label>
                  <select
                    value={dirSalePaymentMethod}
                    onChange={(e) => setDirSalePaymentMethod(e.target.value as PaymentMethod)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  >
                    <option value="ESPECES">Espèces (CASH)</option>
                    <option value="WAVE">Wave</option>
                    <option value="ORANGE_MONEY">Orange Money</option>
                    <option value="MTN_MOMO">MTN MoMo</option>
                    <option value="MOOV_MONEY">Moov Money</option>
                  </select>
                </div>
              </div>

              {dirSalePaymentMethod !== 'ESPECES' && (
                <div>
                  <label className="block font-bold text-slate-300">Réf. Transaction Mobile Money</label>
                  <input
                    type="text"
                    value={dirSaleMmRef}
                    onChange={(e) => setDirSaleMmRef(e.target.value)}
                    placeholder="Ex : WAVE-CI-998811"
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300">Nom Chauffeur</label>
                  <input
                    type="text"
                    value={dirSaleDriver}
                    onChange={(e) => setDirSaleDriver(e.target.value)}
                    placeholder="Ex : Konaté Mamadou"
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300">Tél Chauffeur</label>
                  <input
                    type="text"
                    value={dirSalePhone}
                    onChange={(e) => setDirSalePhone(e.target.value)}
                    placeholder="+22507..."
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDirectSaleModal(false)}
                  className="flex-1 rounded bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded bg-[#009E60] py-2.5 font-black text-white hover:bg-emerald-600 active:scale-95 shadow"
                >
                  Valider la Vente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE 5 : CONTRÔLE ROUTIER DIRECT */}
      {showDirectControlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[#FF8200] bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-black text-white">
                Contrôle Routier Immédiat
              </h3>
              <button
                type="button"
                onClick={() => setShowDirectControlModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteDirectControl} className="mt-4 space-y-3 text-xs">
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={dirCtrlPlateOrTicket}
                  onChange={(e) => setDirCtrlPlateOrTicket(e.target.value)}
                  placeholder="Saisir Plaque (CI-8842-GT) ou Ticket (UJPAS-VRD01-100003)..."
                  className="flex-1 rounded border border-slate-700 bg-slate-800 p-2.5 text-white font-mono uppercase"
                />
                <button
                  type="submit"
                  className="rounded bg-[#FF8200] px-4 py-2 font-black text-slate-950 hover:bg-orange-400"
                >
                  Vérifier
                </button>
              </div>

              {dirCtrlResult && (
                <div
                  className={`mt-4 rounded-lg border p-4 ${
                    dirCtrlResult.verdict?.includes('CONFORME')
                      ? 'border-[#009E60] bg-emerald-950/20'
                      : 'border-red-600 bg-red-950/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {dirCtrlResult.verdict?.includes('CONFORME') ? (
                      <CheckCircle2 className="h-5 w-5 text-[#009E60]" />
                    ) : (
                      <AlertOctagon className="h-5 w-5 text-red-500" />
                    )}
                    <span className="font-black text-sm text-white">
                      {dirCtrlResult.verdict}
                    </span>
                  </div>

                  {dirCtrlResult.sale && (
                    <div className="mt-2 space-y-1 text-xs text-slate-300 border-t border-slate-800 pt-2">
                      <div>Camion : <strong>{dirCtrlResult.sale.truck_plate}</strong></div>
                      <div>Ticket : {dirCtrlResult.sale.ticket_number}</div>
                      <div>Chauffeur : {dirCtrlResult.sale.driver_name} ({dirCtrlResult.sale.driver_phone})</div>
                      <div>Paiement : {dirCtrlResult.sale.payment_method} ({dirCtrlResult.sale.contribution_amount_fcfa} FCFA)</div>
                      <div>Expire le : {new Date(dirCtrlResult.sale.max_stay_expires_at).toLocaleString()}</div>
                    </div>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* MODALE 6 : DÉPENSE DIRECTE CENTRALE */}
      {showDirectExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-black text-white">
                Dépense Directe Trésorerie Centrale
              </h3>
              <button
                type="button"
                onClick={() => setShowDirectExpenseModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordDirectCentralExpense} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-300">Intitulé de la dépense *</label>
                <input
                  type="text"
                  required
                  value={dirExpTitle}
                  onChange={(e) => setDirExpTitle(e.target.value)}
                  placeholder="Ex : Réapprovisionnement scellés et rouleaux thermiques"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300">Catégorie</label>
                  <select
                    value={dirExpCategory}
                    onChange={(e) => setDirExpCategory(e.target.value as ExpenseCategory)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  >
                    <option value="CARBURANT_GROUPE">Carburant</option>
                    <option value="FOURNITURES_TICKETS_SCELLES">Fournitures & Scellés</option>
                    <option value="URGENCE_SANTE_SECOURS">Secours Médical</option>
                    <option value="MAINTENANCE_POSTE">Maintenance</option>
                    <option value="AUTRE_LOGISTIQUE">Logistique Centrale</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-300">Montant (FCFA) *</label>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    required
                    value={dirExpAmount}
                    onChange={(e) => setDirExpAmount(parseInt(e.target.value) || 0)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300">Bénéficiaire</label>
                <input
                  type="text"
                  value={dirExpBeneficiary}
                  onChange={(e) => setDirExpBeneficiary(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300">Justification</label>
                <textarea
                  value={dirExpJustification}
                  onChange={(e) => setDirExpJustification(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDirectExpenseModal(false)}
                  className="flex-1 rounded bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded bg-[#FF8200] py-2.5 font-black text-slate-950 hover:bg-orange-400 active:scale-95 shadow"
                >
                  Ordonnancer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE 7 : CRÉATION NOUVEAU CARNET */}
      {showNewBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-black text-white">
                Émission d'un Nouveau Carnet de Tickets
              </h3>
              <button
                type="button"
                onClick={() => setShowNewBatchModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNewBatch} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-300">Secteur portuaire dotataire</label>
                <select
                  value={newBatchSectorId}
                  onChange={(e) => setNewBatchSectorId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                >
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300">Nombre de tickets dans le carnet</label>
                <select
                  value={newBatchCount}
                  onChange={(e) => setNewBatchCount(parseInt(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-white"
                >
                  <option value={24}>24 tickets (4 planches A4 de 6)</option>
                  <option value={50}>50 tickets (Carnet standard UJPAS)</option>
                  <option value={100}>100 tickets (Grand carnet terminal)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewBatchModal(false)}
                  className="flex-1 rounded bg-slate-800 py-2.5 font-bold text-slate-300 hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded bg-[#FF8200] py-2.5 font-black text-slate-950 hover:bg-orange-400 active:scale-95 shadow"
                >
                  Générer le Carnet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
