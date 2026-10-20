/**
 * PORTUS — UJPAS (Union des Jeunes du Port pour l'Assistance et la Sécurité)
 * Module de Cryptographie Asymétrique Ed25519 Hors-Ligne & Normalisation de Plaques (`src/lib/crypto/ed25519.ts`)
 *
 * Responsabilités Phase 3 :
 * 1. Signature et vérification cryptographique hors-ligne via `@noble/ed25519` (RFC 8032).
 * 2. Gestion du dictionnaire des clés publiques indexées par `kid` alimenté depuis `app_settings`.
 * 3. Formats attendus des QR Codes :
 *    - Ticket : `P1.<kid>.<ticket_number>.<epoch>.<sig>`
 *    - Badge  : `P1B.<kid>.<badge_no>.<epoch>.<sig>`
 *    (Avec rétrocompatibilité transparente pour les formats pipe '|' si présents)
 * 4. Chiffre de contrôle (Check Digit) pour les numéros physiques de tickets.
 * 5. Normalisation et comparaison tolérante aux confusions visuelles des plaques d'immatriculation.
 */

import * as ed from '@noble/ed25519';
import type {AppSettings, UserRole} from '../../types/portus';

/**
 * Clé privée Ed25519 de référence RFC 8032 (utilisée en atelier local et démo)
 * Sa clé publique dérivée exacte est : d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
 */
export const DEFAULT_DEMO_SECRET_KEY_HEX =
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

export const DEFAULT_PUBLIC_KEY_K1_HEX =
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

/**
 * Registre interne des clés publiques Ed25519 indexées par `kid` (Key Identifier)
 */
const PUBLIC_KEY_REGISTRY: Record<string, string> = {
  k1: DEFAULT_PUBLIC_KEY_K1_HEX,
  '1': DEFAULT_PUBLIC_KEY_K1_HEX,
  v1: DEFAULT_PUBLIC_KEY_K1_HEX,
};

/**
 * Enregistre ou met à jour une clé publique dans le registre local
 */
export function registerPublicKeyForKid(kid: string, publicKeyHex: string): void {
  const cleanKid = kid.trim().toLowerCase();
  const cleanPub = publicKeyHex.trim().toLowerCase();
  if (cleanPub.length !== 64) {
    throw new Error(
      `Clé publique Ed25519 invalide pour kid="${cleanKid}" : 64 caractères hexadécimaux requis.`
    );
  }
  PUBLIC_KEY_REGISTRY[cleanKid] = cleanPub;
}

/**
 * Synchronise et charge le dictionnaire des clés publiques depuis les `AppSettings`
 */
export function syncPublicKeysFromAppSettings(settings: Partial<AppSettings>): void {
  if (settings.ed25519_public_key_hex && settings.ed25519_public_key_hex.length === 64) {
    const pubHex = settings.ed25519_public_key_hex.trim().toLowerCase();
    const ver = settings.key_version ? String(settings.key_version) : '1';
    PUBLIC_KEY_REGISTRY[`k${ver}`] = pubHex;
    PUBLIC_KEY_REGISTRY[`v${ver}`] = pubHex;
    PUBLIC_KEY_REGISTRY[ver] = pubHex;
    PUBLIC_KEY_REGISTRY['k1'] = pubHex;
  }

  // Dictionnaire optionnel étendu stocké dans settings (ex: settings.public_keys)
  const extendedKeys = (settings as unknown as {public_keys?: Record<string, string>})?.public_keys;
  if (extendedKeys && typeof extendedKeys === 'object') {
    for (const [k, hex] of Object.entries(extendedKeys)) {
      if (typeof hex === 'string' && hex.trim().length === 64) {
        PUBLIC_KEY_REGISTRY[k.trim().toLowerCase()] = hex.trim().toLowerCase();
      }
    }
  }
}

/**
 * Résout la clé publique hexadécimale associée à un `kid`
 */
export function resolvePublicKeyByKid(
  kid: string,
  fallbackPublicKeyHex?: string
): string | null {
  const cleanKid = kid.trim().toLowerCase();
  if (PUBLIC_KEY_REGISTRY[cleanKid]) {
    return PUBLIC_KEY_REGISTRY[cleanKid];
  }
  if (fallbackPublicKeyHex && fallbackPublicKeyHex.trim().length === 64) {
    return fallbackPublicKeyHex.trim().toLowerCase();
  }
  return null;
}

/**
 * Retourne une copie de lecture du registre des clés enregistrées
 */
