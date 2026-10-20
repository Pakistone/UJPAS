/**
 * PORTUS — Bouton d'installation PWA In-App (Android / Chromium / Guide iOS Safari)
 */

import React, {useEffect, useState} from 'react';
import {Download, Smartphone, X} from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
}

export const PWAInstallBanner: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as {standalone?: boolean}).standalone ===
        true;
    setIsInstalled(standalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const {outcome} = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
      return;
    }
    setShowIOSModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-amber-400"
        title="Installer l'application PORTUS sur l'écran d'accueil"
      >
        <Download className="h-4 w-4 shrink-0 text-amber-400" />
        <span>Installer PWA</span>
      </button>

      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Smartphone className="h-5 w-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">
                  Installation Terminal Hors-Ligne PORTUS
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-slate-300">
              {isIOS ? (
                <>
                  <p>
                    Pour installer <strong>PORTUS — UJPAS Vridi</strong> en mode
                    plein écran hors-ligne sur iOS Safari :
                  </p>
                  <ol className="list-decimal space-y-1.5 pl-5 text-slate-200">
                    <li>
                      Appuyez sur le bouton <strong>Partager</strong> dans la
                      barre Safari.
                    </li>
                    <li>
                      Sélectionnez{' '}
                      <strong>Sur l&apos;écran d&apos;accueil</strong>.
                    </li>
                    <li>
                      Validez en appuyant sur <strong>Ajouter</strong>.
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <p>
                    Pour installer <strong>PORTUS — UJPAS Vridi</strong> sur ce
                    smartphone Android :
                  </p>
                  <ol className="list-decimal space-y-1.5 pl-5 text-slate-200">
                    <li>
                      Ouvrez le menu du navigateur Chrome (icône <strong>⋮</strong>{' '}
                      en haut à droite).
                    </li>
                    <li>
                      Appuyez sur{' '}
                      <strong>Installer l&apos;application</strong> ou{' '}
                      <strong>Ajouter à l&apos;écran d&apos;accueil</strong>.
                    </li>
                  </ol>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="mt-5 min-h-[44px] w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-400"
            >
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
};
