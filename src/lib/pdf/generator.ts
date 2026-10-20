/**
 * PORTUS — UJPAS (Union des Jeunes du Port pour l'Assistance et la Sécurité)
 * Générateur Éditique PDF Haute Performance (`src/lib/pdf/generator.ts`)
 *
 * Spécifications Phase 3 :
 * 1. Import dynamique de `jspdf` et `qrcode` (`await import(...)`) au moment exact de l'impression
 *    afin de protéger la mémoire vive sur les terminaux Android de terrain (2 Go RAM).
 * 2. Prise en charge des templates images Base64 via `src/lib/pdf/assets.ts` :
 *    - `TICKET_TEMPLATE_BASE64` en fond de ticket (avec repli vectoriel si vide).
 *    - `UJPAS_LOGO_BASE64` en superposition officielle.
 * 3. Carnets de Tickets A4 Paysage (6 tickets par feuille, 2 lignes de 3) :
 *    - QR Code signé Ed25519 au format standard `P1.<kid>.<ticket_number>.<epoch>.<sig>`.
 *    - Numéro physique (ex: VRD-000101) avec son chiffre de contrôle (Check Digit).
 *    - Date d'impression officielle.
 *    - Traits de coupe pointillés (`setLineDashPattern`).
 * 4. Badges CR80 (85.6 x 54 mm) sur planche A4 Portrait (8 badges Recto/Verso) :
 *    - Traits de coupe pointillés et repères.
 *    - Photo agent, logo UJPAS, indicatif radio (callsign), matricule.
 *    - Bandeau de couleur dynamique par rôle :
 *        * ROUGE  = RESPONSABLE / DIRECTION
 *        * BLEU   = AGENT DE PERCEPTION
 *        * AMBRE  = CONTRÔLEUR ROUTIER / AUDITEUR
 * 5. Curseurs de calibrage d'imprimante (`offset_x_mm`, `offset_y_mm`).
 */

import {
  createSignedTicketQrP1,
  createSignedBadgeQrP1B,
  computeTicketCheckDigit,
  formatTicketNumberWithCheckDigit,
  DEFAULT_DEMO_SECRET_KEY_HEX,
} from '../crypto/ed25519';
import {TICKET_TEMPLATE_BASE64, UJPAS_LOGO_BASE64} from './assets';
import type {AppSettings, Profile, Sector, UserRole} from '../../types/portus';

export interface PrinterCalibrationOffsets {
  offset_x_mm: number;
  offset_y_mm: number;
}

export interface PrintableTicketSpec {
  ticketNumber: string;
  serialNumber: number;
  sectorCode: string;
  sectorName: string;
  batchCode: string;
  amountFcfa: number;
  kid: string;
  epoch?: number;
  qrPayloadP1?: string;
}

export interface TicketSheetGenerationOptions {
  tickets: PrintableTicketSpec[];
  settings: AppSettings;
  calibration: PrinterCalibrationOffsets;
  secretKeyHex?: string;
  fileName?: string;
}

export interface PrintableBadgeSpec {
  badgeNumber: string;
  profile: Profile;
  sector: Sector | null;
  expiresDate: string; // YYYY-MM-DD
  kid: string;
  epoch?: number;
  qrPayloadP1B?: string;
}

export interface BadgeSheetGenerationOptions {
  badges: PrintableBadgeSpec[];
  settings: AppSettings;
  calibration: PrinterCalibrationOffsets;
  secretKeyHex?: string;
  fileName?: string;
}

export interface RoleColorTheme {
  bannerLabel: string;
  rgbPrimary: [number, number, number];
  rgbTextOnBanner: [number, number, number];
  hexColor: string;
}

/**
 * Résout le bandeau couleur officiel d'un badge selon le rôle et les habilitations :
 * - ROUGE : Responsable (RESPONSABLE_SECTEUR, RESPONSABLE, SUPERVISEUR_UJPAS, ADMIN_PROJET, ADMINISTRATEUR)
 * - BLEU  : Agent de perception terrain (AGENT_TERRAIN, AGENT avec peut_vendre)
 * - AMBRE : Contrôleur routier / Auditeur (CONTROLEUR, AUDITEUR, AUDITEUR_INSTITUTIONNEL ou contrôleur pur)
 */