export function getRegisteredKeyRing(): Record<string, string> {
  return {...PUBLIC_KEY_REGISTRY};
}

/**
 * Calcule un chiffre de contrôle (Check Digit) déterministe pour un numéro de ticket physique
 * Algorithme pondéré modulo-10 (Luhn-variant adapté aux codes alphanumériques)
 */
export function computeTicketCheckDigit(ticketNumber: string): string {
  const clean = ticketNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  let sum = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const weight = i % 2 === 0 ? 1 : 3;
    sum += code * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

/**
 * Formate un numéro de ticket avec son chiffre de contrôle (ex: 'VRD-000101' -> 'VRD-000101-4')
 */
export function formatTicketNumberWithCheckDigit(ticketNumber: string): string {
  const cd = computeTicketCheckDigit(ticketNumber);
  return `${ticketNumber}-${cd}`;
}

/**
 * Helpers d'encodage UTF-8 <-> Uint8Array <-> Hex
 */
export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToHex(bytes: Uint8Array): string {
  return ed.etc.bytesToHex(bytes);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error('Chaîne hexadécimale malformée.');
  }
  return ed.etc.hexToBytes(clean);
}

/**
 * Génère une nouvelle paire de clés Ed25519 (seed 32 octets + clé publique 32 octets)
 */
export async function generateEd25519KeyPair(): Promise<{
  secretKeyHex: string;
  publicKeyHex: string;
}> {
  const {secretKey, publicKey} = await ed.keygenAsync();
  return {
    secretKeyHex: ed.etc.bytesToHex(secretKey),
    publicKeyHex: ed.etc.bytesToHex(publicKey),
  };
}

/**
 * Signe un message canonique UTF-8 avec une clé privée Ed25519 (seed 32 octets en hex)
 */
export async function signCanonicalMessageEd25519(
  canonicalMessage: string,
  secretKeyHex: string = DEFAULT_DEMO_SECRET_KEY_HEX
): Promise<string> {
  const msgBytes = utf8ToBytes(canonicalMessage);
  const privBytes = hexToBytes(secretKeyHex);
  const sigBytes = await ed.signAsync(msgBytes, privBytes);
  return bytesToHex(sigBytes);
}

/**
 * Vérifie hors-ligne une signature Ed25519 sur un message canonique UTF-8
 */
