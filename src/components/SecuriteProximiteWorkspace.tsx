/**
 * PORTUS — Module de Sécurité de Proximité & Passation de Service Jour/Nuit (Phase 6.1)
 *
 * Fonctionnalités :
 * 1. Déclaration d'incidents en 3 taps :
 *    - Tap 1 : Sélection de la catégorie d'incident (grands boutons tactiles plein soleil/nuit)
 *    - Tap 2 : Bascule Niveau URGENT (`URGENCE_ABSOLUE` / `CRITIQUE` / `MODERE`)
 *    - Tap 3 : Envoi immédiat avec géolocalisation GPS auto + photo compressée `<canvas>` (~180 Ko)
 * 2. Génération automatique d'un code court radio (`INC-XXXX`) pour dictée vocale sur Canal 16.
 * 3. Option « Signalé par talkie-walkie » avec saisie de l'indicatif radio appelant.
 * 4. Bouton de secours SMS / WhatsApp avec coordonnées et lien GPS hors-ligne.
 * 5. Journal de passation de service Jour / Nuit (`shift_handovers`).
 */

import React, {useState, useEffect} from 'react';
import {
  Siren,
  Radio,
  MapPin,
  Camera,
  MessageSquare,
  Send,
  Sun,
  Moon,
  CheckCircle2,
  AlertTriangle,
  ClipboardList,
  ShieldAlert,
  Navigation,
} from 'lucide-react';
import {portusRepository} from '../lib/supabase/client';
import {enqueueOfflineMutation} from '../lib/db';
import {syncEngine} from '../lib/sync/syncEngine';
import type {
  AppSettings,
  Incident,
  IncidentSeverity,
  IncidentType,
  Profile,
  Sector,
  ShiftHandover,
  Ticket,
} from '../types/portus';

interface SecuriteProximiteWorkspaceProps {
  currentProfile: Profile;
  profiles: Profile[];
  sectors: Sector[];
  tickets: Ticket[];
  settings: AppSettings;
  onDataChanged: () => void;
}

const INCIDENT_TYPE_CARDS: Array<{
  type: IncidentType;
  shortTitle: string;
  defaultDescription: string;
}> = [
  {
    type: 'PANNE_CAMION_OBSTRUCTION',
    shortTitle: 'Panne Camion / Obstruction Voie',
    defaultDescription:
      'Ensemble routier en panne immobilisant une file de circulation sur le corridor de Vridi. Balisage et remorquage requis.',
  },
  {
    type: 'ACCIDENT_CORRIDOR',
    shortTitle: 'Accident Matériel / Corporel',
    defaultDescription:
      'Collision sur le corridor portuaire de Vridi. Sécurisation du périmètre par la brigade UJPAS.',
  },
  {
    type: 'CONGESTION_CRITIQUE_TERMINAL',
    shortTitle: 'Congestion Critique Accès Terminal',
    defaultDescription:
      'Saturation critique des files poids lourds aux abords du terminal. Régulation prioritaire en cours.',
  },
  {
    type: 'LITIGE_CHAUFFEUR_ASSISTANCE',
    shortTitle: 'Litige Chauffeur / Régularisation',
    defaultDescription:
      'Médiation terrain requise pour un véhicule en attente de régularisation.',
  },
  {
    type: 'TENTATIVE_CORRUPTION_OU_FALSIFICATION',
    shortTitle: 'Falsification / Fraude Détectée',
    defaultDescription:
      'Présentation d’un support falsifié ou tentative de contournement du contrôle UJPAS.',
  },
  {
    type: 'AGRESSION_SECURITE',
    shortTitle: 'Urgence Sécurité / Agression',
    defaultDescription:
      'Menace directe sur l’intégrité des équipes ou des chauffeurs en séjour. Renfort immédiat requis sur Canal 16.',
  },
];

