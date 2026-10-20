/**
 * PORTUS — Atelier Éditique PDF (A4 Paysage 6 Tickets & A4 Portrait 8 Badges CR80)
 * et Console de Vérification Cryptographique Hors-Ligne Ed25519 (`P1`, `P1B`, `kid`, Tolérance Plaques)
 */

import React, {useState} from 'react';
import {
  Printer,
  ShieldCheck,
  QrCode,
  Sliders,
  FileDown,
  IdCard,
  CheckCircle2,
  AlertTriangle,
  SearchCheck,
} from 'lucide-react';
import {
  createSignedTicketQrP1,
  createSignedBadgeQrP1B,
  verifyTicketQrPayloadP1,
  verifyBadgeQrPayloadP1B,
  compareTruckPlatesWithTolerance,
  getRegisteredKeyRing,
  TicketVerificationResultP1,
  BadgeVerificationResultP1B,
  PlateMatchAssessment,
} from '../lib/crypto/ed25519';
import {
  generateTicketsLandscapePdfSheet,
  generateBadgesPortraitPdfSheet,
  resolveBadgeRoleColorTheme,
  PrintableTicketSpec,
  PrintableBadgeSpec,
} from '../lib/pdf/generator';
import type {AppSettings, Profile, Sector} from '../types/portus';

interface EditiqueAndCryptoPanelProps {
  settings: AppSettings;
  sectors: Sector[];
  profiles: Profile[];
}