export async function verifyCanonicalMessageEd25519(
  canonicalMessage: string,
  signatureHex: string,
  publicKeyHex: string
): Promise<boolean> {
  try {
    const cleanSig = signatureHex.trim().toLowerCase();
    const cleanPub = publicKeyHex.trim().toLowerCase();
    if (cleanSig.length !== 128 || cleanPub.length !== 64) {
      return false;
    }
    const sigBytes = hexToBytes(cleanSig);
    const msgBytes = utf8ToBytes(canonicalMessage);
    const pubBytes = hexToBytes(cleanPub);
    return await ed.verifyAsync(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}

// =============================================================================
// PROTOCOLE QR TICKET `P1` (Format point : P1.<kid>.<ticket_number>.<epoch>.<sig>)
// =============================================================================

export interface TicketPayloadP1 {
  protocol: 'P1';
  kid: string;
  ticketNumber: string;
  epoch: number;
  signatureHex: string;
  canonicalMessage: string;
  rawQrString: string;
  // Propriétés optionnelles dérivées ou legacy
  checkDigit?: string;
  serialNumber?: number;
  sectorCode?: string;
  amountFcfa?: number;
}

export interface TicketVerificationResultP1 {
  isValidSyntax: boolean;
  isSignatureVerified: boolean;
  kidResolved: boolean;
  publicKeyUsed: string | null;
  parsed: TicketPayloadP1 | null;
  errorReason: string | null;
}

/**
 * Construit le message canonique signé pour un ticket `P1` (format point standard)
 */
export function buildTicketCanonicalMessageP1(params: {
  kid: string;
  ticketNumber: string;
  epoch: number;
}): string {
  return [
    'P1',
    params.kid.trim().toLowerCase(),
    params.ticketNumber.trim().toUpperCase(),
    String(Math.floor(params.epoch)),
  ].join('.');
}

/**
 * Génère et signe un payload QR `P1` au format standard :
 * `P1.<kid>.<ticket_number>.<epoch>.<sig>`
 */
export async function createSignedTicketQrP1(params: {
  kid?: string;
  ticketNumber: string;
  epoch?: number;
  serialNumber?: number;
  sectorCode?: string;
  amountFcfa?: number;
  secretKeyHex?: string;
}): Promise<TicketPayloadP1> {
  const kid = (params.kid ?? 'k1').trim().toLowerCase();
  const epoch = params.epoch ?? Math.floor(Date.now() / 1000);
  const ticketNumber = params.ticketNumber.trim().toUpperCase();
  const checkDigit = computeTicketCheckDigit(ticketNumber);

  const canonicalMessage = buildTicketCanonicalMessageP1({
    kid,
    ticketNumber,
    epoch,
  });

  const signatureHex = await signCanonicalMessageEd25519(
    canonicalMessage,
    params.secretKeyHex ?? DEFAULT_DEMO_SECRET_KEY_HEX
  );

  const rawQrString = `${canonicalMessage}.${signatureHex}`;

  return {
    protocol: 'P1',
    kid,
    ticketNumber,
    epoch,
    signatureHex,
    canonicalMessage,
    rawQrString,
    checkDigit,
    serialNumber: params.serialNumber,
    sectorCode: params.sectorCode,
    amountFcfa: params.amountFcfa,
  };
}

/**
 * Analyse et vérifie hors-ligne un QR Code de ticket `P1`
 * Supporte :
 * 1. Format canonique point : `P1.<kid>.<ticket_number>.<epoch>.<sig>`
 * 2. Format legacy pipe : `P1|<kid>|<ticket_number>|<serial>|<sector>|<amount>|<sig>`
 */
export async function verifyTicketQrPayloadP1(
  rawQr: string,
  fallbackPublicKeyHex?: string
): Promise<TicketVerificationResultP1> {
  const trimmed = rawQr.trim();

  // 1. Format canonique Standard avec points '.'
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    if (parts.length === 5 && parts[0].toUpperCase() === 'P1') {
      const [proto, rawKid, rawTicket, rawEpoch, rawSig] = parts;
      const kid = rawKid.trim().toLowerCase();
      const ticketNumber = rawTicket.trim().toUpperCase();
      const epoch = Number.parseInt(rawEpoch.trim(), 10);
      const signatureHex = rawSig.trim().toLowerCase();

      if (Number.isNaN(epoch) || signatureHex.length !== 128) {
        return {
          isValidSyntax: false,
          isSignatureVerified: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed: null,
          errorReason: 'Horodatage epoch ou longueur de signature Ed25519 (128 hex) invalide.',
        };
      }

      const canonicalMessage = `${proto.toUpperCase()}.${kid}.${ticketNumber}.${epoch}`;
      const parsed: TicketPayloadP1 = {
        protocol: 'P1',
        kid,
        ticketNumber,
        epoch,
        signatureHex,
        canonicalMessage,
        rawQrString: trimmed,
        checkDigit: computeTicketCheckDigit(ticketNumber),
      };

      const publicKeyHex = resolvePublicKeyByKid(kid, fallbackPublicKeyHex);
      if (!publicKeyHex) {
        return {
          isValidSyntax: true,
          isSignatureVerified: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed,
          errorReason: `Identifiant de clé publique (kid="${kid}") inconnu dans le trousseau du terminal.`,
        };
      }

      const verified = await verifyCanonicalMessageEd25519(
        canonicalMessage,
        signatureHex,
        publicKeyHex
      );

      return {
        isValidSyntax: true,
        isSignatureVerified: verified,
        kidResolved: true,
        publicKeyUsed: publicKeyHex,
        parsed,
        errorReason: verified
          ? null
          : 'Signature cryptographique Ed25519 invalide — Ticket falsifié ou altéré.',
      };
    }
  }

  // 2. Format Legacy avec barres '|' (rétrocompatibilité pour la suite de tests existante)
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|');
    if (parts.length === 7) {
      const [rawProto, rawKid, rawTicketNum, rawSerial, rawSector, rawAmount, rawSig] = parts;
      const isP1 = rawProto.toUpperCase() === 'P1' || rawProto.toUpperCase() === 'PORTUS';
      if (!isP1) {
        return {
          isValidSyntax: false,
          isSignatureVerified: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed: null,
          errorReason: `Protocole non reconnu ("${rawProto}"). Attendu : "P1".`,
        };
      }

      const kid = rawKid.trim().toLowerCase();
      const ticketNumber = rawTicketNum.trim().toUpperCase();
      const serialNumber = Number.parseInt(rawSerial.trim(), 10);
      const sectorCode = rawSector.trim().toUpperCase();
      const amountFcfa = Number.parseInt(rawAmount.trim(), 10);
      const signatureHex = rawSig.trim().toLowerCase();

      if (Number.isNaN(serialNumber) || Number.isNaN(amountFcfa) || signatureHex.length !== 128) {
        return {
          isValidSyntax: false,
          isSignatureVerified: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed: null,
          errorReason: 'Paramètres legacy de ticket invalides.',
        };
      }

      const canonicalMessage =
        rawProto.toUpperCase() === 'P1'
          ? `P1|${kid}|${ticketNumber}|${serialNumber}|${sectorCode}|${amountFcfa}`
          : `PORTUS|${rawKid}|${ticketNumber}|${serialNumber}|${sectorCode}|${amountFcfa}`;

      const parsed: TicketPayloadP1 = {
        protocol: 'P1',
        kid,
        ticketNumber,
        epoch: Math.floor(Date.now() / 1000),
        signatureHex,
        canonicalMessage,
        rawQrString: trimmed,
        serialNumber,
        sectorCode,
        amountFcfa,
        checkDigit: computeTicketCheckDigit(ticketNumber),
      };

      const publicKeyHex = resolvePublicKeyByKid(kid, fallbackPublicKeyHex);
      if (!publicKeyHex) {
        return {
          isValidSyntax: true,
          isSignatureVerified: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed,
          errorReason: `Identifiant de clé publique (kid="${kid}") inconnu dans le trousseau du terminal.`,
        };
      }

      const verified = await verifyCanonicalMessageEd25519(
        canonicalMessage,
        signatureHex,
        publicKeyHex
      );

      return {
        isValidSyntax: true,
        isSignatureVerified: verified,
        kidResolved: true,
        publicKeyUsed: publicKeyHex,
        parsed,
        errorReason: verified
          ? null
          : 'Signature cryptographique Ed25519 invalide — Ticket falsifié ou altéré.',
      };
    }
  }

  return {
    isValidSyntax: false,
    isSignatureVerified: false,
    kidResolved: false,
    publicKeyUsed: null,
    parsed: null,
    errorReason: 'Format QR Ticket invalide. Attendu : P1.<kid>.<ticket_number>.<epoch>.<sig>',
  };
}

