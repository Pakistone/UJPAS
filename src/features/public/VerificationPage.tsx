/**
 * PORTUS — Page Publique de Vérification de Ticket & Badge (`src/features/public/VerificationPage.tsx`)
 *
 * Route accessible sans authentification : `/v/:payload`
 *
 * Spécifications Phase 3 :
 * 1. Palette officielle de la République de Côte d'Ivoire :
 *    - Orange : #FF8200
 *    - Blanc  : #FFFFFF
 *    - Vert   : #009E60
 * 2. Vérification cryptographique Ed25519 100% locale et hors-ligne :
 *    - Supporte les tickets `P1.<kid>.<ticket_number>.<epoch>.<sig>`
 *    - Supporte les badges `P1B.<kid>.<badge_no>.<epoch>.<sig>`
 * 3. Si signature valide :
 *    - Affiche en vert éclatant « Support Authentique UJPAS » avec le sceau officiel.
 * 4. Statut d'enregistrement et protection des agents terrain hors-ligne :
 *    - Si le ticket est `AVAILABLE`, `ASSIGNED`, ou non encore synchronisé :
 *      Affiche le message rassurant en bleu :
 *      « Ticket officiel — Synchronisation de la vente en cours »
 *      afin de protéger l'agent de terrain qui perçoit les droits sans 4G immédiate.
 *    - Si le ticket est `SOLD` : Affiche les informations de validité du séjour (24h).
 */

import React, {useState, useEffect, useMemo} from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Truck,
  Calendar,
  Phone,
  Radio,
  FileCheck2,
  Search,
  ExternalLink,
  ChevronRight,
  Info,
  QrCode,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import {
  verifyTicketQrPayloadP1,
  verifyBadgeQrPayloadP1B,
  formatTicketNumberWithCheckDigit,
  TicketVerificationResultP1,
  BadgeVerificationResultP1B,
} from '../../lib/crypto/ed25519';
import {portusRepository} from '../../lib/supabase/client';
import {UJPAS_LOGO_BASE64} from '../../lib/pdf/assets';
import type {Ticket, Sale, AppSettings} from '../../types/portus';
import {INITIAL_SETTINGS} from '../../lib/db';

interface VerificationPageProps {
  payload?: string | null;
  onNavigateHome?: () => void;
}

