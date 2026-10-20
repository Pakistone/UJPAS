/**
 * PORTUS — Sécurité d'Authentification Terrain, Chiffrement PBKDF2 du Code PIN Hors-Ligne,
 * Verrouillage après 5 échecs consécutifs, et Liaison / Révocation d'Appareil.
 *
 * Utilise l'API Web Crypto standard (`crypto.subtle`) disponible sur Android & iOS.
 */

import {getPortusDB} from '../db';
import type {DeviceBindingRecord, Profile} from '../../types/portus';

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH_BITS = 256;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes de verrouillage de sécurité

const STORAGE_DEVICE_ID_KEY = 'portus_vridi_device_id';
const STORAGE_LOCKOUT_KEY = 'portus_vridi_auth_lockout';
const STORAGE_ACTIVE_SESSION_KEY = 'portus_vridi_active_session';

export interface LockoutState {
  failedAttempts: number;
  lockedUntil: number | null; // timestamp ms
  lastFailedAt: string | null;
}

export interface ActiveSessionState {
  profileId: string;
  matricule: string;
  deviceId: string;
  authenticatedAt: string;
  unlockedOffline: boolean;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Génère ou récupère l'identifiant matériel unique de ce smartphone
 */
export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_DEVICE_ID_KEY);
  if (existing && existing.length >= 12) {
    return existing;
  }
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const newId = `TERM-VRD-${bytesToHex(randomBytes).toUpperCase()}`;
  localStorage.setItem(STORAGE_DEVICE_ID_KEY, newId);
  return newId;
}

/**
 * Dérive une empreinte cryptographique PBKDF2-SHA256 à partir du code PIN et d'un sel
 */
export async function derivePinHashPBKDF2(
  pin: string,
  saltHex: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin.trim()),
    {name: 'PBKDF2'},
    false,
    ['deriveBits']
  );

  const saltBytes = hexToBytes(saltHex);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

