/**
 * What the approval screen is doing while it reads a transaction. Purely
 * informational: shown under "Reading this transaction…" so a long check
 * (many inputs, slow backend) is visibly progressing, never a silent spinner.
 */
export type ApprovalProgress =
  | { step: 'checking_operation' }
  | { step: 'loading_inputs' }
  | { step: 'verifying_signatures'; done: number; total: number }
  | { step: 'checking_fee' };

export type ApprovalProgressListener = (progress: ApprovalProgress) => void;
