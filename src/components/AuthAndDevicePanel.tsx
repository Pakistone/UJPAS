/**
 * PORTUS — Panneau d'Authentification Hors-Ligne (PIN PBKDF2), Verrouillage 5 Échecs
 * et Gestion de Liaison / Révocation d'Appareil.
 */

import React, {useState, useEffect, useCallback} from 'react';
import {
  ShieldCheck,
  Lock,
  Smartphone,
  KeyRound,
  AlertOctagon,
  CheckCircle2,
  RotateCcw,
  Ban,
} from 'lucide-react';
import {
  getOrCreateDeviceId,
  getLockoutState,
  verifyOfflinePinPBKDF2,
  bindDeviceWithPBKDF2Pin,
  revokeBoundDevice,
  restoreRevokedDevice,
  getAllBoundDevices,
  resetAuthLockout,
  LockoutState,
} from '../lib/auth/security';
import type {DeviceBindingRecord, Profile} from '../types/portus';

interface AuthAndDevicePanelProps {
  profiles: Profile[];
  currentProfile: Profile;
  onSelectProfile: (profile: Profile) => void;
}

export const AuthAndDevicePanel: React.FC<AuthAndDevicePanelProps> = ({
  profiles,
  currentProfile,
  onSelectProfile,
}) => {
  const [selectedProfileId, setSelectedProfileId] = useState(currentProfile.id);
  const [pinInput, setPinInput] = useState('');
  const [newPinToBind, setNewPinToBind] = useState('');
  const [authStatus, setAuthStatus] = useState<{
    type: 'SUCCESS' | 'ERROR' | 'INFO';
    text: string;
  } | null>(null);
  const [lockout, setLockout] = useState<LockoutState>(() => getLockoutState());
  const [boundDevices, setBoundDevices] = useState<DeviceBindingRecord[]>([]);
  const [revokeReason, setRevokeReason] = useState(
    'Signalement perte terminal Quart Vridi TC1'
  );

  const deviceId = getOrCreateDeviceId();

  const refreshDevices = useCallback(async () => {
    const list = await getAllBoundDevices();
    setBoundDevices(list);
    setLockout(getLockoutState());
  }, []);

  useEffect(() => {
    setSelectedProfileId(currentProfile.id);
    void refreshDevices();
  }, [currentProfile.id, refreshDevices]);

  const targetProfile =
    profiles.find((p) => p.id === selectedProfileId) ?? currentProfile;

  const handleVerifyOfflinePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthStatus(null);

    const result = await verifyOfflinePinPBKDF2(targetProfile, pinInput);
    setLockout(result.lockout);
    await refreshDevices();

    if (result.verified) {
      onSelectProfile(targetProfile);
      setPinInput('');
      setAuthStatus({
        type: 'SUCCESS',
        text: `Authentification hors-ligne PBKDF2 validée pour ${targetProfile.full_name} (${targetProfile.callsign}). Terminal lié : ${deviceId}.`,
      });
    } else {
      setAuthStatus({
        type: 'ERROR',
        text: result.errorMessage ?? 'Échec de vérification du code PIN.',
      });
    }
  };

  const handleUpdatePBKDF2Pin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPinToBind.trim().length < 4) {
      setAuthStatus({
        type: 'ERROR',
        text: 'Le code PIN local doit comporter au moins 4 chiffres.',
      });
      return;
    }

    try {
      const record = await bindDeviceWithPBKDF2Pin(
        currentProfile,
        newPinToBind.trim()
      );
      setNewPinToBind('');
      await refreshDevices();
      setAuthStatus({
        type: 'SUCCESS',
        text: `Code PIN local chiffré (PBKDF2-SHA256, ${record.pbkdf2_iterations} itérations) et appareil ${record.device_id} lié à ${currentProfile.matricule}.`,
      });
    } catch (err) {
      setAuthStatus({
        type: 'ERROR',
        text:
          err instanceof Error
            ? err.message
            : "Impossible de lier l'appareil.",
      });
    }
  };

  const handleRevokeDevice = async (targetDeviceId: string) => {
    try {
      await revokeBoundDevice(targetDeviceId, revokeReason);
      await refreshDevices();
      setAuthStatus({
        type: 'INFO',
        text: `Terminal ${targetDeviceId} révoqué avec succès. Tout déverrouillage hors-ligne est désormais bloqué sur cet appareil.`,
      });
    } catch (err) {
      setAuthStatus({
        type: 'ERROR',
        text: err instanceof Error ? err.message : 'Erreur de révocation.',
      });
    }
  };

  const handleRestoreDevice = async (targetDeviceId: string) => {
    try {
      await restoreRevokedDevice(targetDeviceId);
      await refreshDevices();
      setAuthStatus({
        type: 'SUCCESS',
        text: `Terminal ${targetDeviceId} réhabilité par l'Administrateur Projet.`,
      });
    } catch (err) {
      setAuthStatus({
        type: 'ERROR',
        text: err instanceof Error ? err.message : 'Erreur de réactivation.',
      });
    }
  };

  const isLocked = Boolean(
    lockout.lockedUntil && Date.now() < lockout.lockedUntil
  );

  return (
    <div className="space-y-6">
      {/* Carte principale : Déverrouillage Hors-Ligne PBKDF2 & Verrouillage 5 échecs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-bold text-white">
                Authentification Hors-Ligne (PIN PBKDF2-SHA256)
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">
              Essais en échec : {lockout.failedAttempts}/5
            </span>
          </div>

          <p className="mt-1.5 text-xs text-slate-400">
            Sélectionnez un agent des 5 rôles UJPAS et saisissez son code PIN
            terrain. Après 5 échecs consécutifs, le terminal se verrouille
            automatiquement pendant 15 minutes.
          </p>

          {isLocked && (
            <div className="mt-4 rounded-xl border border-rose-500/50 bg-rose-950/60 p-4 text-xs text-rose-200">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-rose-300">
                  <AlertOctagon className="h-4 w-4 shrink-0" />
                  <span>TERMINAL VERROUILLÉ (5 ÉCHECS CONSÉCUTIFS)</span>
                </div>
                {currentProfile.role === 'ADMIN_PROJET' && (
                  <button
                    type="button"
                    onClick={() => {
                      setLockout(resetAuthLockout());
                      setAuthStatus({
                        type: 'INFO',
                        text: 'Verrouillage réinitialisé par ADMIN_PROJET.',
                      });
                    }}
                    className="rounded-md bg-rose-500/20 px-2.5 py-1 font-semibold text-rose-200 hover:bg-rose-500/30"
                  >
                    Débloquer (Admin)
                  </button>
                )}
              </div>
              <p className="mt-1">
                Protection anti-force brute active jusqu&apos;à{' '}
                {lockout.lockedUntil
                  ? new Date(lockout.lockedUntil).toLocaleTimeString('fr-FR')
                  : ''}
                .
              </p>
            </div>
          )}

          <form onSubmit={handleVerifyOfflinePin} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="auth-profile-select"
                className="block text-xs font-semibold text-slate-300"
              >
                Compte Opérateur UJPAS (PIN initial démo indiqué entre
                parenthèses)
              </label>
              <select
                id="auth-profile-select"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.matricule} — {p.full_name} [{p.role}] · PIN:{' '}
                    {p.pin_hash}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="auth-pin-input"
                className="block text-xs font-semibold text-slate-300"
              >
                Code PIN Terrain
              </label>
              <input
                id="auth-pin-input"
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="Ex: 4444"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                disabled={isLocked}
                required
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-base tracking-widest text-white focus:border-amber-400 focus:outline-none disabled:opacity-40"
              />
            </div>

            <button
              type="submit"
              disabled={isLocked}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Lock className="h-4 w-4" />
              <span>Déverrouiller Session Hors-Ligne & Lier Terminal</span>
            </button>
          </form>

          {authStatus && (
            <div
              className={`mt-4 rounded-lg border px-3.5 py-2.5 text-xs ${
                authStatus.type === 'SUCCESS'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : authStatus.type === 'ERROR'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                    : 'border-sky-500/40 bg-sky-500/10 text-sky-200'
              }`}
            >
              {authStatus.text}
            </div>
          )}
        </div>

        {/* Liaison et Révocation d'appareil */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              Liaison Matérielle & Révocation d&apos;Appareil
            </h2>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            Identifiant matériel unique de ce smartphone :{' '}
            <code className="font-mono font-bold text-amber-300">
              {deviceId}
            </code>
          </p>

          <form onSubmit={handleUpdatePBKDF2Pin} className="mt-4 space-y-3">
            <div>
              <label
                htmlFor="new-pbkdf2-pin"
                className="block text-xs font-semibold text-slate-300"
              >
                Enrôler / Rotation du PIN local PBKDF2 pour{' '}
                {currentProfile.full_name}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="new-pbkdf2-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="Nouveau PIN (4 à 8 chiffres)"
                  value={newPinToBind}
                  onChange={(e) => setNewPinToBind(e.target.value)}
                  className="min-h-[44px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="min-h-[44px] shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25"
                >
                  Chiffrer & Lier
                </button>
              </div>
            </div>
          </form>

          <div className="mt-5 border-t border-slate-800 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Terminaux liés dans IndexedDB ({boundDevices.length})
            </h3>

            {boundDevices.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">
                Déverrouillez un profil à gauche ou cliquez sur « Chiffrer &
                Lier » pour générer l&apos;empreinte PBKDF2 de cet appareil.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {boundDevices.map((dev) => (
                  <div
                    key={dev.device_id}
                    className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono font-bold text-white">
                        {dev.device_id}{' '}
                        <span className="font-sans font-normal text-slate-400">
                          · {dev.matricule}
                        </span>
                      </div>
                      <span
                        className={
                          dev.is_revoked
                            ? 'font-bold text-rose-400'
                            : 'font-bold text-emerald-400'
                        }
                      >
                        {dev.is_revoked ? 'RÉVOQUÉ' : 'ACTIF & LIÉ'}
                      </span>
                    </div>

                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      PBKDF2 Salt: {dev.pbkdf2_salt_hex.slice(0, 16)}… · Hash:{' '}
                      {dev.pbkdf2_pin_hash_hex.slice(0, 20)}…
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!dev.is_revoked ? (
                        <>
                          <input
                            type="text"
                            value={revokeReason}
                            onChange={(e) => setRevokeReason(e.target.value)}
                            aria-label="Motif de révocation"
                            className="min-h-[36px] flex-1 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-200"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              void handleRevokeDevice(dev.device_id)
                            }
                            className="flex min-h-[36px] items-center gap-1 rounded-md bg-rose-500/20 px-3 py-1.5 font-semibold text-rose-300 hover:bg-rose-500/30"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            <span>Révoquer appareil</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            void handleRestoreDevice(dev.device_id)
                          }
                          className="flex min-h-[36px] items-center gap-1 rounded-md bg-emerald-500/20 px-3 py-1.5 font-semibold text-emerald-300 hover:bg-emerald-500/30"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Réhabiliter appareil</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Matrice des Permissions Cumulables du Profil Actif */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-amber-400" />
          <h3 className="text-sm font-bold text-white">
            Habilitations Cumulables & Indicatif Radio de l&apos;Opérateur Actif
          </h3>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="text-slate-400">Indicatif Radio (Callsign)</span>
            <p className="mt-1 font-mono text-sm font-bold text-amber-400">
              {currentProfile.callsign}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="text-slate-400">
              Perception Contribution (`peut_vendre`)
            </span>
            <p className="mt-1 flex items-center gap-1.5 font-bold text-white">
              <CheckCircle2
                className={`h-4 w-4 ${currentProfile.peut_vendre ? 'text-emerald-400' : 'text-rose-400'}`}
              />
              <span>
                {currentProfile.peut_vendre ? 'HABILITÉ' : 'NON HABILITÉ'}
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="text-slate-400">
              Contrôle Routier (`peut_controler`)
            </span>
            <p className="mt-1 flex items-center gap-1.5 font-bold text-white">
              <CheckCircle2
                className={`h-4 w-4 ${currentProfile.peut_controler ? 'text-emerald-400' : 'text-rose-400'}`}
              />
              <span>
                {currentProfile.peut_controler ? 'HABILITÉ' : 'NON HABILITÉ'}
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="text-slate-400">
              Signalement Sécurité (`peut_signaler`)
            </span>
            <p className="mt-1 flex items-center gap-1.5 font-bold text-white">
              <CheckCircle2
                className={`h-4 w-4 ${currentProfile.peut_signaler ? 'text-emerald-400' : 'text-rose-400'}`}
              />
              <span>
                {currentProfile.peut_signaler ? 'HABILITÉ' : 'NON HABILITÉ'}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
