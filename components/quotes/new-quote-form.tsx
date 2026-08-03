"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createQuoteDraft,
  type CreateQuoteState,
} from "@/app/(application)/quotes/actions";
import { SUPPORTED_CURRENCY_CODES } from "@/lib/formatting/currency";
import { newQuoteDefaultsForCustomer } from "@/lib/quotes/new-quote-defaults";

type Customer = {
  id: string;
  name: string;
  preferredCurrencyCode: string | null;
  locale: string | null;
};

export function NewQuoteForm({
  customers,
  issueDate,
  validUntil,
  defaultLocale,
  defaultCurrency,
  commandId,
}: {
  customers: Customer[];
  issueDate: string;
  validUntil: string;
  defaultLocale: string;
  defaultCurrency: string;
  commandId: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    createQuoteDraft,
    {} as CreateQuoteState,
  );
  const [customerId, setCustomerId] = useState("");
  const [currencyCode, setCurrencyCode] = useState(defaultCurrency);
  const [locale, setLocale] = useState(defaultLocale);
  useEffect(() => {
    if (state.href) router.push(state.href);
  }, [router, state.href]);
  function selectCustomer(nextCustomerId: string) {
    setCustomerId(nextCustomerId);
    const defaults = newQuoteDefaultsForCustomer(
      customers,
      nextCustomerId,
      defaultCurrency,
      defaultLocale,
    );
    setCurrencyCode(defaults.currencyCode);
    setLocale(defaults.locale);
  }
  return (
    <form action={action} className="quote-create-form">
      <input type="hidden" name="commandId" value={commandId} />
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      <div className="form-grid">
        <label className="span-2">
          Customer
          <select
            name="customerId"
            required
            value={customerId}
            onChange={(event) => selectCustomer(event.target.value)}
          >
            <option value="" disabled>
              Select a customer
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Issue date
          <input
            name="issueDate"
            type="date"
            defaultValue={issueDate}
            required
          />
        </label>
        <label>
          Valid until
          <input
            name="validUntil"
            type="date"
            defaultValue={validUntil}
            required
          />
        </label>
        <label>
          Currency
          <select
            name="currencyCode"
            value={currencyCode}
            onChange={(event) => setCurrencyCode(event.target.value)}
            required
          >
            {SUPPORTED_CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Locale
          <input
            name="locale"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            maxLength={35}
            required
          />
        </label>
        <label>
          Tax label
          <input
            name="taxLabel"
            defaultValue="Configured tax"
            maxLength={80}
            required
          />
        </label>
        <label>
          Price basis
          <select name="taxMode" defaultValue="exclusive">
            <option value="exclusive">Tax exclusive</option>
            <option value="inclusive">Tax inclusive</option>
          </select>
        </label>
      </div>
      <p className="legal-note">
        Currency and tax configuration are explicit. Locale changes presentation
        only and never converts money.
      </p>
      <button
        className="button button-primary"
        type="submit"
        disabled={pending || customers.length === 0}
      >
        {pending ? "Creating…" : "Create draft"}
      </button>
      {customers.length === 0 && (
        <p className="form-error" role="alert">
          Create a customer before starting a quotation.
        </p>
      )}
    </form>
  );
}
