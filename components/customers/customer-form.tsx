"use client";

import { useActionState } from "react";
import {
  createCustomer,
  updateCustomer,
  type CustomerMutationState,
} from "@/app/(application)/customers/actions";
import { SUPPORTED_CURRENCY_CODES } from "@/lib/formatting/currency";

export type CustomerDefaults = {
  id?: string;
  name?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  locale?: string;
  currencyCode?: string;
  taxTreatment?: "standard" | "exempt" | "zero_rated" | "reverse_charge";
  taxIdentifier?: string;
  version?: number;
};

export function CustomerForm({
  defaults = {},
  mode = "create",
  commandId,
}: {
  defaults?: CustomerDefaults;
  mode?: "create" | "edit";
  commandId: string;
}) {
  const action = mode === "create" ? createCustomer : updateCustomer;
  const [state, formAction, pending] = useActionState(
    action,
    {} as CustomerMutationState,
  );
  return (
    <form action={formAction} className="record-form" noValidate>
      <input type="hidden" name="commandId" value={commandId} />
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      {state.message && (
        <div className="form-success" role="status">
          {state.message}
        </div>
      )}
      {defaults.id && (
        <input type="hidden" name="customerId" value={defaults.id} />
      )}
      {defaults.version && (
        <input type="hidden" name="expectedVersion" value={defaults.version} />
      )}
      <div className="form-grid">
        <label className="span-2">
          Customer name
          <input
            name="name"
            defaultValue={defaults.name}
            required
            maxLength={160}
          />
        </label>
        <label>
          Contact name
          <input
            name="contactName"
            defaultValue={defaults.contactName}
            maxLength={120}
          />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            defaultValue={defaults.email}
            maxLength={254}
          />
        </label>
        <label>
          Phone
          <input name="phone" defaultValue={defaults.phone} maxLength={40} />
        </label>
        <label className="span-2">
          Billing address
          <input
            name="billingAddressLine1"
            defaultValue={defaults.address1}
            maxLength={160}
          />
        </label>
        <label className="span-2">
          Address line 2
          <input
            name="billingAddressLine2"
            defaultValue={defaults.address2}
            maxLength={160}
          />
        </label>
        <label>
          City
          <input
            name="billingCity"
            defaultValue={defaults.city}
            maxLength={100}
          />
        </label>
        <label>
          Region
          <input
            name="billingRegion"
            defaultValue={defaults.region}
            maxLength={100}
          />
        </label>
        <label>
          Postal code
          <input
            name="billingPostalCode"
            defaultValue={defaults.postalCode}
            maxLength={24}
          />
        </label>
        <label>
          Country code
          <input
            name="billingCountryCode"
            defaultValue={defaults.countryCode ?? "IN"}
            pattern="[A-Z]{2}"
            maxLength={2}
            required
          />
        </label>
        <label>
          Locale
          <input
            name="locale"
            defaultValue={defaults.locale ?? "en-IN"}
            required
            maxLength={35}
          />
        </label>
        <label>
          Currency
          <select
            name="preferredCurrencyCode"
            defaultValue={defaults.currencyCode ?? "INR"}
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
          Tax treatment
          <select
            name="taxTreatment"
            defaultValue={defaults.taxTreatment ?? "standard"}
          >
            <option value="standard">Standard</option>
            <option value="exempt">Exempt</option>
            <option value="zero_rated">Zero-rated</option>
            <option value="reverse_charge">Reverse charge</option>
          </select>
        </label>
        <label>
          Tax identifier
          <input
            name="taxIdentifier"
            defaultValue={defaults.taxIdentifier}
            maxLength={80}
          />
        </label>
      </div>
      <button
        className="button button-primary"
        type="submit"
        disabled={pending}
      >
        {pending
          ? "Saving…"
          : mode === "create"
            ? "Create customer"
            : "Save customer"}
      </button>
    </form>
  );
}
