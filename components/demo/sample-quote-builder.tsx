"use client";

import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { SampleDocumentPreview } from "./sample-document-preview";
import {
  calculateSampleQuote,
  marketFor,
  publicMarkets,
  taxPresentationOptions,
  type SampleQuoteState,
} from "@/lib/demo/sample-quote-adapter";

const initialState: SampleQuoteState = {
  marketId: "india",
  taxPresentation: "india-intra",
  taxMode: "exclusive",
  customerName: "Asha Engineering Works",
  discount: "12",
  items: [
    {
      id: "coupling",
      description: "Precision coupling assembly",
      quantity: "2",
      unit: "EA",
      unitPrice: "11200",
      taxRate: "18",
    },
    {
      id: "rail",
      description: "Stainless feed rail",
      quantity: "3",
      unit: "M",
      unitPrice: "3900",
      taxRate: "18",
    },
    {
      id: "bracket",
      description: "Mounting bracket set",
      quantity: "5",
      unit: "EA",
      unitPrice: "1150",
      taxRate: "18",
    },
  ],
};

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="sample-error" role="alert">
      {error}
    </p>
  ) : null;
}

export function SampleQuoteBuilder() {
  const [state, setState] = useState(initialState);
  const [tab, setTab] = useState<"form" | "document">("form");
  const [error, setError] = useState<string | null>(null);
  const formTab = useRef<HTMLButtonElement>(null);
  const documentTab = useRef<HTMLButtonElement>(null);
  const focusRequested = useRef<"form" | "document" | null>(null);
  const customerId = useId();
  const market = marketFor(state.marketId);
  useEffect(() => {
    if (!focusRequested.current) return;
    (focusRequested.current === "form"
      ? formTab
      : documentTab
    ).current?.focus();
    focusRequested.current = null;
  }, [tab]);
  const update = <K extends keyof SampleQuoteState>(
    key: K,
    value: SampleQuoteState[K],
  ) => setState((current) => ({ ...current, [key]: value }));
  const updateItem = (
    index: number,
    key: keyof SampleQuoteState["items"][number],
    value: string,
  ) =>
    setState((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  const selectMarket = (marketId: SampleQuoteState["marketId"]) => {
    const next = marketFor(marketId);
    const defaultPresentation = taxPresentationOptions(marketId)[0].value;
    setState((current) => ({
      ...current,
      marketId,
      taxPresentation: defaultPresentation,
      items: current.items.map((item) => ({ ...item, taxRate: next.rate })),
    }));
  };
  let calculated: ReturnType<typeof calculateSampleQuote> | null = null;
  let calculationError: string | null = null;
  try {
    calculated = calculateSampleQuote(state);
  } catch (cause) {
    calculationError =
      cause instanceof z.ZodError
        ? (cause.issues[0]?.message ?? "This specimen cannot be calculated.")
        : cause instanceof Error
          ? cause.message
          : "This specimen cannot be calculated.";
  }
  const setMobileTab = (next: "form" | "document", focus = false) => {
    if (focus) focusRequested.current = next;
    setTab(next);
  };
  const tabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: "form" | "document",
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setMobileTab(current === "form" ? "document" : "form", true);
  };
  const print = () => {
    if (calculated) {
      setError(null);
      window.print();
    } else
      setError(calculationError ?? "Fix the specimen fields before printing.");
  };
  return (
    <section
      className="sample-builder"
      id="sample-builder"
      aria-labelledby="sample-builder-title"
    >
      <div className="sample-builder-heading">
        <p className="eyebrow">Anonymous quotation specimen</p>
        <h2 id="sample-builder-title">Build one now — nothing is stored.</h2>
        <p>
          Use a bounded market specimen to see the document update. This does
          not create or issue a quotation.
        </p>
      </div>
      <div className="sample-banner">
        <span aria-hidden="true" /> Demo only — this quotation is not issued,
        not stored, and cannot be sent.
      </div>
      <div
        className="sample-tabs"
        role="tablist"
        aria-label="Sample quotation view"
      >
        <button
          ref={formTab}
          id="sample-builder-form-tab"
          role="tab"
          aria-controls="sample-builder-form"
          aria-selected={tab === "form"}
          tabIndex={tab === "form" ? 0 : -1}
          className={tab === "form" ? "active" : ""}
          onClick={() => setMobileTab("form")}
          onKeyDown={(event) => tabKeyDown(event, "form")}
        >
          Form
        </button>
        <button
          ref={documentTab}
          id="sample-builder-document-tab"
          role="tab"
          aria-controls="sample-builder-document"
          aria-selected={tab === "document"}
          tabIndex={tab === "document" ? 0 : -1}
          className={tab === "document" ? "active" : ""}
          onClick={() => setMobileTab("document")}
          onKeyDown={(event) => tabKeyDown(event, "document")}
        >
          Document
        </button>
      </div>
      <div className={`sample-work sample-tab-${tab}`}>
        <form
          id="sample-builder-form"
          role="tabpanel"
          aria-labelledby="sample-builder-form-tab"
          className="sample-editor"
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset>
            <legend>Market and tax treatment</legend>
            <div className="sample-grid-two">
              <label>
                Market
                <select
                  aria-label="Market"
                  value={state.marketId}
                  onChange={(event) =>
                    selectMarket(
                      event.target.value as SampleQuoteState["marketId"],
                    )
                  }
                >
                  {publicMarkets.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} — {option.currency}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="sample-tax-mode">
                <legend>Price basis</legend>
                <button
                  type="button"
                  aria-pressed={state.taxMode === "exclusive"}
                  className={state.taxMode === "exclusive" ? "active" : ""}
                  onClick={() => update("taxMode", "exclusive")}
                >
                  Exclusive
                </button>
                <button
                  type="button"
                  aria-pressed={state.taxMode === "inclusive"}
                  className={state.taxMode === "inclusive" ? "active" : ""}
                  onClick={() => update("taxMode", "inclusive")}
                >
                  Inclusive
                </button>
              </fieldset>
            </div>
            <label>
              Tax presentation
              <select
                aria-label="Tax presentation"
                value={state.taxPresentation}
                onChange={(event) =>
                  update(
                    "taxPresentation",
                    event.target.value as SampleQuoteState["taxPresentation"],
                  )
                }
              >
                {taxPresentationOptions(state.marketId).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <small className="sample-derived">
              {market.currency} · configured specimen only · final amounts are
              calculated with Tender’s shared money kernel.
            </small>
          </fieldset>
          <fieldset>
            <legend>Quotation</legend>
            <label htmlFor={customerId}>
              Customer name
              <input
                id={customerId}
                value={state.customerName}
                maxLength={120}
                onChange={(event) => update("customerName", event.target.value)}
              />
            </label>
            <label>
              Discount (%)
              <input
                inputMode="decimal"
                value={state.discount}
                onChange={(event) => update("discount", event.target.value)}
                aria-describedby="discount-help"
              />
              <small id="discount-help">
                Applied consistently by the calculator across all lines.
              </small>
            </label>
          </fieldset>
          <fieldset>
            <legend>Line items</legend>
            <div className="sample-editor-lines">
              {state.items.map((item, index) => (
                <div className="sample-editor-line" key={item.id}>
                  <label className="sample-description">
                    Description
                    <input
                      value={item.description}
                      maxLength={160}
                      onChange={(event) =>
                        updateItem(index, "description", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Qty
                    <input
                      inputMode="decimal"
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem(index, "quantity", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <select
                      value={item.unit}
                      onChange={(event) =>
                        updateItem(index, "unit", event.target.value)
                      }
                    >
                      {["EA", "M", "KG", "L", "BOX"].map((unit) => (
                        <option key={unit}>{unit}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tax %
                    <input
                      inputMode="decimal"
                      value={
                        state.taxPresentation === "export-zero" ||
                        state.taxPresentation === "us-none"
                          ? "0"
                          : item.taxRate
                      }
                      disabled={
                        state.taxPresentation === "export-zero" ||
                        state.taxPresentation === "us-none"
                      }
                      onChange={(event) =>
                        updateItem(index, "taxRate", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Unit price
                    <input
                      inputMode="decimal"
                      value={item.unitPrice}
                      onChange={(event) =>
                        updateItem(index, "unitPrice", event.target.value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="sample-remove"
                    disabled={state.items.length <= 1}
                    onClick={() =>
                      update(
                        "items",
                        state.items.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      )
                    }
                    aria-label={`Remove ${item.description || `line ${index + 1}`}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="sample-add"
              onClick={() =>
                update("items", [
                  ...state.items,
                  {
                    id: crypto.randomUUID(),
                    description: "",
                    quantity: "1",
                    unit: "EA",
                    unitPrice: "0",
                    taxRate: market.rate,
                  },
                ])
              }
            >
              + Add line item
            </button>
          </fieldset>
        </form>
        <div
          id="sample-builder-document"
          className="sample-preview"
          role="tabpanel"
          aria-labelledby="sample-builder-document-tab"
        >
          <div className="sample-paper">
            {calculated ? (
              <SampleDocumentPreview state={state} quote={calculated} />
            ) : (
              <div className="sample-calculation-error" role="alert">
                {calculationError}
              </div>
            )}
          </div>
          <div className="sample-actions">
            <button
              type="button"
              className="button button-primary"
              disabled
              aria-describedby="issue-help"
            >
              Issue quotation
            </button>
            <button type="button" className="button" onClick={print}>
              Save/Print as PDF
            </button>
            <p id="issue-help">
              Issuing requires a signed-in workspace. This anonymous specimen
              remains only in this tab.
            </p>
            <ErrorText error={error} />
          </div>
        </div>
      </div>
    </section>
  );
}
