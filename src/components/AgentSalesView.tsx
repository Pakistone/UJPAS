/**
 * PORTUS — Écran de Vente de l'Agent Percepteur (Tunnel en 3 étapes / 1 seul écran fluide)
 * Spécifications :
 * - Couleurs nationales Côte d'Ivoire : Orange (#FF8200), Vert (#009E60), Blanc/Gris clair
 * - Haute visibilité plein soleil Vridi (contrastes AAA, boutons >= 48px)
 * - Rôle Agent Volant : Sélection/changement direct du secteur d'affectation
 * - Stock local strict : Ne voit et ne vend que les tickets attribués par son Responsable
 * - Alerte stock critique rouge clignotante dès qu'il reste moins de 5 tickets
 * - Tunnel ergonomique : Scan QR / Saisie -> Pays (ML, BF, CI, AUTRE) -> Plaque majuscule -> Téléphone chauffeur
 * - Paiement 5 000 FCFA fixe : CASH par défaut (Vert vif #009E60) ou MOBILE MONEY (Orange #FF8200) avec photo compressée canvas ~200 Ko
 * - Validation & Reçu : Enregistrement IndexedDB (mutation_queue), notification auto au Responsable,
 *   bouton géant « Partager le reçu WhatsApp » prérempli avec numéro chauffeur.
 */

import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  QrCode,
  Camera,
  CameraOff,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  Banknote,
  Share2,
  MessageSquare,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  Check,
  ChevronDown,
  Sparkles,
  Ticket as TicketIcon,
  X,
  MapPin,
  Radio,
} from 'lucide-react';
import {Html5Qrcode} from 'html5-qrcode';
import {verifyTicketQrPayloadP1, normalizeTruckPlate} from '../lib/crypto/ed25519';
import {compressImageFileToCanvas200Kb, generateSyntheticMobileMoneyReceiptCanvas} from '../lib/media/imageCompressor';
import {syncEngine} from '../lib/sync/syncEngine';
import {getPortusDB} from '../lib/db/index';
import type {
  AppSettings,
  PaymentMethod,
  Profile,
  Sale,
  Sector,
  Ticket,
} from '../types/portus';

export interface AgentSalesViewProps {
  currentProfile: Profile;
  profiles: Profile[];
  sectors: Sector[];
  tickets: Ticket[];
  sales: Sale[];
  settings: AppSettings;
  activeSectorId?: string;
  onSectorChange?: (sectorId: string) => void;
  onSaleCompleted?: (sale: Sale) => void | Promise<void>;
  onClose?: () => void;
}

export type CountryCode = 'ML' | 'BF' | 'CI' | 'AUTRE';

const QUICK_COUNTRIES: Array<{
  code: CountryCode;
  label: string;
  flag: string;
  defaultDial: string;
}> = [
  {code: 'ML', label: 'Mali (ML)', flag: '🇲🇱', defaultDial: '+223'},
  {code: 'BF', label: 'Burkina (BF)', flag: '🇧🇫', defaultDial: '+226'},
  {code: 'CI', label: "Côte d'Ivoire (CI)", flag: '🇨🇮', defaultDial: '+225'},
  {code: 'AUTRE', label: 'Autre pays', flag: '🌍', defaultDial: '+227'},
];

const DIAL_CODES = [
  {code: '+223', label: 'Mali (+223)'},
  {code: '+226', label: 'Burkina Faso (+226)'},
  {code: '+225', label: "Côte d'Ivoire (+225)"},
  {code: '+227', label: 'Niger (+227)'},
  {code: '+233', label: 'Ghana (+233)'},
  {code: '+228', label: 'Togo (+228)'},
  {code: '+221', label: 'Sénégal (+221)'},
];

const MOBILE_OPERATORS: Array<{
  id: Exclude<PaymentMethod, 'ESPECES'>;
  label: string;
  colorClass: string;
}> = [
  {id: 'WAVE', label: 'Wave', colorClass: 'border-sky-500 bg-sky-500/20 text-sky-200'},
  {id: 'ORANGE_MONEY', label: 'Orange Money', colorClass: 'border-[#FF8200] bg-[#FF8200]/20 text-amber-200'},
  {id: 'MTN_MOMO', label: 'MTN MoMo', colorClass: 'border-yellow-500 bg-yellow-500/20 text-yellow-200'},
  {id: 'MOOV_MONEY', label: 'Moov Money', colorClass: 'border-blue-500 bg-blue-500/20 text-blue-200'},
];