export const VerificationPage: React.FC<VerificationPageProps> = ({
  payload: initialPayload,
  onNavigateHome,
}) => {
  const [rawInput, setRawInput] = useState<string>(() => {
    if (initialPayload && initialPayload.trim().length > 0) {
      return initialPayload.trim();
    }
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path.startsWith('/v/')) {
        return decodeURIComponent(path.slice(3));
      }
      const params = new URLSearchParams(window.location.search);
      const queryPayload = params.get('v') || params.get('payload');
      if (queryPayload) return queryPayload;
    }
    return '';
  });

  const [activePayload, setActivePayload] = useState<string>(rawInput);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);

  const [ticketResult, setTicketResult] = useState<TicketVerificationResultP1 | null>(null);
  const [badgeResult, setBadgeResult] = useState<BadgeVerificationResultP1B | null>(null);
  const [dbTicket, setDbTicket] = useState<Ticket | null>(null);
  const [dbSale, setDbSale] = useState<Sale | null>(null);
  const [copied, setCopied] = useState(false);

  // Charger les paramètres de configuration UJPAS
  useEffect(() => {
    void (async () => {
      try {
        await portusRepository.init();
        const s = await portusRepository.getSettings();
        setSettings(s);
      } catch {
        // Paramètres de repli
      }
    })();
  }, []);

  // Déclencher la vérification à chaque mise à jour du payload actif
  useEffect(() => {
    if (!activePayload || activePayload.trim().length < 5) {
      setTicketResult(null);
      setBadgeResult(null);
      setDbTicket(null);
      setDbSale(null);
      return;
    }

    let isMounted = true;
    setIsVerifying(true);

    void (async () => {
      const clean = activePayload.trim();

      // Détecter si c'est un badge ou un ticket
      const isBadge = clean.startsWith('P1B');
      if (isBadge) {
        const bRes = await verifyBadgeQrPayloadP1B(clean);
        if (!isMounted) return;
        setBadgeResult(bRes);
        setTicketResult(null);
        setDbTicket(null);
        setDbSale(null);
        setIsVerifying(false);
        return;
      }

      // Traiter comme un ticket
      const tRes = await verifyTicketQrPayloadP1(clean);
      if (!isMounted) return;
      setTicketResult(tRes);
      setBadgeResult(null);

      if (tRes.isValidSyntax && tRes.parsed) {
        try {
          await portusRepository.init();
          const tickets = await portusRepository.getTickets();
          const matched = tickets.find(
            (t) =>
              t.ticket_number.toUpperCase() === tRes.parsed?.ticketNumber.toUpperCase()
          );

          if (matched) {
            setDbTicket(matched);
            if (matched.status === 'SOLD') {
              const sales = await portusRepository.getSales();
              const matchedSale = sales.find((s) => s.ticket_id === matched.id);
              setDbSale(matchedSale ?? null);
            } else {
              setDbSale(null);
            }
          } else {
            setDbTicket(null);
            setDbSale(null);
          }
        } catch {
          // Hors ligne
        }
      }

      setIsVerifying(false);
    })();

    return () => {
      isMounted = false;
    };
  }, [activePayload]);

  const handleCopyPayload = () => {
    if (!activePayload) return;
    void navigator.clipboard.writeText(activePayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Calcul du séjour pour un ticket vendu
  const stayStatus = useMemo(() => {
    if (!dbSale) return null;
    const soldAt = new Date(dbSale.sold_at).getTime();
    const durationHours = 24;
    const expiresAt = soldAt + durationHours * 3600 * 1000;
    const now = Date.now();
    const isStillActive = now <= expiresAt;
    const remainingHours = Math.max(0, Math.floor((expiresAt - now) / (3600 * 1000)));
    const remainingMinutes = Math.max(0, Math.floor(((expiresAt - now) % (3600 * 1000)) / (60 * 1000)));

    return {
      isStillActive,
      expiresAt: new Date(expiresAt).toLocaleString('fr-FR'),
      remainingText: isStillActive
        ? `${remainingHours}h ${remainingMinutes}min restantes`
        : 'Séjour de 24h dépassé — En attente de régularisation',
    };
  }, [dbSale]);

  return (
    <div className="min-h-screen bg-[#070B12] text-slate-100 selection:bg-[#FF8200] selection:text-slate-950 font-sans">
      {/* Bandeau Tricolore République de Côte d'Ivoire (Orange - Blanc - Vert) */}
      <div className="h-2 w-full grid grid-cols-3">
        <div className="bg-[#FF8200]" />
        <div className="bg-[#FFFFFF]" />
        <div className="bg-[#009E60]" />
      </div>

      {/* Header institutionnel */}
      <header className="border-b border-slate-800 bg-[#0A101D]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            {UJPAS_LOGO_BASE64 ? (
              <img
                src={UJPAS_LOGO_BASE64}
                alt="UJPAS Logo"
                className="h-10 w-10 object-contain rounded-lg border border-slate-700 bg-slate-900 p-1"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[#FF8200] bg-slate-900 font-mono text-lg font-black text-[#FF8200] shadow-md shadow-[#FF8200]/10">
                UJ
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-wider text-[#FF8200] uppercase">
                  RÉPUBLIQUE DE CÔTE D'IVOIRE
                </span>
              </div>
              <h1 className="text-base font-extrabold text-white tracking-tight">
                Port Autonome d'Abidjan — UJPAS Vridi
              </h1>
              <p className="text-[11px] text-slate-400">
                Portail Officiel d'Authentification Cryptographique Ed25519
              </p>
            </div>
          </div>

          {onNavigateHome && (
            <button
              type="button"
              onClick={onNavigateHome}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
            >
              <span>Accès Espace Agent</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* Corps principal */}
      <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
        {/* Zone de saisie / scan si l'utilisateur arrive sans payload URL */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-[#FF8200]" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Vérification du Payload QR Code
              </h2>
            </div>
            {activePayload && (
              <button
                type="button"
                onClick={handleCopyPayload}
                className="flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 transition"
                title="Copier le payload"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-semibold">Copié</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-slate-400" />
                    <span>Copier</span>
                  </>
                )}
              </button>
            )}
          </div>

          <p className="mt-1 text-xs text-slate-400">
            Scannez le QR Code présent sur le ticket physique ou le badge professionnel UJPAS,
            ou collez ci-dessous la chaîne brute signée.
          </p>

          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Ex: P1.k1.VRD-000101.1713580800.7f8a..."
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-amber-300 placeholder-slate-600 focus:border-[#FF8200] focus:outline-none focus:ring-1 focus:ring-[#FF8200]"
            />
            <button
              type="button"
              onClick={() => setActivePayload(rawInput)}
              disabled={isVerifying}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FF8200] to-[#E67300] px-5 py-2 text-xs font-bold text-slate-950 shadow-md hover:brightness-110 active:scale-98 transition disabled:opacity-50"
            >
              {isVerifying ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span>Vérifier l'Authenticité</span>
            </button>
          </div>
        </section>

        {/* ÉTAT 1 : CHARGEMENT EN COURS */}
        {isVerifying && (
          <div className="flex flex-col items-center justify-center py-12 rounded-2xl border border-slate-800 bg-slate-900/40">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div className="absolute h-full w-full animate-ping rounded-full bg-[#009E60]/20" />
              <RefreshCw className="h-8 w-8 animate-spin text-[#009E60]" />
            </div>
            <p className="mt-4 text-sm font-bold text-slate-200">
              Vérification cryptographique Ed25519 en cours...
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Calcul mathématique local de la signature RFC 8032
            </p>
          </div>
        )}

        {/* ÉTAT 2 : TICKET VALIDE */}
        {!isVerifying && ticketResult && ticketResult.isValidSyntax && (
          <div className="space-y-5 animate-in fade-in duration-300">
            {ticketResult.isSignatureVerified ? (
              <>
                {/* 1. CARTOUCHE VERT : SUPPORT AUTHENTIQUE UJPAS */}
                <div className="rounded-2xl border-2 border-[#009E60] bg-[#009E60]/10 p-6 shadow-xl backdrop-blur-md">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#009E60] text-white shadow-lg shadow-[#009E60]/30">
                        <ShieldCheck className="h-8 w-8" />
                      </div>
                      <div>
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#009E60]/20 border border-[#009E60]/40 px-3 py-0.5 text-xs font-black text-[#009E60] uppercase tracking-wide">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Signature Cryptographique Certifiée
                        </div>
                        <h2 className="mt-1 text-2xl font-black text-white tracking-tight">
                          Support Authentique UJPAS
                        </h2>
                        <p className="text-xs text-emerald-200 font-medium mt-0.5">
                          Ce ticket a été émis de manière infalsifiable par le système central UJPAS
                          du Corridor Portuaire de Vridi (Abidjan).
                        </p>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 border-slate-700/60 pt-3 sm:pt-0">
                      <span className="text-[11px] font-bold text-slate-400 uppercase">
                        Clé Publique
                      </span>
                      <span className="font-mono text-xs font-extrabold text-[#009E60]">
                        KID: {ticketResult.parsed?.kid.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. STATUT D'ENREGISTREMENT & MESSAGE BLEU DE PROTECTION DE L'AGENT */}
                {(!dbTicket || dbTicket.status === 'AVAILABLE' || dbTicket.status === 'ASSIGNED') ? (
                  <div className="rounded-2xl border border-sky-500/40 bg-sky-950/40 p-5 shadow-lg backdrop-blur-sm">
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
                        <Clock className="h-5 w-5 animate-pulse" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2 w-2 rounded-full bg-sky-400 animate-ping" />
                          <h3 className="text-base font-bold text-sky-200">
                            Ticket officiel — Synchronisation de la vente en cours
                          </h3>
                        </div>
                        <p className="mt-1 text-xs text-sky-100/90 leading-relaxed">
                          Le support physique et sa signature Ed25519 sont 100% authentiques.
                          L'agent de terrain opère actuellement en zone portuaire sous couverture
                          réseau intermittente. La transaction manuscrite portée sur le ticket
                          fait foi et sera télétransmise dès la prochaine connexion de son terminal.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-mono text-sky-300">
                          <span>Statut support : {dbTicket ? dbTicket.status : 'EMIS_AUTHENTIFIE'}</span>
                          <span>•</span>
                          <span>Perception terrain protégée</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : dbTicket.status === 'SOLD' ? (
                  /* TICKET VENDU ET SYNCHRONISÉ */
                  <div className="rounded-2xl border border-emerald-500/40 bg-slate-900/90 p-5 shadow-lg space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <Truck className="h-5 w-5 text-[#FF8200]" />
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                          Séjour Camion Enregistré & Validé
                        </h3>
                      </div>
                      <span className="rounded-md bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-xs font-black text-emerald-300">
                        VENTE CONFIRMÉE
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                        <span className="text-[11px] text-slate-400 uppercase font-semibold">
                          Immatriculation Camion
                        </span>
                        <p className="mt-1 font-mono text-lg font-black text-amber-400">
                          {dbSale?.truck_plate || 'ENREGISTRÉE'}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                        <span className="text-[11px] text-slate-400 uppercase font-semibold">
                          Montant de la Contribution
                        </span>
                        <p className="mt-1 font-mono text-lg font-black text-white">
                          {dbSale?.contribution_amount_fcfa ?? settings.default_contribution_fcfa} FCFA
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                        <span className="text-[11px] text-slate-400 uppercase font-semibold">
                          Validité du Séjour (24h)
                        </span>
                        <p className={`mt-1 text-xs font-bold ${stayStatus?.isStillActive ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {stayStatus?.remainingText || '24h autorisées'}
                        </p>
                        {stayStatus?.expiresAt && (
                          <span className="text-[10px] text-slate-500 font-mono">
                            Jusqu'au {stayStatus.expiresAt}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* STATUT ANNULÉ OU FERMÉ */
                  <div className="rounded-2xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-amber-200">
                    <div className="flex items-center gap-2 font-bold text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                      <span>Statut particulier du ticket en base : {dbTicket.status}</span>
                    </div>
                    <p className="mt-1 text-slate-300">
                      Ce ticket a fait l'objet d'un statut particulier (clôture de séjour ou régularisation).
                    </p>
                  </div>
                )}

                {/* 3. DÉTAILS TECHNIQUES DE L'ÉPREUVE CRYPTOGRAPHIQUE */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Certificat Technique de l'Épreuve
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg bg-slate-950/80 p-3 border border-slate-800/80">
                      <span className="text-slate-500">Numéro de Ticket</span>
                      <p className="font-mono text-sm font-bold text-white mt-0.5">
                        {ticketResult.parsed?.ticketNumber}
                        {ticketResult.parsed?.checkDigit && (
                          <span className="text-emerald-400 ml-1.5 text-xs">
                            [Chiffre Ctrl : {ticketResult.parsed.checkDigit}]
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="rounded-lg bg-slate-950/80 p-3 border border-slate-800/80">
                      <span className="text-slate-500">Algorithme & Norme</span>
                      <p className="font-mono text-sm font-bold text-emerald-400 mt-0.5">
                        Ed25519 (RFC 8032)
                      </p>
                    </div>

                    <div className="rounded-lg bg-slate-950/80 p-3 border border-slate-800/80 col-span-1 sm:col-span-2">
                      <span className="text-slate-500">Empreinte Signature (128 hex)</span>
                      <p className="font-mono text-[11px] text-slate-300 break-all mt-0.5">
                        {ticketResult.parsed?.signatureHex}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* SIGNATURE INVALIDE : TICKET FALSIFIÉ OU ALTÉRÉ */
              <div className="rounded-2xl border-2 border-rose-600 bg-rose-950/40 p-6 shadow-2xl backdrop-blur-md">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-lg shadow-rose-600/30">
                    <ShieldAlert className="h-8 w-8" />
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 border border-rose-500/40 px-3 py-0.5 text-xs font-black text-rose-400 uppercase tracking-wide">
                      Alerte Sécurité — Falsification Détectée
                    </span>
                    <h2 className="mt-1 text-2xl font-black text-white tracking-tight">
                      Support Non Authentique ou Altéré
                    </h2>
                    <p className="mt-1 text-xs text-rose-200 leading-relaxed">
                      La signature cryptographique Ed25519 ne correspond pas à la clé privée officielle de
                      l'UJPAS. Ce ticket ne doit pas être accepté sur le corridor.
                    </p>
                    <div className="mt-4 rounded-xl border border-rose-800/60 bg-rose-950/60 p-3 text-xs text-rose-300">
                      <strong>Motif de rejet :</strong> {ticketResult.errorReason || 'Signature invalide'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ÉTAT 3 : BADGE PROFESSIONNEL VALIDE */}
        {!isVerifying && badgeResult && badgeResult.isValidSyntax && (
          <div className="space-y-5 animate-in fade-in duration-300">
            {badgeResult.isSignatureVerified ? (
              <div className="rounded-2xl border-2 border-[#009E60] bg-[#009E60]/10 p-6 shadow-xl backdrop-blur-md">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#009E60] text-white shadow-lg shadow-[#009E60]/30">
                    <ShieldCheck className="h-8 w-8" />
                  </div>
                  <div className="flex-1">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#009E60]/20 border border-[#009E60]/40 px-3 py-0.5 text-xs font-black text-[#009E60] uppercase tracking-wide">
                      Badge Professionnel Certifié
                    </span>
                    <h2 className="mt-1 text-2xl font-black text-white tracking-tight">
                      Badge UJPAS Authentique
                    </h2>
                    <p className="text-xs text-emerald-200 mt-1">
                      Agent ou responsable officiellement assermenté pour le Corridor Portuaire de Vridi.
                    </p>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl bg-slate-950/80 p-3 border border-slate-800">
                        <span className="text-slate-400">Numéro de Badge</span>
                        <p className="font-mono text-base font-bold text-white mt-0.5">
                          {badgeResult.parsed?.badgeNumber}
                        </p>
                      </div>

                      <div className="rounded-xl bg-slate-950/80 p-3 border border-slate-800">
                        <span className="text-slate-400">Identifiant de Clé</span>
                        <p className="font-mono text-base font-bold text-[#009E60] mt-0.5">
                          KID: {badgeResult.parsed?.kid.toUpperCase()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-rose-600 bg-rose-950/40 p-6 shadow-xl">
                <div className="flex items-start gap-4">
                  <ShieldAlert className="h-10 w-10 text-rose-500 shrink-0" />
                  <div>
                    <h3 className="text-lg font-bold text-white">Badge Non Authentique</h3>
                    <p className="text-xs text-rose-200 mt-1">
                      {badgeResult.errorReason || 'Signature cryptographique Ed25519 rejetée.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ÉTAT 4 : SYNTAXE NON RECONNUE */}
        {!isVerifying && activePayload && !ticketResult?.isValidSyntax && !badgeResult?.isValidSyntax && (
          <div className="rounded-2xl border border-amber-600/40 bg-amber-950/30 p-6 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto" />
            <h3 className="text-base font-bold text-white">
              Format de QR Code Non Reconnu
            </h3>
            <p className="text-xs text-slate-300 max-w-md mx-auto">
              Le contenu analysé ne respecte pas les protocoles cryptographiques officiels de l'UJPAS
              (format attendu : <code className="text-amber-400">P1.&lt;kid&gt;.&lt;ticket&gt;.&lt;epoch&gt;.&lt;sig&gt;</code>).
            </p>
          </div>
        )}

        {/* Informations d'assistance et contacts d'urgence */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 text-xs text-slate-400">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-slate-200 text-sm">
                Assistance & Contrôle Routier UJPAS Vridi
              </h4>
              <p className="mt-0.5">
                En cas de contestation ou de doute sur la validité d'un ticket, contactez le poste central.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-white font-mono font-bold">
                <Phone className="h-3.5 w-3.5 text-[#FF8200]" />
                <span>{settings.support_phone}</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-white font-mono font-bold">
                <Radio className="h-3.5 w-3.5 text-[#009E60]" />
                <span>{settings.emergency_radio_channel}</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Pied de page */}
      <footer className="border-t border-slate-800/80 bg-slate-950/90 py-6 text-center text-xs text-slate-500">
        <p>
          © {new Date().getFullYear()} UJPAS — Union des Jeunes du Port pour l'Assistance et la Sécurité.
        </p>
        <p className="mt-1 text-[11px] text-slate-600">
          Corridor Portuaire de Vridi · Port Autonome d'Abidjan · République de Côte d'Ivoire
        </p>
      </footer>
    </div>
  );
};
