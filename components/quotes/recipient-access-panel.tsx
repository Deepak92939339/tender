"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createQuoteShareLinkAction,
  revokeQuoteShareLinkAction,
} from "@/app/(application)/quotes/actions";
import {
  capabilityUrlUsesFragment,
  dateTimeLocalToInstant,
  toDateTimeLocalValue,
  type ShareLinkListItem,
  type ShareLinkStatus,
} from "@/lib/quotes/share-link";

type RecipientAccessPanelProps = {
  quoteId: string;
  quoteVersion: number;
  revisionId: string;
  revisionNumber: number;
  timezone: string;
  locale: string;
  maxExpiresAt: string;
  defaultExpiresAt: string;
  links: ShareLinkListItem[];
};

const statusLabel: Record<ShareLinkStatus, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  superseded: "Superseded",
  accepted: "Accepted",
};

export function RecipientAccessPanel({
  quoteId,
  quoteVersion,
  revisionId,
  revisionNumber,
  timezone,
  locale,
  maxExpiresAt,
  defaultExpiresAt,
  links,
}: RecipientAccessPanelProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [expiresLocal, setExpiresLocal] = useState(
    toDateTimeLocalValue(new Date(defaultExpiresAt), timezone),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ShareLinkListItem | null>(
    null,
  );
  const revokeDialogRef = useRef<HTMLDialogElement>(null);
  const revokeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const createCommandRef = useRef<string | null>(null);
  const revokeCommandRefs = useRef(new Map<string, string>());

  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });

  async function createLink() {
    setBusy(true);
    setCopied(false);
    setCreatedUrl(null);
    setMessage("Creating recipient link…");
    const expiresAt = dateTimeLocalToInstant(expiresLocal, timezone);
    if (!expiresAt) {
      setBusy(false);
      setMessage(
        `Choose a valid expiry date and time in the ${timezone} timezone.`,
      );
      return;
    }
    const result = await createQuoteShareLinkAction({
      quoteId,
      revisionId,
      expectedVersion: quoteVersion,
      commandId: (createCommandRef.current ??= crypto.randomUUID()),
      recipientEmail: email,
      expiresAt: expiresAt.toISOString(),
    });
    setBusy(false);
    setMessage(result.message);
    if (result.status === "created" && result.url) {
      setCreatedUrl(result.url);
    }
    if (result.status !== "failed") {
      createCommandRef.current = null;
      router.refresh();
    }
  }

  async function copyCreatedLink() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(
      `${window.location.origin}${createdUrl}`,
    );
    setCopied(true);
  }

  function openRevoke(link: ShareLinkListItem) {
    setRevokeTarget(link);
    setMessage("");
    revokeDialogRef.current?.showModal();
  }

  function closeRevoke() {
    revokeDialogRef.current?.close();
    const id = revokeTarget?.id;
    setRevokeTarget(null);
    if (id) revokeButtonRefs.current.get(id)?.focus();
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setBusy(true);
    setMessage("Revoking recipient link…");
    let commandId = revokeCommandRefs.current.get(revokeTarget.id);
    if (!commandId) {
      commandId = crypto.randomUUID();
      revokeCommandRefs.current.set(revokeTarget.id, commandId);
    }
    const result = await revokeQuoteShareLinkAction({
      quoteId,
      shareLinkId: revokeTarget.id,
      expectedVersion: quoteVersion,
      commandId,
    });
    setBusy(false);
    setMessage(result.message);
    if (result.status === "ok") {
      revokeCommandRefs.current.delete(revokeTarget.id);
      closeRevoke();
      router.refresh();
    }
  }

  return (
    <section
      className="recipient-access"
      aria-labelledby="recipient-access-heading"
    >
      <header>
        <p className="eyebrow">Sharing</p>
        <h2 id="recipient-access-heading">Recipient access</h2>
        <p>
          Create a one-time capability link for issued revision {revisionNumber}
          . Tender does not send email. The raw secret is shown only once and
          cannot be recovered after you leave this page.
        </p>
      </header>
      <form
        className="recipient-access-form"
        onSubmit={(event) => {
          event.preventDefault();
          void createLink();
        }}
      >
        <label>
          Recipient email
          <input
            type="email"
            name="recipientEmail"
            autoComplete="off"
            required
            minLength={3}
            maxLength={254}
            value={email}
            onChange={(event) => {
              createCommandRef.current = null;
              setEmail(event.target.value);
            }}
          />
        </label>
        <label>
          Link expires
          <input
            type="datetime-local"
            name="expiresAt"
            required
            max={toDateTimeLocalValue(new Date(maxExpiresAt), timezone)}
            value={expiresLocal}
            onChange={(event) => {
              createCommandRef.current = null;
              setExpiresLocal(event.target.value);
            }}
          />
        </label>
        <button className="button button-primary" type="submit" disabled={busy}>
          Create recipient link
        </button>
      </form>
      {message && (
        <p className="workflow-message" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {createdUrl && capabilityUrlUsesFragment(createdUrl) && (
        <div className="recipient-created-link">
          <p>
            Copy or open this link now. Leaving this page permanently discards
            the secret. Replay will not recover it.
          </p>
          <div className="recipient-created-actions">
            <button
              className="button"
              type="button"
              onClick={() => void copyCreatedLink()}
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
            <a className="button button-primary" href={createdUrl}>
              Open link
            </a>
          </div>
        </div>
      )}
      <div className="recipient-link-list">
        <h3>Existing links</h3>
        {links.length === 0 ? (
          <p className="quiet-empty">No recipient links have been created.</p>
        ) : (
          <table>
            <caption className="sr-only">
              Recipient links for this issued quotation
            </caption>
            <thead>
              <tr>
                <th scope="col">Recipient</th>
                <th scope="col">Created</th>
                <th scope="col">Expires</th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <td>{link.recipientEmail}</td>
                  <td>
                    <time dateTime={link.createdAt}>
                      {dateTime.format(new Date(link.createdAt))}
                    </time>
                  </td>
                  <td>
                    <time dateTime={link.expiresAt}>
                      {dateTime.format(new Date(link.expiresAt))}
                    </time>
                  </td>
                  <td>
                    <span className={`state-label share-state-${link.status}`}>
                      {statusLabel[link.status]}
                    </span>
                  </td>
                  <td>
                    {link.status === "active" && (
                      <button
                        ref={(node) => {
                          if (node) revokeButtonRefs.current.set(link.id, node);
                          else revokeButtonRefs.current.delete(link.id);
                        }}
                        className="text-action"
                        type="button"
                        onClick={() => openRevoke(link)}
                        disabled={busy}
                      >
                        Revoke link
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <dialog
        className="reject-dialog"
        ref={revokeDialogRef}
        aria-labelledby="revoke-link-heading"
        onClose={() => setRevokeTarget(null)}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not([disabled])",
            ),
          );
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first && last) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement === last &&
            first
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmRevoke();
          }}
        >
          <p className="eyebrow">Sharing</p>
          <h2 id="revoke-link-heading">Revoke recipient link</h2>
          <p>
            {revokeTarget
              ? `Revoke access for ${revokeTarget.recipientEmail}? The recipient will no longer be able to open this quotation.`
              : "Revoke this recipient link?"}
          </p>
          <div className="dialog-actions">
            <button className="button" type="button" onClick={closeRevoke}>
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={busy}
            >
              Confirm revocation
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
