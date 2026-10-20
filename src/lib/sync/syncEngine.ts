/**
 * PORTUS — Moteur de Synchronisation Automatique Offline-First (`syncEngine.ts`)
 *
 * Caractéristiques :
 * 1. Déclenchement automatique sur :
 *    - événement `online` (retour de la couverture 4G sur le corridor de Vridi)
 *    - événement `visibilitychange` (retour au premier plan sur iOS Safari & Android)
 *    - cycle périodique léger pour les éléments dont `next_retry_at` est atteint
 * 2. Backoff exponentiel avec jitter (`2^attempts * 1500ms`, plafonné à 5 minutes)
 * 3. Idempotence garantie par `idempotency_key` transmis aux RPC (`sync_sale`, etc.)
 * 4. Bus d'événements réactif pour alimenter l'écran « À synchroniser (N) » en temps réel
 */

import {
  enqueueOfflineMutation,
  getAllMutationQueueItems,
  getPendingMutationsDue,
  updateMutationItem,
  removeMutationItem,
  resetFailedMutationForImmediateRetry,
} from '../db';
import {
  portusRepository,
  SyncSaleParams,
  VerifyTicketParams,
  DeclareExitParams,
  ConfirmMobilePaymentParams,
  ReportIncidentParams,
  AckNotificationParams,
} from '../supabase/client';
import type {MutationOperationType, MutationQueueItem} from '../../types/portus';

export interface SyncEngineState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  queue: MutationQueueItem[];
  lastSyncedAt: string | null;
  lastSyncTrigger: 'INIT' | 'ONLINE_EVENT' | 'VISIBILITY_CHANGE' | 'MANUAL' | 'ENQUEUE' | null;
}

type SyncStateListener = (state: SyncEngineState) => void;

const BASE_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export function computeExponentialBackoffMs(attempts: number): number {
  const exp = Math.min(attempts, 8);
  const raw = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, exp));
  const jitter = Math.floor(Math.random() * 450);
  return raw + jitter;
}

class PortusSyncEngine {
  private listeners = new Set<SyncStateListener>();
  private isSyncing = false;
  private lastSyncedAt: string | null = null;
  private lastSyncTrigger: SyncEngineState['lastSyncTrigger'] = null;
  private started = false;
  private intervalId: number | null = null;

  public start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // Vérification périodique légère toutes les 12 secondes pour les retries programmés
    this.intervalId = window.setInterval(() => {
      if (navigator.onLine && !this.isSyncing) {
        void this.flushDueMutations('INIT');
      }
    }, 12000);

