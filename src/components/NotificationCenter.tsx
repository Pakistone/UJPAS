/**
 * PORTUS — Centre de Notifications In-App & Gestion des Abonnements Web Push VAPID
 *
 * Affiche :
 * - Le flux des notifications temps réel filtrées par rôle / secteur (Perception de la Contribution
 *   d'Assistance et de Sécurisation, Camions En attente de régularisation, Incidents corridor).
 * - L'accusé de réception transactionnel via le RPC `ack_notification` (ou mise en file hors-ligne).
 * - Le panneau d'activation / révocation de l'abonnement Web Push VAPID.
 */

import React, {useEffect, useState, useCallback} from 'react';
import {
  Bell,
  BellRing,
  CheckCheck,
  ShieldAlert,
  Radio,
  Truck,
  X,
  CheckCircle2,
  Volume2,
} from 'lucide-react';
import {portusRepository} from '../lib/supabase/client';
import {syncEngine} from '../lib/sync/syncEngine';
import {
  getActivePushSubscriptionForProfile,
  subscribeToWebPushVapid,
  unsubscribeFromWebPushVapid,
  getVapidPublicKey,
} from '../lib/push/vapidPush';
import type {
  AppNotification,
  Profile,
  PushSubscriptionRecord,
} from '../types/portus';

