import { addDaysToIsoDate, dateInTimeZone } from "./effective-state";
import { isCanonicalBase64url } from "../public-quotes/base64url";

export const SHARE_LINK_SELECT_COLUMNS =
  "id, revision_id, recipient_email, expires_at, created_at, disabled_at, disabled_reason" as const;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ShareLinkStatus =
  "active" | "expired" | "revoked" | "superseded" | "accepted";

export type ShareLinkListItem = {
  id: string;
  recipientEmail: string;
  createdAt: string;
  expiresAt: string;
  status: ShareLinkStatus;
  revisionId: string;
};

export type ShareLinkRecord = {
  id: string;
  recipient_email: string;
  created_at: string;
  expires_at: string;
  disabled_at: string | null;
  disabled_reason: "revoked" | "superseded" | "accepted" | null;
  revision_id: string;
};

export type CreateShareLinkRpcResult = {
  status: "created" | "replayed_without_secret";
  linkId: string;
  selector: string;
  secret: string | null;
  revisionId: string;
  expiresAt: string;
};

export type RecipientEventRecord = {
  id: string;
  event_type: "change_requested" | "declined" | "accepted";
  message: string | null;
  created_at: string;
  revision_id: string;
  share_link_id: string;
};

export type AcceptanceRecord = {
  id: string;
  accepted_at: string;
  recipient_email_snapshot: string;
  buyer_asserted_name: string;
  buyer_asserted_title: string | null;
  acceptance_statement_version: number;
  acceptance_statement: string;
  revision_id: string;
  snapshot_hash: string;
  calculation_fingerprint: string;
  share_link_id: string;
};

export type CommitmentEventView = {
  id: string;
  type: "change_requested" | "declined" | "accepted";
  createdAt: string;
  message: string | null;
  revisionId: string;
  revisionNumber: number | null;
  acceptance: {
    acceptedAt: string;
    recipientEmail: string;
    buyerAssertedName: string;
    buyerAssertedTitle: string | null;
    acceptanceStatementVersion: number;
    acceptanceStatement: string;
    snapshotHash: string;
    calculationFingerprint: string;
  } | null;
};

export function canCreateShareLink(input: {
  currentRevisionId: string | null | undefined;
  revisionId: string | null | undefined;
  revisionState: string | null | undefined;
}) {
  return Boolean(
    input.currentRevisionId &&
    input.revisionId &&
    input.currentRevisionId === input.revisionId &&
    input.revisionState === "issued",
  );
}

export function recipientCapabilityUrl(selector: string, secret: string) {
  if (!UUID_V4.test(selector) || !isCanonicalBase64url(secret, 32)) {
    throw new Error("Capability material is invalid.");
  }
  return `/quote/${selector}#secret=${secret}`;
}

export function capabilityUrlUsesFragment(url: string) {
  const parsed = new URL(url, "https://tender.local");
  return (
    parsed.search === "" &&
    parsed.hash.startsWith("#secret=") &&
    !parsed.searchParams.has("secret")
  );
}

export function shareLinkStatus(
  link: Pick<ShareLinkRecord, "disabled_reason" | "expires_at">,
  now = new Date(),
): ShareLinkStatus {
  if (link.disabled_reason === "revoked") return "revoked";
  if (link.disabled_reason === "superseded") return "superseded";
  if (link.disabled_reason === "accepted") return "accepted";
  if (Date.parse(link.expires_at) <= now.getTime()) return "expired";
  return "active";
}

export function presentShareLinks(
  rows: ShareLinkRecord[],
  now = new Date(),
): ShareLinkListItem[] {
  return rows.map((row) => ({
    id: row.id,
    recipientEmail: row.recipient_email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: shareLinkStatus(row, now),
    revisionId: row.revision_id,
  }));
}

export function listItemHasAuthorityMaterial(item: ShareLinkListItem) {
  return (
    "selector" in item ||
    "secret" in item ||
    "token_hash" in item ||
    "tokenHash" in item
  );
}

export function exclusiveEndOfOrganizationDate(
  isoDate: string,
  timeZone: string,
) {
  const next = addDaysToIsoDate(isoDate, 1);
  let low = Date.parse(`${next}T00:00:00.000Z`) - 36 * 60 * 60 * 1000;
  let high = Date.parse(`${next}T00:00:00.000Z`) + 36 * 60 * 60 * 1000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dateInTimeZone(new Date(mid), timeZone) < next) low = mid + 1;
    else high = mid;
  }
  return new Date(low);
}

export function isShareExpiryWithinRevision(input: {
  expiresAt: Date;
  now: Date;
  validUntil: string;
  timeZone: string;
}) {
  const max = exclusiveEndOfOrganizationDate(input.validUntil, input.timeZone);
  return (
    input.expiresAt > input.now && input.expiresAt.getTime() <= max.getTime()
  );
}