export function resolveBadgeRoleColorTheme(profile: Profile): RoleColorTheme {
  const role: UserRole = profile.role;

  if (
    role === 'RESPONSABLE_SECTEUR' ||
    role === 'RESPONSABLE' ||
    role === 'SUPERVISEUR_UJPAS' ||
    role === 'ADMIN_PROJET' ||
    role === 'ADMINISTRATEUR'
  ) {
    return {
      bannerLabel:
        role === 'ADMINISTRATEUR' || role === 'ADMIN_PROJET'
          ? 'DIRECTION PROJET UJPAS'
          : role === 'SUPERVISEUR_UJPAS'
            ? 'SUPERVISEUR CORRIDOR UJPAS'
            : 'RESPONSABLE DE SECTEUR',
      rgbPrimary: [190, 18, 60], // Rouge institutionnel (#BE123C)
      rgbTextOnBanner: [255, 255, 255],
      hexColor: '#BE123C',
    };
  }

  if (
    role === 'CONTROLEUR' ||
    role === 'AUDITEUR' ||
    role === 'AUDITEUR_INSTITUTIONNEL' ||
    (!profile.peut_vendre && profile.peut_controler)
  ) {
    return {
      bannerLabel:
        role === 'CONTROLEUR'
          ? 'AGENT CONTRÔLEUR ROUTIER'
          : 'AUDITEUR INSTITUTIONNEL',
      rgbPrimary: [217, 119, 6], // Ambre / Jaune sécurité (#D97706)
      rgbTextOnBanner: [15, 23, 42],
      hexColor: '#D97706',
    };
  }

  return {
    bannerLabel: 'AGENT DE TERRAIN — PERCEPTION',
    rgbPrimary: [29, 78, 216], // Bleu professionnel (#1D4ED8)
    rgbTextOnBanner: [255, 255, 255],
    hexColor: '#1D4ED8',
  };
}

/**
 * Génère un portrait vectoriel net en DataURL PNG si aucune photo n'est présente
 */
function buildAvatarDataUrl(profile: Profile, hexAccent: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, 160, 200);

  ctx.strokeStyle = hexAccent;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 154, 194);

  // Silhouette buste
  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.arc(80, 74, 34, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(80, 185, 58, Math.PI, 0, false);
  ctx.fill();

  // Initiales
  const initials = profile.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials || 'UJ', 80, 76);

  ctx.fillStyle = hexAccent;
  ctx.fillRect(0, 168, 160, 32);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(profile.matricule, 80, 184);

  return canvas.toDataURL('image/png');
}

/**
 * 1. GÉNÉRATEUR DE FEUILLES A4 PAYSAGE DE 6 TICKETS (2 LIGNES DE 3)
 *    Format A4 Paysage : 297 mm x 210 mm
 *    Incorpore TICKET_TEMPLATE_BASE64 en fond si présent,
 *    superpose le logo UJPAS, le QR code Ed25519 (format point),
 *    le numéro physique avec chiffre de contrôle, la date d'impression,
 *    et les traits de coupe pointillés.
 */
