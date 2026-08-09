"use client";
import { useState } from "react";
import { DecisionDocument } from "./decision-document";
import { SAMPLE_QUOTE_FIXTURES } from "@/lib/demo/sample-quote-fixtures";

export function DecisionRoomHero() {
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  return (
    <section className="decision-hero" id="product">
      <div className="decision-copy">
        <p className="eyebrow">Commercial quotations, held to a clear rule.</p>
        <h1>Priced once. Approved on the record. Issued unchanged.</h1>
        <p>
          Currency, tax, approval and history stay attached to the same document
          from catalog to issue.
        </p>
        <div className="button-row">
          <a className="button button-primary" href="#sample-builder">
            Build a sample quote
          </a>
          <a className="button" href="/sign-in">
            Sign in
          </a>
        </div>
      </div>
      <div className="decision-stage">
        <div
          className="decision-mobile-switch"
          role="group"
          aria-label="Hero quotation currency"
        >
          {(["INR", "USD"] as const).map((code) => (
            <button
              type="button"
              aria-pressed={currency === code}
              className={currency === code ? "active" : ""}
              onClick={() => setCurrency(code)}
              key={code}
            >
              {code}
            </button>
          ))}
        </div>
        <div className="decision-documents">
          <div className="decision-rear">
            <DecisionDocument
              input={SAMPLE_QUOTE_FIXTURES.USD}
              number="TND-2026-0042"
              label="USD sample quotation"
            />
          </div>
          <div className="decision-front">
            <DecisionDocument
              input={SAMPLE_QUOTE_FIXTURES.INR}
              number="TND-2026-0041"
              label="INR sample quotation"
            />
          </div>
        </div>
        <div className="decision-mobile-document">
          <DecisionDocument
            input={SAMPLE_QUOTE_FIXTURES[currency]}
            number={currency === "INR" ? "TND-2026-0041" : "TND-2026-0042"}
            label={`${currency} sample quotation`}
          />
        </div>
      </div>
    </section>
  );
}