// =============================================================================
// PROTOCOLE QR BADGE PROFESSIONNEL `P1B` (Format point : P1B.<kid>.<badge_no>.<epoch>.<sig>)
// =============================================================================

export interface BadgePayloadP1B {
  protocol: 'P1B';
  kid: string;
  badgeNumber: string;
  epoch: number;
  signatureHex: string;
  canonicalMessage: string;
  rawQrString: string;
  // Propriétés optionnelles dérivées ou legacy
  matricule?: string;
  role?: UserRole;
  sectorCode?: string;
  callsign?: string;
  expiresDate?: string;
}

export interface BadgeVerificationResultP1B {
  isValidSyntax: boolean;
  isSignatureVerified: boolean;
  isExpired: boolean;
  kidResolved: boolean;
  publicKeyUsed: string | null;
  parsed: BadgePayloadP1B | null;
  errorReason: string | null;
}

/**
 * Construit le message canonique pour un badge `P1B` (format point standard)
 */
export function buildBadgeCanonicalMessageP1B(params: {
  kid: string;
  badgeNumber: string;
  epoch: number;
}): string {
  return [
    'P1B',
    params.kid.trim().toLowerCase(),
    params.badgeNumber.trim().toUpperCase(),
    String(Math.floor(params.epoch)),
  ].join('.');
}

/**
 * Génère et signe un payload QR `P1B` au format standard :
 * `P1B.<kid>.<badge_no>.<epoch>.<sig>`
 */
export async function createSignedBadgeQrP1B(params: {
  kid?: string;
  badgeNumber: string;
  epoch?: number;
  matricule?: string;
  role?: UserRole;
  sectorCode?: string;
  callsign?: string;
  expiresDate?: string;
  secretKeyHex?: string;
}): Promise<BadgePayloadP1B> {
  const kid = (params.kid ?? 'k1').trim().toLowerCase();
  const epoch = params.epoch ?? Math.floor(Date.now() / 1000);
  const badgeNumber = params.badgeNumber.trim().toUpperCase();

  const canonicalMessage = buildBadgeCanonicalMessageP1B({
    kid,
    badgeNumber,
    epoch,
  });

  const signatureHex = await signCanonicalMessageEd25519(
    canonicalMessage,
    params.secretKeyHex ?? DEFAULT_DEMO_SECRET_KEY_HEX
  );

  const rawQrString = `${canonicalMessage}.${signatureHex}`;

  return {
    protocol: 'P1B',
    kid,
    badgeNumber,
    epoch,
    signatureHex,
    canonicalMessage,
    rawQrString,
    matricule: params.matricule,
    role: params.role,
    sectorCode: params.sectorCode,
    callsign: params.callsign,
    expiresDate: params.expiresDate,
  };
}