export async function generateTicketsLandscapePdfSheet(
  options: TicketSheetGenerationOptions
): Promise<{
  blobUrl: string;
  fileName: string;
  pageCount: number;
  ticketPayloads: string[];
}> {
  // Import dynamique obligatoire pour préserver la mémoire (Android 2Go)
  const [{jsPDF}, QRCode] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ]);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const ox = Number.isFinite(options.calibration.offset_x_mm)
    ? options.calibration.offset_x_mm
    : 0;
  const oy = Number.isFinite(options.calibration.offset_y_mm)
    ? options.calibration.offset_y_mm
    : 0;

  // Grille 3 colonnes x 2 lignes sur A4 Paysage (297 x 210 mm)
  const marginX = 9;
  const marginY = 10;
  const gapX = 3;
  const gapY = 4;
  const ticketWidth = 91; // 3 * 91 + 2 * 3 + 18 = 297 mm
  const ticketHeight = 93; // 2 * 93 + 4 + 20 = 210 mm

  const ticketsToPrint = options.tickets.slice(0, 24); // Jusqu'à 4 planches par lot
  const totalPages = Math.max(1, Math.ceil(ticketsToPrint.length / 6));
  const generatedPayloads: string[] = [];
  const printDateStr = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const hasTemplateImage =
    typeof TICKET_TEMPLATE_BASE64 === 'string' &&
    TICKET_TEMPLATE_BASE64.trim().length > 20;

  const hasLogoImage =
    typeof UJPAS_LOGO_BASE64 === 'string' &&
    UJPAS_LOGO_BASE64.trim().length > 20;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    if (pageIdx > 0) {
      doc.addPage('a4', 'landscape');
    }

    // Bandeau supérieur de planche éditique & repères de calibrage
    doc.setLineDashPattern([], 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `PLANCHE ÉDITIQUE UJPAS VRIDI — CARNET 6 TICKETS · CALIBRAGE X:${ox >= 0 ? '+' : ''}${ox}mm / Y:${oy >= 0 ? '+' : ''}${oy}mm · DATE: ${printDateStr} · PAGE ${pageIdx + 1}/${totalPages}`,
      marginX + ox,
      6.5 + oy
    );

    const pageSlice = ticketsToPrint.slice(pageIdx * 6, pageIdx * 6 + 6);

    for (let idx = 0; idx < pageSlice.length; idx++) {
      const spec = pageSlice[idx];
      const col = idx % 3;
      const row = Math.floor(idx / 3);

      const x = marginX + col * (ticketWidth + gapX) + ox;
      const y = marginY + row * (ticketHeight + gapY) + oy;

      const checkDigit = computeTicketCheckDigit(spec.ticketNumber);

      // Signature cryptographique Ed25519 P1 standard : P1.<kid>.<ticket_number>.<epoch>.<sig>
      let qrString = spec.qrPayloadP1;
      if (!qrString) {
        const signed = await createSignedTicketQrP1({
          kid: spec.kid || 'k1',
          ticketNumber: spec.ticketNumber,
          epoch: spec.epoch ?? Math.floor(Date.now() / 1000),
          serialNumber: spec.serialNumber,
          sectorCode: spec.sectorCode,
          amountFcfa: spec.amountFcfa,
          secretKeyHex: options.secretKeyHex ?? DEFAULT_DEMO_SECRET_KEY_HEX,
        });
        qrString = signed.rawQrString;
      }
      generatedPayloads.push(qrString);

      // Génération QR Code bitmap haute lisibilité
      const qrDataUrl = await QRCode.toDataURL(qrString, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 260,
        color: {
          dark: '#090D16',
          light: '#FFFFFF',
        },
      });

      // 1. FOND DU TICKET : Si TICKET_TEMPLATE_BASE64 est fourni, on le place en fond
      if (hasTemplateImage) {
        try {
          doc.addImage(TICKET_TEMPLATE_BASE64, 'PNG', x, y, ticketWidth, ticketHeight);
        } catch {
          // Fallback vectoriel si l'image est malformée
        }
      } else {
        // Rendu vectoriel officiel propre si aucun template image fourni
        doc.setFillColor(255, 255, 255);
        doc.rect(x, y, ticketWidth, ticketHeight, 'F');

        // En-tête sombre officiel UJPAS + liseré orange
        doc.setFillColor(15, 23, 42);
        doc.rect(x, y, ticketWidth, 15, 'F');
        doc.setFillColor(245, 158, 11);
        doc.rect(x, y + 15, ticketWidth, 1.2, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.text('UJPAS — CORRIDOR PORTUAIRE DE VRIDI', x + 3, y + 5.2);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.2);
        doc.setTextColor(253, 230, 138);
        doc.text(
          "CONTRIBUTION D'ASSISTANCE ET DE SÉCURISATION (24H)",
          x + 3,
          y + 9.6
        );

        // Montant en haut à droite
        doc.setFillColor(245, 158, 11);
        doc.rect(x + ticketWidth - 26, y + 2.2, 23.5, 10.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);
        doc.text(
          `${spec.amountFcfa} FCFA`,
          x + ticketWidth - 14.2,
          y + 8.6,
          {align: 'center'}
        );

        // Grille de 10 cases de saisie manuscrite de la plaque
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.4);
        doc.setTextColor(15, 23, 42);
        doc.text(
          'IMMATRICULATION CAMION (1 CARACTÈRE PAR CASE) :',
          x + 3,
          y + 29.5
        );

        const boxCount = 10;
        const boxW = 5.3;
        const boxH = 7.2;
        const boxGap = 0.6;
        for (let b = 0; b < boxCount; b++) {
          const bx = x + 3 + b * (boxW + boxGap);
          const by = y + 31.2;
          doc.setDrawColor(30, 41, 59);
          doc.setLineWidth(0.35);
          doc.rect(bx, by, boxW, boxH);
        }

        // Champs manuscrits
        const leftColX = x + 3;
        const infoStartY = y + 43;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.1);
        doc.setTextColor(30, 41, 59);
        doc.text('DATE & HEURE ENTRÉE :', leftColX, infoStartY);
        doc.setDrawColor(148, 163, 184);
        doc.line(leftColX + 27, infoStartY + 0.3, leftColX + 54, infoStartY + 0.3);

        doc.text('FIN SÉJOUR AUTORISÉ (+24H) :', leftColX, infoStartY + 6);
        doc.line(leftColX + 33, infoStartY + 6.3, leftColX + 54, infoStartY + 6.3);

        doc.text('TÉL. CHAUFFEUR / FLOTTE :', leftColX, infoStartY + 12);
        doc.line(leftColX + 31, infoStartY + 12.3, leftColX + 54, infoStartY + 12.3);

        doc.text(
          'MODE : [ ] ESPÈCES  [ ] WAVE  [ ] OM/MTN',
          leftColX,
          infoStartY + 18
        );

        // Pied de ticket : Contacts secours
        const footerY = y + ticketHeight - 9.5;
        doc.setFillColor(241, 245, 249);
        doc.rect(x + 0.4, footerY, ticketWidth - 0.8, 9.1, 'F');
        doc.setDrawColor(203, 213, 225);
        doc.line(x, footerY, x + ticketWidth, footerY);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.7);
        doc.setTextColor(15, 23, 42);
        doc.text(
          `URGENCE UJPAS : ${options.settings.support_phone}`,
          x + 3,
          footerY + 3.8
        );
        doc.setFont('courier', 'normal');
        doc.setFontSize(5.3);
        doc.setTextColor(51, 65, 85);
        doc.text(
          `RADIO: ${options.settings.emergency_radio_channel} · LOT: ${spec.batchCode}`,
          x + 3,
          footerY + 7.4
        );
      }

      // 2. SUPERPOSITION DYNAMIQUE PAR-DESSUS LE FOND (Spécification Phase 3)
      // A. Logo UJPAS (si fourni en Base64)
      if (hasLogoImage) {
        try {
          doc.addImage(UJPAS_LOGO_BASE64, 'PNG', x + 3, y + 2.5, 10, 10);
        } catch {
          // Ignorer si format incompatible
        }
      }

      // B. Numéro physique avec son chiffre de contrôle (ex: VRD-000101-4 ou Ctrl: 4)
      doc.setFont('courier', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(hasTemplateImage ? 15 : 255, hasTemplateImage ? 23 : 255, hasTemplateImage ? 42 : 255);
      doc.text(
        `N° ${spec.ticketNumber} [Ctrl:${checkDigit}]`,
        x + (hasLogoImage ? 15 : 3),
        y + 13.5
      );

      // C. Date d'impression officielle
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.8);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `ÉDITION DU ${printDateStr} · SECTEUR ${spec.sectorCode}`,
        x + 3,
        y + 20.5
      );

      // D. QR Code signé placé à droite
      const qrBoxSize = 28;
      const qrBoxX = x + ticketWidth - qrBoxSize - 3;
      const qrBoxY = y + 40;

      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.35);
      doc.rect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);
      doc.addImage(
        qrDataUrl,
        'PNG',
        qrBoxX + 1,
        qrBoxY + 1,
        qrBoxSize - 2,
        qrBoxSize - 2
      );

      // Mention du protocole cryptographique
      doc.setFont('courier', 'bold');
      doc.setFontSize(5.2);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `ED25519 · KID:${spec.kid.toUpperCase()}`,
        qrBoxX + qrBoxSize / 2,
        qrBoxY + qrBoxSize + 3.2,
        {align: 'center'}
      );

      // 3. TRAITS DE COUPE POINTILLÉS (DASHED CROP MARKS)
      doc.setDrawColor(100, 116, 139);
      doc.setLineWidth(0.28);
      doc.setLineDashPattern([1.5, 1.5], 0);

      // Cadre extérieur pointillé pour le massicotage
      doc.rect(x, y, ticketWidth, ticketHeight);

      // Repères d'angle pointillés externes (pour les guides d'imprimerie)
      const cropLen = 3.5;
      // Haut-Gauche
      doc.line(x - cropLen, y, x, y);
      doc.line(x, y - cropLen, x, y);
      // Haut-Droit
      doc.line(x + ticketWidth, y, x + ticketWidth + cropLen, y);
      doc.line(x + ticketWidth, y - cropLen, x + ticketWidth, y);
      // Bas-Gauche
      doc.line(x - cropLen, y + ticketHeight, x, y + ticketHeight);
      doc.line(x, y + ticketHeight, x, y + ticketHeight + cropLen);
      // Bas-Droit
      doc.line(x + ticketWidth, y + ticketHeight, x + ticketWidth + cropLen, y + ticketHeight);
      doc.line(x + ticketWidth, y + ticketHeight, x + ticketWidth, y + ticketHeight + cropLen);
    }
  }

  const pdfBlob = doc.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);
  const fileName =
    options.fileName ??
    `PORTUS_CARNET_6_TICKETS_${new Date().toISOString().slice(0, 10)}.pdf`;

  doc.save(fileName);

  return {
    blobUrl,
    fileName,
    pageCount: totalPages,
    ticketPayloads: generatedPayloads,
  };
}

