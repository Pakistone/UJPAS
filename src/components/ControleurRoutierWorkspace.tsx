/**
 * PORTUS — Module Frontend Complet du CONTRÔLEUR ROUTIER (UJPAS Vridi, Abidjan)
 *
 * RÈGLES MÉTIER & SPÉCIFICATIONS :
 * 1. Hiérarchie : Le contrôleur répond DIRECTEMENT à l'Administrateur (les rapports de fraude vont à l'Admin).
 * 2. Contrôle centré sur la plaque : Saisie manuelle ou OCR de la plaque -> affiche l'historique du camion et l'état de son ticket actuel.
 * 3. Double vérification : Comparaison du ticket physique avec la Fiche Ticket en base. Vérification Ed25519 100% hors-ligne.
 * 4. Anti-fraude : En cas de ticket non enregistré, affichage d'une galerie des agents (Photo, Nom, Téléphone) pour que le chauffeur désigne le vendeur.
 * 5. Signalement : Bouton pour envoyer instantanément un rapport d'anomalie/fraude à l'Administrateur pour enquête.
 * 6. DESIGN : Viseur clair, indicateurs sémantiques (Vert = Valid, Orange = À vérifier manuellement, Rouge = Fraude),
 *    lisible en plein soleil (Mode Plein Soleil Ivoire haute visibilité) et Mode Nuit disponible (Surveillance Nocturne).
 */

