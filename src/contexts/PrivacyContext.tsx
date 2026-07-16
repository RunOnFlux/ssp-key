import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { storage } from '../store'; // mmkv — same storage mechanism the app already uses for preferences (language)
import { PRIVACY_MODE_STORAGE_KEY } from '../lib/privacy';

interface PrivacyContextValue {
  /** True when privacy mode is ON — sensitive identifiers render masked. */
  hidden: boolean;
  togglePrivacy: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | undefined>(
  undefined,
);

/**
 * Privacy mode (shoulder-surfing protection), ported from ssp-wallet's
 * PrivacyContext. Persisted to its OWN new MMKV key — never inside sspConfig
 * or any existing key (append-only invariant). Purely presentational: it never
 * touches signing, crypto, or approval-flow displays.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  // MMKV reads are synchronous — hydrate the persisted preference at mount.
  const [hidden, setHidden] = useState<boolean>(
    () => storage.getBoolean(PRIVACY_MODE_STORAGE_KEY) ?? false,
  );

  const togglePrivacy = useCallback(() => {
    setHidden((prev) => {
      const next = !prev;
      try {
        storage.set(PRIVACY_MODE_STORAGE_KEY, next);
      } catch (error) {
        console.error('[PRIVACY] Failed to persist privacy mode', error);
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ hidden, togglePrivacy }),
    [hidden, togglePrivacy],
  );

  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacyMode(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) {
    throw new Error('usePrivacyMode must be used within PrivacyProvider');
  }
  return ctx;
}
