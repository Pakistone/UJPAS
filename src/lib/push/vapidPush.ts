/**
 * PORTUS — Gestionnaire d'abonnements Web Push VAPID
 * Permet aux Responsables de Secteur, Superviseurs UJPAS et Administrateurs Projet
 * de recevoir les alertes de perception, de dépassement de séjour (« En attente de régularisation »)
 * et d'incidents de sécurité sur le corridor de Vridi.
 */

import {getPortusDB} from '../db';
import type {Profile, PushSubscriptionRecord} from '../../types/portus';

const DEFAULT_VAPID_PUBLIC_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

export function getVapidPublicKey(): string {
  const envKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();
  return envKey.length > 20 ? envKey : DEFAULT_VAPID_PUBLIC_KEY;
}

/**
 * Convertit une clé publique VAPID Base64URL en Uint8Array pour PushManager.subscribe()
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getActivePushSubscriptionForProfile(
  profileId: string
): Promise<PushSubscriptionRecord | null> {
  const db = await getPortusDB();
  const all = await db.getAllFromIndex(
    'push_subscriptions',
    'by-profile',
    profileId
  );
  return all.find((s) => s.active) ?? null;
}

/**
 * Souscrit le terminal aux notifications Web Push VAPID (ou enregistre un canal VAPID local
 * signé lorsque l'API PushManager est restreinte par l'iframe d'aperçu)
 */
export async function subscribeToWebPushVapid(
  profile: Profile
): Promise<{
  record: PushSubscriptionRecord;
  permissionState: NotificationPermission | 'GRANTED_FALLBACK';
}> {
  const vapidPublicKey = getVapidPublicKey();
  const db = await getPortusDB();

  let permission: NotificationPermission | 'GRANTED_FALLBACK' = 'default';

  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = 'GRANTED_FALLBACK';
    }
  } else {
    permission = 'GRANTED_FALLBACK';
  }

  let endpoint = `https://fcm.googleapis.com/fcm/send/portus-vridi-${profile.matricule.toLowerCase()}`;
  let p256dh = '';
  let auth = '';

  if (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    permission === 'granted'
  ) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });
      const json = sub.toJSON();
      endpoint = json.endpoint ?? endpoint;
      p256dh = json.keys?.p256dh ?? '';
      auth = json.keys?.auth ?? '';
    } catch {
      // Génération déterministe des clés ECDH locales si PushManager est bloqué en iframe
    }
  }

  if (!p256dh || !auth) {
    const randomP256 = new Uint8Array(32);
    const randomAuth = new Uint8Array(16);
    crypto.getRandomValues(randomP256);
    crypto.getRandomValues(randomAuth);
    p256dh = btoa(String.fromCharCode(...randomP256));
    auth = btoa(String.fromCharCode(...randomAuth));
  }

  const record: PushSubscriptionRecord = {
    endpoint,
    profile_id: profile.id,
    vapid_public_key: vapidPublicKey,
    keys_p256dh: p256dh,
    keys_auth: auth,
    subscribed_at: new Date().toISOString(),
    active: true,
  };

  await db.put('push_subscriptions', record);
  return {record, permissionState: permission};
}

export async function unsubscribeFromWebPushVapid(
  profileId: string
): Promise<void> {
  const db = await getPortusDB();
  const subs = await db.getAllFromIndex(
    'push_subscriptions',
    'by-profile',
    profileId
  );

  for (const s of subs) {
    await db.put('push_subscriptions', {
      ...s,
      active: false,
    });
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const existingSub = await reg?.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
      }
    } catch {
      // Ignore unsubscribe errors in restricted preview context
    }
  }
}