/**
 * 2. GÉNÉRATEUR DE LA PLANCHE A4 PORTRAIT DE 8 BADGES PROFESSIONNELS CR80 (RECTO / VERSO)
 *    Format A4 Portrait : 210 mm x 297 mm
 *    Format norme CR80 : 85.60 mm x 54.0 mm (2 colonnes x 4 lignes = 8 badges)
 *    Traits de coupe pointillés, photo agent, logo UJPAS, indicatif radio (callsign),
 *    bandeau couleur dynamique par rôle (Rouge = RESPONSABLE, Bleu = AGENT, Ambre = CONTROLEUR).
 */
export async function generateBadgesPortraitPdfSheet(
  options: BadgeSheetGenerationOptions
): Promise<{
  blobUrl: string;
  fileName: string;
  badgePayloads: string[];
}> {
  const [{jsPDF}, QRCode] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ]);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const ox = Number.isFinite(options.calibration.offset_x_mm)
    ? options.calibration.offset_x_mm
    : 0;
  const oy = Number.isFinite(options.calibration.offset_y_mm)
    ? options.calibration.offset_y_mm
    : 0;

  const cardW = 85.6;
  const cardH = 54.0;
  const gapX = 8.0;
  const gapY = 9.0;
  const startX = (210 - (cardW * 2 + gapX)) / 2; // 15.4 mm
  const startY = 22;

  // Remplit jusqu'à 8 badges sur la planche
  const badges8: PrintableBadgeSpec[] = [];
  for (let i = 0; i < 8; i++) {
    badges8.push(options.badges[i % options.badges.length]);
  }

  const badgeQrUrls: string[] = [];
  const badgeQrRawStrings: string[] = [];

  for (const b of badges8) {
    let qrRaw = b.qrPayloadP1B;
    if (!qrRaw) {
      // Signature Ed25519 format P1B.<kid>.<badge_no>.<epoch>.<sig>
      const signed = await createSignedBadgeQrP1B({
        kid: b.kid || 'k1',
        badgeNumber: b.badgeNumber,
        epoch: b.epoch ?? Math.floor(Date.now() / 1000),
        matricule: b.profile.matricule,
        role: b.profile.role,
        sectorCode: b.sector?.code ?? 'VRD-GLOBAL',
        callsign: b.profile.callsign,
        expiresDate: b.expiresDate,
        secretKeyHex: options.secretKeyHex ?? DEFAULT_DEMO_SECRET_KEY_HEX,
      });
      qrRaw = signed.rawQrString;
    }
    badgeQrRawStrings.push(qrRaw);

    const qrDataUrl = await QRCode.toDataURL(qrRaw, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: {
        dark: '#090D16',
        light: '#FFFFFF',
      },
    });
    badgeQrUrls.push(qrDataUrl);
  }

  const hasLogoImage =
    typeof UJPAS_LOGO_BASE64 === 'string' &&
    UJPAS_LOGO_BASE64.trim().length > 20;

  // =========================================================================
  // PAGE 1 : RECTO DES 8 BADGES PROFESSIONNELS CR80
  // =========================================================================
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    'PLANCHE A4 PORTRAIT — 8 BADGES PROFESSIONNELS CR80 UJPAS VRIDI (PAGE 1/2 : RECTO)',
    105 + ox,
    11 + oy,
    {align: 'center'}
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Bandeau Couleur : ROUGE = Responsable/Direction · BLEU = Agent Perception · AMBRE = Contrôleur · Calibrage X:${ox}mm Y:${oy}mm`,
    105 + ox,
    15.5 + oy,
    {align: 'center'}
  );

  for (let idx = 0; idx < 8; idx++) {
    const spec = badges8[idx];
    const col = idx % 2;
    const row = Math.floor(idx / 2);

    const x = startX + col * (cardW + gapX) + ox;
    const y = startY + row * (cardH + gapY) + oy;

    const theme = resolveBadgeRoleColorTheme(spec.profile);
    const avatarUrl = spec.profile.photo_url || buildAvatarDataUrl(spec.profile, theme.hexColor);

    // Traits de coupe pointillés autour de chaque badge CR80
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5);

    // Lignes de massicotage externes
    const cut = 3.0;
    doc.line(x - cut, y, x, y);
    doc.line(x, y - cut, x, y);
    doc.line(x + cardW, y, x + cardW + cut, y);
    doc.line(x + cardW, y - cut, x + cardW, y);
    doc.line(x - cut, y + cardH, x, y + cardH);
    doc.line(x, y + cardH, x, y + cardH + cut);
    doc.line(x + cardW, y + cardH, x + cardW + cut, y + cardH);
    doc.line(x + cardW, y + cardH, x + cardW, y + cardH + cut);

    // Retour au tracé plein pour le contenu du badge
    doc.setLineDashPattern([], 0);

    // BANDEAU DE COULEUR DYNAMIQUE PAR RÔLE (Rouge = RESPONSABLE, Bleu = AGENT, Ambre = CONTROLEUR)
    doc.setFillColor(
      theme.rgbPrimary[0],
      theme.rgbPrimary[1],
      theme.rgbPrimary[2]
    );
    doc.rect(x, y, cardW, 12.5, 'F');

    // Logo UJPAS dans le bandeau si disponible
    if (hasLogoImage) {
      try {
        doc.addImage(UJPAS_LOGO_BASE64, 'PNG', x + 2.5, y + 1.5, 9.5, 9.5);
      } catch {
        // Ignorer si non décodable
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(
      theme.rgbTextOnBanner[0],
      theme.rgbTextOnBanner[1],
      theme.rgbTextOnBanner[2]
    );
    doc.text(
      'UJPAS — CORRIDOR PORTUAIRE DE VRIDI',
      x + (hasLogoImage ? 13.5 : 3),
      y + 4.8
    );

    doc.setFontSize(8.2);
    doc.text(theme.bannerLabel, x + (hasLogoImage ? 13.5 : 3), y + 9.8);

    // Photo de l'agent à gauche
    if (avatarUrl) {
      try {
        doc.addImage(avatarUrl, 'PNG', x + 3, y + 15, 21, 26.5);
      } catch {
        // Fallback cadre
      }
    }
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.3);
    doc.rect(x + 3, y + 15, 21, 26.5);

    // Informations nominatives, indicatif radio (Callsign) & matricule
    const infoX = x + 26.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(spec.profile.full_name.slice(0, 24), infoX, y + 19.2);

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(30, 41, 59);
    doc.text(`MATRICULE: ${spec.profile.matricule}`, infoX, y + 24.2);

    // INDICATIF RADIO EN ÉVIDENCE
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(
      theme.rgbPrimary[0],
      theme.rgbPrimary[1],
      theme.rgbPrimary[2]
    );
    doc.text(`INDICATIF (CALLSIGN) : ${spec.profile.callsign}`, infoX, y + 29.0);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Secteur: ${spec.sector ? spec.sector.code : 'SUPERVISION CORRIDOR'}`,
      infoX,
      y + 33.8
    );

    const perms: string[] = [];
    if (spec.profile.peut_vendre) perms.push('PERCEPTION');
    if (spec.profile.peut_controler) perms.push('CONTRÔLE');
    if (spec.profile.peut_signaler) perms.push('SÉCURITÉ');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.7);
    doc.text(`Habilitations: ${perms.join(' · ')}`, infoX, y + 38.2);

    // QR Code signé P1B à droite du recto
    doc.addImage(badgeQrUrls[idx], 'PNG', x + cardW - 21.5, y + 18, 18.5, 18.5);
    doc.setFont('courier', 'bold');
    doc.setFontSize(4.8);
    doc.setTextColor(15, 23, 42);
    doc.text(`P1B · ${spec.kid.toUpperCase()}`, x + cardW - 12.2, y + 38.5, {align: 'center'});

    // Pied du recto
    doc.setFillColor(15, 23, 42);
    doc.rect(x, y + cardH - 8.5, cardW, 8.5, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(255, 255, 255);
    doc.text(`BADGE N° ${spec.badgeNumber}`, x + 3, y + cardH - 3.2);
    doc.setTextColor(253, 230, 138);
    doc.text(
      `EXP: ${spec.expiresDate}`,
      x + cardW - 3,
      y + cardH - 3.2,
      {align: 'right'}
    );
  }

  // =========================================================================
  // PAGE 2 : VERSO DES 8 BADGES PROFESSIONNELS CR80 (ALIGNEMENT MIROIR)
  // =========================================================================
  doc.addPage('a4', 'portrait');
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    'PLANCHE A4 PORTRAIT — 8 BADGES PROFESSIONNELS CR80 UJPAS VRIDI (PAGE 2/2 : VERSO)',
    105 + ox,
    11 + oy,
    {align: 'center'}
  );

  for (let idx = 0; idx < 8; idx++) {
    const spec = badges8[idx];
    const colRecto = idx % 2;
    const colVerso = 1 - colRecto; // Miroir pour impression recto/verso
    const row = Math.floor(idx / 2);

    const x = startX + colVerso * (cardW + gapX) + ox;
    const y = startY + row * (cardH + gapY) + oy;
    const theme = resolveBadgeRoleColorTheme(spec.profile);
    const rawQr = badgeQrRawStrings[idx];

    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5);

    doc.setLineDashPattern([], 0);

    // Liseré supérieur couleur rôle
    doc.setFillColor(
      theme.rgbPrimary[0],
      theme.rgbPrimary[1],
      theme.rgbPrimary[2]
    );
    doc.rect(x, y, cardW, 5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    doc.setTextColor(15, 23, 42);
    doc.text(
      "CONSIGNES D'AUTHENTICITÉ & DE SÉCURITÉ — UJPAS VRIDI",
      x + 3.5,
      y + 10
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.7);
    doc.setTextColor(51, 65, 85);
    doc.text(
      '1. Badge strictement personnel vérifiable hors-ligne par signature Ed25519.',
      x + 3.5,
      y + 14.5
    );
    doc.text(
      "2. Habilité aux opérations de Contribution d'Assistance et de Sécurisation.",
      x + 3.5,
      y + 18.5
    );
    doc.text(
      `3. Canal Radio Urgence Corridor : ${options.settings.emergency_radio_channel}`,
      x + 3.5,
      y + 22.5
    );
    doc.text(
      `4. En cas de perte ou découverte, appeler : ${options.settings.support_phone}`,
      x + 3.5,
      y + 26.5
    );

    // Grand QR Code de contrôle rapide au verso
    doc.addImage(badgeQrUrls[idx], 'PNG', x + 3.5, y + 29, 21, 21);

    doc.setFont('courier', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(15, 23, 42);
    doc.text(`MATRICULE : ${spec.profile.matricule}`, x + 27, y + 33.5);
    doc.text(`CALLSIGN : ${spec.profile.callsign}`, x + 27, y + 37.5);
    doc.text(`CLÉ (KID) : ${spec.kid.toUpperCase()}`, x + 27, y + 41.5);

    doc.setFont('courier', 'normal');
    doc.setFontSize(4.9);
    doc.setTextColor(71, 85, 105);
    doc.text(`SIG ED25519: ${rawQr.slice(-32)}`, x + 27, y + 46);
    doc.text('Port Autonome d’Abidjan — Corridor de Vridi', x + 27, y + 49.5);
  }

  const pdfBlob = doc.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);
  const fileName =
    options.fileName ??
    `PORTUS_PLANCHE_8_BADGES_CR80_${new Date().toISOString().slice(0, 10)}.pdf`;

  doc.save(fileName);

  return {
    blobUrl,
    fileName,
    badgePayloads: badgeQrRawStrings,
  };
}