/**
 * Analyse et vérifie hors-ligne un QR Code de badge `P1B`
 * Supporte :
 * 1. Format canonique point : `P1B.<kid>.<badge_no>.<epoch>.<sig>`
 * 2. Format legacy pipe : `P1B|<kid>|<badge_number>|<matricule>|<role>|<sector>|<callsign>|<expires>|<sig>`
 */
export async function verifyBadgeQrPayloadP1B(
  rawQr: string,
  fallbackPublicKeyHex?: string
): Promise<BadgeVerificationResultP1B> {
  const trimmed = rawQr.trim();

  // 1. Format canonique Standard avec points '.'
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    if (parts.length === 5 && parts[0].toUpperCase() === 'P1B') {
      const [proto, rawKid, rawBadge, rawEpoch, rawSig] = parts;
      const kid = rawKid.trim().toLowerCase();
      const badgeNumber = rawBadge.trim().toUpperCase();
      const epoch = Number.parseInt(rawEpoch.trim(), 10);
      const signatureHex = rawSig.trim().toLowerCase();

      if (Number.isNaN(epoch) || signatureHex.length !== 128) {
        return {
          isValidSyntax: false,
          isSignatureVerified: false,
          isExpired: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed: null,
          errorReason: 'Horodatage epoch ou longueur de signature Ed25519 (128 hex) invalide.',
        };
      }

      const canonicalMessage = `${proto.toUpperCase()}.${kid}.${badgeNumber}.${epoch}`;
      const parsed: BadgePayloadP1B = {
        protocol: 'P1B',
        kid,
        badgeNumber,
        epoch,
        signatureHex,
        canonicalMessage,
        rawQrString: trimmed,
      };

      const publicKeyHex = resolvePublicKeyByKid(kid, fallbackPublicKeyHex);
      if (!publicKeyHex) {
        return {
          isValidSyntax: true,
          isSignatureVerified: false,
          isExpired: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed,
          errorReason: `Identifiant de clé (kid="${kid}") inconnu pour ce badge.`,
        };
      }

      const verified = await verifyCanonicalMessageEd25519(
        canonicalMessage,
        signatureHex,
        publicKeyHex
      );

      return {
        isValidSyntax: true,
        isSignatureVerified: verified,
        isExpired: false,
        kidResolved: true,
        publicKeyUsed: publicKeyHex,
        parsed,
        errorReason: verified
          ? null
          : 'Signature cryptographique Ed25519 invalide — Badge non authentique.',
      };
    }
  }

  // 2. Format Legacy avec barres '|'
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|');
    if (parts.length === 9 && parts[0].toUpperCase() === 'P1B') {
      const [
        ,
        rawKid,
        rawBadgeNum,
        rawMatricule,
        rawRole,
        rawSector,
        rawCallsign,
        rawExpires,
        rawSig,
      ] = parts;

      const kid = rawKid.trim().toLowerCase();
      const badgeNumber = rawBadgeNum.trim().toUpperCase();
      const matricule = rawMatricule.trim().toUpperCase();
      const role = rawRole.trim().toUpperCase() as UserRole;
      const sectorCode = rawSector.trim().toUpperCase();
      const callsign = rawCallsign.trim().toUpperCase();
      const expiresDate = rawExpires.trim().slice(0, 10);
      const signatureHex = rawSig.trim().toLowerCase();

      if (signatureHex.length !== 128) {
        return {
          isValidSyntax: false,
          isSignatureVerified: false,
          isExpired: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed: null,
          errorReason: 'Signature Ed25519 du badge malformée (128 hex requis).',
        };
      }

      const canonicalMessage = [
        'P1B',
        kid,
        badgeNumber,
        matricule,
        role,
        sectorCode,
        callsign,
        expiresDate,
      ].join('|');

      const parsed: BadgePayloadP1B = {
        protocol: 'P1B',
        kid,
        badgeNumber,
        epoch: Math.floor(Date.now() / 1000),
        signatureHex,
        canonicalMessage,
        rawQrString: trimmed,
        matricule,
        role,
        sectorCode,
        callsign,
        expiresDate,
      };

      const publicKeyHex = resolvePublicKeyByKid(kid, fallbackPublicKeyHex);
      if (!publicKeyHex) {
        return {
          isValidSyntax: true,
          isSignatureVerified: false,
          isExpired: false,
          kidResolved: false,
          publicKeyUsed: null,
          parsed,
          errorReason: `Identifiant de clé (kid="${kid}") inconnu pour ce badge.`,
        };
      }

      const verified = await verifyCanonicalMessageEd25519(
        canonicalMessage,
        signatureHex,
        publicKeyHex
      );

      const expiresMs = new Date(`${expiresDate}T23:59:59Z`).getTime();
      const isExpired = !Number.isNaN(expiresMs) && Date.now() > expiresMs;

      return {
        isValidSyntax: true,
        isSignatureVerified: verified,
        isExpired,
        kidResolved: true,
        publicKeyUsed: publicKeyHex,
        parsed,
        errorReason: !verified
          ? 'Signature Ed25519 invalide — Badge non authentique.'
          : isExpired
            ? `Badge expiré depuis le ${expiresDate}.`
            : null,
      };
    }
  }

  return {
    isValidSyntax: false,
    isSignatureVerified: false,
    isExpired: false,
    kidResolved: false,
    publicKeyUsed: null,
    parsed: null,
    errorReason: 'Format QR Badge invalide. Attendu : P1B.<kid>.<badge_no>.<epoch>.<sig>',
  };
}

