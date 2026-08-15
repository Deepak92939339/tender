import type { CanonicalQuoteSnapshotV1 } from "./canonical-snapshot.ts";

export type VerifiedRevisionState =
  "draft" | "waiting" | "approved" | "rejected" | "issued";

export type RevisionRecordKind = "verified_revision" | "legacy_capture";
export type RecipientEventType =
  "viewed" | "change_requested" | "declined" | "accepted";

export type QuoteRevisionProjection = {
  id: string;
  quoteId: string;
  quoteNumber: string;
  revisionNumber: number;
  recordKind: RevisionRecordKind;
  state: VerifiedRevisionState;
  effectiveState: VerifiedRevisionState | "expired" | "accepted";
  parentRevisionId: string | null;
  legacySourceRevisionId: string | null;
  snapshotFormatVersion: number | null;
  calculationFormatVersion: number | null;
  calculationFingerprint: string | null;
  snapshotHash: string | null;
  currencyCode: string | null;
  totalMinor: number | null;
  validUntil: string | null;
  requiresManualApproval: boolean | null;
  approvalReasonCodes: string[];
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  issuedAt: string | null;
  verificationCode: string | null;
  legacyCapturedAt: string | null;
};

export type RevisionTimelineProjection = {
  quoteId: string;
  currentRevisionId: string | null;
  acceptedRevisionId: string | null;
  legacyUnverified: boolean;
  revisions: QuoteRevisionProjection[];
};

export type ApprovalImpactProjection = {
  revisionId: string;
  requiresManualApproval: boolean;
  reasonCodes: string[];
  thresholdBps: number;
};

export type CommercialDiffProjection = {
  baseRevisionId: string | null;
  candidateRevisionId: string;
  changedPaths: string[];
  oldSnapshotHash: string | null;
  newSnapshotHash: string | null;
};

export type ShareLinkProjection = {
  id: string;
  revisionId: string;
  recipientEmail: string;
  tokenFormatVersion: 1;
  expiresAt: string;
  createdAt: string;
  disabledAt: string | null;
  disabledReason: "revoked" | "superseded" | "accepted" | null;
  /** Revision-scoped terminal response; never inferred from disabledReason. */
  responseType: RecipientEventType | null;
};

export type CreateVerifiedDraftResult = {
  quoteId: string;
  quoteNumber: string;
  version: number;
  currentRevisionId: string;
  revisionNumber: 1;
};

export type LegacyAdoptionResult = CreateVerifiedDraftResult & {
  legacyCaptureId: string;
};

export type RevisionCommandResult = {
  quoteId: string;
  quoteNumber: string;
  state: VerifiedRevisionState;
  version: number;
  currentRevisionId: string;
  revisionNumber: number;
};

export type ShareLinkRevocationResult = {
  linkId: string;
  quoteId: string;
  revisionId: string;
  disabledReason: "revoked";
  disabledAt: string;
};

export type ShareLinkCreationResult = {
  status: "created" | "replayed_without_secret";
  link: ShareLinkProjection;
  selector: string;
  secret: string | null;
};

export type BuyerQuoteProjection = {
  linkId: string;
  revisionId: string;
  quoteNumber: string;
  revisionNumber: number;
  effectiveState: "issued" | "expired" | "accepted";
  snapshotHash: string;
  calculationFingerprint: string;
  snapshot: CanonicalQuoteSnapshotV1;
  responseType: RecipientEventType | null;
  acceptanceAllowed: boolean;
  acceptanceStatementVersion: 1;
  acceptanceStatement: string;
};

export type BuyerResponseProjection = {
  eventId: string;
  revisionId: string;
  linkId: string;
  type: RecipientEventType;
  message: string | null;
  createdAt: string;
};

export type AcceptanceProjection = {
  acceptanceId: string;
  quoteId: string;
  revisionId: string;
  shareLinkId: string;
  recipientEventId: string;
  acceptedAt: string;
  snapshotHash: string;
  calculationFingerprint: string;
  recipientEmailSnapshot: string;
  /** Buyer-asserted only; this is not certified identity. */
  buyerAssertedName: string;
  /** Buyer-asserted only; this is not certified identity. */
  buyerAssertedTitle: string | null;
  acceptanceStatementVersion: 1;
  acceptanceStatement: string;
  acceptanceStatementHash: string;
  replayed: boolean;
};

export type CanonicalAcceptanceStatementV1 = {
  format_version: 1;
  statement: string;
  buyer_asserted_name: string;
  buyer_asserted_title: string | null;
  revision_id: string;
  snapshot_hash: string;
  calculation_fingerprint: string;
};

export type VerificationProjection = {
  verified: boolean;
  quoteNumber: string | null;
  revisionNumber: number | null;
  sellerLegalName: string | null;
  currencyCode: string | null;
  totalMinor: number | null;
  issuedAt: string | null;
  acceptedAt: string | null;
  snapshotHash: string | null;
  calculationFingerprint: string | null;
};

export type PublicBrokerResult<T> =
  | { status: "ok"; value: T }
  | {
      status:
        | "rate_limited"
        | "invalid_link"
        | "message_invalid"
        | "idempotency_conflict"
        | "not_found"
        | "revoked"
        | "superseded"
        | "expired"
        | "accepted"
        | "already_responded"
        | "already_accepted"
        | "acceptance_evidence_invalid"
        | "stale";
    };
