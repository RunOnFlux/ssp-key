/**
 * User-facing handling of a Kaspa signed-amount conflict (KAS-2).
 *
 * `reconcileKasLedgerClaims` (lib/kaspaLedger.ts) resolves what a proof can
 * resolve. What remains reaches the user here, with signing still refused:
 * - an outpoint whose recorded amount the blockchain PROVES right (the UTXO
 *   source is lying): a plain error, never a reset;
 * - an outpoint whose real amount cannot be proven right now: an explained,
 *   destructive per-outpoint reset that forgets ONLY those outpoints (the
 *   rest of the ledger is untouched). The user then sends again.
 */
import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { KasLedgerConflictError, resetKasLedgerOutpoints } from './kaspaLedger';

type Display = (type: string, content: string, visibilityTime?: number) => void;

export function isKasLedgerConflictError(
  error: unknown,
): error is KasLedgerConflictError {
  return (
    error instanceof KasLedgerConflictError ||
    (error instanceof Error &&
      error.name === 'KasLedgerConflictError' &&
      Array.isArray((error as KasLedgerConflictError).refused) &&
      Array.isArray((error as KasLedgerConflictError).unprovable))
  );
}

/** `txid:index` shortened for a dialog: first 8 hex of the txid + index. */
function shortOutpoint(outpoint: string): string {
  const [txid, index] = outpoint.split(':');
  return `${(txid ?? '').slice(0, 8)}…:${index ?? '?'}`;
}

/**
 * Show the per-outpoint reset dialog. `onDone(true)` after a confirmed reset,
 * `false` when cancelled or when the reset was refused.
 */
export function promptKasOutpointReset(
  t: TFunction<['home', 'common']>,
  outpoints: readonly string[],
  onDone?: (reset: boolean) => void,
): void {
  Alert.alert(
    t('home:kas_ledger_conflict_title'),
    t('home:kas_ledger_conflict_message', {
      count: outpoints.length,
      outpoints: outpoints.map(shortOutpoint).join(', '),
    }),
    [
      {
        text: t('common:cancel'),
        style: 'cancel',
        onPress: () => onDone?.(false),
      },
      {
        text: t('home:kas_ledger_conflict_reset'),
        style: 'destructive',
        onPress: () => {
          let reset = false;
          try {
            reset = resetKasLedgerOutpoints(outpoints) > 0;
          } catch {
            reset = false;
          }
          onDone?.(reset);
        },
      },
    ],
    { cancelable: true, onDismiss: () => onDone?.(false) },
  );
}

/**
 * Surface a ledger conflict from a signing path. Returns true when `error`
 * was a conflict (handled here). Signing stays refused either way.
 */
export function handleKasLedgerConflict(
  error: unknown,
  t: TFunction<['home', 'common']>,
  displayMessage: Display,
): boolean {
  if (!isKasLedgerConflictError(error)) return false;
  if (error.refused.length > 0) {
    // A proof contradicts the UTXO source: never offer to forget anything.
    displayMessage('error', t('home:err_kas_ledger_conflict_refused'), 10000);
    return true;
  }
  promptKasOutpointReset(t, error.unprovable, (reset) => {
    if (reset) {
      displayMessage('success', t('home:kas_ledger_conflict_reset_done'));
    }
  });
  return true;
}
