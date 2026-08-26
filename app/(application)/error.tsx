"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ApplicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Tender application render failed", error);
  }, [error]);

  return (
    <section className="recovery-page" role="alert">
      <p className="eyebrow">Workspace interrupted</p>
      <h1>Tender could not load this workspace view.</h1>
      <p>
        Your data was not changed. Retry once; if the problem continues, use the
        public guide or return to reviewer access.
      </p>
      <div className="button-row">
        <button className="button button-primary" type="button" onClick={reset}>
          Retry this page
        </button>
        <Link className="button" href="/help">
          Open help
        </Link>
        <Link className="button" href="/sign-in">
          Reviewer access
        </Link>
      </div>
      {error.digest && <small>Reference: {error.digest}</small>}
    </section>
  );
}
