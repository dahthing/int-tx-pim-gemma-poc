export interface ReviewOutcome {
  externalId?: string;
  status: 'submitted' | 'live' | 'rejected';
  reason?: string;
}

// PLACEHOLDER status vocabulary (S0.8).
const LIVE = new Set(['APPROVED', 'ONLINE']);
const REJECTED = new Set(['REJECTED', 'REVIEW_FAILED']);
const PENDING = new Set(['PENDING_REVIEW', 'UNDER_REVIEW']);

export function mapReviewStatus(raw: { status: string; reason?: string | null }): ReviewOutcome {
  if (LIVE.has(raw.status)) return { status: 'live' };
  if (REJECTED.has(raw.status)) return { status: 'rejected', reason: raw.reason || 'rejected by Temu (no reason given)' };
  if (PENDING.has(raw.status)) return { status: 'submitted' };
  return { status: 'submitted', reason: `unknown review status: ${raw.status}` };
}
