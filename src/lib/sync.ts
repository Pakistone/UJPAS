/**
 * PORTUS — Moteur de Synchronisation (src/lib/sync.ts)
 * Écoute les événements `online` et `visibilitychange` pour purger la file d'attente
 * vers la fonction RPC Supabase `sync_sale` avec backoff exponentiel et garantie d'idempotence.
 */

import {useEffect, useState, useCallback} from 'react';
import {syncEngine, SyncEngineState} from './sync/syncEngine';
import type {MutationQueueItem} from '../types/portus';

export {syncEngine};
export type {SyncEngineState};

const INITIAL_SYNC_STATE: SyncEngineState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  pendingCount: 0,
  failedCount: 0,
  queue: [],
  lastSyncedAt: null,
  lastSyncTrigger: null,
};

/**
 * Hook React personnalisé pour écouter l'état du moteur de synchronisation
 */
export function useSyncEngine(): {
  syncState: SyncEngineState;
  triggerManualSync: () => Promise<{synced: number; failed: number}>;
  enqueueSaleMutation: (params: {
    ticketNumber: string;
    agentId: string;
    truckPlate: string;
    sectorId: string | null;
    paymentMethod: string;
    driverPhone?: string;
    payload: Record<string, unknown>;
  }) => Promise<MutationQueueItem>;
} {
  const [syncState, setSyncState] = useState<SyncEngineState>(INITIAL_SYNC_STATE);

  useEffect(() => {
    // Initialise l'état local depuis IndexedDB
    void syncEngine.getState().then((s) => setSyncState(s));

    // Démarre l'écoute des événements online, visibilitychange et timer périodique
    syncEngine.start();
    const unsubscribe = syncEngine.subscribe((updatedState) => {
      setSyncState(updatedState);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const triggerManualSync = useCallback(async () => {
    return await syncEngine.flushDueMutations('MANUAL', true);
  }, []);

  const enqueueSaleMutation = useCallback(
    async (params: {
      ticketNumber: string;
      agentId: string;
      truckPlate: string;
      sectorId: string | null;
      paymentMethod: string;
      driverPhone?: string;
      payload: Record<string, unknown>;
    }): Promise<MutationQueueItem> => {
      return await syncEngine.enqueueMutation({
        operation: 'SYNC_SALE',
        label: `Vente ${params.ticketNumber} (${params.truckPlate})`,
        payload: {
          p_ticket_number: params.ticketNumber,
          p_agent_id: params.agentId,
          p_truck_plate: params.truckPlate,
          ...params.payload,
        },
        actor_id: params.agentId,
        sector_id: params.sectorId,
      });
    },
    []
  );

  return {
    syncState,
    triggerManualSync,
    enqueueSaleMutation,
  };
}

/**
 * Fonction autonome de purge immédiate vers la RPC Supabase `sync_sale`
 */
export async function flushMutationQueueToSupabase(): Promise<{
  synced: number;
  failed: number;
}> {
  return await syncEngine.flushDueMutations('MANUAL', true);
}