async function compressIncidentPhotoToDataUrl(
  file: File
): Promise<{dataUrl: string; sizeKb: number}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture image impossible.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Décodage image impossible.'));
      img.onload = () => {
        const maxSide = 960;
        let w = img.width;
        let h = img.height;
        if (w > maxSide || h > maxSide) {
          if (w >= h) {
            h = Math.round((h * maxSide) / w);
            w = maxSide;
          } else {
            w = Math.round((w * maxSide) / h);
            h = maxSide;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Contexte Canvas 2D indisponible.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.68);
        const sizeKb = Math.round((dataUrl.length * 0.75) / 1024);
        resolve({dataUrl, sizeKb});
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const SecuriteProximiteWorkspace: React.FC<
  SecuriteProximiteWorkspaceProps
> = ({
  currentProfile,
  profiles,
  sectors,
  tickets,
  settings,
  onDataChanged,
}) => {
  const [subTab, setSubTab] = useState<'INCIDENTS_3TAPS' | 'SHIFT_HANDOVER'>(
    'INCIDENTS_3TAPS'
  );
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [handovers, setHandovers] = useState<ShiftHandover[]>([]);

  // État Déclaration 3 Taps
  const [selectedType, setSelectedType] = useState<IncidentType>(
    'PANNE_CAMION_OBSTRUCTION'
  );
  const [severity, setSeverity] = useState<IncidentSeverity>('URGENCE_ABSOLUE');
  const [sectorId, setSectorId] = useState<string>(
    currentProfile.sector_id ?? sectors[0]?.id ?? ''
  );
  const [truckPlate, setTruckPlate] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [reportedViaWalkieTalkie, setReportedViaWalkieTalkie] = useState(false);
  const [walkieCallsign, setWalkieCallsign] = useState(currentProfile.callsign);
  const [gpsCoords, setGpsCoords] = useState<{lat: number; lng: number}>({
    lat: 5.2594,
    lng: -4.0128,
  });
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoSizeKb, setPhotoSizeKb] = useState<number | null>(null);
  const [lastCreatedIncident, setLastCreatedIncident] =
    useState<Incident | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // État Passation de service Jour / Nuit
  const [shiftPeriod, setShiftPeriod] = useState<'JOUR' | 'NUIT'>('JOUR');
  const [incomingAgentId, setIncomingAgentId] = useState<string>(
    profiles.find((p) => p.id !== currentProfile.id)?.id ?? currentProfile.id
  );
  const [serialStart, setSerialStart] = useState<number>(100006);
  const [serialEnd, setSerialEnd] = useState<number>(100050);
  const [cashHandedOver, setCashHandedOver] = useState<number>(35000);
  const [handoverSummary, setHandoverSummary] = useState<string>(
    'RAS sur les accès terminaux. Balisage lumineux en place et radio Canal 16 vérifiée.'
  );

  const loadModuleData = async () => {
    const [loadedIncidents, loadedHandovers] = await Promise.all([
      portusRepository.getIncidents(),
      portusRepository.getShiftHandovers(),
    ]);
    setIncidents(loadedIncidents);
    setHandovers(loadedHandovers);
  };

  useEffect(() => {
    void loadModuleData();
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsCoords({
            lat: Number(pos.coords.latitude.toFixed(5)),
            lng: Number(pos.coords.longitude.toFixed(5)),
          });
        },
        () => {
          // Conserve les coordonnées par défaut du secteur Vridi en cas de refus
        },
        {enableHighAccuracy: true, timeout: 4000}
      );
    }
  }, []);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressIncidentPhotoToDataUrl(file);
      setPhotoDataUrl(compressed.dataUrl);
      setPhotoSizeKb(compressed.sizeKb);
    } catch (err) {
      setFeedbackBanner({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Erreur lors de la compression photo.',
      });
    }
  };

  const handleTrigger3TapIncident = async () => {
    setIsSubmitting(true);
    setFeedbackBanner(null);
    try {
      const card =
        INCIDENT_TYPE_CARDS.find((c) => c.type === selectedType) ??
        INCIDENT_TYPE_CARDS[0];
      const title = card.shortTitle;
      const description = customNotes.trim() || card.defaultDescription;

      const payload = {
        p_reported_by: currentProfile.id,
        p_sector_id: sectorId || sectors[0].id,
        p_incident_type: selectedType,
        p_severity: severity,
        p_title: title,
        p_description: description,
        p_truck_plate: truckPlate.trim().toUpperCase() || null,
        p_reported_via_walkie_talkie: reportedViaWalkieTalkie,
        p_walkie_talkie_callsign: walkieCallsign.trim().toUpperCase(),
        p_photo_data_url: photoDataUrl,
        p_photo_size_kb: photoSizeKb,
        p_gps_lat: gpsCoords.lat,
        p_gps_lng: gpsCoords.lng,
      };

      const res = await portusRepository.rpcReportIncident(payload);
      if (!navigator.onLine) {
        await enqueueOfflineMutation({
          id: `INC-${crypto.randomUUID()}`,
          operation: 'REPORT_INCIDENT',
          label: `Incident ${String(res.incident_code)} (${title})`,
          payload: payload as unknown as Record<string, unknown>,
          actor_id: currentProfile.id,
          sector_id: sectorId,
        });
        await syncEngine.refreshState();
      }

      const updatedList = await portusRepository.getIncidents();
      setIncidents(updatedList);
      const created =
        updatedList.find((i) => i.id === res.incident_id) ?? updatedList[0];
      if (created) {
        setLastCreatedIncident(created);
      }

      setCustomNotes('');
      setTruckPlate('');
      setPhotoDataUrl(null);
      setPhotoSizeKb(null);
      setFeedbackBanner({
        type: 'success',
        text: `Alerte sécurité enregistrée — Code Radio : ${String(res.incident_code)}`,
      });
      onDataChanged();
    } catch (err) {
      setFeedbackBanner({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : "Impossible d'enregistrer l'incident.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildEmergencyOfflineGpsMessage = (inc?: Incident | null) => {
    const activeSector =
      sectors.find((s) => s.id === (inc?.sector_id ?? sectorId)) ?? sectors[0];
    const lat = inc?.gps_lat ?? gpsCoords.lat;
    const lng = inc?.gps_lng ?? gpsCoords.lng;
    const code = inc?.incident_code ?? 'INC-URGENT';
    const sev = inc?.severity ?? severity;
    const title =
      inc?.title ??
      INCIDENT_TYPE_CARDS.find((c) => c.type === selectedType)?.shortTitle ??
      'Incident Corridor Vridi';
    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    return `[UJPAS VRIDI SECOURS — ${code}] Niveau: ${sev} | Secteur: ${activeSector?.code} | Motif: ${title}${
      inc?.truck_plate || truckPlate
        ? ` | Camion: ${inc?.truck_plate ?? truckPlate}`
        : ''
    } | Indicatif: ${
      inc?.walkie_talkie_callsign ?? walkieCallsign
    } | Position GPS Hors-Ligne: ${lat}, ${lng} (${mapsUrl})`;
  };

  const activeTrucksInSector = tickets.filter(
    (t) => t.sector_id === sectorId && t.status === 'SEJOUR_ACTIF'
  ).length;
  const pendingRegularizationInSector = tickets.filter(
    (t) =>
      t.sector_id === sectorId && t.status === 'EN_ATTENTE_REGULARISATION'
  ).length;

  const handleRecordShiftHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackBanner(null);
    try {
      const record = await portusRepository.recordShiftHandover({
        sectorId,
        shiftPeriod,
        outgoingAgentId: currentProfile.id,
        incomingAgentId,
        supervisorId:
          profiles.find((p) => p.role === 'RESPONSABLE_SECTEUR')?.id ?? null,
        activeTrucksCount: activeTrucksInSector,
        pendingRegularizationCount: pendingRegularizationInSector,
        remainingTicketsSerialStart: serialStart,
        remainingTicketsSerialEnd: serialEnd,
        cashHandedOverFcfa: cashHandedOver,
        handoverSummary,
      });
      await loadModuleData();
      onDataChanged();
      setFeedbackBanner({
        type: 'success',
        text: `Passation de service (${record.shift_period}) enregistrée avec succès.`,
      });
    } catch (err) {
      setFeedbackBanner({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Erreur lors de la passation de service.',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* En-tête du module Sécurité de Proximité */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div>
          <div className="flex items-center gap-2">
            <Siren className="h-5 w-5 text-red-400" />
            <h2 className="text-lg font-extrabold text-white">
              Sécurité de Proximité & Passation de Quart Jour/Nuit
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Déclaration rapide en 3 taps avec code radio court{' '}
            <span className="font-mono text-amber-300">INC-XXXX</span>, saisie
            Talkie-Walkie, lien GPS hors-ligne SMS/WhatsApp et relève d&apos;équipe.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-slate-950 p-1">
          <button
            type="button"
            onClick={() => setSubTab('INCIDENTS_3TAPS')}
            className={`flex min-h-[40px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition ${
              subTab === 'INCIDENTS_3TAPS'
                ? 'bg-red-500 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <ShieldAlert className="h-4 w-4" />
            <span>Urgence 3 Taps & Radio</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('SHIFT_HANDOVER')}
            className={`flex min-h-[40px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition ${
              subTab === 'SHIFT_HANDOVER'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <ClipboardList className="h-4 w-4" />
            <span>Passation Jour / Nuit ({handovers.length})</span>
          </button>
        </div>
      </div>

      {feedbackBanner && (
        <div
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-xs font-bold ${
            feedbackBanner.type === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
              : 'border-red-500/50 bg-red-500/15 text-red-300'
          }`}
        >
          <span>{feedbackBanner.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="underline"
          >
            Fermer
          </button>
        </div>
      )}

      {subTab === 'INCIDENTS_3TAPS' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Colonne gauche : Déclaration en 3 Taps */}
          <div className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-5 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <span className="text-[11px] font-bold tracking-wider text-red-400 uppercase">
                  Protocole Terrain Rapide
                </span>
                <h3 className="text-base font-extrabold text-white">
                  Signaler un Incident en 3 Taps
                </h3>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 font-mono text-xs text-emerald-400">
                <MapPin className="h-3.5 w-3.5" />
                <span>
                  GPS: {gpsCoords.lat}, {gpsCoords.lng}
                </span>
              </div>
            </div>

            {/* TAP 1 : Catégorie */}
            <div>
              <label className="block text-xs font-extrabold tracking-wide text-amber-400 uppercase">
                TAP 1 — Choisir la catégorie d&apos;incident
              </label>
              <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {INCIDENT_TYPE_CARDS.map((card) => {
                  const active = selectedType === card.type;
                  return (
                    <button
                      key={card.type}
                      type="button"
                      onClick={() => setSelectedType(card.type)}
                      className={`flex min-h-[54px] flex-col justify-center rounded-xl border p-3 text-left transition ${
                        active
                          ? 'border-amber-400 bg-amber-500/15 text-white'
                          : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span className="text-xs font-extrabold">
                        {card.shortTitle}
                      </span>
                      <span className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                        {card.defaultDescription}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* TAP 2 : Niveau d'urgence */}
            <div>
              <label className="block text-xs font-extrabold tracking-wide text-amber-400 uppercase">
                TAP 2 — Niveau de criticité (Bouton URGENT pré-sélectionné)
              </label>
              <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                {(
                  [
                    {
                      level: 'URGENCE_ABSOLUE',
                      label: 'URGENT ABSOLU',
                      style:
                        severity === 'URGENCE_ABSOLUE'
                          ? 'border-red-500 bg-red-600 text-white'
                          : 'border-slate-800 bg-slate-950 text-red-300',
                    },
                    {
                      level: 'CRITIQUE',
                      label: 'CRITIQUE',
                      style:
                        severity === 'CRITIQUE'
                          ? 'border-amber-500 bg-amber-500 text-slate-950'
                          : 'border-slate-800 bg-slate-950 text-amber-300',
                    },
                    {
                      level: 'MODERE',
                      label: 'MODÉRÉ',
                      style:
                        severity === 'MODERE'
                          ? 'border-sky-500 bg-sky-500 text-slate-950'
                          : 'border-slate-800 bg-slate-950 text-sky-300',
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.level}
                    type="button"
                    onClick={() => setSeverity(item.level)}
                    className={`min-h-[48px] rounded-xl border px-3 py-2 text-xs font-black transition ${item.style}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Options Talkie-Walkie + Photo + Plaque (Optionnelles pour garder 3 taps) */}
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2.5 text-xs font-bold text-slate-200">
                  <input
                    type="checkbox"
                    checked={reportedViaWalkieTalkie}
                    onChange={(e) =>
                      setReportedViaWalkieTalkie(e.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-700 accent-amber-500"
                  />
                  <Radio className="h-4 w-4 text-amber-400" />
                  <span>Signalé par talkie-walkie (Canal 16)</span>
                </label>

                {reportedViaWalkieTalkie && (
                  <input
                    type="text"
                    value={walkieCallsign}
                    onChange={(e) => setWalkieCallsign(e.target.value)}
                    placeholder="Indicatif radio (ex: VIGIE-TC1-08)"
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-amber-300"
                  />
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400">
                    Secteur concerné
                  </label>
                  <select
                    value={sectorId}
                    onChange={(e) => setSectorId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
                  >
                    {sectors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400">
                    Plaque camion impliqué (optionnel)
                  </label>
                  <input
                    type="text"
                    value={truckPlate}
                    onChange={(e) =>
                      setTruckPlate(e.target.value.toUpperCase())
                    }
                    placeholder="Ex: BF-4410-KL"
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800">
                  <Camera className="h-4 w-4 text-amber-400" />
                  <span>
                    {photoDataUrl
                      ? `Photo jointe (${photoSizeKb} Ko)`
                      : 'Joindre Photo Preuve (compressée)'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>

                <input
                  type="text"
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  placeholder="Précision terrain optionnelle..."
                  className="min-w-[200px] flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            {/* TAP 3 : Déclenchement immédiat */}
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleTrigger3TapIncident}
              className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white shadow-lg transition hover:bg-red-500 disabled:opacity-50"
            >
              <Siren className="h-5 w-5" />
              <span>
                TAP 3 — DÉCLENCHER L&apos;ALERTE & GÉNÉRER LE CODE RADIO (INC-XXXX)
              </span>
            </button>

            {/* Carte Code Court Radio + Secours SMS / WhatsApp Hors-Ligne */}
            <div className="rounded-xl border border-amber-500/40 bg-slate-950 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-bold text-amber-400 uppercase">
                    Code Court Radio généré pour Canal 16
                  </span>
                  <p className="font-mono text-2xl font-black text-white">
                    {lastCreatedIncident?.incident_code ??
                      incidents[0]?.incident_code ??
                      'INC-8492'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      buildEmergencyOfflineGpsMessage(
                        lastCreatedIncident ?? incidents[0]
                      )
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-[42px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-500"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Secours WhatsApp + GPS</span>
                  </a>

                  <a
                    href={`sms:${settings.support_phone.replace(/\s+/g, '')}?body=${encodeURIComponent(
                      buildEmergencyOfflineGpsMessage(
                        lastCreatedIncident ?? incidents[0]
                      )
                    )}`}
                    className="flex min-h-[42px] items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs font-extrabold text-amber-300 hover:bg-amber-500/25"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>SMS Secours Hors-Ligne</span>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Colonne droite : Fil temps réel des incidents */}
          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5 lg:col-span-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-white">
                Incidents Actifs sur le Corridor ({incidents.length})
              </h3>
              <span className="font-mono text-xs text-amber-400">
                {settings.emergency_radio_channel}
              </span>
            </div>

            <div className="space-y-3">
              {incidents.map((inc) => {
                const sec = sectors.find((s) => s.id === inc.sector_id);
                return (
                  <div
                    key={inc.id}
                    className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded bg-red-500/20 px-2 py-0.5 font-mono text-sm font-black text-red-300">
                        {inc.incident_code}
                      </span>
                      <span className="font-mono text-[11px] font-bold text-amber-400">
                        {inc.severity} · {inc.status}
                      </span>
                    </div>

                    <p className="font-bold text-white">{inc.title}</p>
                    <p className="text-slate-400">{inc.description}</p>

                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
                      <span>Secteur: {sec?.code ?? 'VRD'}</span>
                      {inc.truck_plate && (
                        <span>· Camion: {inc.truck_plate}</span>
                      )}
                      {inc.reported_via_walkie_talkie && (
                        <span className="text-amber-300">
                          · Radio: {inc.walkie_talkie_callsign}
                        </span>
                      )}
                      {inc.gps_lat && inc.gps_lng && (
                        <a
                          href={`https://maps.google.com/?q=${inc.gps_lat},${inc.gps_lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-emerald-400 underline"
                        >
                          <Navigation className="h-3 w-3" />
                          <span>GPS</span>
                        </a>
                      )}
                    </div>

                    {inc.status !== 'RESOLU' && (
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await portusRepository.updateIncidentStatus({
                              incidentId: inc.id,
                              actor: currentProfile,
                              status: 'EN_INTERVENTION',
                            });
                            await loadModuleData();
                          }}
                          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300"
                        >
                          Prendre en charge
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await portusRepository.updateIncidentStatus({
                              incidentId: inc.id,
                              actor: currentProfile,
                              status: 'RESOLU',
                              resolutionNote:
                                'Voie dégagée et sécurisation rétablie par UJPAS.',
                            });
                            await loadModuleData();
                          }}
                          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300"
                        >
                          Marquer Résolu
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {subTab === 'SHIFT_HANDOVER' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Formulaire de Passation Jour / Nuit */}
          <form
            onSubmit={handleRecordShiftHandover}
            className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5 lg:col-span-6"
          >
            <h3 className="text-base font-extrabold text-white">
              Consigner une Passation de Service Jour / Nuit
            </h3>
            <p className="text-xs text-slate-400">
              Assure la continuité opérationnelle entre la brigade sortante et
              la brigade entrante (stocks de carnets, caisse espèces et camions
              en attente de régularisation).
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShiftPeriod('JOUR')}
                className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl border text-xs font-extrabold transition ${
                  shiftPeriod === 'JOUR'
                    ? 'border-amber-400 bg-amber-500 text-slate-950'
                    : 'border-slate-800 bg-slate-950 text-slate-300'
                }`}
              >
                <Sun className="h-4 w-4" />
                <span>QUART DE JOUR (06h–18h)</span>
              </button>

              <button
                type="button"
                onClick={() => setShiftPeriod('NUIT')}
                className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl border text-xs font-extrabold transition ${
                  shiftPeriod === 'NUIT'
                    ? 'border-indigo-400 bg-indigo-600 text-white'
                    : 'border-slate-800 bg-slate-950 text-slate-300'
                }`}
              >
                <Moon className="h-4 w-4" />
                <span>QUART DE NUIT (18h–06h)</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-300">
                  Agent / Chef de Quart Entrant
                </label>
                <select
                  value={incomingAgentId}
                  onChange={(e) => setIncomingAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.callsign})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300">
                  Espèces transmises (FCFA)
                </label>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={cashHandedOver}
                  onChange={(e) =>
                    setCashHandedOver(Number(e.target.value) || 0)
                  }
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300">
                  N° Série Premier Ticket Restant
                </label>
                <input
                  type="number"
                  value={serialStart}
                  onChange={(e) => setSerialStart(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300">
                  N° Série Dernier Ticket Restant
                </label>
                <input
                  type="number"
                  value={serialEnd}
                  onChange={(e) => setSerialEnd(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
              <div>
                <span className="text-slate-400">Camions en séjour actif</span>
                <p className="mt-0.5 font-mono text-lg font-bold text-emerald-400">
                  {activeTrucksInSector}
                </p>
              </div>
              <div>
                <span className="text-slate-400">
                  En attente de régularisation
                </span>
                <p className="mt-0.5 font-mono text-lg font-bold text-amber-400">
                  {pendingRegularizationInSector}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Observations et consignes de passation
              </label>
              <textarea
                rows={3}
                value={handoverSummary}
                onChange={(e) => setHandoverSummary(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-white"
              />
            </div>

            <button
              type="submit"
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-xs font-black text-slate-950 transition hover:bg-amber-400"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>SIGNER ET ENREGISTRER LA PASSATION DE QUART</span>
            </button>
          </form>

          {/* Historique du Journal de Passation */}
          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5 lg:col-span-6">
            <h3 className="text-base font-extrabold text-white">
              Journal Officiel des Passations Jour / Nuit
            </h3>
            <div className="space-y-3">
              {handovers.map((h) => {
                const outgoing = profiles.find(
                  (p) => p.id === h.outgoing_agent_id
                );
                const incoming = profiles.find(
                  (p) => p.id === h.incoming_agent_id
                );
                const sec = sectors.find((s) => s.id === h.sector_id);
                return (
                  <div
                    key={h.id}
                    className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-extrabold text-amber-400">
                        QUART {h.shift_period} · {sec?.code ?? 'VRD-SEC-01'}
                      </span>
                      <span className="text-slate-400">
                        {new Date(h.handed_over_at).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <p className="text-slate-300">
                      Sortant : <strong>{outgoing?.full_name}</strong> →
                      Entrant : <strong>{incoming?.full_name}</strong>
                    </p>
                    <p className="text-slate-400">{h.handover_summary}</p>
                    <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-[11px] text-slate-300">
                      <span>
                        Caisse remise:{' '}
                        {h.cash_handed_over_fcfa.toLocaleString('fr-FR')} FCFA
                      </span>
                      <span>
                        · Tickets: {h.remaining_tickets_serial_start}–
                        {h.remaining_tickets_serial_end}
                      </span>
                      <span className="text-amber-300">
                        · En attente de régularisation:{' '}
                        {h.pending_regularization_count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