// =============================================================================
// NORMALISATION ET TOLÉRANCE DES PLAQUES D'IMMATRICULATION POIDS LOURDS
// =============================================================================

export interface PlateMatchAssessment {
  normalizedRegistered: string;
  normalizedObserved: string;
  skeletonRegistered: string;
  skeletonObserved: string;
  exactMatch: boolean;
  fuzzyTolerantMatch: boolean;
  editDistance: number;
  diagnostic: string;
}

/**
 * Normalise une plaque poids lourd d'Afrique de l'Ouest (ex: "ci 8842 gt 01" -> "CI-8842-GT-01")
 */
export function normalizeTruckPlate(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Construit le squelette phonétique/visuel d'une plaque pour absorber les confusions
 * courantes de lecture nocturne ou sur plaques boueuses du corridor de Vridi :
 * O <-> 0, I/L <-> 1, Z <-> 2, S <-> 5, B <-> 8, G <-> 6
 */
export function buildVisualPlateSkeleton(raw: string): string {
  const alnum = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return alnum
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6');
}

/**
 * Calcule la distance de Levenshtein entre deux chaînes
 */
export function computeLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({length: m + 1}, () =>
    new Array<number>(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Compare deux plaques avec tolérance aux confusions visuelles (O/0, I/1, B/8, S/5)
 * et distance d'édition <= 1 pour assister le contrôleur terrain.
 */
export function compareTruckPlatesWithTolerance(
  registeredPlate: string,
  observedPlate: string
): PlateMatchAssessment {
  const normalizedRegistered = normalizeTruckPlate(registeredPlate);
  const normalizedObserved = normalizeTruckPlate(observedPlate);

  const rawAlnumReg = normalizedRegistered.replace(/-/g, '');
  const rawAlnumObs = normalizedObserved.replace(/-/g, '');

  const exactMatch =
    rawAlnumReg.length >= 4 && rawAlnumReg === rawAlnumObs;

  const skeletonRegistered = buildVisualPlateSkeleton(normalizedRegistered);
  const skeletonObserved = buildVisualPlateSkeleton(normalizedObserved);

  const editDistance = computeLevenshteinDistance(
    skeletonRegistered,
    skeletonObserved
  );

  const fuzzyTolerantMatch =
    exactMatch ||
    (skeletonRegistered.length >= 4 &&
      (skeletonRegistered === skeletonObserved || editDistance <= 1));

  let diagnostic = 'Discordance franche de plaque — En attente de régularisation';
  if (exactMatch) {
    diagnostic = 'Concordance exacte de la plaque d’immatriculation';
  } else if (skeletonRegistered === skeletonObserved) {
    diagnostic =
      'Concordance tolérante validée (confusion visuelle O/0, I/1, B/8 ou tirets)';
  } else if (fuzzyTolerantMatch) {
    diagnostic =
      'Concordance tolérante à 1 caractère près (poussière / frappe terrain) — Vérification visuelle recommandée';
  }

  return {
    normalizedRegistered,
    normalizedObserved,
    skeletonRegistered,
    skeletonObserved,
    exactMatch,
    fuzzyTolerantMatch,
    editDistance,
    diagnostic,
  };
}