/**
 * 3. RAPPORT HEBDOMADAIRE INSTITUTIONNEL PARTENAIRES (A4 PORTRAIT)
 */
export interface WeeklyPartnerReportOptions {
  settings: AppSettings;
  generatedBy: Profile;
  totalCollectedFcfa: number;
  cashCollectedFcfa: number;
  mobileMoneyCollectedFcfa: number;
  remittedByAgentsFcfa: number;
  depositedToTreasuryFcfa: number;
  activeTrucksCount: number;
  pendingRegularizationCount: number;
  dormantBatchesCount: number;
  paymentBreakdown: Array<{method: string; count: number; amountFcfa: number}>;
  sectorSummaries: Array<{
    sectorCode: string;
    sectorName: string;
    salesCount: number;
    amountFcfa: number;
  }>;
}

export async function generateWeeklyPartnerAuditReportPDF(
  options: WeeklyPartnerReportOptions
): Promise<{fileName: string; blobUrl: string}> {
  const {jsPDF} = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  doc.setFillColor(9, 13, 22);
  doc.rect(0, 0, 210, 34, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(
    'UJPAS — CORRIDOR PORTUAIRE DE VRIDI (ABIDJAN, CÔTE D’IVOIRE)',
    14,
    13
  );

  doc.setFontSize(9.5);
  doc.setTextColor(245, 158, 11);
  doc.text(
    `RAPPORT HEBDOMADAIRE PARTENAIRES & AUDIT — ${options.settings.contribution_label.toUpperCase()}`,
    14,
    20.5
  );

  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `Édité le ${new Date().toLocaleString('fr-FR')} par ${options.generatedBy.full_name} (${options.generatedBy.matricule} / ${options.generatedBy.callsign})`,
    14,
    28
  );

  let y = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. PYRAMIDE FINANCIÈRE DE RÉCONCILIATION (FCFA)', 14, y);

  y += 5;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, 182, 34, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Niveau 1 — Total Perçu Terrain (${options.settings.contribution_label}) :`,
    19,
    y + 8
  );
  doc.setFont('courier', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`${options.totalCollectedFcfa.toLocaleString('fr-FR')} FCFA`, 190, y + 8, {
    align: 'right',
  });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text('   dont Espèces perçues / Mobile Money perçu :', 19, y + 15);
  doc.setFont('courier', 'bold');
  doc.text(
    `${options.cashCollectedFcfa.toLocaleString('fr-FR')} FCFA / ${options.mobileMoneyCollectedFcfa.toLocaleString('fr-FR')} FCFA`,
    190,
    y + 15,
    {align: 'right'}
  );

  doc.setFont('helvetica', 'normal');
  doc.text(
    'Niveau 2 — Espèces Remises aux Responsables de Secteur (Remittances) :',
    19,
    y + 22
  );
  doc.setFont('courier', 'bold');
  doc.text(`${options.remittedByAgentsFcfa.toLocaleString('fr-FR')} FCFA`, 190, y + 22, {
    align: 'right',
  });

  doc.setFont('helvetica', 'normal');
  doc.text(
    'Niveau 3 — Reversements Trésorerie Centrale UJPAS (Treasury Deposits) :',
    19,
    y + 29
  );
  doc.setFont('courier', 'bold');
  doc.setTextColor(4, 120, 87);
  doc.text(
    `${options.depositedToTreasuryFcfa.toLocaleString('fr-FR')} FCFA`,
    190,
    y + 29,
    {align: 'right'}
  );

  y += 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('2. INDICATEURS OPÉRATIONNELS CORRIDOR DE VRIDI', 14, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`• Camions en séjour régulier actif : ${options.activeTrucksCount}`, 16, y);
  doc.text(
    `• Véhicules « ${options.settings.pending_regularization_label} » : ${options.pendingRegularizationCount}`,
    85,
    y
  );
  doc.text(
    `• Carnets dormants sous surveillance : ${options.dormantBatchesCount}`,
    152,
    y
  );

  y += 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('3. VENTILATION DES RECETTES PAR MODE DE RÈGLEMENT', 14, y);

  y += 6;
  for (const item of options.paymentBreakdown) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`${item.method.padEnd(16, ' ')}`, 18, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${item.count} ticket(s)`, 75, y);
    doc.setFont('courier', 'bold');
    doc.text(`${item.amountFcfa.toLocaleString('fr-FR')} FCFA`, 190, y, {
      align: 'right',
    });
    y += 6;
  }

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('4. SYNTHÈSE PAR SECTEUR PORTUAIRE', 14, y);

  y += 6;
  for (const sec of options.sectorSummaries) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.3);
    doc.setTextColor(15, 23, 42);
    doc.text(`${sec.sectorCode} — ${sec.sectorName}`, 18, y);
    doc.setFont('courier', 'bold');
    doc.text(
      `${sec.salesCount} perceptions · ${sec.amountFcfa.toLocaleString('fr-FR')} FCFA`,
      190,
      y,
      {align: 'right'}
    );
    y += 6.5;
  }

  doc.setDrawColor(148, 163, 184);
  doc.line(14, 272, 196, 272);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Clé publique Ed25519 UJPAS (v${options.settings.key_version}) : ${options.settings.ed25519_public_key_hex}`,
    14,
    278
  );
  doc.text(
    'Document certifié conforme — Trésorerie UJPAS Corridor Vridi.',
    14,
    283
  );

  const fileName = `PORTUS_RAPPORT_HEBDOMADAIRE_PARTENAIRES_${new Date().toISOString().slice(0, 10)}.pdf`;
  const blobUrl = URL.createObjectURL(doc.output('blob'));
  doc.save(fileName);

  return {fileName, blobUrl};
}
