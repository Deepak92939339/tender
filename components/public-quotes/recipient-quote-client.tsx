"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Brand } from "@/components/ui/brand";
import type {
  BuyerQuoteProjection,
  VerificationProjection,
} from "@/lib/quotes/commitment-contracts";
import {
  normalizeVerificationCode,
  recipientQuoteViewModel,
  verificationViewModel,
  type RecipientQuoteViewModel,
} from "@/lib/public-quotes/view-model";

type AccessStatus =
  | "loading"
  | "ready"
  | "invalid_link"
  | "rate_limited"
  | "session_invalid"
  | "unavailable"
  | "revoked"
  | "superseded"
  | "expired"
  | "accepted"
  | "already_responded"
  | "already_accepted"
  | "stale";
type DialogKind = "change" | "decline" | "accept" | null;
type MutationStatus =
  | "idle"
  | "pending"
  | "success"
  | AccessStatus
  | "idempotency_conflict"
  | "message_invalid"
  | "acceptance_evidence_invalid";
type VerificationState = {
  status:
    | "idle"
    | "pending"
    | "verified"
    | "not_found"
    | "invalid"
    | "unavailable"
    | "rate_limited";
  result: ReturnType<typeof verificationViewModel>;
};

const terminalMessages: Partial<Record<AccessStatus, string>> = {
  invalid_link: "This quotation link is not valid.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  session_invalid:
    "Your secure quotation session has expired. Open the original link again.",
  unavailable: "The quotation service is temporarily unavailable.",
  revoked: "This quotation link has been revoked.",
  superseded: "This quotation revision has been superseded.",
  expired: "This quotation has expired.",
  accepted: "This quotation has already been accepted.",
  already_responded: "A response has already been recorded for this revision.",
  already_accepted: "This quotation has already been accepted.",
  stale: "This revision is no longer current.",
};

function stateLabel(quote: RecipientQuoteViewModel) {
  if (quote.responseType === "accepted") return "Accepted";
  if (quote.responseType === "declined") return "Declined";
  if (quote.responseType === "change_requested")
    return "Change request recorded";
  return quote.effectiveState === "issued" ? "Issued" : quote.effectiveState;
}

function quantity(
  item: RecipientQuoteViewModel["items"][number],
  locale: string,
) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.round(Math.log10(item.quantity_scale)),
  }).format(item.quantity_scaled / item.quantity_scale);
}

function Dialog({
  open,
  title,
  pending,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  pending: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = ref.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      focusable()[0] ??
      panel
    )?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      previous?.focus();
    };
  }, [open, pending, onClose]);
  if (!open) return null;
  return (
    <div className="recipient-dialog-backdrop">
      <section
        ref={ref}
        className="recipient-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </section>
    </div>
  );
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({ status: "unavailable" }));
  return { response, result: result as Record<string, unknown> };
}