export function generateSaltHex(byteLength = 16): string {
  const salt = new Uint8Array(byteLength);
  crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

/**
 * Comparaison à temps constant pour prévenir les attaques temporelles sur le PIN
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Gestion du compteur d'échecs et du verrouillage après 5 tentatives erronées
 */
export function getLockoutState(): LockoutState {
  try {
    const raw = localStorage.getItem(STORAGE_LOCKOUT_KEY);
    if (!raw) {
      return {failedAttempts: 0, lockedUntil: null, lastFailedAt: null};
    }
    const parsed = JSON.parse(raw) as LockoutState;
    if (parsed.lockedUntil && Date.now() >= parsed.lockedUntil) {
      // Expiration automatique du verrouillage
      const resetState: LockoutState = {
        failedAttempts: 0,
        lockedUntil: null,
        lastFailedAt: null,
      };
      localStorage.setItem(STORAGE_LOCKOUT_KEY, JSON.stringify(resetState));
      return resetState;
    }
    return parsed;
  } catch {
    return {failedAttempts: 0, lockedUntil: null, lastFailedAt: null};
  }
}

export function recordFailedAuthAttempt(): LockoutState {
  const current = getLockoutState();
  const nextAttempts = current.failedAttempts + 1;
  const isNowLocked = nextAttempts >= MAX_FAILED_ATTEMPTS;

  const updated: LockoutState = {
    failedAttempts: nextAttempts,
    lockedUntil: isNowLocked ? Date.now() + LOCKOUT_DURATION_MS : null,
    lastFailedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_LOCKOUT_KEY, JSON.stringify(updated));
  return updated;
}

export function resetAuthLockout(): LockoutState {
  const clean: LockoutState = {
    failedAttempts: 0,
    lockedUntil: null,
    lastFailedAt: null,
  };
  localStorage.setItem(STORAGE_LOCKOUT_KEY, JSON.stringify(clean));
  return clean;
}

/**
 * Liaison cryptographique du terminal à l'agent (Device Binding + Stockage PIN PBKDF2)
 */
export async function bindDeviceWithPBKDF2Pin(
  profile: Profile,
  plainPin: string
): Promise<DeviceBindingRecord> {
  const db = await getPortusDB();
  const deviceId = getOrCreateDeviceId();
  const saltHex = generateSaltHex(16);
  const pinHashHex = await derivePinHashPBKDF2(
    plainPin,
    saltHex,
    PBKDF2_ITERATIONS
  );

  const existing = await db.get('device_bindings', deviceId);
  if (existing && existing.is_revoked) {
    throw new Error(
      `APPAREIL RÉVOQUÉ : Le terminal ${deviceId} a été révoqué (${existing.revoked_reason ?? 'Mesure de sécurité UJPAS'}). Contactez l'Administrateur Projet.`
    );
  }

  const nowIso = new Date().toISOString();
  const record: DeviceBindingRecord = {
    device_id: deviceId,
    profile_id: profile.id,
    matricule: profile.matricule,
    user_agent: navigator.userAgent.slice(0, 140),
    bound_at: existing?.bound_at ?? nowIso,
    last_verified_at: nowIso,
    is_revoked: false,
    revoked_at: null,
    revoked_reason: null,
    pbkdf2_salt_hex: saltHex,
    pbkdf2_pin_hash_hex: pinHashHex,
    pbkdf2_iterations: PBKDF2_ITERATIONS,
  };

  await db.put('device_bindings', record);
  return record;
}

/**
 * Vérifie un code PIN hors-ligne via PBKDF2 sur l'appareil lié
 */
export async function verifyOfflinePinPBKDF2(
  profile: Profile,
  candidatePin: string
): Promise<{
  verified: boolean;
  lockout: LockoutState;
  binding: DeviceBindingRecord | null;
  errorMessage?: string;
}> {
  const lockout = getLockoutState();
  if (lockout.lockedUntil && Date.now() < lockout.lockedUntil) {
    const remainingMin = Math.ceil((lockout.lockedUntil - Date.now()) / 60000);
    return {
      verified: false,
      lockout,
      binding: null,
      errorMessage: `Terminal verrouillé après ${MAX_FAILED_ATTEMPTS} échecs consécutifs. Réessayez dans ${remainingMin} min.`,
    };
  }

  const db = await getPortusDB();
  const deviceId = getOrCreateDeviceId();
  let binding = await db.get('device_bindings', deviceId);

  if (binding && binding.is_revoked) {
    return {
      verified: false,
      lockout,
      binding,
      errorMessage: `Ce terminal (${deviceId}) est révoqué : ${binding.revoked_reason ?? 'Décision Superviseur UJPAS'}.`,
    };
  }

  // Si l'appareil est déjà lié à ce profil, on vérifie le condensat PBKDF2 stocké
  if (binding && binding.profile_id === profile.id) {
    const derived = await derivePinHashPBKDF2(
      candidatePin,
      binding.pbkdf2_salt_hex,
      binding.pbkdf2_iterations
    );
    if (constantTimeEqualHex(derived, binding.pbkdf2_pin_hash_hex)) {
      const cleanLockout = resetAuthLockout();
      binding = {
        ...binding,
        last_verified_at: new Date().toISOString(),
      };
      await db.put('device_bindings', binding);
      return {verified: true, lockout: cleanLockout, binding};
    }
  } else {
    // Première connexion sur ce terminal : vérification contre le PIN initial du profil puis dérivation PBKDF2 locale
    if (candidatePin.trim() === profile.pin_hash.trim()) {
      const newBinding = await bindDeviceWithPBKDF2Pin(profile, candidatePin);
      const cleanLockout = resetAuthLockout();
      return {verified: true, lockout: cleanLockout, binding: newBinding};
    }
  }

  const updatedLockout = recordFailedAuthAttempt();
  const remainingTries = Math.max(
    0,
    MAX_FAILED_ATTEMPTS - updatedLockout.failedAttempts
  );

  return {
    verified: false,
    lockout: updatedLockout,
    binding: binding ?? null,
    errorMessage:
      remainingTries > 0
        ? `Code PIN incorrect. ${remainingTries} tentative(s) restante(s) avant verrouillage de sécurité.`
        : `5 échecs consécutifs détectés. Terminal verrouillé pendant 15 minutes.`,
  };
}

/**
 * Révocation ou réactivation d'un appareil lié (pour enrôlement / perte de smartphone terrain)
 */
export async function revokeBoundDevice(
  deviceId: string,
  reason: string
): Promise<DeviceBindingRecord> {
  const db = await getPortusDB();
  const existing = await db.get('device_bindings', deviceId);
  if (!existing) {
    throw new Error(`Aucun terminal lié sous l'identifiant ${deviceId}.`);
  }
  const updated: DeviceBindingRecord = {
    ...existing,
    is_revoked: true,
    revoked_at: new Date().toISOString(),
    revoked_reason: reason.trim() || 'Révocation de sécurité UJPAS',
  };
  await db.put('device_bindings', updated);
  return updated;
}

export async function restoreRevokedDevice(
  deviceId: string
): Promise<DeviceBindingRecord> {
  const db = await getPortusDB();
  const existing = await db.get('device_bindings', deviceId);
  if (!existing) {
    throw new Error(`Terminal ${deviceId} introuvable.`);
  }
  const updated: DeviceBindingRecord = {
    ...existing,
    is_revoked: false,
    revoked_at: null,
    revoked_reason: null,
    last_verified_at: new Date().toISOString(),
  };
  await db.put('device_bindings', updated);
  return updated;
}

export async function getAllBoundDevices(): Promise<DeviceBindingRecord[]> {
  const db = await getPortusDB();
  return db.getAll('device_bindings');
}

export function saveActiveSession(session: ActiveSessionState | null): void {
  if (!session) {
    localStorage.removeItem(STORAGE_ACTIVE_SESSION_KEY);
    return;
  }
  localStorage.setItem(STORAGE_ACTIVE_SESSION_KEY, JSON.stringify(session));
}

export function loadActiveSession(): ActiveSessionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_ACTIVE_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveSessionState;
  } catch {
    return null;
  }
}
