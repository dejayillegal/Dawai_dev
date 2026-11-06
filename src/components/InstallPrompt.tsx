import React, { useEffect, useState } from 'react';
import { Btn } from '../ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const InstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isInstalled) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) {
      if (isIOS) setShowIOSGuide(true);
      return;
    }
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
  };

  if (!deferredPrompt && !isIOS) return null;

  return (
    <>
      <Btn
        small
        tone="cyan"
        title="Install AIDAW as a desktop or mobile application"
        onClick={handleInstall}
        className="flex items-center gap-1 font-semibold"
      >
        <span className="text-[11px]">⬇ Install</span>
      </Btn>

      {showIOSGuide && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-amber">Install AIDAW on iOS</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-300">
              1. Tap the <strong className="text-cyan">Share</strong> icon in the Safari toolbar.<br />
              2. Scroll down and tap <strong className="text-cyan">Add to Home Screen</strong>.<br />
              3. Launch AIDAW with standalone offline audio workstation support.
            </p>
            <div className="mt-4 flex justify-end">
              <Btn small onClick={() => setShowIOSGuide(false)}>Close</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
