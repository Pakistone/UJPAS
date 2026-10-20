/**
 * PORTUS — Écran de Connexion & Définition de PIN Local (Login.tsx)
 * Phase 2 — Noyau PWA, Auth & Offline
 * Palette Côte d'Ivoire : Orange (#FF8200), Vert (#009E60), Blanc & Gris foncé
 * 
 * Fonctionnalités :
 * 1. Connexion en ligne via Supabase Auth (email/mot de passe ou matricule)
 * 2. Définition / Vérification d'un PIN local (PBKDF2-SHA256, 100 000 itérations)
 * 3. Mode Hors-Ligne automatique avec saisie directe du code PIN local
 * 4. Boutons tactiles larges (>= 48px) et contraste fort adapté au soleil du port de Vridi
 */

import React, {useState, useEffect} from 'react';
import {
  Shield,
  Lock,
  Smartphone,
  KeyRound,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  UserCheck,
  RotateCcw,
} from 'lucide-react';
import {supabase, isSupabaseConfigured} from '../lib/supabase';
import {
  getOrCreateDeviceId,
  getLockoutState,
  verifyOfflinePinPBKDF2,
  bindDeviceWithPBKDF2Pin,
  LockoutState,
} from '../lib/auth/security';
import type {Profile} from '../types/portus';

interface LoginProps {
  profiles: Profile[];
  onLoginSuccess: (profile: Profile) => void;
  onCancel?: () => void;
}

