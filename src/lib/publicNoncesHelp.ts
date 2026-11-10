/**
 * Recognises out-of-sync EVM public nonces so Home can show the
 * PublicNoncesOutOfSync screen instead of a bare error toast.
 *
 * EVM co-signing needs one of the public nonces SSP Key previously shared
 * with SSP Wallet. When the wallet's copy and the Key's copy diverge (Key
 * reinstalled/restored, an interrupted signing, nonces used up), signing is
 * refused with `PublicNoncesMismatchError`.
 */
import { PublicNoncesMismatchError } from './constructTx';

export function isPublicNoncesMismatchError(
  error: unknown,
): error is PublicNoncesMismatchError {
  return (
    error instanceof PublicNoncesMismatchError ||
    (error instanceof Error &&
      error.name === 'PublicNoncesMismatchError' &&
      ((error as PublicNoncesMismatchError).reason === 'missing' ||
        (error as PublicNoncesMismatchError).reason === 'mismatch'))
  );
}