export function RecipientQuoteClient({ selector }: { selector: string }) {
  const [access, setAccess] = useState<AccessStatus>("loading");
  const [quote, setQuote] = useState<RecipientQuoteViewModel | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [mutation, setMutation] = useState<MutationStatus>("idle");
  const [verification, setVerification] = useState<VerificationState>({
    status: "idle",
    result: null,
  });

  useEffect(() => {
    let active = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const secret = fragment.get("secret");
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    if (!secret) {
      queueMicrotask(() => active && setAccess("invalid_link"));
      return;
    }
    void post("/api/public-quotes/session", { selector, secret })
      .then(({ result }) => {
        if (!active) return;
        if (result.status) {
          setAccess(result.status as AccessStatus);
          return;
        }
        const projection = result as unknown as BuyerQuoteProjection;
        setQuote(recipientQuoteViewModel(projection));
        setAccess("ready");
        void post("/api/public-quotes/action", {
          action: "record_event",
          eventType: "viewed",
          idempotencyKey: crypto.randomUUID(),
        });
      })
      .catch(() => active && setAccess("unavailable"));
    return () => {
      active = false;
    };
  }, [selector]);

  async function submit(
    action: "change_requested" | "declined",
    message?: string,
  ) {
    setMutation("pending");
    const body =
      action === "change_requested"
        ? {
            action: "record_event",
            eventType: action,
            message,
            idempotencyKey: crypto.randomUUID(),
          }
        : {
            action: "record_event",
            eventType: action,
            idempotencyKey: crypto.randomUUID(),
          };
    const { result } = await post("/api/public-quotes/action", body).catch(
      () => ({ result: { status: "unavailable" } }),
    );
    const status = result.status as MutationStatus | undefined;
    if (status) {
      setMutation(status);
      if (terminalMessages[status as AccessStatus])
        setAccess(status as AccessStatus);
      return;
    }
    setMutation("success");
    setQuote((current) =>
      current ? { ...current, responseType: action } : current,
    );
  }

  async function verify(value: string) {
    const verificationCode = normalizeVerificationCode(value);
    if (!verificationCode) {
      setVerification({ status: "invalid", result: null });
      return;
    }
    setVerification({ status: "pending", result: null });
    const { result } = await post("/api/public-quotes/verify", {
      verificationCode,
    }).catch(() => ({ result: { status: "unavailable" } }));
    if (result.status) {
      setVerification({
        status: result.status as "not_found" | "unavailable" | "rate_limited",
        result: null,
      });
      return;
    }
    setVerification({
      status: "verified",
      result: verificationViewModel(
        result as unknown as VerificationProjection,
      ),
    });
  }

  if (access !== "ready" || !quote)
    return (
      <main id="main-content" className="recipient-shell">
        <header className="recipient-header">
          <Brand />
        </header>
        <section className="recipient-access" role="status" aria-live="polite">
          <h1>
            {access === "loading"
              ? "Opening quotation"
              : "Quotation unavailable"}
          </h1>
          <p>
            {access === "loading"
              ? "Establishing a secure session…"
              : terminalMessages[access]}
          </p>
        </section>
      </main>
    );
  const canRespond =
    quote.effectiveState === "issued" && quote.responseType === null;
  return (
    <main id="main-content" className="recipient-shell">
      <header className="recipient-header">
        <Brand />
        <span>Secure quotation view</span>
      </header>
      <div className="recipient-content">
        <article className="recipient-document">
          <header className="recipient-document-header">
            <div>
              <p className="eyebrow">Commercial quotation</p>
              <h1>{quote.quoteNumber}</h1>
              <p>
                Revision {quote.revisionNumber} · Issued {quote.issueDate} ·
                Valid until {quote.validUntil}
              </p>
            </div>
            <strong className="recipient-state">{stateLabel(quote)}</strong>
          </header>
          <section className="recipient-parties">
            <address>
              <span>Seller</span>
              <strong>{quote.seller.legal_name}</strong>
              <small>
                {[
                  quote.seller.address_line1,
                  quote.seller.address_line2,
                  quote.seller.city,
                  quote.seller.region,
                  quote.seller.postal_code,
                  quote.seller.country_code,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </small>
            </address>
            <address>
              <span>Buyer</span>
              <strong>{quote.buyer.name}</strong>
              <small>
                {[
                  quote.buyer.contact_name,
                  quote.buyer.email,
                  quote.buyer.address_line1,
                  quote.buyer.address_line2,
                  quote.buyer.city,
                  quote.buyer.region,
                  quote.buyer.postal_code,
                  quote.buyer.country_code,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </small>
            </address>
          </section>
          <div className="recipient-lines">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Unit price</th>
                  <th>Tax</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {quote.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Item">
                      <strong>{item.sku}</strong>
                      <span>{item.description}</span>
                    </td>
                    <td data-label="Quantity">
                      {quantity(item, quote.locale)} {item.unit_code}
                    </td>
                    <td data-label="Unit price">{item.unitPriceDisplay}</td>
                    <td data-label="Tax">{item.tax_code}</td>
                    <td data-label="Amount">{item.totalDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {quote.charges.length > 0 && (
            <section className="recipient-charges">
              <h2>Charges</h2>
              {quote.charges.map((charge) => (
                <p key={charge.id}>
                  <span>{charge.description}</span>
                  <strong>{charge.totalDisplay}</strong>
                </p>
              ))}
            </section>
          )}
          <dl className="recipient-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{quote.totals.subtotal}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>− {quote.totals.discount}</dd>
            </div>
            <div>
              <dt>{quote.taxLabel}</dt>
              <dd>{quote.totals.tax}</dd>
            </div>
            <div>
              <dt>Charges</dt>
              <dd>{quote.totals.charges}</dd>
            </div>
            <div className="recipient-grand-total">
              <dt>Total</dt>
              <dd>{quote.totals.total}</dd>
            </div>
          </dl>
          {quote.notes && (
            <section className="recipient-notes">
              <h2>Commercial notes</h2>
              <p>{quote.notes}</p>
            </section>
          )}
          <footer>
            Verification code evidence · Snapshot{" "}
            <code>{quote.snapshotHash.slice(0, 16)}</code> · Calculation{" "}
            <code>{quote.calculationFingerprint.slice(0, 16)}</code>
          </footer>
        </article>
        <section className="recipient-actions">
          <h2>Respond to this revision</h2>
          <p>A response is recorded against this exact issued revision.</p>
          {canRespond ? (
            <div className="recipient-action-row">
              <button
                onClick={() => {
                  setMutation("idle");
                  setDialog("change");
                }}
              >
                Request changes
              </button>
              <button
                className="danger"
                onClick={() => {
                  setMutation("idle");
                  setDialog("decline");
                }}
              >
                Decline
              </button>
              <button
                className="primary"
                disabled
                title="Acceptance is unavailable until the authoritative statement is available to this view."
              >
                Accept quotation
              </button>
            </div>
          ) : (
            <p className="recipient-muted">
              No further response can be recorded for this revision.
            </p>
          )}
        </section>
        <VerificationSection verification={verification} onSubmit={verify} />
      </div>
      <ChangeDialog
        open={dialog === "change"}
        pending={mutation === "pending"}
        status={mutation}
        onClose={() => setDialog(null)}
        onSubmit={(message) => void submit("change_requested", message)}
      />
      <DeclineDialog
        open={dialog === "decline"}
        pending={mutation === "pending"}
        status={mutation}
        onClose={() => setDialog(null)}
        onSubmit={() => void submit("declined")}
      />
    </main>
  );
}

function ChangeDialog({
  open,
  pending,
  status,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  status: MutationStatus;
  onClose(): void;
  onSubmit(message: string): void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      title="Request changes"
      pending={pending}
      onClose={onClose}
    >
      <p>
        A change request records your message only. It does not modify the
        issued quotation or promise a replacement revision.
      </p>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const trimmed = message.trim();
          if (!trimmed || Array.from(trimmed).length > 2000) {
            setError("Enter a message of 1 to 2,000 characters.");
            return;
          }
          onSubmit(trimmed);
        }}
      >
        <label>
          Message to the issuer
          <textarea
            data-autofocus
            value={message}
            maxLength={2000}
            disabled={pending}
            onChange={(event) => {
              setMessage(event.target.value);
              setError("");
            }}
          />
        </label>
        <small>{Array.from(message).length}/2,000 characters</small>
        {error && <p role="alert">{error}</p>}
        {status === "success" && (
          <p role="status">Your change request was recorded.</p>
        )}
        {status !== "idle" && status !== "pending" && status !== "success" && (
          <p role="alert">
            {terminalMessages[status as AccessStatus] ??
              "The request could not be recorded."}
          </p>
        )}
        <div className="recipient-dialog-actions">
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={pending}>
            {pending ? "Recording…" : "Send change request"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function DeclineDialog({
  open,
  pending,
  status,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  status: MutationStatus;
  onClose(): void;
  onSubmit(): void;
}) {
  return (
    <Dialog
      open={open}
      title="Decline quotation"
      pending={pending}
      onClose={onClose}
    >
      <p>
        Declining records a terminal response for this exact issued revision.
      </p>
      {status !== "idle" && status !== "pending" && (
        <p role="status">
          {status === "success"
            ? "Your decline was recorded."
            : (terminalMessages[status as AccessStatus] ??
              "The decline could not be recorded.")}
        </p>
      )}
      <div className="recipient-dialog-actions">
        <button onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button
          className="danger"
          onClick={onSubmit}
          disabled={pending}
          data-autofocus
        >
          {pending ? "Recording…" : "Confirm decline"}
        </button>
      </div>
    </Dialog>
  );
}
function VerificationSection({
  verification,
  onSubmit,
}: {
  verification: VerificationState;
  onSubmit(value: string): void;
}) {
  const [value, setValue] = useState("");
  const result = verification.result;
  return (
    <section className="recipient-verification">
      <h2>Verify a quotation</h2>
      <p>Enter the 32-character code from the document footer.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <label>
          Verification code
          <input
            value={value}
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button disabled={verification.status === "pending"}>
          {verification.status === "pending" ? "Checking…" : "Verify record"}
        </button>
      </form>
      <div aria-live="polite">
        {verification.status === "verified" && result && (
          <p className="recipient-verified">
            Verified · {result.quoteNumber} revision {result.revisionNumber} ·{" "}
            {result.totalDisplay}
          </p>
        )}
        {verification.status === "invalid" && (
          <p>
            The verification code must contain exactly 32 hexadecimal
            characters.
          </p>
        )}
        {verification.status === "not_found" && (
          <p>No issued revision matches this code.</p>
        )}
        {verification.status === "rate_limited" && (
          <p>Too many verification attempts. Please wait and try again.</p>
        )}
        {verification.status === "unavailable" && (
          <p>Verification is temporarily unavailable.</p>
        )}
      </div>
    </section>
  );
}