export function defaultShareExpiry(
  validUntil: string,
  timeZone: string,
  now = new Date(),
) {
  const max = exclusiveEndOfOrganizationDate(validUntil, timeZone);
  const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const candidate = week.getTime() < max.getTime() ? week : max;
  if (candidate.getTime() <= now.getTime()) return null;
  return candidate;
}

function localDateTimeParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

export function toDateTimeLocalValue(instant: Date, timeZone?: string) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const parts = timeZone
    ? localDateTimeParts(instant, timeZone)
    : {
        year: instant.getFullYear(),
        month: instant.getMonth() + 1,
        day: instant.getDate(),
        hour: instant.getHours(),
        minute: instant.getMinutes(),
      };
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function dateTimeLocalToInstant(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const numbers = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = numbers;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const actual = localDateTimeParts(new Date(candidate), timeZone);
    const actualValue = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const difference = target - actualValue;
    if (difference === 0) {
      const instant = new Date(candidate);
      return toDateTimeLocalValue(instant, timeZone) === value ? instant : null;
    }
    candidate += difference;
  }
  return null;
}

export function formatReviewableIdentifier(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.length <= 20) return normalized;
  return `${normalized.slice(0, 12)}…${normalized.slice(-8)}`;
}

const createResultSchemaKeys = [
  "status",
  "link_id",
  "selector",
  "secret",
  "revision_id",
  "expires_at",
] as const;

export function parseCreateShareLinkResult(
  value: unknown,
): CreateShareLinkRpcResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
    [...createResultSchemaKeys].sort().join(",")
  ) {
    return null;
  }
  const status = row.status;
  if (status !== "created" && status !== "replayed_without_secret") return null;
  if (
    typeof row.link_id !== "string" ||
    !UUID_V4.test(row.link_id) ||
    typeof row.selector !== "string" ||
    !UUID_V4.test(row.selector) ||
    typeof row.revision_id !== "string" ||
    !UUID_V4.test(row.revision_id) ||
    typeof row.expires_at !== "string" ||
    !Number.isFinite(Date.parse(row.expires_at))
  ) {
    return null;
  }
  const secret =
    status === "created" && typeof row.secret === "string" && row.secret
      ? row.secret
      : null;
  if (status === "created" && (!secret || !isCanonicalBase64url(secret, 32)))
    return null;
  if (status === "replayed_without_secret" && row.secret) return null;
  return {
    status,
    linkId: row.link_id,
    selector: row.selector,
    secret,
    revisionId: row.revision_id,
    expiresAt: row.expires_at,
  };
}

export function createShareLinkPresentation(result: CreateShareLinkRpcResult) {
  if (result.status !== "created" || !result.secret) {
    return {
      status: "replayed_without_secret" as const,
      linkId: result.linkId,
      url: null,
    };
  }
  return {
    status: "created" as const,
    linkId: result.linkId,
    url: recipientCapabilityUrl(result.selector, result.secret),
  };
}

export function presentCommitmentEvents(
  events: RecipientEventRecord[],
  acceptances: AcceptanceRecord[],
  revisionNumbers: ReadonlyMap<string, number>,
): CommitmentEventView[] {
  const acceptanceByEventShare = new Map(
    acceptances.map((row) => [`${row.share_link_id}:${row.revision_id}`, row]),
  );
  return events.map((event) => {
    const acceptance =
      event.event_type === "accepted"
        ? (acceptanceByEventShare.get(
            `${event.share_link_id}:${event.revision_id}`,
          ) ?? null)
        : null;
    return {
      id: event.id,
      type: event.event_type,
      createdAt: event.created_at,
      message: event.message,
      revisionId: event.revision_id,
      revisionNumber: revisionNumbers.get(event.revision_id) ?? null,
      acceptance: acceptance
        ? {
            acceptedAt: acceptance.accepted_at,
            recipientEmail: acceptance.recipient_email_snapshot,
            buyerAssertedName: acceptance.buyer_asserted_name,
            buyerAssertedTitle: acceptance.buyer_asserted_title,
            acceptanceStatementVersion: acceptance.acceptance_statement_version,
            acceptanceStatement: acceptance.acceptance_statement,
            snapshotHash: acceptance.snapshot_hash,
            calculationFingerprint: acceptance.calculation_fingerprint,
          }
        : null,
    };
  });
}

export function shareLinkSelectIsPermitted(columns: string) {
  const requested = columns.split(",").map((value) => value.trim());
  const forbidden = [
    "selector",
    "token_hash",
    "token_format_version",
    "token_hash_algorithm",
  ];
  return (
    requested.every((column) =>
      SHARE_LINK_SELECT_COLUMNS.split(", ")
        .map((value) => value.trim())
        .includes(column),
    ) && forbidden.every((column) => !requested.includes(column))
  );
}

export { createResultSchemaKeys };
