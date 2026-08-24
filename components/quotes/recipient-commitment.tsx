import {
  formatReviewableIdentifier,
  type CommitmentEventView,
} from "@/lib/quotes/share-link";

type RecipientCommitmentProps = {
  locale: string;
  timezone: string;
  events: CommitmentEventView[];
};

const eventLabel = {
  change_requested: "Change requested",
  declined: "Declined",
  accepted: "Accepted",
} as const;

export function RecipientCommitment({
  locale,
  timezone,
  events,
}: RecipientCommitmentProps) {
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  return (
    <section
      className="recipient-commitment"
      aria-labelledby="recipient-commitment-heading"
    >
      <header>
        <p className="eyebrow">Recipient response</p>
        <h2 id="recipient-commitment-heading">Recipient commitment</h2>
        <p>
          Responses below are recorded against the issued revision. A typed name
          is a buyer assertion and acceptance evidence, not a certified digital
          signature.
        </p>
      </header>
      {events.length === 0 ? (
        <p className="quiet-empty">
          No change request, decline, or acceptance has been recorded.
        </p>
      ) : (
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{eventLabel[event.type]}</strong>
                {event.revisionNumber ? (
                  <span>Revision {event.revisionNumber}</span>
                ) : null}
                {event.message ? <span>{event.message}</span> : null}
                {event.acceptance && (
                  <dl className="acceptance-evidence">
                    <div>
                      <dt>Accepted</dt>
                      <dd>
                        <time dateTime={event.acceptance.acceptedAt}>
                          {dateTime.format(
                            new Date(event.acceptance.acceptedAt),
                          )}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt>Recipient email snapshot</dt>
                      <dd>{event.acceptance.recipientEmail}</dd>
                    </div>
                    <div>
                      <dt>Buyer-asserted name</dt>
                      <dd>{event.acceptance.buyerAssertedName}</dd>
                    </div>
                    {event.acceptance.buyerAssertedTitle && (
                      <div>
                        <dt>Buyer-asserted title</dt>
                        <dd>{event.acceptance.buyerAssertedTitle}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Acceptance statement version</dt>
                      <dd>{event.acceptance.acceptanceStatementVersion}</dd>
                    </div>
                    <div>
                      <dt>Revision identity</dt>
                      <dd>
                        <code>{event.revisionId}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Snapshot hash</dt>
                      <dd>
                        <code title={event.acceptance.snapshotHash}>
                          {formatReviewableIdentifier(
                            event.acceptance.snapshotHash,
                          )}
                        </code>
                      </dd>
                    </div>
                    <div>
                      <dt>Calculation fingerprint</dt>
                      <dd>
                        <code title={event.acceptance.calculationFingerprint}>
                          {formatReviewableIdentifier(
                            event.acceptance.calculationFingerprint,
                          )}
                        </code>
                      </dd>
                    </div>
                    <div className="acceptance-statement">
                      <dt>Recorded statement</dt>
                      <dd>{event.acceptance.acceptanceStatement}</dd>
                    </div>
                  </dl>
                )}
              </div>
              <time dateTime={event.createdAt}>
                {dateTime.format(new Date(event.createdAt))}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
