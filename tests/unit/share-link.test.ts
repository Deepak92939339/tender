import { describe, expect, it } from "vitest";
import {
  canCreateShareLink,
  capabilityUrlUsesFragment,
  createShareLinkPresentation,
  dateTimeLocalToInstant,
  exclusiveEndOfOrganizationDate,
  formatReviewableIdentifier,
  isShareExpiryWithinRevision,
  listItemHasAuthorityMaterial,
  parseCreateShareLinkResult,
  presentCommitmentEvents,
  presentShareLinks,
  recipientCapabilityUrl,
  shareLinkSelectIsPermitted,
  shareLinkStatus,
  toDateTimeLocalValue,
} from "@/lib/quotes/share-link";

const selector = "11111111-1111-4111-8111-111111111111";
const secret = "A".repeat(43);
const linkId = "22222222-2222-4222-8222-222222222222";
const revisionId = "33333333-3333-4333-8333-333333333333";

describe("issuer share-link helpers", () => {
  it("allows creation only for the current issued revision", () => {
    expect(
      canCreateShareLink({
        currentRevisionId: "rev-1",
        revisionId: "rev-1",
        revisionState: "issued",
      }),
    ).toBe(true);
    expect(
      canCreateShareLink({
        currentRevisionId: null,
        revisionId: "rev-1",
        revisionState: "issued",
      }),
    ).toBe(false);
    expect(
      canCreateShareLink({
        currentRevisionId: "rev-1",
        revisionId: "rev-1",
        revisionState: "approved",
      }),
    ).toBe(false);
    expect(
      canCreateShareLink({
        currentRevisionId: "rev-2",
        revisionId: "rev-1",
        revisionState: "issued",
      }),
    ).toBe(false);
  });

  it("builds a fragment capability URL and rejects query-parameter authority", () => {
    const url = recipientCapabilityUrl(selector, secret);
    expect(url).toBe(`/quote/${selector}#secret=${secret}`);
    expect(capabilityUrlUsesFragment(url)).toBe(true);
    expect(url).not.toContain("?secret=");
    expect(url).not.toContain(`?${secret}`);
  });

  it("keeps expiry inside the revision validity window", () => {
    const now = new Date("2026-08-15T08:00:00.000Z");
    const validUntil = "2026-08-20";
    const timeZone = "Asia/Kolkata";
    const max = exclusiveEndOfOrganizationDate(validUntil, timeZone);
    expect(max.toISOString()).toBe("2026-08-20T18:30:00.000Z");
    expect(
      isShareExpiryWithinRevision({
        expiresAt: new Date("2026-08-20T18:30:00.000Z"),
        now,
        validUntil,
        timeZone,
      }),
    ).toBe(true);
    expect(
      isShareExpiryWithinRevision({
        expiresAt: new Date("2026-08-20T18:30:00.001Z"),
        now,
        validUntil,
        timeZone,
      }),
    ).toBe(false);
    expect(
      isShareExpiryWithinRevision({
        expiresAt: now,
        now,
        validUntil,
        timeZone,
      }),
    ).toBe(false);
  });

  it("round-trips organization-local expiry independently of the browser timezone", () => {
    const instant = new Date("2026-08-20T12:15:00.000Z");
    const local = toDateTimeLocalValue(instant, "Asia/Kolkata");
    expect(local).toBe("2026-08-20T17:45");
    expect(dateTimeLocalToInstant(local, "Asia/Kolkata")?.toISOString()).toBe(
      instant.toISOString(),
    );
    expect(
      dateTimeLocalToInstant("2026-02-31T10:00", "Asia/Kolkata"),
    ).toBeNull();
  });

  it("returns the raw secret only on first create and never on replay", () => {
    const created = parseCreateShareLinkResult({
      status: "created",
      link_id: linkId,
      selector,
      secret,
      revision_id: revisionId,
      expires_at: "2026-08-20T18:30:00.000Z",
    });
    expect(created?.secret).toBe(secret);
    const presented = createShareLinkPresentation(created!);
    expect(presented.url).toBe(`/quote/${selector}#secret=${secret}`);
    const replayed = parseCreateShareLinkResult({
      status: "replayed_without_secret",
      link_id: linkId,
      selector,
      secret: null,
      revision_id: revisionId,
      expires_at: "2026-08-20T18:30:00.000Z",
    });
    expect(replayed?.secret).toBeNull();
    expect(createShareLinkPresentation(replayed!).url).toBeNull();
    expect(
      parseCreateShareLinkResult({
        status: "replayed_without_secret",
        link_id: linkId,
        selector,
        secret,
        revision_id: revisionId,
        expires_at: "2026-08-20T18:30:00.000Z",
      }),
    ).toBeNull();
    expect(
      parseCreateShareLinkResult({
        status: "created",
        link_id: linkId,
        selector,
        secret: `${secret.slice(0, -1)}B`,
        revision_id: revisionId,
        expires_at: "2026-08-20T18:30:00.000Z",
      }),
    ).toBeNull();
    expect(
      parseCreateShareLinkResult({
        status: "created",
        link_id: linkId,
        selector,
        secret,
        revision_id: revisionId,
        expires_at: "2026-08-20T18:30:00.000Z",
        unexpected: true,
      }),
    ).toBeNull();
  });

  it("lists active, expired, revoked, and revision-invalidated links at a fixed clock", () => {
    const now = new Date("2026-08-15T08:30:00.000Z");
    const items = presentShareLinks(
      [
        {
          id: linkId,
          recipient_email: "buyer@example.test",
          created_at: "2026-08-15T08:00:00.000Z",
          expires_at: "2026-08-20T18:30:00.000Z",
          disabled_at: null,
          disabled_reason: null,
          revision_id: revisionId,
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          recipient_email: "old@example.test",
          created_at: "2026-08-15T08:00:00.000Z",
          expires_at: "2026-08-15T08:00:00.000Z",
          disabled_at: null,
          disabled_reason: null,
          revision_id: revisionId,
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          recipient_email: "revoked@example.test",
          created_at: "2026-08-15T08:00:00.000Z",
          expires_at: "2026-08-16T08:00:00.000Z",
          disabled_at: "2026-08-15T09:00:00.000Z",
          disabled_reason: "revoked",
          revision_id: revisionId,
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          recipient_email: "superseded@example.test",
          created_at: "2026-08-15T08:00:00.000Z",
          expires_at: "2026-08-16T08:00:00.000Z",
          disabled_at: "2026-08-15T08:15:00.000Z",
          disabled_reason: "superseded",
          revision_id: revisionId,
        },
      ],
      now,
    );
    expect(items[0]?.status).toBe("active");
    expect(items[1]?.status).toBe("expired");
    expect(items[2]?.status).toBe("revoked");
    expect(items[3]?.status).toBe("superseded");
    expect(listItemHasAuthorityMaterial(items[0]!)).toBe(false);
    expect(JSON.stringify(items)).not.toContain("token");
    expect(JSON.stringify(items)).not.toContain(secret);
    expect(JSON.stringify(items)).not.toContain("selector");
  });

  it("derives disabled reasons ahead of expiry", () => {
    expect(
      shareLinkStatus({
        disabled_reason: "accepted",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
    ).toBe("accepted");
    expect(
      shareLinkStatus({
        disabled_reason: "superseded",
        expires_at: "2099-01-01T00:00:00.000Z",
      }),
    ).toBe("superseded");
  });

  it("attaches acceptance evidence only to its exact link and revision event", () => {
    const event = {
      id: "77777777-7777-4777-8777-777777777777",
      event_type: "accepted" as const,
      message: null,
      created_at: "2026-08-15T09:00:00.000Z",
      revision_id: revisionId,
      share_link_id: linkId,
    };
    const acceptance = {
      id: "88888888-8888-4888-8888-888888888888",
      accepted_at: "2026-08-15T09:00:00.000Z",
      recipient_email_snapshot: "buyer@example.test",
      buyer_asserted_name: "Buyer",
      buyer_asserted_title: null,
      acceptance_statement_version: 1,
      acceptance_statement: "Accepted.",
      revision_id: revisionId,
      snapshot_hash: "a".repeat(64),
      calculation_fingerprint: "b".repeat(64),
      share_link_id: linkId,
    };
    expect(
      presentCommitmentEvents(
        [event],
        [acceptance],
        new Map([[revisionId, 1]]),
      )[0]?.acceptance?.buyerAssertedName,
    ).toBe("Buyer");
    expect(
      presentCommitmentEvents(
        [{ ...event, share_link_id: selector }],
        [acceptance],
        new Map([[revisionId, 1]]),
      )[0]?.acceptance,
    ).toBeNull();
  });

  it("permits only granted share-link columns", () => {
    expect(
      shareLinkSelectIsPermitted(
        "id, revision_id, recipient_email, expires_at, created_at, disabled_at, disabled_reason",
      ),
    ).toBe(true);
    expect(shareLinkSelectIsPermitted("id, selector")).toBe(false);
    expect(shareLinkSelectIsPermitted("id, token_hash")).toBe(false);
  });

  it("shortens hash identifiers for review", () => {
    const hash = "a".repeat(64);
    expect(formatReviewableIdentifier(hash)).toBe(
      `${"a".repeat(12)}…${"a".repeat(8)}`,
    );
  });
});
