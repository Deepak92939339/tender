"use client";

import { useActionState, useState } from "react";
import Papa from "papaparse";
import {
  commitCatalogImport,
  prepareCatalogImport,
  type ImportPreviewState,
  type MutationState,
} from "@/app/(application)/catalog/actions";
import { catalogCsvHeaders } from "@/lib/validation/catalog";

export function CatalogImport() {
  const [payload, setPayload] = useState("");
  const [filename, setFilename] = useState("");
  const [localError, setLocalError] = useState("");
  const [review, reviewAction, reviewing] = useActionState(
    prepareCatalogImport,
    {} as ImportPreviewState,
  );
  const [commit, commitAction, committing] = useActionState(
    commitCatalogImport,
    {} as MutationState,
  );

  function parseFile(file?: File) {
    setLocalError("");
    setPayload("");
    setFilename("");
    if (!file) return;
    if (file.size > 512 * 1024) {
      setLocalError(
        "CSV review stopped before upload. Select a file no larger than 512 KB.",
      );
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
      complete(result) {
        const fields = result.meta.fields ?? [];
        const unknown = fields.filter(
          (field) =>
            !catalogCsvHeaders.includes(
              field as (typeof catalogCsvHeaders)[number],
            ),
        );
        const missing = catalogCsvHeaders.filter(
          (field) => !fields.includes(field),
        );
        if (unknown.length || missing.length) {
          setLocalError(
            `CSV review stopped. ${unknown.length ? `Unknown headers: ${unknown.join(", ")}. ` : ""}${missing.length ? `Missing headers: ${missing.join(", ")}.` : ""}`,
          );
          return;
        }
        if (result.errors.length) {
          setLocalError(
            `CSV review stopped. Parser error ${result.errors[0]?.code ?? "UNKNOWN"} at row ${result.errors[0]?.row ?? "unknown"}.`,
          );
          return;
        }
        if (result.data.length < 1 || result.data.length > 1000) {
          setLocalError(
            "CSV review stopped. Use between 1 and 1,000 data rows.",
          );
          return;
        }
        setFilename(file.name);
        setPayload(JSON.stringify(result.data));
      },
    });
  }

  return (
    <div className="import-workspace">
      <form action={reviewAction} className="import-form">
        <label>
          Catalog CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => parseFile(event.target.files?.[0])}
          />
        </label>
        <input type="hidden" name="filename" value={filename} />
        <input type="hidden" name="payload" value={payload} />
        <button
          className="button"
          type="submit"
          disabled={!payload || reviewing}
        >
          {reviewing ? "Reviewing…" : "Review CSV"}
        </button>
      </form>
      {localError && (
        <div className="form-error" role="alert">
          {localError}
        </div>
      )}
      {review.error && (
        <div className="form-error" role="alert">
          {review.error}
        </div>
      )}
      {review.message && (
        <p className="form-success" role="status">
          {review.message}
        </p>
      )}

      {review.preview && (
        <section
          className="import-review"
          aria-labelledby="import-review-heading"
        >
          <header>
            <div>
              <h3 id="import-review-heading">CSV review</h3>
              <p>
                {review.preview.validCount} valid ·{" "}
                {review.preview.invalidCount} invalid ·{" "}
                {review.preview.rowCount} total
              </p>
            </div>
          </header>
          <div
            className="table-region"
            tabIndex={0}
            role="region"
            aria-label="Catalog CSV review table"
          >
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>SKU</th>
                  <th>Description</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {review.preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td className="mono">{row.sku}</td>
                    <td>{row.description}</td>
                    <td>
                      {row.status === "valid"
                        ? "Valid"
                        : `${row.errors.join(", ")} · ${row.fields.join(", ")}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={commitAction} className="commit-import">
            <input
              type="hidden"
              name="batchId"
              value={review.preview.batchId}
            />
            <input
              type="hidden"
              name="commandId"
              value={review.preview.batchId}
            />
            <input
              type="hidden"
              name="allowPartial"
              value={review.preview.invalidCount > 0 ? "true" : "false"}
            />
            {review.preview.invalidCount > 0 && (
              <label className="checkbox">
                <input type="checkbox" required /> Import only the{" "}
                {review.preview.validCount} validated rows and skip invalid rows
              </label>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={committing || review.preview.validCount === 0}
            >
              {committing
                ? "Importing…"
                : review.preview.invalidCount > 0
                  ? "Confirm partial import"
                  : "Import products"}
            </button>
          </form>
          {commit.error && (
            <div className="form-error" role="alert">
              {commit.error}
            </div>
          )}
          {commit.message && (
            <p className="form-success" role="status">
              {commit.message}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