export const EditiqueAndCryptoPanel: React.FC<EditiqueAndCryptoPanelProps> = ({
  settings,
  sectors,
  profiles,
}) => {
  // 1. Curseurs de calibrage d'imprimante (offset_x_mm, offset_y_mm) mémorisés dans localStorage
  const [offsetXMm, setOffsetXMm] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('portus_printer_offset_x_mm');
      return saved ? Number(saved) : 0;
    }
    return 0;
  });
  const [offsetYMm, setOffsetYMm] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('portus_printer_offset_y_mm');
      return saved ? Number(saved) : 0;
    }
    return 0;
  });
  const [selectedKid, setSelectedKid] = useState<string>('k1');

  const handleUpdateOffsetXMm = (val: number) => {
    setOffsetXMm(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('portus_printer_offset_x_mm', String(val));
    }
  };

  const handleUpdateOffsetYMm = (val: number) => {
    setOffsetYMm(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('portus_printer_offset_y_mm', String(val));
    }
  };

  // 2. Paramètres de génération Planche A4 Paysage (6 tickets : 2 lignes de 3)
  const [selectedSectorId, setSelectedSectorId] = useState<string>(
    sectors[0]?.id ?? '11111111-1111-4111-8111-111111111101'
  );
  const [batchCode, setBatchCode] = useState<string>('CARNET-VRD01-2026-002');
  const [serialStart, setSerialStart] = useState<number>(100051);
  const [ticketSheetCount, setTicketSheetCount] = useState<number>(1); // 1 feuille = 6 tickets
  const [isGeneratingTicketsPdf, setIsGeneratingTicketsPdf] = useState(false);
  const [lastTicketsPdfResult, setLastTicketsPdfResult] = useState<{
    fileName: string;
    pageCount: number;
    sampleQr: string;
  } | null>(null);

  // 3. Paramètres de génération Planche A4 Portrait (8 badges CR80 recto/verso)
  const [badgeExpiresDate, setBadgeExpiresDate] = useState<string>('2027-12-31');
  const [isGeneratingBadgesPdf, setIsGeneratingBadgesPdf] = useState(false);
  const [lastBadgesPdfResult, setLastBadgesPdfResult] = useState<{
    fileName: string;
    sampleQr: string;
  } | null>(null);

  // 4. Banc de vérification cryptographique Ed25519 hors-ligne (P1 / P1B) + Tolérance plaques
  const [qrInputToVerify, setQrInputToVerify] = useState<string>('');
  const [ticketVerification, setTicketVerification] =
    useState<TicketVerificationResultP1 | null>(null);
  const [badgeVerification, setBadgeVerification] =
    useState<BadgeVerificationResultP1B | null>(null);

  const [registeredPlateInput, setRegisteredPlateInput] =
    useState<string>('CI-8842-GT-01');
  const [observedPlateInput, setObservedPlateInput] =
    useState<string>('CI 8B42 G7 01');
  const [plateAssessment, setPlateAssessment] =
    useState<PlateMatchAssessment | null>(() =>
      compareTruckPlatesWithTolerance('CI-8842-GT-01', 'CI 8B42 G7 01')
    );

  const activeSector =
    sectors.find((s) => s.id === selectedSectorId) ?? sectors[0];

  const handleGenerateTicketsSheet = async () => {
    if (!activeSector) return;
    setIsGeneratingTicketsPdf(true);
    try {
      const totalTickets = ticketSheetCount * 6;
      const specs: PrintableTicketSpec[] = [];

      for (let i = 0; i < totalTickets; i++) {
        const serial = serialStart + i;
        specs.push({
          ticketNumber: `UJPAS-${activeSector.code.replace(/[^A-Z0-9]/g, '').slice(-5)}-${serial}`,
          serialNumber: serial,
          sectorCode: activeSector.code,
          sectorName: activeSector.name,
          batchCode,
          amountFcfa: settings.default_contribution_fcfa,
          kid: selectedKid,
        });
      }

      const res = await generateTicketsLandscapePdfSheet({
        tickets: specs,
        settings,
        calibration: {
          offset_x_mm: offsetXMm,
          offset_y_mm: offsetYMm,
        },
        fileName: `PORTUS_TICKETS_${activeSector.code}_${serialStart}_${serialStart + totalTickets - 1}.pdf`,
      });

      const firstQr = res.ticketPayloads[0] ?? '';
      setLastTicketsPdfResult({
        fileName: res.fileName,
        pageCount: res.pageCount,
        sampleQr: firstQr,
      });

      if (firstQr) {
        setQrInputToVerify(firstQr);
        const ver = await verifyTicketQrPayloadP1(
          firstQr,
          settings.ed25519_public_key_hex
        );
        setTicketVerification(ver);
        setBadgeVerification(null);
      }
    } finally {
      setIsGeneratingTicketsPdf(false);
    }
  };

  const handleGenerateBadgesSheet = async () => {
    setIsGeneratingBadgesPdf(true);
    try {
      const badgeSpecs: PrintableBadgeSpec[] = profiles.map((p, idx) => ({
        badgeNumber: `BDG-UJPAS-2026-040${idx + 1}`,
        profile: p,
        sector: sectors.find((s) => s.id === p.sector_id) ?? null,
        expiresDate: badgeExpiresDate,
        kid: selectedKid,
      }));

      const res = await generateBadgesPortraitPdfSheet({
        badges: badgeSpecs,
        settings,
        calibration: {
          offset_x_mm: offsetXMm,
          offset_y_mm: offsetYMm,
        },
        fileName: `PORTUS_8_BADGES_CR80_RECTO_VERSO_${badgeExpiresDate}.pdf`,
      });

      const firstBadgeQr = res.badgePayloads[0] ?? '';
      setLastBadgesPdfResult({
        fileName: res.fileName,
        sampleQr: firstBadgeQr,
      });

      if (firstBadgeQr) {
        setQrInputToVerify(firstBadgeQr);
        const ver = await verifyBadgeQrPayloadP1B(
          firstBadgeQr,
          settings.ed25519_public_key_hex
        );
        setBadgeVerification(ver);
        setTicketVerification(null);
      }
    } finally {
      setIsGeneratingBadgesPdf(false);
    }
  };

  const handleGenerateSampleTicketP1 = async () => {
    const sample = await createSignedTicketQrP1({
      kid: selectedKid,
      ticketNumber: 'UJPAS-VRD01-100051',
      serialNumber: 100051,
      sectorCode: activeSector?.code ?? 'VRD-SEC-01',
      amountFcfa: settings.default_contribution_fcfa,
    });
    setQrInputToVerify(sample.rawQrString);
    const ver = await verifyTicketQrPayloadP1(
      sample.rawQrString,
      settings.ed25519_public_key_hex
    );
    setTicketVerification(ver);
    setBadgeVerification(null);
  };

  const handleGenerateSampleBadgeP1B = async () => {
    const p = profiles[2] ?? profiles[0];
    const sample = await createSignedBadgeQrP1B({
      kid: selectedKid,
      badgeNumber: 'BDG-UJPAS-2026-0101',
      matricule: p.matricule,
      role: p.role,
      sectorCode: 'VRD-SEC-01',
      callsign: p.callsign,
      expiresDate: badgeExpiresDate,
    });
    setQrInputToVerify(sample.rawQrString);
    const ver = await verifyBadgeQrPayloadP1B(
      sample.rawQrString,
      settings.ed25519_public_key_hex
    );
    setBadgeVerification(ver);
    setTicketVerification(null);
  };

  const handleVerifyQrInput = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = qrInputToVerify.trim();
    if (clean.toUpperCase().startsWith('P1B|')) {
      const res = await verifyBadgeQrPayloadP1B(
        clean,
        settings.ed25519_public_key_hex
      );
      setBadgeVerification(res);
      setTicketVerification(null);
    } else {
      const res = await verifyTicketQrPayloadP1(
        clean,
        settings.ed25519_public_key_hex
      );
      setTicketVerification(res);
      setBadgeVerification(null);
    }
  };

  const handleComparePlates = (e: React.FormEvent) => {
    e.preventDefault();
    setPlateAssessment(
      compareTruckPlatesWithTolerance(registeredPlateInput, observedPlateInput)
    );
  };

  const keyRing = getRegisteredKeyRing();

  return (
    <div className="space-y-6">
      {/* 1. Calibrage Imprimante (offset_x_mm, offset_y_mm) & Clé Ed25519 (kid) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-amber-400" />
            <h2 className="text-base font-bold text-white">
              Calibrage Imprimante (`offset_x_mm`, `offset_y_mm`) & Clé
              Asymétrique Ed25519 (`kid`)
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              handleUpdateOffsetXMm(0);
              handleUpdateOffsetYMm(0);
            }}
            className="min-h-[36px] rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            Réinitialiser (0 mm / 0 mm)
          </button>
        </div>

        <p className="mt-1 text-xs text-slate-400">
          Ajustez au millimètre près les marges mécaniques de l&apos;imprimante
          pour les planches pré-perforées A4 Paysage (6 tickets) et A4 Portrait
          (8 badges CR80 recto/verso). Valeurs conservées dans le terminal.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5">
            <div className="flex items-center justify-between text-xs">
              <label
                htmlFor="offset-x-slider"
                className="font-semibold text-slate-300"
              >
                Décalage Horizontal (`offset_x_mm`)
              </label>
              <span className="font-mono font-bold text-amber-400">
                {offsetXMm >= 0 ? `+${offsetXMm}` : offsetXMm} mm
              </span>
            </div>
            <input
              id="offset-x-slider"
              type="range"
              min={-15}
              max={15}
              step={0.5}
              value={offsetXMm}
              onChange={(e) => handleUpdateOffsetXMm(Number.parseFloat(e.target.value))}
              className="mt-2.5 w-full accent-amber-500"
            />
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5">
            <div className="flex items-center justify-between text-xs">
              <label
                htmlFor="offset-y-slider"
                className="font-semibold text-slate-300"
              >
                Décalage Vertical (`offset_y_mm`)
              </label>
              <span className="font-mono font-bold text-amber-400">
                {offsetYMm >= 0 ? `+${offsetYMm}` : offsetYMm} mm
              </span>
            </div>
            <input
              id="offset-y-slider"
              type="range"
              min={-15}
              max={15}
              step={0.5}
              value={offsetYMm}
              onChange={(e) => handleUpdateOffsetYMm(Number.parseFloat(e.target.value))}
              className="mt-2.5 w-full accent-amber-500"
            />
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5">
            <label
              htmlFor="kid-select"
              className="block text-xs font-semibold text-slate-300"
            >
              Identifiant de Clé Publique Ed25519 (`kid`)
            </label>
            <select
              id="kid-select"
              value={selectedKid}
              onChange={(e) => setSelectedKid(e.target.value)}
              className="mt-1.5 min-h-[38px] w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-xs text-white"
            >
              {Object.entries(keyRing).map(([kid, pub]) => (
                <option key={kid} value={kid}>
                  kid={kid} · pub={pub.slice(0, 16)}…
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 2. Générateurs PDF Éditiques : 6 Tickets Paysage & 8 Badges CR80 Portrait */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Planche A4 Paysage de 6 Tickets (2 lignes de 3) */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">
              Planche A4 Paysage — 6 Tickets (2 lignes × 3)
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Import dynamique `jspdf` · En-tête officiel UJPAS, 10 cases de
            saisie de plaque, carré QR Code `P1` signé Ed25519, contacts secours
            et traits de coupe.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label
                htmlFor="pdf-sector-select"
                className="block text-xs font-semibold text-slate-300"
              >
                Secteur d&apos;affectation du carnet
              </label>
              <select
                id="pdf-sector-select"
                value={selectedSectorId}
                onChange={(e) => setSelectedSectorId(e.target.value)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              >
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label
                  htmlFor="pdf-batch-code"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Code Lot Carnet
                </label>
                <input
                  id="pdf-batch-code"
                  type="text"
                  value={batchCode}
                  onChange={(e) => setBatchCode(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="pdf-serial-start"
                  className="block text-xs font-semibold text-slate-300"
                >
                  N° Série Début
                </label>
                <input
                  id="pdf-serial-start"
                  type="number"
                  min={1}
                  value={serialStart}
                  onChange={(e) =>
                    setSerialStart(Number.parseInt(e.target.value, 10) || 100001)
                  }
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="pdf-sheet-count"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Planches (×6)
                </label>
                <select
                  id="pdf-sheet-count"
                  value={ticketSheetCount}
                  onChange={(e) =>
                    setTicketSheetCount(Number.parseInt(e.target.value, 10))
                  }
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
                >
                  <option value={1}>1 planche (6 tickets)</option>
                  <option value={2}>2 planches (12 tickets)</option>
                  <option value={3}>3 planches (18 tickets)</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              disabled={isGeneratingTicketsPdf}
              onClick={() => void handleGenerateTicketsSheet()}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
            >
              <FileDown className="h-4 w-4" />
              <span>
                {isGeneratingTicketsPdf
                  ? 'Chargement jsPDF & Signature Ed25519 en cours…'
                  : `Générer & Télécharger PDF (${ticketSheetCount * 6} Tickets A4 Paysage)`}
              </span>
            </button>

            {lastTicketsPdfResult && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                <p className="font-bold">
                  Planche générée : {lastTicketsPdfResult.fileName} (
                  {lastTicketsPdfResult.pageCount} page(s))
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-emerald-300">
                  Exemple QR P1 signé : {lastTicketsPdfResult.sampleQr}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Planche A4 Portrait de 8 Badges CR80 (Recto/Verso) */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-2">
            <IdCard className="h-5 w-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">
              Planche A4 Portrait — 8 Badges CR80 (Recto / Verso)
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Bandeau couleur réglementaire : <strong>Rouge</strong> (Responsable
            / Superviseur), <strong>Bleu</strong> (Agent Perception),{' '}
            <strong>Jaune/Ambre</strong> (Contrôleur). Photo, matricule,
            indicatif radio et QR signé `P1B`.
          </p>

          {/* Aperçu des bandeaux couleur par profil */}
          <div className="mt-3 space-y-1.5">
            {profiles.map((p) => {
              const theme = resolveBadgeRoleColorTheme(p);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs"
                >
                  <div>
                    <span className="font-bold text-white">{p.full_name}</span>
                    <span className="mx-1.5 text-slate-600">·</span>
                    <span className="font-mono text-slate-400">
                      {p.callsign}
                    </span>
                  </div>
                  <span
                    className="font-mono text-[11px] font-bold"
                    style={{color: theme.hexColor}}
                  >
                    {theme.bannerLabel}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3">
            <label
              htmlFor="badge-expires-input"
              className="block text-xs font-semibold text-slate-300"
            >
              Date d&apos;expiration des badges imprimés
            </label>
            <input
              id="badge-expires-input"
              type="date"
              value={badgeExpiresDate}
              onChange={(e) => setBadgeExpiresDate(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-white"
            />
          </div>

          <button
            type="button"
            disabled={isGeneratingBadgesPdf}
            onClick={() => void handleGenerateBadgesSheet()}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-4 py-2.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50"
          >
            <FileDown className="h-4 w-4" />
            <span>
              {isGeneratingBadgesPdf
                ? 'Génération Recto/Verso CR80 en cours…'
                : 'Générer Planche A4 Portrait (8 Badges CR80 Recto/Verso)'}
            </span>
          </button>

          {lastBadgesPdfResult && (
            <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <p className="font-bold">
                Planche CR80 générée : {lastBadgesPdfResult.fileName}
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-emerald-300">
                Exemple QR P1B signé : {lastBadgesPdfResult.sampleQr}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 3. Vérificateur Cryptographique Hors-Ligne Ed25519 (P1 & P1B) + Tolérance Plaques */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Vérification Signature Ed25519 P1 / P1B */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">
                Vérificateur Hors-Ligne Ed25519 (`P1` Ticket & `P1B` Badge)
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleGenerateSampleTicketP1()}
                className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-slate-700"
              >
                Exemple P1
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateSampleBadgeP1B()}
                className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-slate-700"
              >
                Exemple P1B
              </button>
            </div>
          </div>

          <form onSubmit={handleVerifyQrInput} className="mt-3 space-y-3">
            <div>
              <label
                htmlFor="qr-verify-textarea"
                className="block text-xs font-semibold text-slate-300"
              >
                Chaîne QR scannée (`P1|kid|...` ou `P1B|kid|...`)
              </label>
              <textarea
                id="qr-verify-textarea"
                rows={3}
                value={qrInputToVerify}
                onChange={(e) => setQrInputToVerify(e.target.value)}
                placeholder="Cliquez sur Exemple P1 ou Exemple P1B, ou collez un QR Code..."
                required
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700"
            >
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              <span>Vérifier Signature Ed25519 Hors-Ligne (@noble/ed25519)</span>
            </button>
          </form>

          {ticketVerification && (
            <div
              className={`mt-4 rounded-lg border p-3.5 text-xs ${
                ticketVerification.isSignatureVerified
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                {ticketVerification.isSignatureVerified ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                )}
                <span>
                  {ticketVerification.isSignatureVerified
                    ? 'SIGNATURE ED25519 TICKET P1 AUTHENTIQUE'
                    : 'ÉCHEC VÉRIFICATION CRYPTOGRAPHIQUE P1'}
                </span>
              </div>
              {ticketVerification.parsed && (
                <p className="mt-1.5 font-mono text-[11px]">
                  Ticket: {ticketVerification.parsed.ticketNumber} · Série #
                  {ticketVerification.parsed.serialNumber} · Secteur:{' '}
                  {ticketVerification.parsed.sectorCode} · Contribution:{' '}
                  {ticketVerification.parsed.amountFcfa} FCFA · kid=
                  {ticketVerification.parsed.kid}
                </p>
              )}
              {ticketVerification.errorReason && (
                <p className="mt-1 text-rose-300">
                  {ticketVerification.errorReason}
                </p>
              )}
            </div>
          )}

          {badgeVerification && (
            <div
              className={`mt-4 rounded-lg border p-3.5 text-xs ${
                badgeVerification.isSignatureVerified &&
                !badgeVerification.isExpired
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                {badgeVerification.isSignatureVerified &&
                !badgeVerification.isExpired ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                )}
                <span>
                  {badgeVerification.isSignatureVerified
                    ? 'SIGNATURE ED25519 BADGE P1B AUTHENTIQUE'
                    : 'BADGE P1B INVALIDE OU ALTÉRÉ'}
                </span>
              </div>
              {badgeVerification.parsed && (
                <p className="mt-1.5 font-mono text-[11px]">
                  Badge: {badgeVerification.parsed.badgeNumber} · Matricule:{' '}
                  {badgeVerification.parsed.matricule} · Rôle:{' '}
                  {badgeVerification.parsed.role} · Radio:{' '}
                  {badgeVerification.parsed.callsign} · Exp:{' '}
                  {badgeVerification.parsed.expiresDate}
                </p>
              )}
              {badgeVerification.errorReason && (
                <p className="mt-1 text-rose-300">
                  {badgeVerification.errorReason}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Normalisation et Tolérance des Plaques Poids Lourds */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-2">
            <SearchCheck className="h-5 w-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">
              Normalisation & Tolérance des Plaques Poids Lourds
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Absorbe les différences d&apos;espacement/tirets et les confusions
            visuelles de nuit ou sur plaques poussiéreuses (`O/0`, `I/1`, `B/8`,
            `S/5`, `G/6`, distance Levenshtein ≤ 1).
          </p>

          <form onSubmit={handleComparePlates} className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="reg-plate-input"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Plaque enregistrée à la perception
                </label>
                <input
                  id="reg-plate-input"
                  type="text"
                  value={registeredPlateInput}
                  onChange={(e) => setRegisteredPlateInput(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-white uppercase"
                />
              </div>
              <div>
                <label
                  htmlFor="obs-plate-input"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Plaque lue au contrôle routier
                </label>
                <input
                  id="obs-plate-input"
                  type="text"
                  value={observedPlateInput}
                  onChange={(e) => setObservedPlateInput(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-white uppercase"
                />
              </div>
            </div>

            <button
              type="submit"
              className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700"
            >
              <span>Évaluer Concordance & Squelette Visuel</span>
            </button>
          </form>

          {plateAssessment && (
            <div
              className={`mt-4 rounded-lg border p-3.5 text-xs ${
                plateAssessment.exactMatch
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : plateAssessment.fuzzyTolerantMatch
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              <p className="font-bold">{plateAssessment.diagnostic}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-300">
                <span>
                  Normalisé : {plateAssessment.normalizedRegistered} vs{' '}
                  {plateAssessment.normalizedObserved}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Squelette : {plateAssessment.skeletonRegistered} vs{' '}
                  {plateAssessment.skeletonObserved}
                </span>
                <span aria-hidden="true">·</span>
                <span>Distance : {plateAssessment.editDistance}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