    void this.notifyListeners();
    if (navigator.onLine) {
      void this.flushDueMutations('INIT');
    }
  }

  public stop(): void {
    if (!this.started || typeof window === 'undefined') return;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.started = false;
  }

  private handleOnline = (): void => {
    this.lastSyncTrigger = 'ONLINE_EVENT';
    void this.notifyListeners();
    void this.flushDueMutations('ONLINE_EVENT');
  };

  private handleOffline = (): void => {
    void this.notifyListeners();
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.lastSyncTrigger = 'VISIBILITY_CHANGE';
      void this.notifyListeners();
      if (navigator.onLine) {
        void this.flushDueMutations('VISIBILITY_CHANGE');
      }
    }
  };

  public subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    void this.getState().then(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async refreshState(): Promise<SyncEngineState> {
    await this.notifyListeners();
    return this.getState();
  }

  public async getState(): Promise<SyncEngineState> {
    const queue = await getAllMutationQueueItems();
    const pendingCount = queue.filter(
      (i) => i.status === 'PENDING' || i.status === 'SYNCING'
    ).length;
    const failedCount = queue.filter(
      (i) => i.status === 'FAILED' || i.status === 'DEAD_LETTER'
    ).length;

    return {
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isSyncing: this.isSyncing,
      pendingCount,
      failedCount,
      queue,
      lastSyncedAt: this.lastSyncedAt,
      lastSyncTrigger: this.lastSyncTrigger,
    };
  }

  private async notifyListeners(): Promise<void> {
    const state = await this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  /**
   * Ajoute une opération métier à la file `mutation_queue`.
   * Si le terminal est en ligne, tente immédiatement la synchronisation.
   */
  public async enqueueMutation(params: {
    id?: string;
    operation: MutationOperationType;
    label: string;
    payload: Record<string, unknown>;
    actor_id: string;
    sector_id: string | null;
    forceOfflineQueue?: boolean;
  }): Promise<MutationQueueItem> {
    const idempotencyKey = params.id ?? `MUT-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const item = await enqueueOfflineMutation({
      id: idempotencyKey,
      operation: params.operation,
      label: params.label,
      payload: {
        ...params.payload,
        p_idempotency_key:
          params.payload.p_idempotency_key ?? idempotencyKey,
      },
      actor_id: params.actor_id,
      sector_id: params.sector_id,
    });

    this.lastSyncTrigger = 'ENQUEUE';
    await this.notifyListeners();

    if (navigator.onLine && !params.forceOfflineQueue) {
      await this.flushDueMutations('ENQUEUE');
    }

    return item;
  }

  /**
   * Vide séquentiellement toutes les mutations arrivées à échéance de retry
   */
  public async flushDueMutations(
    trigger: SyncEngineState['lastSyncTrigger'] = 'MANUAL',
    ignoreRetrySchedule = false
  ): Promise<{synced: number; failed: number}> {
    if (this.isSyncing) {
      return {synced: 0, failed: 0};
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine && trigger !== 'MANUAL') {
      await this.notifyListeners();
      return {synced: 0, failed: 0};
    }

    this.isSyncing = true;
    this.lastSyncTrigger = trigger;
    await this.notifyListeners();

    let synced = 0;
    let failed = 0;

    try {
      const itemsToProcess = ignoreRetrySchedule
        ? (await getAllMutationQueueItems()).sort(
            (a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
        : await getPendingMutationsDue(Date.now());

      for (const item of itemsToProcess) {
        await updateMutationItem({
          ...item,
          status: 'SYNCING',
        });
        await this.notifyListeners();

        try {
          await this.executeSingleMutation(item);
          await removeMutationItem(item.id);
          synced += 1;
          this.lastSyncedAt = new Date().toISOString();
        } catch (err) {
          failed += 1;
          const nextAttempts = item.attempts + 1;
          const backoffMs = computeExponentialBackoffMs(nextAttempts);
          const errorMessage =
            err instanceof Error
              ? err.message
              : 'Erreur réseau lors de la synchronisation RPC.';

          await updateMutationItem({
            ...item,
            status: nextAttempts >= item.max_attempts ? 'DEAD_LETTER' : 'FAILED',
            attempts: nextAttempts,
            next_retry_at: Date.now() + backoffMs,
            last_error: errorMessage,
          });
        }

        await this.notifyListeners();
      }
    } finally {
      this.isSyncing = false;
      await this.notifyListeners();
    }

    return {synced, failed};
  }

  public async retrySingleItemNow(id: string): Promise<void> {
    await resetFailedMutationForImmediateRetry(id);
    await this.notifyListeners();
    await this.flushDueMutations('MANUAL', true);
  }

  public async discardMutationItem(id: string): Promise<void> {
    await removeMutationItem(id);
    await this.notifyListeners();
  }

  private async executeSingleMutation(item: MutationQueueItem): Promise<void> {
    switch (item.operation) {
      case 'SYNC_SALE': {
        await portusRepository.rpcSyncSale(
          item.payload as unknown as SyncSaleParams
        );
        break;
      }
      case 'VERIFY_TICKET': {
        await portusRepository.rpcVerifyTicket(
          item.payload as unknown as VerifyTicketParams
        );
        break;
      }
      case 'DECLARE_EXIT': {
        await portusRepository.rpcDeclareExit(
          item.payload as unknown as DeclareExitParams
        );
        break;
      }
      case 'CONFIRM_MOBILE_PAYMENT': {
        await portusRepository.rpcConfirmMobilePayment(
          item.payload as unknown as ConfirmMobilePaymentParams
        );
        break;
      }
      case 'REPORT_INCIDENT': {
        await portusRepository.rpcReportIncident(
          item.payload as unknown as ReportIncidentParams
        );
        break;
      }
      case 'ACK_NOTIFICATION': {
        await portusRepository.rpcAckNotification(
          item.payload as unknown as AckNotificationParams
        );
        break;
      }
      default: {
        const exhaustiveCheck: never = item.operation;
        throw new Error(`Opération de synchronisation non supportée : ${String(exhaustiveCheck)}`);
      }
    }
  }
}

export const syncEngine = new PortusSyncEngine();
