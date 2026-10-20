/**
 * PORTUS — Gestionnaire IndexedDB Local (idb)
 * Stockage hors-ligne résilient (Android 2Go RAM / 4G instable Vridi)
 * Contient la file d'attente des mutations (`mutation_queue`), le cache des profils et le stockage PIN sécurisé.
 */

import {openDB, DBSchema, IDBPDatabase} from 'idb';
import type {
  MutationQueueItem,
  Profile,
  Ticket,
  Sale,
  AppSettings,
  Sector,
  DeviceBindingRecord,
} from '../types/portus';

export const DB_NAME = 'portus_ujpas_vridi_db';
export const DB_VERSION = 2;

export interface PortusCoreDBSchema extends DBSchema {
  mutation_queue: {
    key: string;
    value: MutationQueueItem;
    indexes: {'by-status': string; 'by-next-retry': number};
  };
  profiles: {
    key: string;
    value: Profile;
    indexes: {'by-matricule': string; 'by-sector': string};
  };
  tickets: {
    key: string;
    value: Ticket;
    indexes: {'by-number': string; 'by-sector': string; 'by-status': string};
  };
  sales: {
    key: string;
    value: Sale;
    indexes: {
      'by-idempotency': string;
      'by-ticket': string;
      'by-plate': string;
      'by-sector': string;
    };
  };
  sectors: {
    key: string;
    value: Sector;
    indexes: {'by-code': string};
  };
  app_settings: {
    key: number;
    value: AppSettings;
  };
  device_bindings: {
    key: string;
    value: DeviceBindingRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<PortusCoreDBSchema>> | null = null;

export async function getDB(): Promise<IDBPDatabase<PortusCoreDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PortusCoreDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('mutation_queue')) {
          const store = db.createObjectStore('mutation_queue', {keyPath: 'id'});
          store.createIndex('by-status', 'status');
          store.createIndex('by-next-retry', 'next_retry_at');
        }

        if (!db.objectStoreNames.contains('profiles')) {
          const store = db.createObjectStore('profiles', {keyPath: 'id'});
          store.createIndex('by-matricule', 'matricule');
          store.createIndex('by-sector', 'sector_id');
        }

        if (!db.objectStoreNames.contains('tickets')) {
          const store = db.createObjectStore('tickets', {keyPath: 'id'});
          store.createIndex('by-number', 'ticket_number');
          store.createIndex('by-sector', 'sector_id');
          store.createIndex('by-status', 'status');
        }

        if (!db.objectStoreNames.contains('sales')) {
          const store = db.createObjectStore('sales', {keyPath: 'id'});
          store.createIndex('by-idempotency', 'sync_idempotency_key');
          store.createIndex('by-ticket', 'ticket_number');
          store.createIndex('by-plate', 'normalized_plate');
          store.createIndex('by-sector', 'sector_id');
        }

        if (!db.objectStoreNames.contains('sectors')) {
          const store = db.createObjectStore('sectors', {keyPath: 'id'});
          store.createIndex('by-code', 'code');
        }

        if (!db.objectStoreNames.contains('app_settings')) {
          db.createObjectStore('app_settings', {keyPath: 'id'});
        }

        if (!db.objectStoreNames.contains('device_bindings')) {
          db.createObjectStore('device_bindings', {keyPath: 'device_id'});
        }
      },
    });
  }
  return dbPromise;
}

// Re-export des fonctions de l'implémentation complète pour assurer l'intégration transparente
export * from './db/index';