interface NotificationCenterProps {
  currentProfile: Profile;
  isOpen: boolean;
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  currentProfile,
  isOpen,
  onClose,
  onUnreadCountChange,
}) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [pushSub, setPushSub] = useState<PushSubscriptionRecord | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatusMessage, setPushStatusMessage] = useState<string | null>(
    null
  );

  const loadData = useCallback(async () => {
    const list =
      await portusRepository.getNotificationsForProfile(currentProfile);
    setNotifications(list);
    const unread = list.filter((n) => !n.is_read).length;
    onUnreadCountChange(unread);

    const activeSub = await getActivePushSubscriptionForProfile(
      currentProfile.id
    );
    setPushSub(activeSub);
  }, [currentProfile, onUnreadCountChange]);

  useEffect(() => {
    void loadData();
    const unsub = syncEngine.subscribe(() => {
      void loadData();
    });
    return () => unsub();
  }, [loadData]);

  const handleAcknowledge = async (notif: AppNotification) => {
    if (notif.is_read) return;
    await syncEngine.enqueueMutation({
      operation: 'ACK_NOTIFICATION',
      label: `Accusé réception alerte : ${notif.title.slice(0, 38)}`,
      payload: {
        p_notification_id: notif.id,
        p_actor_id: currentProfile.id,
      },
      actor_id: currentProfile.id,
      sector_id: currentProfile.sector_id,
    });
    await loadData();
  };

  const handleAcknowledgeAll = async () => {
    const unreadList = notifications.filter((n) => !n.is_read);
    for (const n of unreadList) {
      await syncEngine.enqueueMutation({
        operation: 'ACK_NOTIFICATION',
        label: `Accusé réception alerte : ${n.title.slice(0, 38)}`,
        payload: {
          p_notification_id: n.id,
          p_actor_id: currentProfile.id,
        },
        actor_id: currentProfile.id,
        sector_id: currentProfile.sector_id,
      });
    }
    await loadData();
  };

  const handleToggleWebPush = async () => {
    setPushBusy(true);
    setPushStatusMessage(null);
    try {
      if (pushSub && pushSub.active) {
        await unsubscribeFromWebPushVapid(currentProfile.id);
        setPushSub(null);
        setPushStatusMessage(
          'Abonnement Web Push VAPID désactivé sur ce terminal.'
        );
      } else {
        const res = await subscribeToWebPushVapid(currentProfile);
        setPushSub(res.record);
        setPushStatusMessage(
          `Canal Web Push VAPID actif (${res.record.keys_p256dh.slice(0, 14)}…).`
        );
      }
    } catch (err) {
      setPushStatusMessage(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la configuration VAPID.'
      );
    } finally {
      setPushBusy(false);
    }
  };

  if (!isOpen) return null;

  const displayedNotifications =
    filter === 'UNREAD'
      ? notifications.filter((n) => !n.is_read)
      : notifications;

  const getCategoryIcon = (category: AppNotification['category']) => {
    switch (category) {
      case 'PERCEPTION_CONTRIBUTION':
        return <Truck className="h-4 w-4 text-emerald-400" />;
      case 'ALERTE_REGULARISATION':
      case 'FRAUDE_DETECTEE':
        return <ShieldAlert className="h-4 w-4 text-amber-400" />;
      case 'INCIDENT_SECURITE':
        return <Radio className="h-4 w-4 text-rose-400" />;
      default:
        return <Bell className="h-4 w-4 text-sky-400" />;
    }
  };

  const getCategoryLabel = (category: AppNotification['category']) => {
    switch (category) {
      case 'PERCEPTION_CONTRIBUTION':
        return "Contribution d'Assistance";
      case 'ALERTE_REGULARISATION':
        return 'En attente de régularisation';
      case 'FRAUDE_DETECTEE':
        return 'Anomalie Contrôle';
      case 'INCIDENT_SECURITE':
        return 'Incident Sécurité Vridi';
      case 'VERSEMENT_CAISSE':
        return 'Versement Caisse';
      default:
        return 'Système UJPAS';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-slate-950 text-slate-100 shadow-2xl">
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-bold tracking-tight text-white">
                Centre de Notifications & Web Push
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {currentProfile.full_name} · {currentProfile.callsign}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
            aria-label="Fermer le centre de notifications"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Bloc Web Push VAPID */}
        <div className="border-b border-slate-800 bg-slate-900/70 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Volume2 className="h-4 w-4 text-amber-400" />
                <span>Abonnement Web Push VAPID (Corridor Vridi)</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Clé VAPID :{' '}
                <code className="font-mono text-slate-300">
                  {getVapidPublicKey().slice(0, 18)}…
                </code>
                {' · '}
                {pushSub?.active ? 'Actif sur cet appareil' : 'Non abonné'}
              </p>
            </div>
            <button
              type="button"
              disabled={pushBusy}
              onClick={handleToggleWebPush}
              className={`min-h-[42px] shrink-0 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                pushSub?.active
                  ? 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              }`}
            >
              {pushBusy
                ? 'Traitement…'
                : pushSub?.active
                  ? 'Révoquer Push'
                  : 'Activer Web Push'}
            </button>
          </div>
          {pushStatusMessage && (
            <p className="mt-2 text-xs text-emerald-400">{pushStatusMessage}</p>
          )}
        </div>

        {/* Barre de filtre interactive */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                filter === 'ALL'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Toutes ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('UNREAD')}
              className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                filter === 'UNREAD'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Non lues ({notifications.filter((n) => !n.is_read).length})
            </button>
          </div>

          {notifications.some((n) => !n.is_read) && (
            <button
              type="button"
              onClick={handleAcknowledgeAll}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              <CheckCheck className="h-4 w-4 text-emerald-400" />
              <span>Tout acquitter</span>
            </button>
          )}
        </div>

        {/* Liste des notifications */}
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {displayedNotifications.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-2 text-sm font-semibold text-slate-200">
                Aucune notification en attente
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Les perceptions de Contribution d&apos;Assistance et de
                Sécurisation et les alertes « En attente de régularisation »
                apparaîtront ici en temps réel.
              </p>
            </div>
          ) : (
            displayedNotifications.map((n) => (
              <div
                key={n.id}
                className={`rounded-xl border p-4 transition ${
                  n.is_read
                    ? 'border-slate-800/80 bg-slate-900/30 text-slate-400'
                    : 'border-amber-500/40 bg-slate-900 text-slate-100'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <div className="flex items-center gap-1.5 font-medium text-slate-300">
                    {getCategoryIcon(n.category)}
                    <span>{getCategoryLabel(n.category)}</span>
                  </div>
                  <span>
                    {new Date(n.created_at).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <h3 className="mt-1.5 text-sm font-bold text-white">
                  {n.title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  {n.message}
                </p>

                <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2.5 text-xs">
                  {n.is_read ? (
                    <span className="text-emerald-400">
                      Acquittée{' '}
                      {n.acknowledged_at
                        ? `à ${new Date(n.acknowledged_at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}`
                        : ''}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAcknowledge(n)}
                      className="min-h-[38px] rounded-lg bg-emerald-500/15 px-3 py-1.5 font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                    >
                      Accuser réception (RPC ack_notification)
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
