/**
 * PORTUS — Écran « À synchroniser (N) »
 *
 * Permet à l'agent ou au superviseur d'inspecter la file d'attente `mutation_queue` IndexedDB,
 * de voir l'état du backoff exponentiel, de forcer la synchronisation immédiate lors du retour
 * du réseau 4G sur Vridi, ou d'éprouver le moteur en générant une mutation hors-ligne réelle.
 */

import React, {useState} from 'react';
import {
  RefreshCw,
  CloudOff,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Play,
  PlusCircle,
  Clock,
} from 'lucide-react';
import {syncEngine, SyncEngineState} from '../lib/sync/syncEngine';
import {portusRepository} from '../lib/supabase/client';
import type {Profile} from '../types/portus';

interface SyncQueueScreenProps {
  syncState: SyncEngineState;
  currentProfile: Profile;
  onSyncComplete: () => void;
}

export const SyncQueueScreen: React.FC<SyncQueueScreenProps> = ({
  syncState,
  currentProfile,
  onSyncComplete,
}) => {
  const [testPlate, setTestPlate] = useState('CI-8842-GT');
  const [testTicket, setTestTicket] = useState('UJPAS-VRD01-100001');
  const [queueFeedback, setQueueFeedback] = useState<string | null>(null);

  const handleFlushAllNow = async () => {
    setQueueFeedback(null);
    const res = await syncEngine.flushDueMutations('MANUAL', true);
    setQueueFeedback(
      `Synchronisation exécutée : ${res.synced} mutation(s) validée(s), ${res.failed} en attente de retry.`
    );
    onSyncComplete();
  };

  const handleEnqueueOfflineSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setQueueFeedback(null);

    if (!currentProfile.peut_vendre) {
      setQueueFeedback(
        "HABILITATION REFUSÉE : Ce profil n'a pas la permission `peut_vendre` pour percevoir la Contribution d'Assistance et de Sécurisation."
      );
      return;
    }

    const tickets = await portusRepository.getTickets();
    const availableTicket =
      tickets.find(
        (t) =>
          t.ticket_number === testTicket.trim().toUpperCase() &&
          ['IMPRIME', 'ASSIGNE_SECTEUR', 'ASSIGNE_AGENT'].includes(t.status)
      ) ??
      tickets.find((t) =>
        ['IMPRIME', 'ASSIGNE_SECTEUR', 'ASSIGNE_AGENT'].includes(t.status)
      );

    const chosenTicketNumber =
      availableTicket?.ticket_number ?? testTicket.trim().toUpperCase();

    const item = await syncEngine.enqueueMutation({
      operation: 'SYNC_SALE',
      label: `Perception Contribution d'Assistance — Camion ${testPlate.trim().toUpperCase()} (${chosenTicketNumber})`,
      payload: {
        p_ticket_number: chosenTicketNumber,
        p_agent_id: currentProfile.id,
        p_truck_plate: testPlate.trim().toUpperCase(),
        p_country_origin: 'CI',
        p_payment_method: 'ESPECES',
        p_sold_at: new Date().toISOString(),
        p_gps_lat: 5.2594,
        p_gps_lng: -4.0128,
        p_offline_created: true,
      },
      actor_id: currentProfile.id,
      sector_id: currentProfile.sector_id,
      forceOfflineQueue: true, // Conserve dans `mutation_queue` pour inspection dans « À synchroniser (N) »
    });

    setQueueFeedback(
      `Mutation ${item.id} enregistrée dans IndexedDB (mutation_queue). Cliquez sur « Synchroniser maintenant » ou revenez au premier plan pour déclencher le RPC sync_sale.`
    );
  };

  const totalInQueue = syncState.queue.length;

  return (
    <div className="space-y-6">
      {/* En-tête de l'écran À synchroniser (N) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">
              À synchroniser ({totalInQueue})
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              File d&apos;attente IndexedDB (`mutation_queue`) · Déclenchement
              automatique sur événements <code className="text-amber-300">online</code>{' '}
              et <code className="text-amber-300">visibilitychange</code> (iOS /
              Android) · Retry exponentiel avec idempotence.
            </p>
          </div>

          <button
            type="button"
            disabled={syncState.isSyncing || totalInQueue === 0}
            onClick={handleFlushAllNow}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw
              className={`h-4 w-4 ${syncState.isSyncing ? 'animate-spin' : ''}`}
            />
            <span>
              {syncState.isSyncing
                ? 'Synchronisation en cours…'
                : `Synchroniser maintenant (${totalInQueue})`}
            </span>
          </button>
        </div>

        {/* Métadonnées de télémétrie réseau (texte pur sans pills) */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3 text-xs text-slate-400">
          <span>
            Réseau :{' '}
            <strong
              className={
                syncState.isOnline ? 'text-emerald-400' : 'text-amber-400'
              }
            >
              {syncState.isOnline ? 'En ligne (4G Vridi)' : 'Hors-ligne'}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            En attente :{' '}
            <strong className="text-white">{syncState.pendingCount}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            En échec / Retry :{' '}
            <strong className="text-rose-400">{syncState.failedCount}</strong>
          </span>
          {syncState.lastSyncedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Dernière synchro :{' '}
                {new Date(syncState.lastSyncedAt).toLocaleTimeString('fr-FR')}
              </span>
            </>
          )}
        </div>

        {queueFeedback && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
            {queueFeedback}
          </div>
        )}
      </div>

      {/* Formulaire de mise en file hors-ligne pour tester la résilience terrain */}
      <form
        onSubmit={handleEnqueueOfflineSale}
        className="rounded-xl border border-slate-800 bg-slate-900/70 p-5"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <PlusCircle className="h-4 w-4 text-amber-400" />
          <h3>
            Enregistrer une perception hors-ligne dans `mutation_queue` (Test
            Idempotence & Sync)
          </h3>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Simule la saisie d&apos;une Contribution d&apos;Assistance et de
          Sécurisation en zone blanche sous les portiques TC1/TC2 avant retour
          de la 4G.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label
              htmlFor="offline-ticket-input"
              className="block text-xs font-semibold text-slate-300"
            >
              N° Ticket pré-signé Ed25519
            </label>
            <input
              id="offline-ticket-input"
              type="text"
              value={testTicket}
              onChange={(e) => setTestTicket(e.target.value)}
              required
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="offline-plate-input"
              className="block text-xs font-semibold text-slate-300"
            >
              Plaque Camion (Tracteur)
            </label>
            <input
              id="offline-plate-input"
              type="text"
              value={testPlate}
              onChange={(e) => setTestPlate(e.target.value)}
              required
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white uppercase focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-2 text-xs font-bold text-amber-300 transition hover:bg-amber-500/25"
            >
              <CloudOff className="h-4 w-4" />
              <span>Placer en file hors-ligne</span>
            </button>
          </div>
        </div>
      </form>

      {/* Liste détaillée des mutations */}
      <div className="space-y-3">
        {syncState.queue.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />
            <h3 className="mt-2 text-sm font-bold text-white">
              File de synchronisation vide (0 opération en attente)
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Toutes les perceptions de Contribution d&apos;Assistance et de
              Sécurisation et les contrôles routiers sont synchronisés.
            </p>
          </div>
        ) : (
          syncState.queue.map((item) => {
            const retrySeconds = Math.max(
              0,
              Math.ceil((item.next_retry_at - Date.now()) / 1000)
            );
            return (
              <div
                key={item.id}
                className="rounded-xl border border-slate-800 bg-slate-900 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono font-semibold text-amber-400">
                        {item.operation}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{item.id}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Tentatives : {item.attempts}/{item.max_attempts}
                      </span>
                    </div>
                    <h4 className="mt-1 text-sm font-bold text-white">
                      {item.label}
                    </h4>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void syncEngine.retrySingleItemNow(item.id)}
                      className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Synchroniser</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void syncEngine.discardMutationItem(item.id)
                      }
                      className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-rose-500/20 hover:text-rose-300"
                      title="Retirer de la file"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {item.last_error && (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                    <span>
                      Erreur : {item.last_error} — Prochain essai exponentiel
                      dans {retrySeconds}s
                    </span>
                  </div>
                )}

                {!item.last_error && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                    <span>
                      Créé à{' '}
                      {new Date(item.created_at).toLocaleTimeString('fr-FR')} ·
                      Prêt pour envoi RPC idempotent
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