export const Login: React.FC<LoginProps> = ({profiles, onLoginSuccess, onCancel}) => {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [authMode, setAuthMode] = useState<'ONLINE_SUPABASE' | 'OFFLINE_PIN'>(
    isOnline && isSupabaseConfigured ? 'ONLINE_SUPABASE' : 'OFFLINE_PIN'
  );

  // Formulaire Supabase Auth
  const [emailOrMatricule, setEmailOrMatricule] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Formulaire Définition / Vérification PIN
  const [step, setStep] = useState<'AUTHENTICATE' | 'SETUP_PIN'>('AUTHENTICATE');
  const [authenticatedProfile, setAuthenticatedProfile] = useState<Profile | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    profiles[0]?.id ?? ''
  );
  const [pinInput, setPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [feedback, setFeedback] = useState<{type: 'SUCCESS' | 'ERROR' | 'INFO'; message: string} | null>(
    null
  );
  const [lockout, setLockout] = useState<LockoutState>(() => getLockoutState());

  const deviceId = getOrCreateDeviceId();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      setAuthMode('OFFLINE_PIN');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Soumission Supabase Auth (Mode En-Ligne)
  const handleSupabaseLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      if (!isSupabaseConfigured || !supabase) {
        // En mode démo / non configuré : simulation avec le profil local
        const matched = profiles.find(
          (p) =>
            p.matricule.toLowerCase() === emailOrMatricule.toLowerCase().trim() ||
            p.full_name.toLowerCase().includes(emailOrMatricule.toLowerCase().trim())
        );

        if (matched) {
          setAuthenticatedProfile(matched);
          setStep('SETUP_PIN');
          setFeedback({
            type: 'INFO',
            message: `Session Supabase validée pour ${matched.full_name}. Définissez maintenant votre code PIN local pour le travail hors-ligne.`,
          });
        } else {
          setFeedback({
            type: 'ERROR',
            message: 'Identifiant introuvable dans le répertoire des agents UJPAS.',
          });
        }
        return;
      }

      // Vraie authentification Supabase
      const email = emailOrMatricule.includes('@')
        ? emailOrMatricule.trim()
        : `${emailOrMatricule.trim().toLowerCase()}@portus.ci`;

      const {data, error} = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setFeedback({
          type: 'ERROR',
          message: `Échec d'authentification Supabase : ${error.message}`,
        });
        return;
      }

      // Récupération du profil correspondant
      const user = data.user;
      const matched = profiles.find((p) => p.id === user.id) ?? {
        id: user.id,
        full_name: user.user_metadata?.full_name || 'Agent UJPAS Vridi',
        matricule: user.user_metadata?.matricule || 'AGT-VRD-01',
        role: (user.user_metadata?.role as any) || 'AGENT_TERRAIN',
        sector_id: 'sec-vridi-nord',
        callsign: user.user_metadata?.callsign || 'VIGIE-TC1-01',
        phone: user.phone || '0707000000',
        active: true,
      };

      setAuthenticatedProfile(matched as Profile);
      setStep('SETUP_PIN');
      setFeedback({
        type: 'INFO',
        message: 'Connexion Supabase réussie. Veuillez définir ou renouveler votre code PIN local.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'ERROR',
        message: err.message || 'Erreur inattendue lors de la connexion.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Enregistrement du PIN local sécurisé (PBKDF2)
  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authenticatedProfile) return;

    if (pinInput.length < 4) {
      setFeedback({
        type: 'ERROR',
        message: 'Le code PIN doit comporter au moins 4 chiffres.',
      });
      return;
    }

    if (pinInput !== confirmPinInput) {
      setFeedback({
        type: 'ERROR',
        message: 'Les deux codes PIN saisis ne correspondent pas.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await bindDeviceWithPBKDF2Pin(authenticatedProfile, pinInput);
      setFeedback({
        type: 'SUCCESS',
        message: `Code PIN local enregistré avec succès sur ce terminal (${deviceId}). Prêt pour le mode 100% hors-ligne.`,
      });

      setTimeout(() => {
        onLoginSuccess(authenticatedProfile);
      }, 1000);
    } catch (err: any) {
      setFeedback({
        type: 'ERROR',
        message: err.message || "Erreur lors de l'enregistrement sécurisé du code PIN.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Connexion Hors-Ligne avec le PIN
  const handleOfflinePinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const targetProfile = profiles.find((p) => p.id === selectedProfileId);
    if (!targetProfile) {
      setFeedback({type: 'ERROR', message: 'Veuillez sélectionner un profil agent.'});
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await verifyOfflinePinPBKDF2(targetProfile, pinInput);
      setLockout(result.lockout);

      if (result.verified) {
        setFeedback({
          type: 'SUCCESS',
          message: `Session déverrouillée hors-ligne pour ${targetProfile.full_name}.`,
        });
        setTimeout(() => {
          onLoginSuccess(targetProfile);
        }, 800);
      } else {
        setFeedback({
          type: 'ERROR',
          message: result.errorMessage ?? 'Code PIN incorrect.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'ERROR',
        message: err.message || 'Erreur lors de la vérification du code PIN.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-[#FF8200] selection:text-white">
      {/* Carte Centrale */}
      <div className="w-full max-w-md bg-slate-900 border-2 border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Bandeau Tricolore Côte d'Ivoire */}
        <div className="grid grid-cols-3 h-2 w-full">
          <div className="bg-[#FF8200]" title="Orange Côte d'Ivoire" />
          <div className="bg-white" title="Blanc" />
          <div className="bg-[#009E60]" title="Vert Côte d'Ivoire" />
        </div>

        {/* En-tête */}
        <div className="p-6 text-center border-b border-slate-800">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-[#FF8200]/20 via-slate-800 to-[#009E60]/20 border border-slate-700 mb-3 shadow-inner">
            <Shield className="w-9 h-9 text-[#FF8200]" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white uppercase">
            PORTUS <span className="text-[#009E60] font-normal">UJPAS</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-semibold">
            Corridor Portuaire de Vridi — Abidjan
          </p>

          {/* Indicateur de connectivité réseau */}
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800/80 border border-slate-700">
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-[#009E60]" />
                <span className="text-[#009E60]">Connexion 4G Active</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-[#FF8200]" />
                <span className="text-[#FF8200]">Mode 100% Hors-Ligne (Vridi)</span>
              </>
            )}
            <span className="text-slate-600">|</span>
            <span className="text-slate-400 font-mono text-[10px]">{deviceId}</span>
          </div>
        </div>

        {/* Onglets Mode de Connexion */}
        {step === 'AUTHENTICATE' && (
          <div className="grid grid-cols-2 bg-slate-950/60 p-1.5 border-b border-slate-800">
            <button
              type="button"
              onClick={() => {
                setAuthMode('ONLINE_SUPABASE');
                setFeedback(null);
              }}
              className={`py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 min-h-[44px] ${
                authMode === 'ONLINE_SUPABASE'
                  ? 'bg-slate-800 text-white shadow border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-4 h-4 text-[#009E60]" />
              Connexion Supabase
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('OFFLINE_PIN');
                setFeedback(null);
              }}
              className={`py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 min-h-[44px] ${
                authMode === 'OFFLINE_PIN'
                  ? 'bg-slate-800 text-white shadow border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-4 h-4 text-[#FF8200]" />
              Code PIN Local
            </button>
          </div>
        )}

        <div className="p-6">
          {/* Messages de retour */}
          {feedback && (
            <div
              className={`mb-5 p-3 rounded-xl border text-xs font-medium flex items-start gap-2.5 leading-relaxed ${
                feedback.type === 'SUCCESS'
                  ? 'bg-[#009E60]/10 border-[#009E60]/30 text-emerald-300'
                  : feedback.type === 'ERROR'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-[#FF8200]/10 border-[#FF8200]/30 text-orange-200'
              }`}
            >
              {feedback.type === 'SUCCESS' ? (
                <CheckCircle2 className="w-4 h-4 text-[#009E60] shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[#FF8200] shrink-0 mt-0.5" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* ÉTAPE 1.A : Authentification Supabase Online */}
          {step === 'AUTHENTICATE' && authMode === 'ONLINE_SUPABASE' && (
            <form onSubmit={handleSupabaseLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Matricule ou Email Agent
                </label>
                <input
                  type="text"
                  required
                  value={emailOrMatricule}
                  onChange={(e) => setEmailOrMatricule(e.target.value)}
                  placeholder="ex: AGT-VRD-01 ou agent@portus.ci"
                  className="w-full h-12 px-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#009E60] focus:ring-1 focus:ring-[#009E60] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Mot de Passe Supabase
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-12 px-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#009E60] focus:ring-1 focus:ring-[#009E60] text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 mt-2 bg-gradient-to-r from-[#009E60] to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-900/30 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {isSubmitting ? (
                  <RotateCcw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Se Connecter & Configurer PIN</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* ÉTAPE 1.B : Déverrouillage Rapide Hors-Ligne par PIN */}
          {step === 'AUTHENTICATE' && authMode === 'OFFLINE_PIN' && (
            <form onSubmit={handleOfflinePinLogin} className="space-y-4">
              {lockout.lockedUntil && Date.now() < lockout.lockedUntil ? (
                <div className="p-4 bg-rose-500/15 border border-rose-500/30 rounded-xl text-center">
                  <p className="text-xs font-bold text-rose-400">
                    Terminal temporairement verrouillé pour sécurité
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Trop de tentatives infructueuses. Veuillez patienter avant de réessayer.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Agent / Opérateur Terrain
                    </label>
                    <select
                      value={selectedProfileId}
                      onChange={(e) => setSelectedProfileId(e.target.value)}
                      className="w-full h-12 px-3 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#FF8200]"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name} ({p.matricule} — {p.callsign})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">
                        Code PIN Local (4 à 6 chiffres)
                      </label>
                      {lockout.failedAttempts > 0 && (
                        <span className="text-[10px] text-amber-400 font-medium">
                          {lockout.failedAttempts}/5 échecs
                        </span>
                      )}
                    </div>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={8}
                      required
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                      className="w-full h-12 px-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white tracking-widest text-center text-xl focus:outline-none focus:border-[#FF8200] focus:ring-1 focus:ring-[#FF8200]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || pinInput.length < 4}
                    className="w-full h-12 mt-2 bg-gradient-to-r from-[#FF8200] to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold rounded-xl shadow-lg shadow-orange-900/30 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <RotateCcw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        <span>Déverrouiller Session Terrain</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </form>
          )}

          {/* ÉTAPE 2 : Définition Initiale du PIN Local (Après Auth Supabase) */}
          {step === 'SETUP_PIN' && authenticatedProfile && (
            <form onSubmit={handleSavePin} className="space-y-4">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center gap-3">
                <UserCheck className="w-5 h-5 text-[#009E60]" />
                <div>
                  <p className="text-xs font-bold text-white">
                    {authenticatedProfile.full_name}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Matricule : {authenticatedProfile.matricule} | Radio : {authenticatedProfile.callsign}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nouveau Code PIN Local (4 à 6 chiffres)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full h-12 px-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white tracking-widest text-center text-xl focus:outline-none focus:border-[#009E60]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Confirmer le Code PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  value={confirmPinInput}
                  onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full h-12 px-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white tracking-widest text-center text-xl focus:outline-none focus:border-[#009E60]"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || pinInput.length < 4}
                className="w-full h-12 mt-2 bg-gradient-to-r from-[#009E60] to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {isSubmitting ? (
                  <RotateCcw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Sauvegarder le PIN Sécurisé</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setStep('AUTHENTICATE')}
                className="w-full py-2 text-xs text-slate-400 hover:text-slate-200 text-center"
              >
                Retourner à l'authentification
              </button>
            </form>
          )}
        </div>

        {/* Pied de Carte */}
        <div className="bg-slate-950/80 px-6 py-3 border-t border-slate-800/80 text-center text-[10px] text-slate-500">
          UJPAS Côte d'Ivoire — PWA Sécurisée PBKDF2 (100k) & Offline-First
        </div>
      </div>
    </div>
  );
};
