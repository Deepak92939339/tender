"use client";
import { useId, useState } from "react";
import { z } from "zod";
import { SampleDocumentPreview } from "./sample-document-preview";
import {
  calculateSampleQuote,
  type SampleQuoteState,
} from "@/lib/demo/sample-quote-adapter";

const initialState: SampleQuoteState = {
  currency: "INR",
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
  const customerId = useId();
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
  let calculated: ReturnType<typeof calculateSampleQuote> | null = null;
  let calculationError: string | null = null;
  try {
    calculated = calculateSampleQuote(state);
  } catch (cause) {
    calculationError =
      cause instanceof z.ZodError
        ? (cause.issues[0]?.message ?? "This sample cannot be calculated.")
        : cause instanceof Error
          ? cause.message
          : "This sample cannot be calculated.";
  }
  const preview = calculated ? (
    <SampleDocumentPreview state={state} quote={calculated} />
  ) : (
    <div className="sample-calculation-error" role="alert">
      {calculationError}
    </div>
  );
  const print = () => {
    try {
      calculateSampleQuote(state);
      setError(null);
      window.print();
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? (cause.issues[0]?.message ?? "Fix the sample fields.")
          : cause instanceof Error
            ? cause.message
            : "Fix the sample fields.",
      );
    }
  };
  return (
    <section
      className="sample-builder"
      id="sample-builder"
      aria-labelledby="sample-builder-title"
    >
      <div className="sample-builder-heading">
        <p className="eyebrow">Anonymous specimen</p>
        <h2 id="sample-builder-title">Build a sample quote</h2>
        <p>Sample workspace. Nothing is saved.</p>
      </div>
      <div className="sample-banner">
        This quotation remains in this browser tab and cannot be issued.
      </div>
      <div
        className="sample-tabs"
        role="tablist"
        aria-label="Sample quote view"
      >
        <button
          id="sample-builder-form-tab"
          role="tab"
          aria-controls="sample-builder-form"
          aria-selected={tab === "form"}
          className={tab === "form" ? "active" : ""}
          onClick={() => setTab("form")}
        >
          Form
        </button>
        <button
          id="sample-builder-document-tab"
          role="tab"
          aria-controls="sample-builder-document"
          aria-selected={tab === "document"}
          className={tab === "document" ? "active" : ""}
          onClick={() => setTab("document")}
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
            <legend>Market</legend>
            <div className="sample-grid-two">
              <label>
                Currency
                <select
                  value={state.currency}
                  onChange={(event) =>
                    update("currency", event.target.value as "INR" | "USD")
                  }
                >
                  <option value="INR">INR — Indian rupee</option>
                  <option value="USD">USD — US dollar</option>
                </select>
              </label>
              <fieldset className="sample-tax-mode">
                <legend>Tax basis</legend>
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
          </fieldset>
          <fieldset>
            <legend>Quote</legend>
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
              <small id="discount-help">Applied to all line items.</small>
            </label>
          </fieldset>
          <fieldset>
            <legend>Line items</legend>
            <div className="sample-editor-lines">
              {state.items.map((item, index) => (
                <div className="sample-editor-line" key={item.id}>
                  <label>
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
                    Quantity
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
                    Tax rate
                    <select
                      value={item.taxRate}
                      onChange={(event) =>
                        updateItem(index, "taxRate", event.target.value)
                      }
                    >
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="18">18%</option>
                    </select>
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
                    taxRate: "18",
                  },
                ])
              }
            >
              Add line item
            </button>
          </fieldset>
        </form>
        <div
          id="sample-builder-document"
          className="sample-preview"
          role="tabpanel"
          aria-labelledby="sample-builder-document-tab"
        >
          <div className="sample-paper">{preview}</div>
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
              Issuing creates an accountable commercial record and requires a
              signed-in workspace.
            </p>
            <ErrorText error={error} />
          </div>
        </div>
      </div>
    </section>
  );
}
