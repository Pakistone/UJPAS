/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PORTUS — UJPAS (Union des Jeunes du Port pour l'Assistance et la Sécurité)
 * Socle Frontend Noyau PWA & Offline-First (Phase 2)
 */

import React, {useEffect, useState, useCallback} from 'react';
import {
  Shield,
  RefreshCw,
  Bell,
  Database,
  KeyRound,
  Wifi,
  WifiOff,
  Radio,
  CheckCircle2,
  Clock,
  Printer,
  Truck,
  ScanLine,
  Siren,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';
import {
  portusRepository,
  setActiveProfileHeader,
  isSupabaseConfigured,
} from './lib/supabase/client';
import {syncEngine, SyncEngineState} from './lib/sync/syncEngine';
import {
  getOrCreateDeviceId,
  saveActiveSession,
  loadActiveSession,
  bindDeviceWithPBKDF2Pin,
} from './lib/auth/security';
import {INITIAL_PROFILES, INITIAL_SECTORS, INITIAL_SETTINGS} from './lib/db';
import {PWAInstallBanner} from './components/PWAInstallBanner';
import {NotificationCenter} from './components/NotificationCenter';
import {SyncQueueScreen} from './components/SyncQueueScreen';
import {AuthAndDevicePanel} from './components/AuthAndDevicePanel';
import {EditiqueAndCryptoPanel} from './components/EditiqueAndCryptoPanel';
import {AgentPercepteurWorkspace} from './components/AgentPercepteurWorkspace';
import {ControleurRoutierWorkspace} from './components/ControleurRoutierWorkspace';
import {SecuriteProximiteWorkspace} from './components/SecuriteProximiteWorkspace';
import {ResponsableSecteurWorkspace} from './components/ResponsableSecteurWorkspace';
import {AdminAuditeurWorkspace} from './components/AdminAuditeurWorkspace';
import {Login} from './components/Login';
import {VerificationPage} from './features/public/VerificationPage';
import type {
  AppSettings,
  Profile,
  Sector,
  Ticket,
  Sale,
} from './types/portus';

type CoreTab =
  | 'AGENT_PERCEPTEUR'
  | 'CONTROLEUR_ROUTIER'
  | 'SECURITE_PROXIMITE'
  | 'RESPONSABLE_SECTEUR'
  | 'ADMIN_AUDITEUR'
  | 'EDITIQUE_CRYPTO'
  | 'VERIFICATION_PUBLIQUE'
  | 'LOGIN_AUTH'
  | 'AUTH_DEVICE'
  | 'SYNC_QUEUE'
  | 'LOCAL_CACHE';

export default function App() {
  const isDirectVerificationUrl =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/v/') ||
      new URLSearchParams(window.location.search).has('v'));

  const directPayload =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/v/')
      ? decodeURIComponent(window.location.pathname.slice(3))
      : typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('v')
        : null;

  const [activeTab, setActiveTab] = useState<CoreTab>(() => {
    if (isDirectVerificationUrl) return 'VERIFICATION_PUBLIQUE';
    return 'AGENT_PERCEPTEUR';
  });
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [profiles, setProfiles] = useState<Profile[]>(INITIAL_PROFILES);
  const [sectors, setSectors] = useState<Sector[]>(INITIAL_SECTORS);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile>(
    INITIAL_PROFILES[3] // Par défaut : Koné Souleymane (AGENT_TERRAIN — VIGIE-TC1-08)
  );
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);

  const [syncState, setSyncState] = useState<SyncEngineState>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    pendingCount: 0,
    failedCount: 0,
    queue: [],
    lastSyncedAt: null,
    lastSyncTrigger: null,
  });

  const refreshCacheOverview = useCallback(
    async (profileOverride?: Profile) => {
      const target = profileOverride ?? currentProfile;
      await portusRepository.init();
      const [
        loadedSettings,
        loadedSectors,
        loadedProfiles,
        loadedTickets,
        loadedSales,
        notifs,
      ] = await Promise.all([
        portusRepository.getSettings(),
        portusRepository.getSectors(),
        portusRepository.getProfiles(),
        portusRepository.getTickets(),
        portusRepository.getSales(),
        portusRepository.getNotificationsForProfile(target),
      ]);

      setSettings(loadedSettings);
      setSectors(loadedSectors);
      setProfiles(loadedProfiles);
      setTickets(loadedTickets);
      setSales(loadedSales);
      setUnreadNotifications(notifs.filter((n) => !n.is_read).length);
    },
    [currentProfile]
  );

  useEffect(() => {
    syncEngine.start();
    const unsubscribe = syncEngine.subscribe((nextState) => {
      setSyncState(nextState);
    });

    void (async () => {
      await portusRepository.init();
      const loadedProfiles = await portusRepository.getProfiles();
      const savedSession = loadActiveSession();
      const initialProfile =
        loadedProfiles.find((p) => p.id === savedSession?.profileId) ??
        loadedProfiles.find((p) => p.role === 'AGENT_TERRAIN') ??
        loadedProfiles[0] ??
        INITIAL_PROFILES[3];

      setCurrentProfile(initialProfile);
      setActiveProfileHeader(initialProfile.id);

      // Lie automatiquement le terminal avec PBKDF2 lors du premier démarrage s'il n'est pas révoqué
      try {
        await bindDeviceWithPBKDF2Pin(initialProfile, initialProfile.pin_hash);
      } catch {
        // Ignore si l'appareil a été manuellement révoqué
      }

      await refreshCacheOverview(initialProfile);
    })();

    return () => {
      unsubscribe();
      syncEngine.stop();
    };
  }, [refreshCacheOverview]);

  const handleSelectProfile = (nextProfile: Profile) => {
    setCurrentProfile(nextProfile);
    setActiveProfileHeader(nextProfile.id);
    saveActiveSession({
      profileId: nextProfile.id,
      matricule: nextProfile.matricule,
      deviceId: getOrCreateDeviceId(),
      authenticatedAt: new Date().toISOString(),
      unlockedOffline: !syncState.isOnline,
    });
    void refreshCacheOverview(nextProfile);
  };

  const currentSector = sectors.find((s) => s.id === currentProfile.sector_id);
  const totalToSync = syncState.queue.length;

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 selection:bg-amber-500 selection:text-slate-950">
      {/* Barre supérieure tactique haute lisibilité plein soleil / nuit */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#090D16]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/50 bg-slate-900 font-mono text-lg font-black text-amber-400">
              P
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-white">
                  PORTUS — UJPAS VRIDI
                </h1>
                <span className="text-xs text-slate-400">
                  · {currentProfile.callsign}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {settings.contribution_label} ·{' '}
                {currentSector ? currentSector.code : ' Supervision Globale'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PWAInstallBanner />

            {/* Bouton direct vers « À synchroniser (N) » */}
            <button
              type="button"
              onClick={() => setActiveTab('SYNC_QUEUE')}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition ${
                totalToSync > 0
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <RefreshCw
                className={`h-4 w-4 ${syncState.isSyncing ? 'animate-spin text-amber-400' : 'text-emerald-400'}`}
              />
              <span>À synchroniser ({totalToSync})</span>
            </button>

            {/* Bouton Centre de Notifications In-App + Web Push VAPID */}
            <button
              type="button"
              onClick={() => setIsNotifDrawerOpen(true)}
              className="relative flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-800"
              aria-label="Ouvrir le Centre de Notifications"
            >
              <Bell className="h-4 w-4 text-amber-400" />
              <span className="hidden sm:inline">Notifications</span>
              {unreadNotifications > 0 && (
                <span className="font-mono text-xs font-extrabold text-amber-400">
                  ({unreadNotifications})
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Bandeau de contexte opérationnel & Navigation du socle Phase 2 */}
        <div className="border-t border-slate-800/80 bg-slate-950/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-400">
              <span className="flex items-center gap-1.5 font-medium text-slate-200">
                {syncState.isOnline ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-amber-400" />
                )}
                {syncState.isOnline
                  ? 'Réseau 4G Corridor Actif'
                  : 'Mode Hors-Ligne IndexedDB'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Adaptateur :{' '}
                <strong className="text-slate-200">
                  {isSupabaseConfigured
                    ? 'Supabase Cloud RPC'
                    : 'Repository Local IndexedDB (Démo)'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1 text-amber-300">
                <Radio className="h-3.5 w-3.5" />
                {settings.emergency_radio_channel}
              </span>
            </div>

            {/* Navigation par onglets fonctionnels */}
            <nav
              aria-label="Navigation du noyau PWA et Offline"
              className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-900 p-1"
            >
              <button
                type="button"
                onClick={() => setActiveTab('AGENT_PERCEPTEUR')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'AGENT_PERCEPTEUR'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Truck className="h-3.5 w-3.5" />
                <span>Agent Percepteur</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('CONTROLEUR_ROUTIER')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'CONTROLEUR_ROUTIER'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <ScanLine className="h-3.5 w-3.5" />
                <span>Contrôleur Routier</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('SECURITE_PROXIMITE')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'SECURITE_PROXIMITE'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Siren className="h-3.5 w-3.5" />
                <span>Sécurité & Passation</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('RESPONSABLE_SECTEUR')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'RESPONSABLE_SECTEUR'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Responsable Secteur</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('ADMIN_AUDITEUR')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'ADMIN_AUDITEUR'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>Admin & Audit</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('EDITIQUE_CRYPTO')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'EDITIQUE_CRYPTO'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Éditique PDF & Ed25519</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('VERIFICATION_PUBLIQUE')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'VERIFICATION_PUBLIQUE'
                    ? 'bg-[#009E60] text-white shadow'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[#FF8200]" />
                <span>Vérification Publique (/v/)</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('LOGIN_AUTH')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'LOGIN_AUTH'
                    ? 'bg-[#009E60] text-white shadow'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5 text-[#FF8200]" />
                <span>Connexion Supabase & PIN</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('AUTH_DEVICE')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'AUTH_DEVICE'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Terminal & Sécurité</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('SYNC_QUEUE')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'SYNC_QUEUE'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>À synchroniser ({totalToSync})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('LOCAL_CACHE')}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === 'LOCAL_CACHE'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Database className="h-3.5 w-3.5" />
                <span>Cache IndexedDB</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Contenu principal */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {activeTab === 'CONTROLEUR_ROUTIER' && (
          <ControleurRoutierWorkspace
            currentProfile={currentProfile}
            profiles={profiles}
            sectors={sectors}
            tickets={tickets}
            sales={sales}
            settings={settings}
            onDataChanged={() => refreshCacheOverview()}
          />
        )}

        {activeTab === 'AGENT_PERCEPTEUR' && (
          <AgentPercepteurWorkspace
            currentProfile={currentProfile}
            profiles={profiles}
            sectors={sectors}
            tickets={tickets}
            sales={sales}
            settings={settings}
            onDataChanged={() => refreshCacheOverview()}
          />
        )}

        {activeTab === 'SECURITE_PROXIMITE' && (
          <SecuriteProximiteWorkspace
            currentProfile={currentProfile}
            profiles={profiles}
            sectors={sectors}
            tickets={tickets}
            settings={settings}
            onDataChanged={() => refreshCacheOverview()}
          />
        )}

        {activeTab === 'RESPONSABLE_SECTEUR' && (
          <ResponsableSecteurWorkspace
            currentProfile={currentProfile}
            profiles={profiles}
            sectors={sectors}
            tickets={tickets}
            sales={sales}
            settings={settings}
            onDataChanged={() => refreshCacheOverview()}
          />
        )}

        {activeTab === 'ADMIN_AUDITEUR' && (
          <AdminAuditeurWorkspace
            currentProfile={currentProfile}
            profiles={profiles}
            sectors={sectors}
            tickets={tickets}
            sales={sales}
            settings={settings}
            onDataChanged={() => refreshCacheOverview()}
          />
        )}

        {activeTab === 'EDITIQUE_CRYPTO' && (
          <EditiqueAndCryptoPanel
            settings={settings}
            sectors={sectors}
            profiles={profiles}
          />
        )}

        {activeTab === 'VERIFICATION_PUBLIQUE' && (
          <VerificationPage
            payload={directPayload}
            onNavigateHome={() => setActiveTab('AGENT_PERCEPTEUR')}
          />
        )}

        {activeTab === 'LOGIN_AUTH' && (
          <Login
            profiles={profiles}
            onLoginSuccess={(authedProfile) => {
              handleSelectProfile(authedProfile);
              setActiveTab('AGENT_PERCEPTEUR');
            }}
          />
        )}

        {activeTab === 'AUTH_DEVICE' && (
          <AuthAndDevicePanel
            profiles={profiles}
            currentProfile={currentProfile}
            onSelectProfile={handleSelectProfile}
          />
        )}

        {activeTab === 'SYNC_QUEUE' && (
          <SyncQueueScreen
            syncState={syncState}
            currentProfile={currentProfile}
            onSyncComplete={() => void refreshCacheOverview()}
          />
        )}

        {activeTab === 'LOCAL_CACHE' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-amber-400" />
                <h2 className="text-base font-bold text-white">
                  Référentiel Local IndexedDB (`portus_ujpas_vridi_db`)
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Données synchronisées localement pour garantir un fonctionnement
                100% hors-ligne sur le corridor portuaire de Vridi.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <span className="text-xs text-slate-400">
                    Secteurs Vridi en cache
                  </span>
                  <p className="mt-1 font-mono text-2xl font-bold text-white">
                    {sectors.length}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <span className="text-xs text-slate-400">
                    Profils & Indicatifs Radio
                  </span>
                  <p className="mt-1 font-mono text-2xl font-bold text-white">
                    {profiles.length}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <span className="text-xs text-slate-400">
                    Tickets pré-signés Ed25519
                  </span>
                  <p className="mt-1 font-mono text-2xl font-bold text-amber-400">
                    {tickets.length}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <span className="text-xs text-slate-400">
                    Perceptions enregistrées
                  </span>
                  <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">
                    {sales.length}
                  </p>
                </div>
              </div>
            </div>

            {/* Table des tickets en cache local */}
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-sm font-bold text-white">
                Tickets pré-signés Ed25519 disponibles dans IndexedDB
              </h3>
              <div className="mt-3 space-y-2.5">
                {tickets.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-amber-400">
                        {t.ticket_number}
                      </span>
                      <span className="mx-2 text-slate-600">·</span>
                      <span className="text-slate-300">
                        Contribution d&apos;Assistance et de Sécurisation :{' '}
                        <strong>{t.contribution_amount_fcfa} FCFA</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      {t.status === 'SEJOUR_ACTIF' ? (
                        <span className="flex items-center gap-1 font-semibold text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Séjour actif
                        </span>
                      ) : t.status === 'EN_ATTENTE_REGULARISATION' ? (
                        <span className="flex items-center gap-1 font-semibold text-amber-400">
                          <Clock className="h-3.5 w-3.5" />
                          En attente de régularisation
                        </span>
                      ) : (
                        <span className="font-mono text-slate-300">
                          Statut : {t.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Centre de Notifications In-App & Web Push VAPID */}
      <NotificationCenter
        currentProfile={currentProfile}
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
        onUnreadCountChange={setUnreadNotifications}
      />
    </div>
  );
}