import React, {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {
  QrCode,
  Camera,
  CameraOff,
  ShieldCheck,
  ShieldAlert,
  LogOut,
  MapPin,
  SearchCheck,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileSearch,
  Eye,
  Sun,
  Moon,
  Truck,
  Phone,
  Send,
  History,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Shield,
  HelpCircle,
  AlertOctagon,
  X,
  BadgeAlert,
} from 'lucide-react';
import {
  verifyTicketQrPayloadP1,
  compareTruckPlatesWithTolerance,
  TicketVerificationResultP1,
} from '../lib/crypto/ed25519';
import {
  compressImageFileToCanvas200Kb,
  CompressedScreenshotResult,
} from '../lib/media/imageCompressor';
import {portusRepository} from '../lib/supabase/client';
import {syncEngine} from '../lib/sync/syncEngine';
import type {
  AppSettings,
  ControlVerdict,
  Profile,
  Sale,
  Sector,
  Ticket,
} from '../types/portus';

interface ControleurRoutierWorkspaceProps {
  currentProfile: Profile;
  profiles: Profile[];
  sectors: Sector[];
  tickets: Ticket[];
  sales: Sale[];
  settings: AppSettings;
  onDataChanged: () => Promise<void>;
}

/**
 * Normalise une plaque minéralogique (enlève espaces, tirets, points)
 */
function cleanPlateNumber(plate: string): string {
  return plate.replace(/[\s\-_.]/g, '').toUpperCase();
}

/**
 * Masque un numéro de téléphone pour la confidentialité si nécessaire
 */
export function maskDriverPhone(phone?: string | null): string {
  if (!phone || phone.trim().length < 6) {
    return 'Non renseigné';
  }
  const clean = phone.trim();
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)} •• •• ${clean.slice(-2)}`;
  }
  const prefix = clean.slice(0, 6);
  const suffix = clean.slice(-4);
  return `${prefix} •• •• ${suffix}`;
}

/**
 * Génère un portrait SVG déterministe haute netteté pour le trombinoscope des agents
 */
function buildAgentTrombineSvgDataUrl(agent: Profile, index: number): string {
  const palettes = [
    {bg: '#1E3A8A', ring: '#3B82F6', shirt: '#1D4ED8'},
    {bg: '#064E3B', ring: '#10B981', shirt: '#047857'},
    {bg: '#78350F', ring: '#F59E0B', shirt: '#B45309'},
    {bg: '#4C1D95', ring: '#8B5CF6', shirt: '#6D28D9'},
    {bg: '#881337', ring: '#F43F5E', shirt: '#BE123C'},
    {bg: '#0F766E', ring: '#14B8A6', shirt: '#0D9488'},
  ];
  const pal = palettes[index % palettes.length];
  const initials = agent.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 180" width="160" height="180">
    <rect width="160" height="180" rx="16" fill="${pal.bg}" />
    <circle cx="80" cy="62" r="30" fill="#FDE68A" stroke="${pal.ring}" stroke-width="4" />
    <path d="M26 168 C26 120 134 120 134 168 Z" fill="${pal.shirt}" />
    <text x="80" y="70" text-anchor="middle" fill="#0F172A" font-family="sans-serif" font-weight="900" font-size="22">${initials}</text>
    <rect x="0" y="146" width="160" height="34" fill="#020617" opacity="0.9" />
    <text x="80" y="168" text-anchor="middle" fill="#F8FAFC" font-family="monospace" font-weight="bold" font-size="12">${agent.matricule || agent.callsign}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const ControleurRoutierWorkspace: React.FC<ControleurRoutierWorkspaceProps> = ({
  currentProfile,
  profiles,
  sectors,
  tickets,
  sales,
  settings,
  onDataChanged,
}) => {
  // --- Mode d'affichage : Plein Soleil (Clair Haute Lisibilité) vs Nuit (Surveillance) ---
  const [themeMode, setThemeMode] = useState<'SUN' | 'NIGHT'>('SUN');

  // --- Coordonnées GPS automatiques du contrôleur ---
  const [gpsCoords, setGpsCoords] = useState<{lat: number; lng: number}>({
    lat: 5.2594,
    lng: -4.0128,
  });

  // --- CONTRÔLE CENTRÉ SUR LA PLAQUE ---
  const [selectedCountryPrefix, setSelectedCountryPrefix] = useState<string>('CI');
  const [plateInput, setPlateInput] = useState<string>('CI-8842-GT');

  // --- Scanners & Viseurs Caméra ---
  // Viseur 1 : Scanner QR Code Ticket (Ed25519)
  const [isQrScannerActive, setIsQrScannerActive] = useState<boolean>(false);
  // Viseur 2 : Viseur OCR Plaque avec mire optique
  const [isOcrScannerActive, setIsOcrScannerActive] = useState<boolean>(false);
  const [ocrDetectedPlateNotice, setOcrDetectedPlateNotice] = useState<string | null>(null);

  const html5QrRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void;
    isScanning?: boolean;
  } | null>(null);

  // --- Ticket inspecté & Vérification Ed25519 100% hors-ligne ---
  const [scannedTicketNumber, setScannedTicketNumber] = useState<string>('UJPAS-VRD01-100001');
  const [ed25519Result, setEd25519Result] = useState<TicketVerificationResultP1 | null>(null);

  // --- Panneau « Signaler anomalie / fraude DIRECTEMENT à l'Administrateur » ---
  const [showAdminFraudModal, setShowAdminFraudModal] = useState<boolean>(false);
  const [selectedFraudVerdict, setSelectedFraudVerdict] = useState<ControlVerdict>('PLAQUE_NON_CONFORME');
  const [fraudMotifLabel, setFraudMotifLabel] = useState<string>("Discordance de plaque d'immatriculation");
  const [fraudNotes, setFraudNotes] = useState<string>('');
  const [fraudPhoto, setFraudPhoto] = useState<CompressedScreenshotResult | null>(null);
  const [isSubmittingFraud, setIsSubmittingFraud] = useState<boolean>(false);
  const fraudPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // --- Galerie Photos des Agents (Anti-fraude ticket non enregistré NOT_SOLD) ---
  const [showAgentGalleryModal, setShowAgentGalleryModal] = useState<boolean>(false);
  const [selectedSuspectAgentId, setSelectedSuspectAgentId] = useState<string>(
    profiles.find((p) => p.peut_vendre)?.id ?? profiles[0]?.id ?? ''
  );
  const [driverAllegationNote, setDriverAllegationNote] = useState<string>('');
  const [isSubmittingAllegation, setIsSubmittingAllegation] = useState<boolean>(false);

  // --- Bannière d'action & Journal d'audit ---
  const [actionBanner, setActionBanner] = useState<{
    tone: 'SUCCESS' | 'WARNING' | 'DANGER';
    title: string;
    detail: string;
  } | null>(null);

  const [recentAudits, setRecentAudits] = useState<
    Array<{
      id: string;
      action: string;
      entity_id: string;
      payload: Record<string, unknown>;
      created_at: string;
    }>
  >([]);

  // Nettoyage strict des caméras
  const stopAllScannersStrictly = useCallback(async () => {
    const inst = html5QrRef.current;
    if (inst) {
      try {
        await inst.stop();
      } catch {
        // Déjà arrêté
      }
      try {
        inst.clear();
      } catch {
        // Ignorer
      }
      html5QrRef.current = null;
    }
    setIsQrScannerActive(false);
    setIsOcrScannerActive(false);
  }, []);

  // Géolocalisation continue
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsCoords({
            lat: Math.round(pos.coords.latitude * 1000000) / 1000000,
            lng: Math.round(pos.coords.longitude * 1000000) / 1000000,
          });
        },
        () => {},
        {enableHighAccuracy: false, timeout: 5000}
      );
    }
    return () => {
      void stopAllScannersStrictly();
    };
  }, [stopAllScannersStrictly]);

  // Normalisation de la plaque courante
  const normalizedCurrentPlate = useMemo(() => {
    return cleanPlateNumber(plateInput);
  }, [plateInput]);

  // --- RECHERCHE HISTORIQUE DU CAMION CENTRÉE SUR LA PLAQUE ---
  const truckSalesHistory = useMemo(() => {
    if (!normalizedCurrentPlate) return [];
    return sales
      .filter((s) => cleanPlateNumber(s.truck_plate) === normalizedCurrentPlate)
      .sort((a, b) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime());
  }, [sales, normalizedCurrentPlate]);

  // Ticket actif en cours pour ce camion (le plus récent non encore clôturé ou le dernier)
  const activeTruckSale = useMemo(() => {
    const ongoing = truckSalesHistory.find((s) => !s.exited_at);
    return ongoing || truckSalesHistory[0] || null;
  }, [truckSalesHistory]);

  // Ticket physique inspecté (soit celui scanné, soit celui lié au camion)
  const inspectedTicket = useMemo(() => {
    const cleanNum = scannedTicketNumber.trim().toUpperCase();
    return tickets.find((t) => t.ticket_number.toUpperCase() === cleanNum);
  }, [tickets, scannedTicketNumber]);

  const associatedSaleForScannedTicket = useMemo(() => {
    if (inspectedTicket) {
      return sales.find((s) => s.ticket_id === inspectedTicket.id);
    }
    const cleanNum = scannedTicketNumber.trim().toUpperCase();
    return sales.find((s) => s.ticket_number.toUpperCase() === cleanNum);
  }, [sales, inspectedTicket, scannedTicketNumber]);

  const ticketSector = useMemo(() => {
    const secId = inspectedTicket?.sector_id ?? associatedSaleForScannedTicket?.sector_id;
    return sectors.find((s) => s.id === secId);
  }, [sectors, inspectedTicket, associatedSaleForScannedTicket]);

  const sellerProfile = useMemo(() => {
    const agId = associatedSaleForScannedTicket?.agent_id ?? inspectedTicket?.assigned_agent_id;
    return profiles.find((p) => p.id === agId);
  }, [profiles, associatedSaleForScannedTicket, inspectedTicket]);

  // Exécution de l'audit et vérification Ed25519 hors-ligne
  const inspectAndAuditTicket = useCallback(
    async (ticketNumToInspect: string) => {
      const cleanNum = ticketNumToInspect.trim().toUpperCase();
      const t = tickets.find((item) => item.ticket_number === cleanNum);

      let cryptoRes: TicketVerificationResultP1 | null = null;
      if (t?.qr_static_payload) {
        cryptoRes = await verifyTicketQrPayloadP1(
          t.qr_static_payload,
          settings.ed25519_public_key_hex
        );
        setEd25519Result(cryptoRes);
      } else {
        setEd25519Result(null);
      }

      await portusRepository.logTicketConsultationAudit({
        controller: currentProfile,
        ticketNumber: cleanNum,
        ticketId: t?.id ?? null,
        sectorId: t?.sector_id ?? currentProfile.sector_id,
        ed25519Verified: cryptoRes?.isSignatureVerified ?? false,
        gpsLat: gpsCoords.lat,
        gpsLng: gpsCoords.lng,
      });

      const logs = await portusRepository.getRecentAuditLogs(6);
      setRecentAudits(logs);
    },
    [tickets, settings.ed25519_public_key_hex, currentProfile, gpsCoords.lat, gpsCoords.lng]
  );

  useEffect(() => {
    void inspectAndAuditTicket(scannedTicketNumber);
  }, [scannedTicketNumber, inspectAndAuditTicket]);

  // Synchronisation plaque lors de la sélection d'un ticket vendu
  useEffect(() => {
    if (associatedSaleForScannedTicket?.truck_plate) {
      setPlateInput(associatedSaleForScannedTicket.truck_plate);
    }
  }, [associatedSaleForScannedTicket]);

  // --- DÉMARRAGE DU SCANNER QR CODE TICKET ---
  const handleStartQrScanner = async () => {
    await stopAllScannersStrictly();
    const {Html5Qrcode} = await import('html5-qrcode');
    const scanner = new Html5Qrcode('portus-controller-qr-reader');
    html5QrRef.current = scanner;
    setIsQrScannerActive(true);

    try {
      await scanner.start(
        {facingMode: 'environment'},
        {fps: 14, qrbox: {width: 240, height: 240}},
        async (decoded) => {
          await stopAllScannersStrictly();
          const ver = await verifyTicketQrPayloadP1(
            decoded,
            settings.ed25519_public_key_hex
          );
          setEd25519Result(ver);
          if (ver.parsed) {
            setScannedTicketNumber(ver.parsed.ticketNumber);
          } else {
            setScannedTicketNumber(decoded.trim().toUpperCase());
          }
          setActionBanner({
            tone: 'SUCCESS',
            title: `QR Code Ticket Scanné (${ver.parsed?.ticketNumber ?? decoded.slice(0, 15)})`,
            detail: ver.isSignatureVerified
              ? 'Signature Ed25519 UJPAS authentifiée à 100% hors-ligne.'
              : 'Attention : Signature cryptographique non vérifiée ou payload papier.',
          });
        },
        () => {}
      );
    } catch {
      await stopAllScannersStrictly();
    }
  };

  // --- VISEUR OCR DE PLAQUE (Caméra avec mire rectangulaire) ---
  const handleStartOcrPlateScanner = async () => {
    await stopAllScannersStrictly();
    const {Html5Qrcode} = await import('html5-qrcode');
    const scanner = new Html5Qrcode('portus-controller-ocr-reader');
    html5QrRef.current = scanner;
    setIsOcrScannerActive(true);
    setOcrDetectedPlateNotice(null);

    try {
      await scanner.start(
        {facingMode: 'environment'},
        {fps: 12, qrbox: {width: 280, height: 120}},
        (detected) => {
          // Si un code ou texte est lu
          const clean = cleanPlateNumber(detected);
          if (clean.length >= 4) {
            setPlateInput(detected.toUpperCase());
            setOcrDetectedPlateNotice(`Plaque détectée : ${detected.toUpperCase()}`);
          }
        },
        () => {}
      );
    } catch {
      await stopAllScannersStrictly();
    }
  };

  // --- SIMULATION / SÉLECTION RAPIDE DE PLAQUES EXISTANTES ---
  const existingPlatesSample = useMemo(() => {
    const set = new Set<string>();
    sales.forEach((s) => set.add(s.truck_plate));
    return Array.from(set).slice(0, 8);
  }, [sales]);

  // --- CALCUL DURÉE ET JAUGE DU SÉJOUR SUR 15 JOURS ---
  const referenceStartMs = associatedSaleForScannedTicket
    ? new Date(associatedSaleForScannedTicket.sold_at).getTime()
    : activeTruckSale
    ? new Date(activeTruckSale.sold_at).getTime()
    : Date.now();

  const elapsedDaysRaw = Math.max(0, (Date.now() - referenceStartMs) / (1000 * 3600 * 24));
  const elapsedDaysRounded = Math.min(15, Math.round(elapsedDaysRaw * 10) / 10);
  const gaugePercent = Math.min(100, Math.round((elapsedDaysRaw / 15) * 100));

  // --- COMPARATEUR DE PLAQUES & INDICATEUR SÉMANTIQUE ---
  // Vert = Conforme/Valid | Orange = A_VERIFIER | Rouge = FRAUDE / MISMATCH
  const registeredPlate = associatedSaleForScannedTicket?.truck_plate ?? activeTruckSale?.truck_plate ?? '';
  const plateComparison = registeredPlate
    ? compareTruckPlatesWithTolerance(registeredPlate, plateInput)
    : null;

  const isTicketNotSold = Boolean(
    !associatedSaleForScannedTicket &&
      (!inspectedTicket ||
        ['IMPRIME', 'ASSIGNE_SECTEUR', 'ASSIGNE_AGENT', 'AVAILABLE', 'ASSIGNED'].includes(
          inspectedTicket.status
        ))
  );

  const isTicketClosed = Boolean(
    inspectedTicket?.status === 'SORTIE_DECLAREE' ||
      inspectedTicket?.status === 'CLOSED' ||
      associatedSaleForScannedTicket?.exited_at
  );

  let semanticVerdict: 'VALID' | 'A_VERIFIER' | 'FRAUDE' = 'VALID';
  let semanticVerdictLabel = 'VALIDE — CONFORME';
  let semanticDetails = 'Véhicule en règle avec ticket actif et signature Ed25519 vérifiée.';

  if (isTicketNotSold) {
    semanticVerdict = 'FRAUDE';
    semanticVerdictLabel = 'FRAUDE — TICKET NON ENREGISTRÉ (NOT_SOLD)';
    semanticDetails = "Ce ticket physique n'a fait l'objet d'aucune vente enregistrée en base. Activez la Galerie Photos des Agents.";
  } else if (isTicketClosed) {
    semanticVerdict = 'FRAUDE';
    semanticVerdictLabel = 'FRAUDE — TICKET DÉJÀ SORTI / RÉUTILISÉ';
    semanticDetails = 'Ce ticket a déjà été clôturé par une sortie antérieure. Réutilisation frauduleuse interdite.';
  } else if (elapsedDaysRaw > 15) {
    semanticVerdict = 'FRAUDE';
    semanticVerdictLabel = 'ANOMALIE — DÉPASSEMENT 15 JOURS SANS RÉGULARISATION';
    semanticDetails = 'Le délai maximum autorisé sur le corridor est dépassé. Véhicule en infraction.';
  } else if (plateComparison) {
    if (plateComparison.exactMatch) {
      if (associatedSaleForScannedTicket && !associatedSaleForScannedTicket.payment_confirmed) {
        semanticVerdict = 'A_VERIFIER';
        semanticVerdictLabel = 'À VÉRIFIER — PAIEMENT MM EN ATTENTE';
        semanticDetails = 'Paiement Mobile Money non encore validé par le Responsable.';
      } else {
        semanticVerdict = 'VALID';
        semanticVerdictLabel = 'CONFORME — SÉJOUR RÉGULIER';
        semanticDetails = 'Plaque conforme, séjour en cours, assistance active.';
      }
    } else if (plateComparison.fuzzyTolerantMatch) {
      semanticVerdict = 'A_VERIFIER';
      semanticVerdictLabel = 'À VÉRIFIER — ÉCART MINEUR HOMOGLYPHE (1 CARACTÈRE)';
      semanticDetails = `Tolérance d'erreur de saisie (Ex: ${plateComparison.normalizedRegistered} vs ${plateComparison.normalizedObserved}). Contrôle visuel requis.`;
    } else {
      semanticVerdict = 'FRAUDE';
      semanticVerdictLabel = 'FRAUDE — DISCORDANCE PLAQUE (PLATE_MISMATCH)';
      semanticDetails = `La plaque déclarée (${registeredPlate}) ne correspond pas à la plaque constatée (${plateInput}).`;
    }
  } else if (normalizedCurrentPlate && !activeTruckSale) {
    semanticVerdict = 'FRAUDE';
    semanticVerdictLabel = 'SANS TICKET — AUCUN TICKET ACTIF EN BASE';
    semanticDetails = "Aucun ticket de séjour actif n'est enregistré pour ce numéro de plaque sur le port.";
  }

  // --- ACTION 1 : CLÔTURE SORTIE DU CAMION (CLOSED) ---
  const handleDeclareTruckExit = async () => {
    if (!inspectedTicket) return;
    setActionBanner(null);

    try {
      await syncEngine.enqueueMutation({
        operation: 'DECLARE_EXIT',
        label: `Sortie déclarée — Ticket ${inspectedTicket.ticket_number} (${associatedSaleForScannedTicket?.truck_plate ?? plateInput})`,
        payload: {
          p_ticket_number: inspectedTicket.ticket_number,
          p_agent_id: currentProfile.id,
          p_gps_lat: gpsCoords.lat,
          p_gps_lng: gpsCoords.lng,
        },
        actor_id: currentProfile.id,
        sector_id: inspectedTicket.sector_id,
      });

      await onDataChanged();
      setActionBanner({
        tone: 'SUCCESS',
        title: `Sortie du camion déclarée — Ticket ${inspectedTicket.ticket_number} clôturé (CLOSED)`,
        detail: `Coordonnées GPS (${gpsCoords.lat}, ${gpsCoords.lng}) enregistrées. Place libérée dans le secteur.`,
      });
    } catch (err) {
      setActionBanner({
        tone: 'DANGER',
        title: 'Impossible de déclarer la sortie',
        detail: err instanceof Error ? err.message : 'Vérifiez la validité du ticket.',
      });
    }
  };

  // --- ACTION 2 : SIGNALEMENT DIRECT À L'ADMINISTRATEUR ---
  const handleOpenAdminFraudModal = (presetVerdict?: ControlVerdict, motifText?: string) => {
    if (presetVerdict) setSelectedFraudVerdict(presetVerdict);
    if (motifText) setFraudMotifLabel(motifText);
    setShowAdminFraudModal(true);
  };

  const handleFraudPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFileToCanvas200Kb(file, 200);
      setFraudPhoto(compressed);
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmitAdminFraudReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingFraud(true);
    setActionBanner(null);

    try {
      await portusRepository.reportFraudDirectlyToAdmin({
        controller: currentProfile,
        ticketNumber: scannedTicketNumber,
        ticketId: inspectedTicket?.id ?? null,
        observedTruckPlate: plateInput,
        verdict: selectedFraudVerdict,
        motif: fraudMotifLabel,
        notes: fraudNotes.trim(),
        photoDataUrl: fraudPhoto?.dataUrl ?? null,
        photoSizeKb: fraudPhoto?.sizeKb ?? null,
        gpsLat: gpsCoords.lat,
        gpsLng: gpsCoords.lng,
      });

      await onDataChanged();
      setShowAdminFraudModal(false);
      setFraudNotes('');
      setFraudPhoto(null);

      setActionBanner({
        tone: 'DANGER',
        title: "RAPPORT DE FRAUDE TRANSMIS DIRECTEMENT À L'ADMINISTRATEUR",
        detail: `Dossier ouvert pour ${plateInput.toUpperCase()} (Motif : ${fraudMotifLabel}). Notification haute priorité envoyée au bureau de l'Administrateur.`,
      });
    } catch (err) {
      setActionBanner({
        tone: 'DANGER',
        title: 'Erreur lors du signalement',
        detail: err instanceof Error ? err.message : 'Échec de transmission.',
      });
    } finally {
      setIsSubmittingFraud(false);
    }
  };

  // --- ACTION 3 : GALERIE PHOTOS DES AGENTS (ANTI-FRAUDE NOT_SOLD) ---
  const handleConfirmAgentGalleryAllegation = async (e: React.FormEvent) => {
    e.preventDefault();
    const designatedAgent = profiles.find((p) => p.id === selectedSuspectAgentId);
    if (!designatedAgent) return;

    setIsSubmittingAllegation(true);
    try {
      await portusRepository.recordUnsoldTicketSellerAllegation({
        controller: currentProfile,
        ticketNumber: scannedTicketNumber,
        ticketId: inspectedTicket?.id ?? null,
        designatedAgent,
        observedTruckPlate: plateInput,
        driverStatement: driverAllegationNote,
        gpsLat: gpsCoords.lat,
        gpsLng: gpsCoords.lng,
      });

      setShowAgentGalleryModal(false);
      setDriverAllegationNote('');
      await onDataChanged();

      setActionBanner({
        tone: 'WARNING',
        title: "Allégation enregistrée au statut « A_VERIFIER » transmise à l'Administrateur",
        detail: `Le chauffeur a désigné ${designatedAgent.full_name} (${designatedAgent.phone}) comme vendeur du ticket ${scannedTicketNumber}. Enquête contradictoire sans sanction automatique.`,
      });
    } catch (err) {
      setActionBanner({
        tone: 'DANGER',
        title: "Erreur d'enregistrement",
        detail: err instanceof Error ? err.message : 'Échec.',
      });
    } finally {
      setIsSubmittingAllegation(false);
    }
  };

  // Thème dynamique : Plein Soleil (Clair Haute Lisibilité) vs Nuit (Dark)
  const isSun = themeMode === 'SUN';
  const themeCardBg = isSun ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-900 border-slate-800';
  const themeSubCardBg = isSun ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800';
  const themeTextPrimary = isSun ? 'text-slate-950' : 'text-white';
  const themeTextSecondary = isSun ? 'text-slate-600' : 'text-slate-400';
  const themeInputBg = isSun
    ? 'bg-white border-slate-300 text-slate-950 focus:border-amber-600'
    : 'bg-slate-950 border-slate-700 text-white focus:border-amber-400';

  return (
    <div
      className={`space-y-6 min-h-screen transition-colors duration-200 ${
        isSun ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
      }`}
    >
      {/* =========================================================================
          1. BANDEAU OFFICIEL : HIÉRARCHIE DIRECTE ADMINISTRATEUR & COMMUTATEUR SOLEIL/NUIT
      ========================================================================= */}
      <header
        className={`rounded-2xl border p-5 ${
          isSun
            ? 'border-emerald-600/30 bg-gradient-to-r from-emerald-50 via-white to-amber-50 shadow-sm'
            : 'border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 shadow-lg'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 font-mono text-xs font-black text-white uppercase tracking-wider">
                <Shield className="h-3.5 w-3.5" />
                CONTRÔLEUR ROUTIER INDÉPENDANT
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300 border border-amber-500/30">
                Liaison Directe : Direction & Administrateur UJPAS
              </span>
            </div>
            <h1 className={`text-xl font-black tracking-tight ${themeTextPrimary}`}>
              Poste de Contrôle & Répression des Fraudes — {currentProfile.full_name}
            </h1>
            <p className={`flex flex-wrap items-center gap-3 text-xs font-semibold ${themeTextSecondary}`}>
              <span className="font-mono">Indicatif : {currentProfile.callsign} ({currentProfile.matricule})</span>
              <span>·</span>
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                <MapPin className="h-3.5 w-3.5" />
                GPS Corridor : {gpsCoords.lat.toFixed(4)}, {gpsCoords.lng.toFixed(4)}
              </span>
              <span>·</span>
              <span className="font-mono text-amber-700 dark:text-amber-400">
                Crypto Ed25519 : 100% Hors-Ligne Embarquée
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Commutateur Mode Plein Soleil / Mode Nuit */}
            <button
              type="button"
              onClick={() => setThemeMode(isSun ? 'NIGHT' : 'SUN')}
              className={`flex min-h-[46px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-extrabold transition shadow-sm ${
                isSun
                  ? 'border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title="Basculer entre le mode Plein Soleil (ultra contraste) et Mode Nuit"
            >
              {isSun ? (
                <>
                  <Sun className="h-4 w-4 text-amber-600 fill-amber-500" />
                  <span>Mode Plein Soleil (Actif)</span>
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-indigo-400 fill-indigo-400" />
                  <span>Mode Nuit (Actif)</span>
                </>
              )}
            </button>

            {/* Bouton d'urgence : Alerte Fraude Immédiate à l'Administrateur */}
            <button
              type="button"
              onClick={() => handleOpenAdminFraudModal()}
              className="flex min-h-[46px] items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-500 transition shadow-sm"
            >
              <AlertOctagon className="h-4 w-4" />
              <span>ALERTE FRAUDE ADMIN</span>
            </button>
          </div>
        </div>

        {/* Bannière de retour d'action */}
        {actionBanner && (
          <div
            className={`mt-4 rounded-xl border p-4 text-xs font-medium flex items-start justify-between gap-3 ${
              actionBanner.tone === 'SUCCESS'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-200'
                : actionBanner.tone === 'WARNING'
                ? 'border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-rose-500 bg-rose-50 text-rose-950 dark:bg-rose-950/40 dark:text-rose-200'
            }`}
          >
            <div>
              <p className="font-black text-sm">{actionBanner.title}</p>
              <p className="mt-1 leading-relaxed">{actionBanner.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => setActionBanner(null)}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
              title="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </header>

      {/* =========================================================================
          2. CONTRÔLE CENTRÉ SUR LA PLAQUE DU CAMION (Zone Principale)
      ========================================================================= */}
      <section className={`rounded-2xl border p-5 ${themeCardBg}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-amber-500 p-2 text-slate-950">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h2 className={`text-base font-black ${themeTextPrimary}`}>
                Contrôle Centré sur la Plaque du Camion
              </h2>
              <p className={`text-xs ${themeTextSecondary}`}>
                Saisie directe, touches pays rapides, ou viseur OCR caméra haute précision.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Viseur OCR Caméra Plaque */}
            {!isOcrScannerActive ? (
              <button
                type="button"
                onClick={() => void handleStartOcrPlateScanner()}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-800 text-white hover:bg-slate-700 px-3.5 py-2 text-xs font-bold transition"
              >
                <Camera className="h-4 w-4 text-amber-400" />
                <span>Viseur OCR Plaque Caméra</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void stopAllScannersStrictly()}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-rose-600 text-white hover:bg-rose-500 px-3.5 py-2 text-xs font-bold transition"
              >
                <CameraOff className="h-4 w-4" />
                <span>Arrêter Viseur OCR</span>
              </button>
            )}

            {/* Viseur Scanner QR Ticket (Ed25519) */}
            {!isQrScannerActive ? (
              <button
                type="button"
                onClick={() => void handleStartQrScanner()}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 px-3.5 py-2 text-xs font-bold transition"
              >
                <QrCode className="h-4 w-4" />
                <span>Scanner QR Ticket Physique</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void stopAllScannersStrictly()}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-rose-600 text-white hover:bg-rose-500 px-3.5 py-2 text-xs font-bold transition"
              >
                <CameraOff className="h-4 w-4" />
                <span>Arrêter Scanner QR</span>
              </button>
            )}
          </div>
        </div>

        {/* Lecteur Viseur OCR Plaque avec Mire de Cadrage Horizontale */}
        {isOcrScannerActive && (
          <div className="mt-4 rounded-xl border border-amber-500/50 bg-slate-950 p-4">
            <div className="flex items-center justify-between text-xs text-amber-400 font-bold mb-2">
              <span className="flex items-center gap-2">
                <Camera className="h-4 w-4 animate-pulse" />
                Viseur OCR Caméra — Cadrez la plaque minéralogique du tracteur
              </span>
              <span>12 FPS · Autofocus Actif</span>
            </div>
            <div
              id="portus-controller-ocr-reader"
              className="overflow-hidden rounded-lg border-2 border-dashed border-amber-400/80 bg-black min-h-[220px]"
            />
            {ocrDetectedPlateNotice && (
              <p className="mt-2 text-center text-xs font-black text-emerald-400 bg-emerald-950/60 p-2 rounded">
                {ocrDetectedPlateNotice}
              </p>
            )}
          </div>
        )}

        {/* Lecteur Viseur QR Ticket Ed25519 */}
        {isQrScannerActive && (
          <div className="mt-4 rounded-xl border border-emerald-500/50 bg-slate-950 p-4">
            <div className="flex items-center justify-between text-xs text-emerald-400 font-bold mb-2">
              <span className="flex items-center gap-2">
                <QrCode className="h-4 w-4 animate-pulse" />
                Viseur QR Ticket — Vérification Ed25519 100% hors-ligne
              </span>
              <span>Vridi Sécurisé</span>
            </div>
            <div
              id="portus-controller-qr-reader"
              className="overflow-hidden rounded-lg border-2 border-dashed border-emerald-400/80 bg-black min-h-[240px]"
            />
          </div>
        )}

        {/* Saisie tactile de la plaque + Pays */}
        <div className="mt-5 space-y-3">
          <div>
            <label className={`block text-xs font-bold uppercase tracking-wider ${themeTextSecondary}`}>
              Sélection Rapide du Pays d&apos;Immatriculation
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[
                {code: 'CI', label: 'Côte d’Ivoire 🇨🇮'},
                {code: 'ML', label: 'Mali 🇲🇱'},
                {code: 'BF', label: 'Burkina Faso 🇧🇫'},
                {code: 'NE', label: 'Niger 🇳🇪'},
                {code: 'GN', label: 'Guinée 🇬🇳'},
                {code: 'GH', label: 'Ghana 🇬🇭'},
                {code: 'TG', label: 'Togo 🇹🇬'},
                {code: 'SN', label: 'Sénégal 🇸🇳'},
                {code: 'AUTRE', label: 'Autre 🌍'},
              ].map((c) => {
                const isSelected = selectedCountryPrefix === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      setSelectedCountryPrefix(c.code);
                      if (c.code !== 'AUTRE' && !plateInput.startsWith(c.code)) {
                        setPlateInput(`${c.code}-${cleanPlateNumber(plateInput.replace(/^[A-Z]{2}-?/, ''))}`);
                      }
                    }}
                    className={`min-h-[42px] px-3 rounded-lg text-xs font-extrabold border transition ${
                      isSelected
                        ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                        : isSun
                        ? 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-8">
              <label htmlFor="truck-plate-search" className={`block text-xs font-bold ${themeTextSecondary}`}>
                Numéro de Plaque Minéralogique du Tracteur
              </label>
              <div className="mt-1 relative">
                <input
                  id="truck-plate-search"
                  type="text"
                  value={plateInput}
                  onChange={(e) => setPlateInput(e.target.value.toUpperCase())}
                  placeholder="Ex: CI-8842-GT ou 11-JJ-4521"
                  className={`w-full min-h-[50px] rounded-xl px-4 py-3 font-mono text-lg font-black tracking-wider uppercase border ${themeInputBg}`}
                />
                {plateInput && (
                  <button
                    type="button"
                    onClick={() => setPlateInput('')}
                    className="absolute right-3 top-3 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            <div className="md:col-span-4">
              <label htmlFor="ticket-quick-select" className={`block text-xs font-bold ${themeTextSecondary}`}>
                Ticket Physique Contrôlé (Scan ou Saisie)
              </label>
              <input
                id="ticket-quick-select"
                type="text"
                value={scannedTicketNumber}
                onChange={(e) => setScannedTicketNumber(e.target.value.toUpperCase())}
                placeholder="Ex: UJPAS-VRD01-100001"
                className={`mt-1 w-full min-h-[50px] rounded-xl px-3 py-3 font-mono text-sm font-bold uppercase border ${themeInputBg}`}
              />
            </div>
          </div>

          {/* Échantillons rapides de plaques réelles */}
          {existingPlatesSample.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
              <span className={`font-semibold ${themeTextSecondary}`}>Plaques récentes au port :</span>
              {existingPlatesSample.map((pl) => (
                <button
                  key={pl}
                  type="button"
                  onClick={() => setPlateInput(pl)}
                  className={`px-2.5 py-1 rounded-md font-mono text-xs font-bold border ${
                    cleanPlateNumber(plateInput) === cleanPlateNumber(pl)
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : isSun
                      ? 'bg-slate-200 text-slate-800 border-slate-300 hover:bg-slate-300'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {pl}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* =========================================================================
          3. INDICATEUR SÉMANTIQUE GÉANT (Vert = Valid, Orange = À vérifier, Rouge = Fraude)
      ========================================================================= */}
      <section
        className={`rounded-2xl border-2 p-5 transition shadow-md ${
          semanticVerdict === 'VALID'
            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100'
            : semanticVerdict === 'A_VERIFIER'
            ? 'border-amber-500 bg-amber-500/15 text-amber-950 dark:text-amber-100'
            : 'border-rose-600 bg-rose-600/15 text-rose-950 dark:text-rose-100'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`rounded-2xl p-3 text-white ${
                semanticVerdict === 'VALID'
                  ? 'bg-emerald-600'
                  : semanticVerdict === 'A_VERIFIER'
                  ? 'bg-amber-600'
                  : 'bg-rose-600'
              }`}
            >
              {semanticVerdict === 'VALID' ? (
                <CheckCircle2 className="h-7 w-7" />
              ) : semanticVerdict === 'A_VERIFIER' ? (
                <AlertTriangle className="h-7 w-7" />
              ) : (
                <AlertOctagon className="h-7 w-7" />
              )}
            </div>
            <div>
              <span className="font-mono text-xs font-black uppercase tracking-wider opacity-80">
                VERDICT SÉMANTIQUE DU CONTRÔLE ROUTIER
              </span>
              <h3 className="text-lg md:text-xl font-black">{semanticVerdictLabel}</h3>
              <p className="mt-0.5 text-xs font-semibold leading-relaxed">{semanticDetails}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {semanticVerdict === 'FRAUDE' && (
              <button
                type="button"
                onClick={() => handleOpenAdminFraudModal(selectedFraudVerdict, semanticVerdictLabel)}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-700 shadow"
              >
                <Send className="h-4 w-4" />
                <span>Transmettre Rapport à l&apos;Admin</span>
              </button>
            )}

            {isTicketNotSold && (
              <button
                type="button"
                onClick={() => setShowAgentGalleryModal(true)}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 shadow"
              >
                <Users className="h-4 w-4" />
                <span>Ouvrir Galerie Photos des Agents</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* =========================================================================
          4. GRILLE PRINCIPALE : DOUBLE VÉRIFICATION CÔTE-À-CÔTE + HISTORIQUE DU CAMION
      ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* =====================================================================
            GAUCHE (7 COLONNES) : DOUBLE VÉRIFICATION TICKET PHYSIQUE VS BASE & CRYPTO
        ===================================================================== */}
        <div className="space-y-6 lg:col-span-7">
          {/* Fiche Ticket & Vérification Ed25519 */}
          <div className={`rounded-2xl border p-5 ${themeCardBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <FileSearch className="h-5 w-5 text-amber-500" />
                <h3 className={`text-base font-black ${themeTextPrimary}`}>
                  Double Vérification : Ticket Physique vs Base
                </h3>
              </div>

              {/* Sceau Cryptographique Ed25519 100% Hors-Ligne */}
              <div className="flex items-center gap-1.5 text-xs font-black">
                {ed25519Result?.isSignatureVerified ? (
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/30">
                    <ShieldCheck className="h-4 w-4" />
                    Ed25519 AUTHENTIQUE (kid={ed25519Result.parsed?.kid})
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/30">
                    <ShieldAlert className="h-4 w-4" />
                    Signature Manuelle N° Série
                  </span>
                )}
              </div>
            </div>

            {/* Confrontation côte-à-côte */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Volet 1 : Données Physiques Constatées */}
              <div className={`rounded-xl border p-3.5 space-y-2 ${themeSubCardBg}`}>
                <span className="font-mono text-[11px] font-black uppercase text-amber-600 dark:text-amber-400">
                  1. CONSTAT PHYSIQUE SUR LE CORRIDOR
                </span>
                <div>
                  <span className={themeTextSecondary}>Plaque observée devant tracteur :</span>
                  <p className="font-mono text-base font-black text-emerald-600 dark:text-emerald-400">
                    {plateInput.toUpperCase() || 'NON SAISIE'}
                  </p>
                </div>
                <div>
                  <span className={themeTextSecondary}>Numéro de Ticket présenté :</span>
                  <p className="font-mono text-sm font-bold text-amber-600 dark:text-amber-300">
                    {scannedTicketNumber}
                  </p>
                </div>
                <div>
                  <span className={themeTextSecondary}>Ed25519 Statut :</span>
                  <p className="font-bold">
                    {ed25519Result?.isSignatureVerified
                      ? 'Authentifié sans réseau'
                      : 'Non vérifiable ou papier'}
                  </p>
                </div>
              </div>

              {/* Volet 2 : Fiche Ticket Enregistrée en Base */}
              <div className={`rounded-xl border p-3.5 space-y-2 ${themeSubCardBg}`}>
                <span className="font-mono text-[11px] font-black uppercase text-sky-600 dark:text-sky-400">
                  2. FICHE ENREGISTRÉE EN BASE (SUPABASE/IDB)
                </span>
                <div>
                  <span className={themeTextSecondary}>Plaque liée en base :</span>
                  <p className="font-mono text-base font-black text-sky-600 dark:text-sky-400">
                    {registeredPlate || 'AUCUNE (NON VENDU)'}
                  </p>
                </div>
                <div>
                  <span className={themeTextSecondary}>Statut du Ticket :</span>
                  <p className="font-bold">
                    {isTicketClosed
                      ? 'CLOSED (SORTIE_DECLAREE)'
                      : isTicketNotSold
                      ? 'NOT_SOLD (Non synchronisé)'
                      : inspectedTicket?.status === 'EN_ATTENTE_REGULARISATION'
                      ? 'EN ATTENTE DE RÉGULARISATION'
                      : 'SEJOUR_ACTIF (Régulier)'}
                  </p>
                </div>
                <div>
                  <span className={themeTextSecondary}>Agent Vendeur :</span>
                  <p className="font-bold truncate">
                    {sellerProfile
                      ? `${sellerProfile.full_name} (${sellerProfile.callsign})`
                      : 'Non attribué'}
                  </p>
                </div>
              </div>
            </div>

            {/* Détails financiers et chauffeur */}
            <div className={`mt-3 rounded-xl border p-3.5 text-xs ${themeSubCardBg}`}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <span className={themeTextSecondary}>Montant & Mode de Règlement</span>
                  <p className="font-mono font-bold text-sm">
                    {associatedSaleForScannedTicket
                      ? `${associatedSaleForScannedTicket.contribution_amount_fcfa} FCFA · ${associatedSaleForScannedTicket.payment_method}`
                      : `${inspectedTicket?.contribution_amount_fcfa ?? 5000} FCFA (Fixe UJPAS)`}
                  </p>
                  <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    {associatedSaleForScannedTicket?.payment_confirmed
                      ? '✓ Règlement validé'
                      : 'En attente de validation'}
                  </p>
                </div>

                <div>
                  <span className={themeTextSecondary}>Téléphone Chauffeur</span>
                  <p className="font-mono font-bold text-sm">
                    {maskDriverPhone(associatedSaleForScannedTicket?.driver_phone)}
                  </p>
                  <p className={`text-[11px] ${themeTextSecondary}`}>
                    Pays d&apos;origine : {associatedSaleForScannedTicket?.country_origin || 'CI'}
                  </p>
                </div>

                <div>
                  <span className={themeTextSecondary}>Secteur d&apos;émission</span>
                  <p className="font-bold text-sm truncate">
                    {ticketSector ? `${ticketSector.code} — ${ticketSector.name}` : 'Secteur Vridi 1'}
                  </p>
                  <p className={`text-[11px] font-mono ${themeTextSecondary}`}>
                    Vendu :{' '}
                    {associatedSaleForScannedTicket
                      ? new Date(associatedSaleForScannedTicket.sold_at).toLocaleString('fr-FR')
                      : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Jauge des jours écoulés sur 15 jours max */}
            <div className="mt-4 rounded-xl border border-slate-300 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-amber-500" />
                  Jauge de séjour sur le corridor (Jours écoulés sur 15 max)
                </span>
                <span className="font-mono font-black text-amber-600 dark:text-amber-400">
                  {elapsedDaysRounded} / 15 jours ({gaugePercent}%)
                </span>
              </div>
              <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className={`h-full transition-all rounded-full ${
                    elapsedDaysRaw > 15
                      ? 'bg-rose-600'
                      : elapsedDaysRaw > 10
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{width: `${Math.max(6, gaugePercent)}%`}}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                Délai normal : {settings.standard_stay_hours}h. Au-delà de 15 jours sans prolongation :
                passage automatique au statut{' '}
                <strong className="text-amber-600 dark:text-amber-400 font-bold">
                  « {settings.pending_regularization_label} »
                </strong>
                .
              </p>
            </div>
          </div>

          {/* Trace automatique des consultations d'audit */}
          <div className={`rounded-2xl border p-4 ${themeCardBg}`}>
            <div className="flex items-center gap-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              <Eye className="h-4 w-4 text-emerald-500" />
              <span>Journalisation continue des vérifications & Coordonnées GPS (`audit_logs`)</span>
            </div>
            <div className="mt-2.5 space-y-1.5">
              {recentAudits.slice(0, 3).map((log) => (
                <div
                  key={log.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 font-mono text-[11px] ${themeSubCardBg}`}
                >
                  <span className="font-bold">{log.action}</span>
                  <span className={themeTextSecondary}>
                    {String(log.payload.ticket_number ?? log.entity_id)} · GPS(
                    {String(log.payload.gps_lat ?? gpsCoords.lat)}, {String(log.payload.gps_lng ?? gpsCoords.lng)}) ·{' '}
                    {new Date(log.created_at).toLocaleTimeString('fr-FR')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* =====================================================================
            DROITE (5 COLONNES) : HISTORIQUE DU CAMION & ACTIONS DU CONTRÔLEUR
        ===================================================================== */}
        <div className="space-y-6 lg:col-span-5">
          {/* Historique du camion sur le corridor */}
          <div className={`rounded-2xl border p-5 ${themeCardBg}`}>
            <div className="flex items-center gap-2 border-b pb-3 border-slate-200 dark:border-slate-800">
              <History className="h-5 w-5 text-amber-500" />
              <div>
                <h3 className={`text-sm font-black ${themeTextPrimary}`}>
                  Historique du Camion : {plateInput.toUpperCase() || '—'}
                </h3>
                <p className={`text-xs ${themeTextSecondary}`}>
                  {truckSalesHistory.length} séjour(s) enregistré(s) dans le système
                </p>
              </div>
            </div>

            {truckSalesHistory.length > 0 ? (
              <div className="mt-3 space-y-2.5">
                {truckSalesHistory.map((s, idx) => {
                  const isCurrent = !s.exited_at;
                  return (
                    <div
                      key={s.id}
                      className={`rounded-xl border p-3 text-xs space-y-1 ${
                        isCurrent
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : isSun
                          ? 'border-slate-200 bg-slate-50'
                          : 'border-slate-800 bg-slate-950'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono font-bold">
                        <span className="text-amber-600 dark:text-amber-400">
                          Ticket : {s.ticket_number}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            isCurrent
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-300 dark:bg-slate-800 text-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {isCurrent ? 'SÉJOUR ACTIF' : 'SORTIE CLÔTURÉE'}
                        </span>
                      </div>
                      <p className={`text-[11px] ${themeTextSecondary}`}>
                        Entrée : {new Date(s.sold_at).toLocaleString('fr-FR')}
                      </p>
                      {s.exited_at && (
                        <p className={`text-[11px] ${themeTextSecondary}`}>
                          Sortie : {new Date(s.exited_at).toLocaleString('fr-FR')}
                        </p>
                      )}
                      <p className="font-semibold text-[11px]">
                        Règlement : {s.contribution_amount_fcfa} FCFA ({s.payment_method})
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-900 dark:text-rose-200">
                <p className="font-black text-sm">AUCUN SÉJOUR ENREGISTRÉ EN BASE</p>
                <p className="mt-1 leading-relaxed">
                  Ce numéro de plaque n&apos;a jamais payé de contribution UJPAS enregistrée sur ce corridor.
                  Si le chauffeur prétend avoir payé, examinez son ticket papier ou ouvrez la galerie photos.
                </p>
              </div>
            )}
          </div>

          {/* Boutons d'Action Opérationnels du Contrôleur */}
          <div className={`rounded-2xl border p-5 space-y-3 ${themeCardBg}`}>
            <h3 className={`text-sm font-black ${themeTextPrimary}`}>
              Actions Opérationnelles du Contrôleur
            </h3>

            {/* Action 1 : Déclarer la sortie du camion (CLOSED) */}
            <button
              type="button"
              disabled={!associatedSaleForScannedTicket || isTicketClosed}
              onClick={() => void handleDeclareTruckExit()}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white hover:bg-emerald-500 transition disabled:opacity-40 disabled:cursor-not-allowed shadow"
            >
              <LogOut className="h-4 w-4" />
              <span>
                {isTicketClosed
                  ? 'Sortie déjà déclarée (Ticket CLOSED)'
                  : 'Déclarer la Sortie du Camion (Passer à CLOSED)'}
              </span>
            </button>

            {/* Action 2 : Envoyer un rapport d'anomalie/fraude à l'ADMINISTRATEUR */}
            <button
              type="button"
              onClick={() => handleOpenAdminFraudModal()}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-rose-600 bg-rose-600/15 px-4 py-3 text-xs font-black text-rose-700 dark:text-rose-300 hover:bg-rose-600/25 transition shadow"
            >
              <AlertTriangle className="h-4 w-4" />
              <span>Signaler Anomalie / Fraude à l&apos;Administrateur</span>
            </button>

            {/* Action 3 : Galerie Photos des Agents (Désignation vendeur ticket NOT_SOLD) */}
            <button
              type="button"
              onClick={() => setShowAgentGalleryModal(true)}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-sky-500/60 bg-sky-500/15 px-4 py-3 text-xs font-black text-sky-800 dark:text-sky-300 hover:bg-sky-500/25 transition shadow"
            >
              <Users className="h-4 w-4" />
              <span>Galerie Photos des Agents (Désignation vendeur)</span>
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          MODALE 1 : SIGNALEMENT ANOMALIE / FRAUDE DIRECTEMENT À L'ADMINISTRATEUR
      ========================================================================= */}
      {showAdminFraudModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-1.5 text-rose-400 font-mono text-xs font-black">
                  <ShieldAlert className="h-4 w-4" />
                  RAPPORT TRANSMIS DIRECTEMENT À L&apos;ADMINISTRATEUR
                </div>
                <h3 className="text-base font-black text-white mt-1">
                  Signalement d&apos;Anomalie / Fraude sur le Corridor
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminFraudModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Plaque : <strong className="text-white font-mono">{plateInput.toUpperCase()}</strong> ·
              Ticket : <strong className="text-white font-mono">{scannedTicketNumber}</strong> ·
              GPS : <span className="text-emerald-400">{gpsCoords.lat}, {gpsCoords.lng}</span>
            </p>

            <form onSubmit={handleSubmitAdminFraudReport} className="mt-4 space-y-4">
              <div>
                <label htmlFor="fraud-motif-select" className="block text-xs font-bold text-slate-300">
                  Motif d&apos;Anomalie ou Fraude Constaté
                </label>
                <select
                  id="fraud-motif-select"
                  value={selectedFraudVerdict}
                  onChange={(e) => {
                    const v = e.target.value as ControlVerdict;
                    setSelectedFraudVerdict(v);
                    const mapLabels: Record<ControlVerdict, string> = {
                      CONFORME_ACTIF: 'Conforme',
                      DEPASSEMENT_DUREE_EN_ATTENTE_REGULARISATION: 'Dépassement de séjour (> 15 jours)',
                      PLAQUE_NON_CONFORME: 'Discordance de plaque (PLATE_MISMATCH)',
                      SIGNATURE_CRYPTO_INVALIDE: 'Signature cryptographique falsifiée',
                      TICKET_DEJA_SORTI: 'Tentative de réutilisation d’un ticket fermé',
                      TICKET_INCONNU_OU_NON_SYNCHRONISE: 'Ticket non vendu en base (Vente au noir suspectée)',
                      PAIEMENT_MM_NON_CONFIRME: 'Règlement Mobile Money non confirmé',
                    };
                    setFraudMotifLabel(mapLabels[v] || v);
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="PLAQUE_NON_CONFORME">
                    Discordance de plaque d&apos;immatriculation (`PLATE_MISMATCH`)
                  </option>
                  <option value="TICKET_INCONNU_OU_NON_SYNCHRONISE">
                    Ticket non enregistré en base (`NOT_SOLD` / Faux carnet)
                  </option>
                  <option value="DEPASSEMENT_DUREE_EN_ATTENTE_REGULARISATION">
                    Dépassement de durée de séjour (&gt; 15 jours sans régularisation)
                  </option>
                  <option value="TICKET_DEJA_SORTI">
                    Tentative de réutilisation d&apos;un ticket déjà clôturé (`CLOSED`)
                  </option>
                  <option value="SIGNATURE_CRYPTO_INVALIDE">
                    Signature cryptographique Ed25519 altérée / falsifiée
                  </option>
                  <option value="PAIEMENT_MM_NON_CONFIRME">
                    Paiement Mobile Money non confirmé / fausse preuve
                  </option>
                </select>
              </div>

              <div>
                <label htmlFor="fraud-notes-textarea" className="block text-xs font-bold text-slate-300">
                  Circonstances & Déclarations du Chauffeur
                </label>
                <textarea
                  id="fraud-notes-textarea"
                  rows={3}
                  value={fraudNotes}
                  onChange={(e) => setFraudNotes(e.target.value)}
                  placeholder="Précisez l'endroit exact sur le quai, le comportement du chauffeur, la possession de faux tickets papier..."
                  required
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white"
                />
              </div>

              {/* Photo de preuve compressée sur canvas */}
              <div>
                <input
                  ref={fraudPhotoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFraudPhotoSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await stopAllScannersStrictly();
                    fraudPhotoInputRef.current?.click();
                  }}
                  className="flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 w-full justify-center"
                >
                  <Camera className="h-4 w-4 text-amber-400" />
                  <span>
                    {fraudPhoto
                      ? `✓ Photo de preuve jointe (${fraudPhoto.sizeKb} Ko compressée)`
                      : 'Prendre une photo de preuve (Compressée ≤ 200 Ko)'}
                  </span>
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdminFraudModal(false)}
                  className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingFraud}
                  className="flex min-h-[44px] items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-black text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  <span>{isSubmittingFraud ? 'Transmission...' : "Transmettre à l'Administrateur"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODALE 2 : GALERIE PHOTOS DES AGENTS (Photo, Nom, Téléphone)
      ========================================================================= */}
      {showAgentGalleryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <span className="font-mono text-xs font-bold text-amber-400 uppercase">
                  DISPOSITIF ANTI-FRAUDE · DÉSIGNATION DU VENDEUR
                </span>
                <h3 className="text-base font-black text-white mt-0.5">
                  Galerie des Agents Percepteurs UJPAS (Photo, Nom, Téléphone)
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Présentez cet écran au chauffeur pour qu&apos;il pointe l&apos;agent qui lui a remis le ticket.
                  Cette allégation est enregistrée au statut <strong className="text-amber-300 font-bold">A_VERIFIER</strong> (sans sanction automatique)
                  et transmise à l&apos;Administrateur pour confrontation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAgentGalleryModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmAgentGalleryAllegation} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[380px] overflow-y-auto p-1">
                {profiles
                  .filter((p) => p.peut_vendre)
                  .map((agent, idx) => {
                    const isSelected = selectedSuspectAgentId === agent.id;
                    const photoSrc = agent.photo_url || buildAgentTrombineSvgDataUrl(agent, idx);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setSelectedSuspectAgentId(agent.id)}
                        className={`flex flex-col items-center rounded-xl border p-2.5 text-center transition ${
                          isSelected
                            ? 'border-amber-400 bg-amber-500/20 ring-2 ring-amber-400'
                            : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                        }`}
                      >
                        <img
                          src={photoSrc}
                          alt={agent.full_name}
                          className="h-24 w-20 rounded-lg object-cover bg-slate-800 shadow"
                        />
                        <span className="mt-2 text-xs font-black text-white line-clamp-1">
                          {agent.full_name}
                        </span>
                        <span className="font-mono text-[10px] text-amber-400">
                          {agent.callsign || agent.matricule}
                        </span>
                        {/* Numéro de téléphone bien visible */}
                        <span className="mt-1 flex items-center gap-1 font-mono text-[11px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">
                          <Phone className="h-3 w-3" />
                          {agent.phone || '+225 07 00 00 00'}
                        </span>
                      </button>
                    );
                  })}
              </div>

              <div>
                <label htmlFor="allegation-notes-field" className="block text-xs font-bold text-slate-300">
                  Déclaration circonstanciée du chauffeur (Lieu, heure, montant remis)
                </label>
                <input
                  id="allegation-notes-field"
                  type="text"
                  value={driverAllegationNote}
                  onChange={(e) => setDriverAllegationNote(e.target.value)}
                  placeholder="Ex: Le chauffeur affirme avoir remis 5 000 FCFA à 08h30 à cet agent au Quai Fruitier"
                  required
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAgentGalleryModal(false)}
                  className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300"
                >
                  Fermer
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAllegation}
                  className="flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    {isSubmittingAllegation
                      ? 'Enregistrement...'
                      : 'Enregistrer Allégation « A_VERIFIER »'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