export const AgentSalesView: React.FC<AgentSalesViewProps> = ({
  currentProfile,
  profiles,
  sectors,
  tickets,
  sales: _sales,
  settings,
  activeSectorId: initialActiveSectorId,
  onSectorChange,
  onSaleCompleted,
  onClose,
}) => {
  // Secteur actif pour l'Agent Volant
  const [selectedSectorId, setSelectedSectorId] = useState<string>(
    initialActiveSectorId ?? currentProfile.sector_id ?? sectors[0]?.id ?? ''
  );

  const activeSector =
    sectors.find((s) => s.id === selectedSectorId) ?? sectors[0];

  const handleSelectSector = (secId: string) => {
    setSelectedSectorId(secId);
    if (onSectorChange) onSectorChange(secId);
  };

  // Stock local de l'agent : strictement ses tickets attribués disponibles
  const myAssignedTickets = tickets.filter(
    (t) =>
      t.assigned_agent_id === currentProfile.id &&
      ['IMPRIME', 'ASSIGNE_SECTEUR', 'ASSIGNE_AGENT', 'AVAILABLE', 'ASSIGNED'].includes(
        t.status
      )
  );
  const remainingTicketsCount = myAssignedTickets.length;
  const isStockCritical = remainingTicketsCount < 5;

  // Stepper : 1 = Scan/Ticket, 2 = Véhicule & Chauffeur, 3 = Paiement, 4 = Reçu Succès
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // --- ÉTAPE 1 : TICKET & SCAN ---
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [_isScanningActive, setIsScanningActive] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [ticketInput, setTicketInput] = useState<string>(
    myAssignedTickets[0]?.ticket_number ?? ''
  );
  const [ticketValidationState, setTicketValidationState] = useState<{
    status: 'IDLE' | 'VALID' | 'WARNING_COLLEAGUE' | 'ERROR_USED' | 'ERROR_NOT_FOUND';
    message: string;
    targetTicket?: Ticket;
    ownerProfile?: Profile;
  }>({
    status: 'IDLE',
    message: '',
  });
  const [isColleagueOverrideActive, setIsColleagueOverrideActive] = useState(false);
  const [colleagueOverrideReason, setColleagueOverrideReason] = useState('');

  // Scanner HTML5-QRCode instance ref
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const isStoppingScannerRef = useRef<boolean>(false);

  // --- ÉTAPE 2 : VÉHICULE & CHAUFFEUR ---
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>('CI');
  const [truckPlateRaw, setTruckPlateRaw] = useState<string>('');
  const [trailerPlateRaw, setTrailerPlateRaw] = useState<string>('');
  const [containerNumberRaw, setContainerNumberRaw] = useState<string>('');
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [phoneDial, setPhoneDial] = useState<string>('+225');
  const [phoneDigits, setPhoneDigits] = useState<string>('');
  const [driverName, setDriverName] = useState<string>('');

  // --- ÉTAPE 3 : PAIEMENT & ENCAISSEMENT ---
  const FIXED_AMOUNT_FCFA = 5000;
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'MOBILE_MONEY'>('CASH');
  const [selectedOperator, setSelectedOperator] =
    useState<Exclude<PaymentMethod, 'ESPECES'>>('WAVE');
  const [mobileMoneyRef, setMobileMoneyRef] = useState<string>('');
  const [proofDataUrl, setProofDataUrl] = useState<string | null>(null);
  const [proofSizeKb, setProofSizeKb] = useState<number | null>(null);
  const [isCompressingProof, setIsCompressingProof] = useState(false);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  // --- VALIDATION & ENREGISTREMENT ---
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedSale, setConfirmedSale] = useState<Sale | null>(null);
  const [receiptExpirationIso, setReceiptExpirationIso] = useState<string>('');

  // Arrêt strict et nettoyage du scanner pour préserver la RAM (Anti-OOM)
  const destroyScannerStrictly = useCallback(async () => {
    if (isStoppingScannerRef.current) return;
    const instance = html5QrCodeRef.current;
    if (!instance) {
      setIsScanningActive(false);
      setIsScannerOpen(false);
      return;
    }

    isStoppingScannerRef.current = true;
    try {
      if (instance.isScanning) {
        await instance.stop();
      }
    } catch {
      // Déjà arrêté
    }
    try {
      instance.clear();
    } catch {
      // Erreur DOM ignorée
    }
    html5QrCodeRef.current = null;
    isStoppingScannerRef.current = false;
    setIsScanningActive(false);
    setIsScannerOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      void destroyScannerStrictly();
    };
  }, [destroyScannerStrictly]);

  // Contrôle du ticket dans le stock local IndexedDB
  const validateScannedOrInputTicket = useCallback(
    (inputNum: string) => {
      const clean = inputNum.trim().toUpperCase();
      if (!clean) {
        setTicketValidationState({status: 'IDLE', message: ''});
        return;
      }

      // Recherche dans le stock
      const match = tickets.find(
        (t) =>
          t.ticket_number.toUpperCase() === clean ||
          t.ticket_number.toUpperCase().includes(clean)
      );

      if (!match) {
        setTicketValidationState({
          status: 'ERROR_NOT_FOUND',
          message: `Ticket "${clean}" non trouvé dans le stock local UJPAS.`,
        });
        return;
      }

      // Vérifie si déjà utilisé
      if (
        ['SEJOUR_ACTIF', 'SORTIE_DECLAREE', 'EXPIRE', 'ANNULE_FRAUDE', 'SOLD', 'CLOSED'].includes(
          match.status
        )
      ) {
        setTicketValidationState({
          status: 'ERROR_USED',
          message: `Ticket "${match.ticket_number}" déjà utilisé (Statut : ${match.status}).`,
          targetTicket: match,
        });
        return;
      }

      // Contrôle de l'attribution du carnet
      const isMyTicket = match.assigned_agent_id === currentProfile.id;
      const owner = profiles.find((p) => p.id === match.assigned_agent_id);

      if (!isMyTicket) {
        setTicketValidationState({
          status: 'WARNING_COLLEAGUE',
          message: `Ticket attribué à votre collègue ${owner?.full_name ?? 'autre agent'} (${owner?.callsign ?? 'COLLÈGUE'}).`,
          targetTicket: match,
          ownerProfile: owner,
        });
      } else {
        setTicketValidationState({
          status: 'VALID',
          message: `Ticket vérifié dans votre carnet (#${match.serial_number}) · Prêt pour la vente.`,
          targetTicket: match,
          ownerProfile: currentProfile,
        });
      }
    },
    [tickets, currentProfile, profiles]
  );

  // Validation automatique initiale si ticket pré-sélectionné
  useEffect(() => {
    if (ticketInput && ticketValidationState.status === 'IDLE') {
      validateScannedOrInputTicket(ticketInput);
    }
  }, [ticketInput, ticketValidationState.status, validateScannedOrInputTicket]);

  // Démarrage du scanner QR avec arrêt strict dès détection
  const handleStartScanner = async () => {
    setScannerError(null);
    setIsScannerOpen(true);

    setTimeout(async () => {
      try {
        const scannerElement = document.getElementById(
          'portus-agent-sales-qr-reader'
        );
        if (!scannerElement) {
          throw new Error('Élément caméra introuvable.');
        }

        const scanner = new Html5Qrcode('portus-agent-sales-qr-reader');
        html5QrCodeRef.current = scanner;

        await scanner.start(
          {facingMode: 'environment'},
          {fps: 12, qrbox: {width: 250, height: 250}},
          async (decodedText) => {
            // DÉTECTION IMMÉDIATE : Stop et nettoyage stricts
            void destroyScannerStrictly();

            // Retour haptique si supporté
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try {
                navigator.vibrate(60);
              } catch {
                // Ignore
              }
            }

            let detectedTicketNumber = decodedText.trim();
            if (
              decodedText.startsWith('P1|') ||
              decodedText.startsWith('PORTUS|')
            ) {
              const res = await verifyTicketQrPayloadP1(
                decodedText,
                settings.ed25519_public_key_hex
              );
              if (res.parsed?.ticketNumber) {
                detectedTicketNumber = res.parsed.ticketNumber;
              } else {
                const parts = decodedText.split('|');
                if (parts[2]) detectedTicketNumber = parts[2];
              }
            }

            setTicketInput(detectedTicketNumber);
            validateScannedOrInputTicket(detectedTicketNumber);
          },
          () => {
            // Ignore frame errors
          }
        );

        setIsScanningActive(true);
      } catch (err) {
        setScannerError(
          err instanceof Error
            ? err.message
            : 'Impossible d’accéder à la caméra. Vérifiez les autorisations.'
        );
        setIsScanningActive(false);
      }
    }, 200);
  };

  // Compression photo preuve Mobile Money sur <canvas> (~200 Ko)
  const handleProofCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressingProof(true);
    setErrorMessage(null);
    try {
      await destroyScannerStrictly();
      const compressed = await compressImageFileToCanvas200Kb(file, 200);
      setProofDataUrl(compressed.dataUrl);
      setProofSizeKb(compressed.sizeKb);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la compression de la preuve Mobile Money.'
      );
    } finally {
      setIsCompressingProof(false);
    }
  };

  // Preuve synthétique locale de secours
  const handleGenerateSyntheticProof = () => {
    const cleanPlate =
      truckPlateRaw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '') ||
      'CI9420GT01';
    const cleanRef = mobileMoneyRef.trim().toUpperCase() || 'WAVE-AUTO-9921';
    const synthetic = generateSyntheticMobileMoneyReceiptCanvas({
      operator: selectedOperator,
      reference: cleanRef,
      amountFcfa: FIXED_AMOUNT_FCFA,
      truckPlate: cleanPlate,
      ticketNumber: ticketInput || 'UJPAS-VRD01-100001',
    });
    setProofDataUrl(synthetic.dataUrl);
    setProofSizeKb(synthetic.sizeKb);
    if (!mobileMoneyRef) {
      setMobileMoneyRef(cleanRef);
    }
  };

  // Normalisation automatique plaque : majuscules sans espaces superflus
  const handlePlateChange = (val: string) => {
    const upper = val.toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
    setTruckPlateRaw(upper);
  };

  // Soumission finale de la vente
  const handleSubmitSale = async () => {
    setErrorMessage(null);

    const currentTicket = ticketValidationState.targetTicket;
    if (!currentTicket) {
      setErrorMessage('Veuillez scanner ou saisir un ticket papier valide.');
      setCurrentStep(1);
      return;
    }

    if (ticketValidationState.status === 'ERROR_USED') {
      setErrorMessage('Ce ticket est déjà utilisé.');
      setCurrentStep(1);
      return;
    }

    if (
      ticketValidationState.status === 'WARNING_COLLEAGUE' &&
      (!isColleagueOverrideActive || colleagueOverrideReason.trim().length < 6)
    ) {
      setErrorMessage(
        'Ticket d’un collègue : motif obligatoire de dépannage (minimum 6 caractères).'
      );
      setCurrentStep(1);
      return;
    }

    const cleanPlate = normalizeTruckPlate(truckPlateRaw);
    if (!cleanPlate || cleanPlate.length < 4) {
      setErrorMessage(
        'Veuillez renseigner la plaque du tracteur (ex: CI-9420-GT-01).'
      );
      setCurrentStep(2);
      return;
    }

    const cleanDigits = phoneDigits.replace(/\D/g, '');
    if (cleanDigits.length < 8) {
      setErrorMessage(
        'Numéro de téléphone chauffeur requis (au moins 8 chiffres).'
      );
      setCurrentStep(2);
      return;
    }
    const fullPhone = `${phoneDial}${cleanDigits}`;

    if (paymentMode === 'MOBILE_MONEY') {
      if (!mobileMoneyRef.trim() || mobileMoneyRef.trim().length < 4) {
        setErrorMessage(
          'La référence unique de transaction Mobile Money est obligatoire.'
        );
        setCurrentStep(3);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await destroyScannerStrictly();

      const soldAtIso = new Date().toISOString();
      const expiresAtIso = new Date(
        Date.now() + settings.standard_stay_hours * 3600 * 1000
      ).toISOString();
      setReceiptExpirationIso(expiresAtIso);

      const idempotencyKey = `SALE-${currentTicket.ticket_number}-${Date.now()}`;
      const finalPaymentMethod: PaymentMethod =
        paymentMode === 'CASH' ? 'ESPECES' : selectedOperator;

      const targetSectorId = selectedSectorId || currentTicket.sector_id;

      // Enregistrement dans IndexedDB + mutation_queue pour réplication
      await syncEngine.enqueueMutation({
        id: idempotencyKey,
        operation: 'SYNC_SALE',
        label: `Perception 5 000 FCFA (${currentTicket.ticket_number}) — Camion ${cleanPlate}`,
        payload: {
          p_idempotency_key: idempotencyKey,
          p_ticket_number: currentTicket.ticket_number,
          p_agent_id: currentProfile.id,
          p_truck_plate: cleanPlate,
          p_trailer_plate: trailerPlateRaw.trim()
            ? normalizeTruckPlate(trailerPlateRaw)
            : null,
          p_container_number: containerNumberRaw.trim().toUpperCase() || null,
          p_driver_name: driverName.trim() || null,
          p_driver_phone: fullPhone,
          p_country_origin: selectedCountry,
          p_payment_method: finalPaymentMethod,
          p_mobile_money_ref:
            paymentMode === 'MOBILE_MONEY'
              ? mobileMoneyRef.trim().toUpperCase()
              : null,
          p_mobile_money_screenshot_data_url:
            paymentMode === 'MOBILE_MONEY' ? proofDataUrl : null,
          p_mobile_money_screenshot_kb:
            paymentMode === 'MOBILE_MONEY' ? proofSizeKb : null,
          p_colleague_override_reason: isColleagueOverrideActive
            ? colleagueOverrideReason.trim()
            : null,
          p_sold_at: soldAtIso,
          p_offline_created: !navigator.onLine,
        },
        actor_id: currentProfile.id,
        sector_id: targetSectorId,
      });

      // Notification automatique au Responsable de Secteur
      try {
        const db = await getPortusDB();
        const sectorSupervisor =
          profiles.find(
            (p) =>
              (p.role === 'RESPONSABLE_SECTEUR' ||
                p.role === 'SUPERVISEUR_UJPAS') &&
              p.sector_id === targetSectorId
          ) ?? profiles.find((p) => p.role === 'RESPONSABLE_SECTEUR');

        if (sectorSupervisor) {
          await db.put('notifications', {
            id: crypto.randomUUID(),
            recipient_id: sectorSupervisor.id,
            sector_id: targetSectorId,
            category: 'PERCEPTION_CONTRIBUTION',
            title: `Perception 5 000 F (${currentTicket.ticket_number})`,
            message: `Agent ${currentProfile.full_name} (${currentProfile.callsign}) a perçu 5 000 FCFA (${finalPaymentMethod}) sur le camion ${cleanPlate} (${selectedCountry}).`,
            metadata: {
              ticket_number: currentTicket.ticket_number,
              truck_plate: cleanPlate,
              amount_fcfa: FIXED_AMOUNT_FCFA,
              payment_method: finalPaymentMethod,
              agent_id: currentProfile.id,
            },
            is_read: false,
            created_at: soldAtIso,
          });

          // Si le stock restant tombe à moins de 5 tickets : alerte rupture immédiate
          const remainingAfterThis = remainingTicketsCount - 1;
          if (remainingAfterThis < 5) {
            await db.put('notifications', {
              id: crypto.randomUUID(),
              recipient_id: sectorSupervisor.id,
              sector_id: targetSectorId,
              category: 'ALERTE_REGULARISATION',
              title: `🚨 ALERTE RUPTURE STOCK : Agent ${currentProfile.callsign}`,
              message: `Il ne reste que ${remainingAfterThis} ticket(s) dans le carnet de ${currentProfile.full_name}. Réassort immédiat requis !`,
              metadata: {
                agent_id: currentProfile.id,
                remaining_count: remainingAfterThis,
              },
              is_read: false,
              created_at: soldAtIso,
            });
          }
        }
      } catch {
        // Enregistrement notification local résilient
      }

      // Modèle de vente complété
      const completedSale: Sale = {
        id: idempotencyKey,
        idempotency_key: idempotencyKey,
        ticket_id: currentTicket.id,
        ticket_number: currentTicket.ticket_number,
        sector_id: targetSectorId,
        agent_id: currentProfile.id,
        truck_plate: cleanPlate,
        trailer_plate: trailerPlateRaw.trim()
          ? normalizeTruckPlate(trailerPlateRaw)
          : null,
        container_number: containerNumberRaw.trim().toUpperCase() || null,
        driver_name: driverName.trim() || null,
        driver_phone: fullPhone,
        country_origin: selectedCountry,
        contribution_amount_fcfa: FIXED_AMOUNT_FCFA,
        payment_method: finalPaymentMethod,
        mobile_money_ref:
          paymentMode === 'MOBILE_MONEY'
            ? mobileMoneyRef.trim().toUpperCase()
            : null,
        mobile_money_screenshot_data_url: proofDataUrl,
        mobile_money_screenshot_kb: proofSizeKb,
        colleague_override_reason: isColleagueOverrideActive
          ? colleagueOverrideReason.trim()
          : null,
        payment_confirmed: paymentMode === 'CASH',
        payment_confirmed_at: paymentMode === 'CASH' ? soldAtIso : null,
        mobile_money_validation_status:
          paymentMode === 'CASH' ? 'CONFIRME' : 'A_CONFIRMER',
        sold_at: soldAtIso,
        max_stay_expires_at: expiresAtIso,
        offline_created: !navigator.onLine,
        synced_at: soldAtIso,
      };

      setConfirmedSale(completedSale);

      // Vibration haptique de succès
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([80, 40, 120]);
        } catch {
          // Ignore
        }
      }

      // Écran de succès géant
      setCurrentStep(4);

      if (onSaleCompleted) {
        void onSaleCompleted(completedSale);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Erreur lors de l’enregistrement de la perception.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Réinitialisation pour la vente suivante
  const handleResetForNextSale = () => {
    setCurrentStep(1);
    setTruckPlateRaw('');
    setTrailerPlateRaw('');
    setContainerNumberRaw('');
    setPhoneDigits('');
    setDriverName('');
    setPaymentMode('CASH');
    setMobileMoneyRef('');
    setProofDataUrl(null);
    setProofSizeKb(null);
    setConfirmedSale(null);
    setErrorMessage(null);
    setIsColleagueOverrideActive(false);
    setColleagueOverrideReason('');

    // Sélectionne automatiquement le prochain ticket disponible
    const nextTicket = myAssignedTickets.find(
      (t) => t.ticket_number !== ticketInput
    );
    if (nextTicket) {
      setTicketInput(nextTicket.ticket_number);
      validateScannedOrInputTicket(nextTicket.ticket_number);
    } else {
      setTicketInput('');
      setTicketValidationState({status: 'IDLE', message: ''});
    }
  };

  // Texte du reçu prérempli pour WhatsApp et SMS
  const buildReceiptShareText = () => {
    if (!confirmedSale) return '';
    const dateFormatted = new Date(confirmedSale.sold_at).toLocaleString(
      'fr-FR',
      {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }
    );
    const expFormatted = new Date(receiptExpirationIso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return `*PORTUS — UJPAS VRIDI (ABIDJAN)*
*REÇU OFFICIEL DE CONTRIBUTION DE SÉCURISATION*
----------------------------------------
*N° TICKET :* ${confirmedSale.ticket_number}
*CAMION :* ${confirmedSale.truck_plate} (${confirmedSale.country_origin})
${confirmedSale.trailer_plate ? `*REMORQUE :* ${confirmedSale.trailer_plate}\n` : ''}*MONTANT :* 5 000 FCFA (${confirmedSale.payment_method})
${confirmedSale.mobile_money_ref ? `*RÉF. MM :* ${confirmedSale.mobile_money_ref}\n` : ''}*ÉMIS LE :* ${dateFormatted}
*VALIDE JUSQU'AU :* ${expFormatted}
*SECTEUR :* ${activeSector?.name ?? 'Vridi'}
*AGENT PERCEPTEUR :* ${currentProfile.full_name} (${currentProfile.callsign})
----------------------------------------
*ASSISTANCE CHAUFFEURS CORRIDOR :*
Radio VHF : ${settings.emergency_radio_channel}
Téléphone Urgence : ${settings.support_phone}
_Conservez ce reçu pour tout contrôle des agents de la sécurité UJPAS._`;
  };

  const cleanDriverPhoneDigits = (confirmedSale?.driver_phone ?? '').replace(
    /[^0-9]/g,
    ''
  );
  const shareTextEncoded = encodeURIComponent(buildReceiptShareText());
  const whatsappUrl =
    cleanDriverPhoneDigits.length >= 8
      ? `https://wa.me/${cleanDriverPhoneDigits}?text=${shareTextEncoded}`
      : `https://wa.me/?text=${shareTextEncoded}`;
  const smsUrl = `sms:${(confirmedSale?.driver_phone ?? '').replace(/[^0-9+]/g, '')}?body=${shareTextEncoded}`;

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-12 font-sans">
      {/* =========================================================================
          BANDEAU SUPÉRIEUR : IDENTITÉ NATIONALE (ORANGE/VERT) & AGENT VOLANT
      ========================================================================= */}
      <div className="overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-900 shadow-xl">
        {/* Bande tricolore Côte d'Ivoire */}
        <div className="grid h-2 w-full grid-cols-3">
          <div className="bg-[#FF8200]" />
          <div className="bg-white" />
          <div className="bg-[#009E60]" />
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#009E60] font-mono text-xl font-black text-white shadow-md">
                5K
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-black tracking-tight text-white uppercase">
                    Perception Terrain UJPAS
                  </h1>
                  <span className="rounded-full bg-[#FF8200] px-2 py-0.5 text-[10px] font-black text-slate-950 uppercase">
                    Agent Volant
                  </span>
                </div>
                <p className="text-xs font-bold text-[#FF8200]">
                  Tarif fixe : 5 000 FCFA · {activeSector?.name} (
                  {activeSector?.code})
                </p>
              </div>
            </div>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
                aria-label="Fermer"
              >
                <X className="h-6 w-6" />
              </button>
            )}
          </div>

          {/* SÉLECTEUR RAPIDE POUR L'AGENT VOLANT (Changement de secteur immédiat) */}
          <div className="mt-3.5 border-t border-slate-800 pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 font-bold text-slate-300">
                <MapPin className="h-3.5 w-3.5 text-[#FF8200]" />
                Secteur d&apos;intervention actif :
              </span>
              <span className="font-mono text-[11px] text-[#009E60] font-bold">
                {activeSector?.code}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {sectors.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => handleSelectSector(sec.id)}
                  className={`min-h-[40px] rounded-xl px-2.5 py-1.5 text-xs font-bold transition ${
                    selectedSectorId === sec.id
                      ? 'bg-[#FF8200] text-slate-950 font-black shadow-md'
                      : 'border border-slate-800 bg-slate-950 text-slate-300 hover:text-white'
                  }`}
                >
                  {sec.name}
                </button>
              ))}
            </div>
          </div>

          {/* COMPTEUR GÉANT DE TICKETS RESTANTS & ALERTE ROUGE SI < 5 */}
          <div className="mt-3.5 border-t border-slate-800 pt-3">
            <div
              className={`rounded-2xl p-3.5 text-center transition ${
                isStockCritical
                  ? 'border-2 border-red-500 bg-red-950/80 text-white animate-pulse shadow-lg'
                  : 'border border-slate-800 bg-slate-950 text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black tracking-wider uppercase text-slate-300">
                  Stock Carnet ({currentProfile.callsign})
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-xs font-black ${
                    isStockCritical
                      ? 'bg-red-500 text-white'
                      : 'bg-[#009E60]/20 text-[#009E60]'
                  }`}
                >
                  {isStockCritical ? 'ALERTE STOCK BAS' : 'DISPONIBLE'}
                </span>
              </div>

              <div className="my-1.5 flex items-center justify-center gap-2">
                <TicketIcon
                  className={`h-7 w-7 ${
                    isStockCritical ? 'text-red-400' : 'text-[#FF8200]'
                  }`}
                />
                <span className="font-mono text-3xl font-black tracking-tight text-white">
                  {remainingTicketsCount}
                </span>
                <span className="text-xs font-bold text-slate-400">
                  ticket(s) restant(s)
                </span>
              </div>

              {isStockCritical && (
                <div className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-red-600 p-2 text-xs font-black text-white">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    Moins de 5 tickets ! Réapprovisionnement urgent auprès du
                    Responsable.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Stepper tactile 3 étapes fluide */}
          {currentStep !== 4 && (
            <nav
              aria-label="Étapes de la perception"
              className="mt-3.5 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3"
            >
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl border text-center transition ${
                  currentStep === 1
                    ? 'border-[#FF8200] bg-[#FF8200] text-slate-950 font-black shadow-md'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:text-white font-bold'
                }`}
              >
                <span className="text-[10px] tracking-wider uppercase">
                  Étape 1
                </span>
                <span className="text-xs font-black">1. Ticket</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (ticketValidationState.targetTicket) setCurrentStep(2);
                }}
                disabled={!ticketValidationState.targetTicket}
                className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl border text-center transition ${
                  currentStep === 2
                    ? 'border-[#FF8200] bg-[#FF8200] text-slate-950 font-black shadow-md'
                    : !ticketValidationState.targetTicket
                      ? 'border-slate-800 bg-slate-950/40 text-slate-500 opacity-50 cursor-not-allowed font-medium'
                      : 'border-slate-800 bg-slate-950 text-slate-300 hover:text-white font-bold'
                }`}
              >
                <span className="text-[10px] tracking-wider uppercase">
                  Étape 2
                </span>
                <span className="text-xs font-black">2. Camion</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (
                    ticketValidationState.targetTicket &&
                    truckPlateRaw.trim()
                  ) {
                    setCurrentStep(3);
                  }
                }}
                disabled={
                  !ticketValidationState.targetTicket || !truckPlateRaw.trim()
                }
                className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl border text-center transition ${
                  currentStep === 3
                    ? 'border-[#009E60] bg-[#009E60] text-white font-black shadow-md'
                    : !ticketValidationState.targetTicket ||
                        !truckPlateRaw.trim()
                      ? 'border-slate-800 bg-slate-950/40 text-slate-500 opacity-50 cursor-not-allowed font-medium'
                      : 'border-slate-800 bg-slate-950 text-slate-300 hover:text-white font-bold'
                }`}
              >
                <span className="text-[10px] tracking-wider uppercase">
                  Étape 3
                </span>
                <span className="text-xs font-black">3. 5 000 F</span>
              </button>
            </nav>
          )}
        </div>
      </div>

      {/* Message d'erreur explicite */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border-2 border-red-500 bg-red-950/90 p-4 text-white shadow-lg"
        >
          <AlertTriangle className="h-6 w-6 shrink-0 text-red-400" />
          <div className="flex-1">
            <p className="text-xs font-black uppercase text-red-300">
              Vérification requise
            </p>
            <p className="text-sm font-bold">{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center text-red-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* =========================================================================
          ÉTAPE 1 — SCAN DU QR CODE & CONTRÔLE DU STOCK LOCAL
      ========================================================================= */}
      {currentStep === 1 && (
        <section aria-labelledby="step-1-title" className="space-y-4">
          <div className="rounded-2xl border-2 border-slate-700 bg-slate-900 p-5 shadow-lg">
            <span className="text-xs font-black tracking-wider text-[#FF8200] uppercase">
              Étape 1 sur 3
            </span>
            <h2 id="step-1-title" className="text-lg font-black text-white">
              Identification du Ticket Papier
            </h2>
            <p className="mt-1 text-xs text-slate-300">
              Scannez le QR Code officiel sur la souche ou saisissez le numéro.
            </p>

            {/* BOUTON D'ACTION PRINCIPAL GÉANT TACTILE */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  if (isScannerOpen) {
                    void destroyScannerStrictly();
                  } else {
                    void handleStartScanner();
                  }
                }}
                className={`flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-center font-black shadow-xl transition active:scale-[0.98] ${
                  isScannerOpen
                    ? 'border-2 border-red-500 bg-red-600 text-white'
                    : 'border-2 border-[#FF8200] bg-[#FF8200] text-slate-950 hover:brightness-105'
                }`}
              >
                {isScannerOpen ? (
                  <>
                    <CameraOff className="h-7 w-7" />
                    <span className="text-base uppercase tracking-tight">
                      Fermer la Caméra (Stop & Clear)
                    </span>
                  </>
                ) : (
                  <>
                    <QrCode className="h-8 w-8 shrink-0" />
                    <span className="text-lg tracking-tight uppercase">
                      + VENDRE UN TICKET (SCANNER QR)
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Zone Scanner caméra dédiée avec arrêt strict */}
            {isScannerOpen && (
              <div className="mt-4 space-y-3">
                <div
                  id="portus-agent-sales-qr-reader"
                  className="overflow-hidden rounded-2xl border-2 border-[#FF8200] bg-black min-h-[260px]"
                />
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 text-[#009E60] font-bold">
                    <span className="h-2 w-2 rounded-full bg-[#009E60] animate-ping" />
                    Caméra active · Pointez vers le QR
                  </span>
                  <span>Nettoyage mémoire auto (RAM préservée)</span>
                </div>
                {scannerError && (
                  <p className="rounded-xl border border-red-500/40 bg-red-950/50 p-3 text-xs font-bold text-red-300">
                    {scannerError}
                  </p>
                )}
              </div>
            )}

            {/* OPTION DE SECOURS : SAISIE MANUELLE DU NUMÉRO DE TICKET */}
            <div className="mt-5 border-t border-slate-800 pt-4">
              <label
                htmlFor="manual-ticket-input"
                className="block text-xs font-black tracking-wide text-slate-200 uppercase"
              >
                Option de secours : Saisie manuelle du numéro
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="manual-ticket-input"
                  type="text"
                  value={ticketInput}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setTicketInput(val);
                    validateScannedOrInputTicket(val);
                  }}
                  placeholder="Ex: UJPAS-VRD01-100001 ou VRD-000101"
                  className="min-h-[52px] flex-1 rounded-xl border-2 border-slate-700 bg-slate-950 px-4 font-mono text-base font-black tracking-wide text-white placeholder:text-slate-600 focus:border-[#FF8200] focus:outline-none"
                />
                {ticketInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setTicketInput('');
                      setTicketValidationState({status: 'IDLE', message: ''});
                    }}
                    className="flex min-h-[52px] min-w-[52px] items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300"
                    aria-label="Effacer le numéro de ticket"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            {/* RÉSULTAT DU CONTRÔLE STOCK LOCAL */}
            {ticketValidationState.status !== 'IDLE' && (
              <div
                className={`mt-4 rounded-xl border-2 p-4 text-xs ${
                  ticketValidationState.status === 'VALID'
                    ? 'border-[#009E60] bg-emerald-950/60 text-emerald-200'
                    : ticketValidationState.status === 'WARNING_COLLEAGUE'
                      ? 'border-[#FF8200] bg-amber-950/60 text-amber-200'
                      : 'border-red-500 bg-red-950/60 text-red-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {ticketValidationState.status === 'VALID' ? (
                    <CheckCircle2 className="h-5 w-5 text-[#009E60]" />
                  ) : ticketValidationState.status === 'WARNING_COLLEAGUE' ? (
                    <ShieldAlert className="h-5 w-5 text-[#FF8200]" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                  )}
                  <span className="font-black text-sm">
                    {ticketValidationState.status === 'VALID'
                      ? 'TICKET ATTRIBUÉ DISPONIBLE'
                      : ticketValidationState.status === 'WARNING_COLLEAGUE'
                        ? 'TICKET D’UN COLLÈGUE (STOCK DIFFÉRENT)'
                        : 'TICKET NON DISPONIBLE'}
                  </span>
                </div>
                <p className="mt-1 font-bold text-slate-200">
                  {ticketValidationState.message}
                </p>

                {/* DÉPANNAGE COLLÈGUE AVEC MOTIF OBLIGATOIRE */}
                {ticketValidationState.status === 'WARNING_COLLEAGUE' && (
                  <div className="mt-3 rounded-lg border border-[#FF8200]/40 bg-slate-900 p-3">
                    <label className="flex cursor-pointer items-center gap-2.5 font-black text-amber-300">
                      <input
                        type="checkbox"
                        checked={isColleagueOverrideActive}
                        onChange={(e) =>
                          setIsColleagueOverrideActive(e.target.checked)
                        }
                        className="h-5 w-5 rounded border-slate-700 accent-[#FF8200]"
                      />
                      <span>Dépannage collègue (motif obligatoire)</span>
                    </label>

                    {isColleagueOverrideActive && (
                      <div className="mt-2.5 space-y-1.5">
                        <label className="block text-[11px] font-bold text-slate-300">
                          Motif explicite du dépannage (minimum 6 caractères) :
                        </label>
                        <input
                          type="text"
                          value={colleagueOverrideReason}
                          onChange={(e) =>
                            setColleagueOverrideReason(e.target.value)
                          }
                          placeholder="Ex: Batterie téléphone collègue à plat au TC1"
                          className="min-h-[48px] w-full rounded-lg border border-[#FF8200] bg-slate-950 px-3 text-xs text-white"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SÉLECTEUR RAPIDE DE VOS TICKETS ATTRIBUÉS */}
          <div className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black text-slate-300 uppercase">
                Vos tickets disponibles en stock
              </span>
              <span className="rounded bg-[#009E60]/20 px-2 py-0.5 font-mono font-bold text-[#009E60]">
                {myAssignedTickets.length} attribués
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {myAssignedTickets.slice(0, 5).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTicketInput(t.ticket_number);
                    validateScannedOrInputTicket(t.ticket_number);
                  }}
                  className={`min-h-[48px] rounded-xl border px-3.5 py-2 font-mono text-xs font-black transition ${
                    ticketInput === t.ticket_number
                      ? 'border-[#FF8200] bg-[#FF8200] text-slate-950'
                      : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {t.ticket_number}
                </button>
              ))}
            </div>
          </div>

          {/* BOUTON PASSER À L'ÉTAPE 2 */}
          <button
            type="button"
            disabled={
              !ticketValidationState.targetTicket ||
              (ticketValidationState.status === 'WARNING_COLLEAGUE' &&
                (!isColleagueOverrideActive ||
                  colleagueOverrideReason.trim().length < 6))
            }
            onClick={() => setCurrentStep(2)}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#009E60] px-6 py-4 text-base font-black text-white shadow-xl transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>PASSER AUX INFOS DU CAMION</span>
            <ArrowRight className="h-5 w-5" />
          </button>
        </section>
      )}

      {/* =========================================================================
          ÉTAPE 2 — INFORMATIONS VÉHICULE & CHAUFFEUR
      ========================================================================= */}
      {currentStep === 2 && (
        <section aria-labelledby="step-2-title" className="space-y-4">
          <div className="rounded-2xl border-2 border-slate-700 bg-slate-900 p-5 shadow-lg space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-xs font-black tracking-wider text-[#FF8200] uppercase">
                  Étape 2 sur 3
                </span>
                <h2 id="step-2-title" className="text-lg font-black text-white">
                  Véhicule & Chauffeur
                </h2>
              </div>
              <span className="font-mono text-xs font-bold text-[#FF8200] bg-[#FF8200]/10 px-2.5 py-1 rounded-lg">
                Ticket : {ticketInput}
              </span>
            </div>

            {/* SÉLECTION RAPIDE DU PAYS : GROS BOUTONS TACTILES */}
            <div>
              <label className="block text-xs font-black tracking-wide text-slate-200 uppercase">
                1. Pays d&apos;immatriculation du camion (Transit Portuaire)
              </label>
              <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {QUICK_COUNTRIES.map((country) => {
                  const isSelected = selectedCountry === country.code;
                  return (
                    <button
                      key={country.code}
                      type="button"
                      onClick={() => {
                        setSelectedCountry(country.code);
                        setPhoneDial(country.defaultDial);
                      }}
                      className={`flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border p-2 text-center transition ${
                        isSelected
                          ? 'border-2 border-[#FF8200] bg-[#FF8200] text-slate-950 font-black shadow-lg scale-[1.02]'
                          : 'border-slate-800 bg-slate-950 text-slate-200 font-bold hover:border-slate-700'
                      }`}
                    >
                      <span className="text-xl">{country.flag}</span>
                      <span className="text-xs">{country.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SAISIE DE LA PLAQUE DU TRACTEUR (NORMALISATION AUTOMATIQUE) */}
            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="truck-plate-input"
                  className="block text-xs font-black tracking-wide text-slate-200 uppercase"
                >
                  2. Plaque du tracteur (Obligatoire)
                </label>
                <span className="text-[11px] font-bold text-[#FF8200] uppercase">
                  Majuscules auto
                </span>
              </div>
              <div className="mt-2">
                <input
                  id="truck-plate-input"
                  type="text"
                  value={truckPlateRaw}
                  onChange={(e) => handlePlateChange(e.target.value)}
                  placeholder="Ex: CI-9420-GT-01 ou BF-4410-KL"
                  className="min-h-[56px] w-full rounded-2xl border-2 border-slate-700 bg-slate-950 px-4 font-mono text-lg font-black tracking-wider text-white placeholder:text-slate-600 focus:border-[#FF8200] focus:outline-none"
                />
              </div>
            </div>

            {/* TÉLÉPHONE DU CHAUFFEUR AVEC SÉLECTEUR D'INDICATIF */}
            <div>
              <label
                htmlFor="driver-phone-input"
                className="block text-xs font-black tracking-wide text-slate-200 uppercase"
              >
                3. Téléphone du chauffeur (Pour reçu direct WhatsApp / SMS)
              </label>
              <div className="mt-2 flex gap-2">
                <select
                  value={phoneDial}
                  onChange={(e) => setPhoneDial(e.target.value)}
                  className="min-h-[56px] rounded-2xl border-2 border-slate-700 bg-slate-950 px-3 font-mono text-sm font-black text-[#FF8200] focus:border-[#FF8200] focus:outline-none"
                >
                  {DIAL_CODES.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.label}
                    </option>
                  ))}
                </select>

                <input
                  id="driver-phone-input"
                  type="tel"
                  value={phoneDigits}
                  onChange={(e) => setPhoneDigits(e.target.value)}
                  placeholder="Ex: 07 08 44 55 66"
                  className="min-h-[56px] flex-1 rounded-2xl border-2 border-slate-700 bg-slate-950 px-4 font-mono text-base font-black text-white placeholder:text-slate-600 focus:border-[#FF8200] focus:outline-none"
                />
              </div>
            </div>

            {/* CHAMPS OPTIONNELS NON BLOQUANTS */}
            <div className="border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setShowOptionalFields(!showOptionalFields)}
                className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-2 text-xs font-bold text-slate-300 hover:text-white"
              >
                <span>Champs optionnels : Remorque, Conteneur, Chauffeur</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    showOptionalFields ? 'rotate-180 text-[#FF8200]' : ''
                  }`}
                />
              </button>

              {showOptionalFields && (
                <div className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-300">
                      Plaque remorque (optionnelle)
                    </label>
                    <input
                      type="text"
                      value={trailerPlateRaw}
                      onChange={(e) =>
                        setTrailerPlateRaw(e.target.value.toUpperCase())
                      }
                      placeholder="Ex: BF-902-RM"
                      className="mt-1 min-h-[48px] w-full rounded-xl border border-slate-700 bg-slate-900 px-3 font-mono text-sm font-bold text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300">
                      Numéro conteneur (optionnel)
                    </label>
                    <input
                      type="text"
                      value={containerNumberRaw}
                      onChange={(e) =>
                        setContainerNumberRaw(e.target.value.toUpperCase())
                      }
                      placeholder="Ex: MSKU-781920-4"
                      className="mt-1 min-h-[48px] w-full rounded-xl border border-slate-700 bg-slate-900 px-3 font-mono text-sm font-bold text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300">
                      Nom du chauffeur (optionnel)
                    </label>
                    <input
                      type="text"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder="Ex: Traoré Bakary"
                      className="mt-1 min-h-[48px] w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* NAVIGATION ÉTAPE 2 */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="flex min-h-[56px] items-center justify-center rounded-2xl border-2 border-slate-700 bg-slate-900 text-sm font-black text-slate-200"
            >
              Retour (Ticket)
            </button>

            <button
              type="button"
              disabled={
                !truckPlateRaw.trim() ||
                phoneDigits.replace(/\D/g, '').length < 8
              }
              onClick={() => setCurrentStep(3)}
              className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-[#009E60] text-base font-black text-white shadow-xl transition hover:brightness-110 disabled:opacity-40"
            >
              <span>PASSER AU PAIEMENT</span>
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </section>
      )}

      {/* =========================================================================
          ÉTAPE 3 — PAIEMENT & ENCAISSEMENT (5 000 FCFA FIXE)
      ========================================================================= */}
      {currentStep === 3 && (
        <section aria-labelledby="step-3-title" className="space-y-4">
          <div className="rounded-2xl border-2 border-slate-700 bg-slate-900 p-5 shadow-lg space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-xs font-black tracking-wider text-[#FF8200] uppercase">
                  Étape 3 sur 3
                </span>
                <h2 id="step-3-title" className="text-lg font-black text-white">
                  Paiement & Encaissement
                </h2>
              </div>
              <span className="font-mono text-xs font-black text-slate-300">
                {truckPlateRaw}
              </span>
            </div>

            {/* BANDEAU GÉANT DU MONTANT FIXE 5 000 FCFA */}
            <div className="rounded-2xl border-2 border-[#009E60] bg-gradient-to-r from-emerald-950/60 to-slate-950 p-4 text-center shadow-lg">
              <span className="text-xs font-black text-[#009E60] uppercase tracking-wider">
                Contribution d&apos;Assistance et de Sécurisation UJPAS (24H)
              </span>
              <p className="mt-1 font-mono text-4xl font-black tracking-tight text-white">
                5 000 FCFA
              </p>
              <p className="mt-0.5 text-xs text-slate-300 font-bold">
                Tarif fixe légal · Corridor de Vridi (Abidjan)
              </p>
            </div>

            {/* DEUX GRANDS BLOCS TACTILES DISTINCTS : CASH vs MOBILE MONEY */}
            <div>
              <label className="block text-xs font-black tracking-wide text-slate-200 uppercase">
                Sélectionnez le mode d&apos;encaissement
              </label>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* BLOC 1 : CASH (ESPÈCES) - VERT VIF CI */}
                <button
                  type="button"
                  onClick={() => setPaymentMode('CASH')}
                  className={`flex min-h-[68px] items-center gap-3.5 rounded-2xl border-2 p-4 text-left transition active:scale-[0.98] ${
                    paymentMode === 'CASH'
                      ? 'border-[#009E60] bg-[#009E60] text-white shadow-xl scale-[1.02]'
                      : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-[#009E60]/50'
                  }`}
                >
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-bold ${
                      paymentMode === 'CASH'
                        ? 'bg-white text-[#009E60]'
                        : 'bg-[#009E60]/20 text-[#009E60]'
                    }`}
                  >
                    <Banknote className="h-7 w-7" />
                  </div>
                  <div>
                    <span className="block text-base font-black uppercase">
                      CASH (Espèces)
                    </span>
                    <span className="block text-xs font-bold opacity-90">
                      Billet de 5 000 F perçu en main
                    </span>
                  </div>
                </button>

                {/* BLOC 2 : MOBILE MONEY - ORANGE CI / BLEU */}
                <button
                  type="button"
                  onClick={() => setPaymentMode('MOBILE_MONEY')}
                  className={`flex min-h-[68px] items-center gap-3.5 rounded-2xl border-2 p-4 text-left transition active:scale-[0.98] ${
                    paymentMode === 'MOBILE_MONEY'
                      ? 'border-[#FF8200] bg-[#FF8200] text-slate-950 shadow-xl scale-[1.02]'
                      : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-[#FF8200]/50'
                  }`}
                >
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-bold ${
                      paymentMode === 'MOBILE_MONEY'
                        ? 'bg-slate-950 text-[#FF8200]'
                        : 'bg-[#FF8200]/20 text-[#FF8200]'
                    }`}
                  >
                    <Smartphone className="h-7 w-7" />
                  </div>
                  <div>
                    <span className="block text-base font-black uppercase">
                      MOBILE MONEY
                    </span>
                    <span className="block text-xs font-bold opacity-90">
                      Wave, Orange, MTN, Moov
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* SOUS-PANNEAU MOBILE MONEY */}
            {paymentMode === 'MOBILE_MONEY' && (
              <div className="space-y-4 rounded-2xl border-2 border-[#FF8200]/40 bg-slate-950 p-4">
                {/* Choix de l'opérateur */}
                <div>
                  <label className="block text-xs font-black text-amber-300 uppercase">
                    1. Choisissez l&apos;opérateur Mobile Money
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {MOBILE_OPERATORS.map((op) => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => setSelectedOperator(op.id)}
                        className={`min-h-[48px] rounded-xl border-2 px-3 py-2 text-xs font-black transition ${
                          selectedOperator === op.id
                            ? 'border-[#FF8200] bg-[#FF8200] text-slate-950 shadow-md'
                            : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Saisie obligatoire de la référence de transaction */}
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="mm-reference-input"
                      className="block text-xs font-black text-amber-300 uppercase"
                    >
                      2. Référence unique de transaction (Obligatoire)
                    </label>
                    <span className="text-[11px] text-slate-400 font-bold">
                      SMS Chauffeur
                    </span>
                  </div>
                  <input
                    id="mm-reference-input"
                    type="text"
                    value={mobileMoneyRef}
                    onChange={(e) =>
                      setMobileMoneyRef(e.target.value.toUpperCase())
                    }
                    placeholder="Ex: WAVE-CI-998234 ou 261019.0028"
                    className="mt-1.5 min-h-[52px] w-full rounded-xl border-2 border-slate-700 bg-slate-900 px-4 font-mono text-base font-black text-white placeholder:text-slate-600 focus:border-[#FF8200] focus:outline-none"
                  />
                </div>

                {/* Capture ou Preuve Photo (Compressée à ~200 Ko) */}
                <div>
                  <label className="block text-xs font-black text-amber-300 uppercase">
                    3. Preuve écran SMS (Compression canvas &lt; 200 Ko)
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => nativeCameraInputRef.current?.click()}
                      className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-slate-700 bg-slate-900 px-4 font-bold text-xs text-white hover:bg-slate-800"
                    >
                      <Camera className="h-5 w-5 text-[#FF8200]" />
                      <span>Prendre photo SMS écran</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleGenerateSyntheticProof}
                      className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-bold text-slate-300 hover:text-white"
                      title="Générer preuve synthétique de secours"
                    >
                      <Sparkles className="h-4 w-4 text-[#FF8200]" />
                      <span>Preuve auto</span>
                    </button>

                    <input
                      ref={nativeCameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleProofCapture}
                      className="hidden"
                    />
                  </div>

                  {isCompressingProof && (
                    <p className="mt-2 text-xs text-amber-300 animate-pulse font-bold">
                      Compression locale sur canvas à ~200 Ko...
                    </p>
                  )}

                  {proofDataUrl && (
                    <div className="mt-2.5 flex items-center justify-between rounded-xl border border-[#009E60]/40 bg-emerald-950/40 p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-[#009E60]" />
                        <span className="font-bold text-emerald-300">
                          Preuve compressée prête ({proofSizeKb} Ko)
                        </span>
                      </div>
                      <img
                        src={proofDataUrl}
                        alt="Aperçu preuve"
                        className="h-10 w-10 rounded-lg object-cover border border-slate-700"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* BOUTON D'ENCAISSEMENT FINAL GÉANT */}
          <div className="space-y-3">
            <button
              type="button"
              disabled={
                isSubmitting ||
                (paymentMode === 'MOBILE_MONEY' &&
                  mobileMoneyRef.trim().length < 4)
              }
              onClick={handleSubmitSale}
              className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl bg-[#009E60] px-6 py-4 text-lg font-black text-white shadow-2xl transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-6 w-6 animate-spin" />
                  <span>ENREGISTREMENT ET ÉMISSION...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-7 w-7" />
                  <span>
                    VALIDER L&apos;ENCAISSEMENT (5 000 FCFA {paymentMode})
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="min-h-[48px] w-full text-xs font-bold text-slate-400 hover:text-white"
            >
              ← Modifier les informations du camion
            </button>
          </div>
        </section>
      )}

      {/* =========================================================================
          ÉTAPE 4 — VALIDATION & REÇU OFFICIEL (ÉCRAN SUCCÈS GÉANT)
      ========================================================================= */}
      {currentStep === 4 && confirmedSale && (
        <section aria-labelledby="receipt-title" className="space-y-4">
          <div className="rounded-3xl border-2 border-[#009E60] bg-slate-900 p-6 text-center shadow-2xl space-y-5 animate-in fade-in duration-300">
            {/* ICÔNE SUCCÈS GÉANTE AVEC HALO VIBRANT */}
            <div className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#009E60] text-white shadow-2xl">
              <span className="absolute inset-0 rounded-full bg-[#009E60] opacity-30 animate-ping" />
              <CheckCircle2 className="h-14 w-14 font-black" />
            </div>

            <div>
              <span className="text-xs font-black tracking-widest text-[#009E60] uppercase">
                Perception Enregistrée & Sécurisée
              </span>
              <h2
                id="receipt-title"
                className="mt-1 text-2xl font-black text-white"
              >
                5 000 FCFA ENCAISSÉS
              </h2>
              <p className="text-xs font-bold text-slate-300">
                Ticket n°{' '}
                <span className="font-mono text-[#FF8200] text-sm">
                  {confirmedSale.ticket_number}
                </span>
              </p>
            </div>

            {/* CARTE RÉCAPITULATIF REÇU IMPRIMABLE / NUMÉRIQUE */}
            <div className="space-y-3 rounded-2xl border-2 border-slate-700 bg-slate-950 p-4 text-left text-xs font-mono">
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Camion tracteur :</span>
                <span className="font-black text-white text-sm">
                  {confirmedSale.truck_plate} ({confirmedSale.country_origin})
                </span>
              </div>

              {confirmedSale.trailer_plate && (
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Remorque :</span>
                  <span className="font-bold text-slate-200">
                    {confirmedSale.trailer_plate}
                  </span>
                </div>
              )}

              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Règlement :</span>
                <span className="font-black text-[#009E60]">
                  {confirmedSale.payment_method === 'ESPECES'
                    ? 'CASH (ESPÈCES)'
                    : `MOBILE MONEY (${confirmedSale.mobile_money_ref})`}
                </span>
              </div>

              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Chauffeur tél :</span>
                <span className="font-bold text-white">
                  {confirmedSale.driver_phone ?? 'Non renseigné'}
                </span>
              </div>

              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">
                  Séjour garanti jusqu&apos;au :
                </span>
                <span className="font-black text-amber-300">
                  {new Date(receiptExpirationIso).toLocaleDateString('fr-FR')}{' '}
                  à{' '}
                  {new Date(receiptExpirationIso).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <div className="flex justify-between text-[11px] text-slate-400 pt-1 font-sans">
                <span>Agent : {currentProfile.callsign}</span>
                <span>Secteur : {activeSector?.name}</span>
              </div>
            </div>

            {/* BOUTONS DIRECTS : PARTAGE WHATSAPP & SMS PRÉREMPLIS */}
            <div className="space-y-2.5 pt-2">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl bg-[#009E60] px-6 py-3.5 text-base font-black text-white shadow-xl transition hover:brightness-110 active:scale-[0.98]"
              >
                <Share2 className="h-6 w-6" />
                <span>PARTAGER LE REÇU SUR WHATSAPP</span>
              </a>

              <a
                href={smsUrl}
                className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl border-2 border-slate-700 bg-slate-950 px-6 py-3.5 text-base font-black text-slate-200 transition hover:bg-slate-800 active:scale-[0.98]"
              >
                <MessageSquare className="h-6 w-6 text-[#FF8200]" />
                <span>ENVOYER PAR SMS DIRECT</span>
              </a>
            </div>

            {/* BOUTON GÉANT NOUVELLE VENTE IMMÉDIATE */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleResetForNextSale}
                className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8200] px-6 py-4 text-base font-black text-slate-950 shadow-xl transition hover:brightness-105"
              >
                <span>+ VENDRE UN AUTRE TICKET (SUIVANT)</span>
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
