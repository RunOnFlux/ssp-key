/**
 * User-confirmed recovery from a corrupt Kaspa signed-amount ledger.
 *
 * The ledger fails closed (lib/kaspaLedger.ts): an unreadable blob stops
 * every Kaspa signature. This is the ONLY way out, and it needs an explicit
 * destructive confirmation: the warning explains that the replay guard for
 * earlier signatures is lost. Confirming quarantines the bad blob under
 * another key (kept, never read again) and starts an empty ledger.
 */
import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import {
  KasLedgerCorruptError,
  KasLedgerFullError,
  quarantineCorruptKasLedger,
} from './kaspaLedger';

type Display = (type: string, content: string, visibilityTime?: number) => void;

export function isKasLedgerFullError(error: unknown): boolean {
  return (
    error instanceof KasLedgerFullError ||
    (error instanceof Error && error.name === 'KasLedgerFullError')
  );
}

/**
 * Surface a ledger failure from a signing path. Returns true when `error` was
 * a ledger error (handled here): corrupt → error toast + the guarded reset
 * dialog; full → a clear refusal. Signing stays refused either way.
 */
export function handleKasLedgerError(
  error: unknown,
  t: TFunction<['home', 'common']>,
  displayMessage: Display,
): boolean {
  if (isKasLedgerCorruptError(error)) {
    displayMessage('error', t('home:err_kas_ledger_corrupt'), 8000);
    promptKasLedgerReset(t, (reset) => {
      if (reset) displayMessage('success', t('home:kas_ledger_reset_done'));
    });
    return true;
  }
  if (isKasLedgerFullError(error)) {
    displayMessage('error', t('home:err_kas_ledger_full'), 10000);
    return true;
  }
  return false;
}

export function isKasLedgerCorruptError(error: unknown): boolean {
  return (
    error instanceof KasLedgerCorruptError ||
    (error instanceof Error && error.name === 'KasLedgerCorruptError')
  );
}

/**
 * Show the reset dialog. `onDone(true)` after a confirmed reset, `false`
 * when cancelled or when the ledger turned out to be readable.
 */
export function promptKasLedgerReset(
  t: TFunction<['home', 'common']>,
  onDone?: (reset: boolean) => void,
): void {
  Alert.alert(
    t('home:kas_ledger_corrupt_title'),
    t('home:kas_ledger_corrupt_message'),
    [
      {
        text: t('common:cancel'),
        style: 'cancel',
        onPress: () => onDone?.(false),
      },
      {
        text: t('home:kas_ledger_reset'),
        style: 'destructive',
        onPress: () => onDone?.(quarantineCorruptKasLedger()),
      },
    ],
    { cancelable: true, onDismiss: () => onDone?.(false) },
  );
}
