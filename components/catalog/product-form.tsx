"use client";

import { useActionState } from "react";
import {
  createProduct,
  type MutationState,
} from "@/app/(application)/catalog/actions";
import { SUPPORTED_CURRENCY_CODES } from "@/lib/formatting/currency";

type TaxProfile = { id: string; code: string; label: string };

export function ProductForm({
  taxProfiles,
  currencyCode,
  commandId,
}: {
  taxProfiles: TaxProfile[];
  currencyCode: string;
  commandId: string;
}) {
  const [state, action, pending] = useActionState(
    createProduct,
    {} as MutationState,
  );
  return (
    <form action={action} className="record-form" noValidate>
      <input type="hidden" name="commandId" value={commandId} />
      <button
        className="panel-dismiss"
        type="button"
        onClick={(event) =>
          event.currentTarget.closest("details")?.removeAttribute("open")
        }
      >
        Close product form
      </button>
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
      <div className="form-grid">
        <label>
          SKU
          <input name="sku" required maxLength={64} />
        </label>
        <label className="span-2">
          Description
          <input name="description" required maxLength={500} />
        </label>
        <label>
          Unit
          <select name="unitCode" defaultValue="EA">
            <option>EA</option>
            <option>M</option>
            <option>KG</option>
            <option>L</option>
            <option>BOX</option>
          </select>
        </label>
        <label>
          Quantity decimals
          <select name="quantityPrecision" defaultValue="0">
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </label>
        <label>
          Unit price
          <input
            name="unitPrice"
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </label>
        <label>
          Currency
          <select name="currencyCode" defaultValue={currencyCode} required>
            {SUPPORTED_CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Tax profile
          <select
            name="taxProfileId"
            required
            defaultValue={taxProfiles[0]?.id}
          >
            {taxProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.code} — {profile.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          State
          <select name="active" defaultValue="true">
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      </div>
      <button
        className="button button-primary"
        type="submit"
        disabled={pending || taxProfiles.length === 0}
      >
        {pending ? "Creating…" : "Create product"}
      </button>
    </form>
  );
}
