/**
 * PORTUS — Initialisation Client Supabase & Types DDL stricts
 * Respect strict du schéma Phase 1 (PostgreSQL 15+ & RLS)
 * Couleurs nationales : Orange (#FF8200), Vert (#009E60), Blanc
 */

import {createClient, SupabaseClient} from '@supabase/supabase-js';

// Récupération sécurisée des variables d'environnement Vite
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl.startsWith('http') && supabaseAnonKey.length > 20
);

// En-tête de traçabilité pour les requêtes authentifiées terrain
let activeProfileId: string | null = null;

export function setActiveProfile(profileId: string | null): void {
  activeProfileId = profileId;
}

export function getActiveProfileId(): string | null {
  return activeProfileId;
}

/**
 * Client Supabase officiel typé
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'portus_supabase_auth_session',
      },
      global: {
        fetch: (url, options = {}) => {
          const headers = new Headers(options.headers);
          if (activeProfileId) {
            headers.set('x-portus-profile-id', activeProfileId);
          }
          return fetch(url, {...options, headers});
        },
      },
    })
  : null;

// Re-export des types canoniques et de l'instance pour compatibilité
export * from './supabase/client';
