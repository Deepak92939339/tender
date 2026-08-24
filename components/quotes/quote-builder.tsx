"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  refreshQuoteLineAction,
  runQuoteWorkflowAction,
  saveQuoteDraftAction,
  type QuoteDraftProjection,
} from "@/app/(application)/quotes/actions";
import {
  calculateExtendedLineAmountMinor,
  calculateQuote,
  type ChargeType,
  type QuoteCalculationInput,
  type TaxPriceBasis,
  type TaxTreatment,
  type UnitCode,
} from "@/lib/quotes/calculate";
import { quoteStateLabel, type QuoteState } from "@/lib/quotes/effective-state";
import { SUPPORTED_CURRENCY_CODES } from "@/lib/formatting/currency";
import {
  formatMinor,
  formatMinorDecimal,
  parseDecimalMinor,
} from "@/lib/formatting/money";

type Customer = { id: string; name: string; taxTreatment: TaxTreatment };
type Product = {
  id: string;
  sku: string;
  description: string;
  unitCode: UnitCode;
  quantityPrecision: number;
  unitPriceMinor: number;
  currencyCode: string;
  taxCode: string;
  taxBps: number;
  taxTreatment: TaxTreatment;
};
type TaxProfile = {
  id: string;
  code: string;
  label: string;
  rateBps: number;
  treatment: TaxTreatment;
};
type LineState = {
  key: string;
  lineId: string | null;
  product: Product;
  quantity: string;
};
type ChargeState = {
  key: string;
  chargeId: string | null;
  chargeType: ChargeType;
  description: string;
  amount: string;
  taxProfileId: string;
  taxCode: string;
  taxBps: number;
  taxTreatment: TaxTreatment;
  discountApplies: boolean;
};

export type QuoteBuilderProps = {
  quote: {
    id: string;
    number: string;
    state: QuoteState;
    version: number;
    customerId: string;
    currencyCode: string;
    locale: string;
    taxLabel: string;
    taxMode: TaxPriceBasis;
    discountBps: number;
    issueDate: string;
    validUntil: string;
    notes: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    chargesMinor: number;
    totalMinor: number;
    customerSnapshot?: {
      name: string;
      contactName: string;
      email: string;
      addressLine1: string;
      addressLine2: string;
      city: string;
      region: string;
      postalCode: string;
      countryCode: string;
      taxIdentifier: string | null;
      approvalThresholdBps: number;
    };
  };
  customers: Customer[];
  products: Product[];
  taxProfiles: TaxProfile[];
  capabilities: string[];
  initialLines: Array<{
    id: string;
    product: Product;
    quantityScaled: number;
    quantityScale: number;
  }>;
  initialCharges: Array<{
    id: string;
    chargeType: ChargeType;
    description: string;
    amountMinor: number;
    taxProfileId: string;
    taxCode: string;
    taxBps: number;
    taxTreatment: TaxTreatment;
    discountApplies: boolean;
  }>;
};

function quantityText(scaled: number, scale: number) {
  if (scale === 1) return String(scaled);
  const precision = Math.round(Math.log10(scale));
  return `${Math.floor(scaled / scale)}.${String(scaled % scale).padStart(precision, "0")}`.replace(
    /\.?0+$/,
    "",
  );
}

function parseQuantity(value: string, precision: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const [whole = "0", fraction = ""] = value.trim().split(".");
  if (fraction.length > precision) return null;
  const scale = 10 ** precision;
  const scaled =
    BigInt(whole) * BigInt(scale) +
    BigInt(fraction.padEnd(precision, "0") || "0");
  return scaled > 0n && scaled <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(scaled)
    : null;
}

function draftSignature(value: {
  customerId: string;
  currencyCode: string;
  locale: string;
  taxLabel: string;
  taxMode: TaxPriceBasis;
  discountBps: number;
  issueDate: string;
  validUntil: string;
  notes: string;
  lines: LineState[];
  charges: ChargeState[];
}) {
  return JSON.stringify(value);
}

export function QuoteBuilder({
  quote,
  customers,
  products,
  taxProfiles,
  capabilities,
  initialLines,
  initialCharges,
}: QuoteBuilderProps) {
  const router = useRouter();
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const taxById = useMemo(
    () => new Map(taxProfiles.map((tax) => [tax.id, tax])),
    [taxProfiles],
  );
  const [customerId, setCustomerId] = useState(quote.customerId);
  const [currencyCode, setCurrencyCode] = useState(quote.currencyCode);
  const [locale, setLocale] = useState(quote.locale);
  const [taxLabel, setTaxLabel] = useState(quote.taxLabel);
  const [taxMode, setTaxMode] = useState<TaxPriceBasis>(quote.taxMode);
  const [discountBps, setDiscountBps] = useState(quote.discountBps);
  const [issueDate, setIssueDate] = useState(quote.issueDate);
  const [validUntil, setValidUntil] = useState(quote.validUntil);
  const [notes, setNotes] = useState(quote.notes);
  const [selectedProduct, setSelectedProduct] = useState(products[0]?.id ?? "");
  const [lines, setLines] = useState<LineState[]>(
    initialLines.map((line) => ({
      key: line.id,
      lineId: line.id,
      product: line.product,
      quantity: quantityText(line.quantityScaled, line.quantityScale),
    })),
  );
  const [charges, setCharges] = useState<ChargeState[]>(
    initialCharges.map((charge) => ({
      key: charge.id,
      chargeId: charge.id,
      chargeType: charge.chargeType,
      description: charge.description,
      amount: formatMinorDecimal(charge.amountMinor, quote.currencyCode),
      taxProfileId: charge.taxProfileId,
      taxCode: charge.taxCode,
      taxBps: charge.taxBps,
      taxTreatment: charge.taxTreatment,
      discountApplies: charge.discountApplies,
    })),
  );
  const [saveState, setSaveState] = useState<
    "Saved" | "Unsaved" | "Saving…" | "Save failed"
  >("Saved");
  const [saveMessage, setSaveMessage] = useState("Saved server state loaded.");
  const [serverTotals, setServerTotals] = useState({
    subtotalMinor: quote.subtotalMinor,
    discountMinor: quote.discountMinor,
    taxMinor: quote.taxMinor,
    chargesMinor: quote.chargesMinor,
    totalMinor: quote.totalMinor,
  });
  const versionRef = useRef(quote.version);
  const savingRef = useRef(false);
  const [queuedSave, setQueuedSave] = useState(0);
  const [staleConflict, setStaleConflict] = useState(false);
  const [refreshingLineId, setRefreshingLineId] = useState<string | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const rejectDialogRef = useRef<HTMLDialogElement>(null);
  const rejectButtonRef = useRef<HTMLButtonElement>(null);
  const rejectReasonRef = useRef<HTMLTextAreaElement>(null);
  const editable =
    quote.state === "draft" && capabilities.includes("quote.edit");

  const customerTreatment =
    customers.find((customer) => customer.id === customerId)?.taxTreatment ??
    "standard";
  const prepared = useMemo(() => {
    try {
      const items = lines.map((line, index) => {
        const product = line.product;
        const quantityScaled = parseQuantity(
          line.quantity,
          product.quantityPrecision,
        );
        if (!quantityScaled)
          throw new Error(
            `Line ${index + 1} quantity must be positive with at most ${product.quantityPrecision} decimals.`,
          );
        return {
          position: index + 1,
          product_id: product.id,
          sku_snapshot: product.sku,
          description_snapshot: product.description,
          unit_code_snapshot: product.unitCode,
          quantity_precision_snapshot: product.quantityPrecision,
          unit_price_minor_snapshot: product.unitPriceMinor,
          currency_code: product.currencyCode,
          quantity_scaled: quantityScaled,
          quantity_scale: 10 ** product.quantityPrecision,
          tax_code_snapshot: product.taxCode,
          tax_bps_snapshot: product.taxBps,
          tax_price_basis_snapshot: taxMode,
          tax_treatment_snapshot: line.lineId
            ? product.taxTreatment
            : customerTreatment === "standard"
              ? product.taxTreatment
              : customerTreatment,
        };
      });
      const preparedCharges = charges.map((charge, index) => {
        const tax = taxById.get(charge.taxProfileId);
        const amountMinor = parseDecimalMinor(charge.amount, currencyCode);
        if (!tax || amountMinor === null || !charge.description.trim())
          throw new Error(
            `Charge ${index + 1} needs a description, valid amount and tax profile.`,
          );
        const taxCode = charge.chargeId ? charge.taxCode : tax.code;
        const taxBps = charge.chargeId ? charge.taxBps : tax.rateBps;
        const taxTreatment = charge.chargeId
          ? charge.taxTreatment
          : customerTreatment === "standard"
            ? tax.treatment
            : customerTreatment;
        return {
          position: index + 1,
          charge_type: charge.chargeType,
          description_snapshot: charge.description.trim(),
          amount_minor: amountMinor,
          currency_code: currencyCode,
          tax_code_snapshot: taxCode,
          tax_bps_snapshot: taxBps,
          tax_price_basis_snapshot: taxMode,
          tax_treatment_snapshot: taxTreatment,
          discount_applies: charge.discountApplies,
        };
      });
      const calculationInput: QuoteCalculationInput = {
        currency_code: currencyCode,
        tax_mode: taxMode,
        discount_bps: discountBps,
        items,
        charges: preparedCharges,
      };
      const calculation = calculateQuote(calculationInput);
      const payload = {
        customer_id: customerId,
        currency_code: currencyCode,
        locale,
        tax_label: taxLabel,
        tax_mode: taxMode,
        discount_bps: discountBps,
        issue_date: issueDate,
        valid_until: validUntil,
        notes,
        items: items.map((item, index) => ({
          line_id: lines[index]!.lineId,
          product_id: item.product_id,
          position: item.position,
          quantity_scaled: item.quantity_scaled,
          quantity_scale: item.quantity_scale,
        })),
        charges: preparedCharges.map((charge, index) => ({
          charge_id: charges[index]!.chargeId,
          position: charge.position,
          charge_type: charge.charge_type,
          description: charge.description_snapshot,
          amount_minor: charge.amount_minor,
          tax_profile_id: charges[index]!.taxProfileId,
          discount_applies: charge.discount_applies,
        })),
      };
      return { calculation, payload, error: "" };
    } catch (error) {
      return {
        calculation: null,
        payload: null,
        error:
          error instanceof Error
            ? error.message
            : "Commercial fields are invalid.",
      };
    }
  }, [
    charges,
    currencyCode,
    customerId,
    customerTreatment,
    discountBps,
    issueDate,
    lines,
    locale,
    notes,
    taxById,
    taxLabel,
    taxMode,
    validUntil,
  ]);

  const signature = useMemo(
    () =>
      draftSignature({
        customerId,
        currencyCode,
        locale,
        taxLabel,
        taxMode,
        discountBps,
        issueDate,
        validUntil,
        notes,
        lines,
        charges,
      }),
    [
      charges,
      currencyCode,
      customerId,
      discountBps,
      issueDate,
      lines,
      locale,
      notes,
      taxLabel,
      taxMode,
      validUntil,
    ],
  );
  const baselineRef = useRef(signature);
  const latestSignatureRef = useRef(signature);
  useEffect(() => {
    latestSignatureRef.current = signature;
  }, [signature]);

  const projectionState = useCallback(
    (
      projection: QuoteDraftProjection,
      identity?: { lineKeys: string[]; chargeKeys: string[] },
    ) => {
      const projectedLines: LineState[] = projection.items.map(
        (item, index) => ({
          key: identity?.lineKeys[index] ?? item.id,
          lineId: item.id,
          quantity: quantityText(item.quantity_scaled, item.quantity_scale),
          product: {
            id: item.product_id ?? item.id,
            sku: item.sku_snapshot,
            description: item.description_snapshot,
            unitCode: item.unit_code_snapshot,
            quantityPrecision: item.quantity_precision_snapshot,
            unitPriceMinor: item.unit_price_minor_snapshot,
            currencyCode: item.currency_code,
            taxCode: item.tax_code_snapshot,
            taxBps: item.tax_bps_snapshot,
            taxTreatment: item.tax_treatment_snapshot,
          },
        }),
      );
      const projectedCharges: ChargeState[] = projection.charges.map(
        (charge, index) => ({
          key: identity?.chargeKeys[index] ?? charge.id,
          chargeId: charge.id,
          chargeType: charge.charge_type,
          description: charge.description_snapshot,
          amount: formatMinorDecimal(
            charge.amount_minor,
            projection.currency_code,
          ),
          taxProfileId:
            taxProfiles.find((tax) => tax.code === charge.tax_code_snapshot)
              ?.id ??
            taxProfiles[0]?.id ??
            "",
          taxCode: charge.tax_code_snapshot,
          taxBps: charge.tax_bps_snapshot,
          taxTreatment: charge.tax_treatment_snapshot,
          discountApplies: charge.discount_applies,
        }),
      );
      const state = {
        customerId: projection.customer_id,
        currencyCode: projection.currency_code,
        locale: projection.locale,
        taxLabel: projection.tax_label,
        taxMode: projection.tax_mode,
        discountBps: projection.discount_bps,
        issueDate: projection.issue_date,
        validUntil: projection.valid_until,
        notes: projection.notes,
        lines: projectedLines,
        charges: projectedCharges,
      };
      return { ...state, signature: draftSignature(state) };
    },
    [taxProfiles],
  );

  const applyExactProjection = useCallback(
    (
      projection: QuoteDraftProjection,
      message: string,
      identity?: { lineKeys: string[]; chargeKeys: string[] },
    ) => {
      const projected = projectionState(projection, identity);
      versionRef.current = projection.version;
      setCustomerId(projected.customerId);
      setCurrencyCode(projected.currencyCode);
      setLocale(projected.locale);
      setTaxLabel(projected.taxLabel);
      setTaxMode(projected.taxMode);
      setDiscountBps(projected.discountBps);
      setIssueDate(projected.issueDate);
      setValidUntil(projected.validUntil);
      setNotes(projected.notes);
      setLines(projected.lines);
      setCharges(projected.charges);
      setServerTotals({
        subtotalMinor: projection.subtotal_minor,
        discountMinor: projection.discount_minor,
        taxMinor: projection.tax_minor,
        chargesMinor: projection.charges_minor,
        totalMinor: projection.total_minor,
      });
      baselineRef.current = projected.signature;
      latestSignatureRef.current = projected.signature;
      setStaleConflict(false);
      setSaveState("Saved");
      setSaveMessage(message);
    },
    [projectionState],
  );

  const persist = useCallback(
    async (
      capturedSignature: string,
      payload: unknown,
      capturedIdentity: { lineKeys: string[]; chargeKeys: string[] },
    ) => {
      if (savingRef.current) {
        setQueuedSave((value) => value + 1);
        return;
      }
      savingRef.current = true;
      setSaveState("Saving…");
      setSaveMessage("Saving authoritative draft…");
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const result = await saveQuoteDraftAction({
        quoteId: quote.id,
        expectedVersion: versionRef.current,
        commandId: crypto.randomUUID(),
        payload,
      });
      savingRef.current = false;
      if (result.status === "saved" && result.projection) {
        const projected = projectionState(result.projection, capturedIdentity);
        versionRef.current = result.projection.version;
        setServerTotals({
          subtotalMinor: result.projection.subtotal_minor,
          discountMinor: result.projection.discount_minor,
          taxMinor: result.projection.tax_minor,
          chargesMinor: result.projection.charges_minor,
          totalMinor: result.projection.total_minor,
        });
        baselineRef.current = projected.signature;
        setStaleConflict(false);
        if (latestSignatureRef.current === capturedSignature) {
          applyExactProjection(
            result.projection,
            result.message,
            capturedIdentity,
          );
        } else {
          const projectedLineByKey = new Map(
            capturedIdentity.lineKeys.map((key, index) => [
              key,
              projected.lines[index],
            ]),
          );
          const projectedChargeByKey = new Map(
            capturedIdentity.chargeKeys.map((key, index) => [
              key,
              projected.charges[index],
            ]),
          );
          setLines((current) =>
            current.map((line) => {
              const serverLine = projectedLineByKey.get(line.key);
              return serverLine
                ? {
                    ...line,
                    lineId: serverLine.lineId,
                    product: serverLine.product,
                  }
                : line;
            }),
          );
          setCharges((current) =>
            current.map((charge) => {
              const serverCharge = projectedChargeByKey.get(charge.key);
              return serverCharge
                ? {
                    ...charge,
                    chargeId: serverCharge.chargeId,
                    taxProfileId: serverCharge.taxProfileId,
                    taxCode: serverCharge.taxCode,
                    taxBps: serverCharge.taxBps,
                    taxTreatment: serverCharge.taxTreatment,
                  }
                : charge;
            }),
          );
          setSaveState("Unsaved");
          setSaveMessage(
            "Server state reconciled; newer local edits are waiting to save.",
          );
          setQueuedSave((value) => value + 1);
        }
      } else {
        setStaleConflict(result.status === "stale");
        setSaveState("Save failed");
        setSaveMessage(result.message);
      }
    },
    [applyExactProjection, projectionState, quote.id],
  );

  useEffect(() => {
    if (!editable) return;
    if (signature === baselineRef.current) {
      if (!savingRef.current) {
        setSaveState("Saved");
        setSaveMessage("Saved server state unchanged.");
      }
      return;
    }
    setSaveState((current) => (current === "Saving…" ? current : "Unsaved"));
    setSaveMessage((current) =>
      current.includes("another session")
        ? current
        : "Changes are waiting to save.",
    );
    const timer = window.setTimeout(() => {
      if (prepared.payload) {
        void persist(signature, prepared.payload, {
          lineKeys: lines.map((line) => line.key),
          chargeKeys: charges.map((charge) => charge.key),
        });
      } else {
        setSaveState("Save failed");
        setSaveMessage(prepared.error);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    charges,
    editable,
    lines,
    persist,
    prepared.error,
    prepared.payload,
    queuedSave,
    signature,
  ]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saveState === "Unsaved" || saveState === "Save failed")
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  function saveNow() {
    if (!editable) return;
    if (prepared.payload) {
      void persist(signature, prepared.payload, {
        lineKeys: lines.map((line) => line.key),
        chargeKeys: charges.map((charge) => charge.key),
      });
    } else {
      setSaveState("Save failed");
      setSaveMessage(prepared.error);
    }
  }
  function addProduct() {
    const product = productsById.get(selectedProduct);
    if (!product) return;
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        lineId: null,
        product,
        quantity: product.quantityPrecision
          ? `1.${"0".repeat(product.quantityPrecision)}`
          : "1",
      },
    ]);
  }
  function addCharge() {
    const tax = taxProfiles[0];
    if (!tax) return;
    setCharges((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        chargeId: null,
        chargeType: "freight",
        description: "Freight",
        amount: formatMinorDecimal(0, currencyCode),
        taxProfileId: tax.id,
        taxCode: tax.code,
        taxBps: tax.rateBps,
        taxTreatment: tax.treatment,
        discountApplies: false,
      },
    ]);
  }
  const displayTotals = prepared.calculation ?? {
    ...serverTotals,
    subtotal_minor: serverTotals.subtotalMinor,
    discount_minor: serverTotals.discountMinor,
    tax_minor: serverTotals.taxMinor,
    charges_minor: serverTotals.chargesMinor,
    total_minor: serverTotals.totalMinor,
  };

  async function refreshLine(lineId: string) {
    if (saveState !== "Saved") {
      setSaveMessage(
        "Save or reconcile local edits before refreshing catalog pricing.",
      );
      return;
    }
    setRefreshingLineId(lineId);
    setSaveState("Saving…");
    setSaveMessage("Refreshing this line from the current catalog…");
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    const result = await refreshQuoteLineAction({
      quoteId: quote.id,
      lineId,
      expectedVersion: versionRef.current,
      commandId: crypto.randomUUID(),
    });
    setRefreshingLineId(null);
    if (result.status === "saved" && result.projection) {
      applyExactProjection(result.projection, result.message);
      setWorkflowMessage(result.message);
      router.refresh();
    } else {
      setStaleConflict(result.status === "stale");
      setSaveState("Save failed");
      setSaveMessage(result.message);
    }
  }

  async function runWorkflow(
    action: "submit" | "approve" | "reject" | "issue",
    reason?: string,
  ) {
    setWorkflowBusy(true);
    setWorkflowMessage(
      `${action[0]!.toUpperCase()}${action.slice(1)} in progress…`,
    );
    const result = await runQuoteWorkflowAction({
      quoteId: quote.id,
      expectedVersion: versionRef.current,
      commandId: crypto.randomUUID(),
      action,
      reason,
    });
    setWorkflowBusy(false);
    setWorkflowMessage(result.message);
    if (result.status === "ok") {
      if (result.version) versionRef.current = result.version;
      rejectDialogRef.current?.close();
      router.refresh();
    }
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveNow();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        quote.state === "draft" &&
        capabilities.includes("quote.submit") &&
        saveState === "Saved" &&
        lines.length > 0
      ) {
        event.preventDefault();
        void runWorkflow("submit");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  function openRejectDialog() {
    rejectDialogRef.current?.showModal();
    window.setTimeout(() => rejectReasonRef.current?.focus(), 0);
  }

  const stateLabel = quoteStateLabel(quote.state);

  return (
    <div className="quote-builder">
      <section
        className="quote-document"
        aria-labelledby="quote-number-heading"
      >
        <header className="quote-document-header">
          <div>
            <p className="eyebrow">Quotation</p>
            <h1 id="quote-number-heading">{quote.number}</h1>
          </div>
          <span className="state-label">{stateLabel}</span>
        </header>
        {quote.customerSnapshot && (
          <section
            className="quote-submission-snapshot"
            aria-labelledby="submission-snapshot-heading"
          >
            <div>
              <p className="eyebrow">Submission snapshot</p>
              <h2 id="submission-snapshot-heading">
                {quote.customerSnapshot.name}
              </h2>
              <p>
                {[
                  quote.customerSnapshot.contactName,
                  quote.customerSnapshot.email,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No contact details supplied"}
              </p>
            </div>
            <dl>
              <div>
                <dt>Billing address</dt>
                <dd>
                  {[
                    quote.customerSnapshot.addressLine1,
                    quote.customerSnapshot.addressLine2,
                    quote.customerSnapshot.city,
                    quote.customerSnapshot.region,
                    quote.customerSnapshot.postalCode,
                    quote.customerSnapshot.countryCode,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt>Tax identifier</dt>
                <dd>{quote.customerSnapshot.taxIdentifier || "—"}</dd>
              </div>
              <div>
                <dt>Approval threshold at submission</dt>
                <dd>
                  {(quote.customerSnapshot.approvalThresholdBps / 100).toFixed(
                    2,
                  )}
                  %
                </dd>
              </div>
            </dl>
          </section>
        )}
        <fieldset className="quote-edit-fieldset" disabled={!editable}>
          <div className="quote-header-fields form-grid">
            <label className="span-2">
              Customer
              <select
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
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
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </label>
            <label>
              Valid until
              <input
                type="date"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            </label>
            <label>
              Currency
              <select
                aria-label="Quote currency"
                value={currencyCode}
                onChange={(event) => setCurrencyCode(event.target.value)}
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
                value={locale}
                maxLength={35}
                onChange={(event) => setLocale(event.target.value)}
              />
            </label>
            <label>
              Tax label
              <input
                value={taxLabel}
                maxLength={80}
                onChange={(event) => setTaxLabel(event.target.value)}
              />
            </label>
            <label>
              Price basis
              <select
                value={taxMode}
                onChange={(event) =>
                  setTaxMode(event.target.value as TaxPriceBasis)
                }
              >
                <option value="exclusive">Tax exclusive</option>
                <option value="inclusive">Tax inclusive</option>
              </select>
            </label>
            <label>
              Discount %
              <input
                aria-label="Discount percent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={discountBps / 100}
                onChange={(event) =>
                  setDiscountBps(
                    Math.max(
                      0,
                      Math.min(
                        10_000,
                        Math.round(Number(event.target.value) * 100),
                      ),
                    ),
                  )
                }
              />
            </label>
          </div>

          <section className="quote-lines" aria-labelledby="lines-heading">
            <header>
              <div>
                <p className="eyebrow">Commercial lines</p>
                <h2 id="lines-heading">Items</h2>
              </div>
              <div className="inline-add">
                <label>
                  Catalog product
                  <select
                    aria-label="Catalog product"
                    value={selectedProduct}
                    onChange={(event) => setSelectedProduct(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addProduct();
                      }
                    }}
                  >
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.sku} — {product.description}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button"
                  type="button"
                  onClick={addProduct}
                  disabled={!selectedProduct}
                >
                  Add product
                </button>
              </div>
            </header>
            <div
              className="table-region"
              tabIndex={0}
              role="region"
              aria-label="Quotation items table"
            >
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Unit price</th>
                    <th>Tax</th>
                    <th>Amount</th>
                    <th>
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const product = line.product;
                    const calculated = prepared.calculation?.items[index];
                    return (
                      <tr key={line.key} data-line-id={line.lineId ?? "new"}>
                        <td>
                          <strong>{product.sku}</strong>
                          <br />
                          <span>{product.description}</span>
                        </td>
                        <td>
                          <label className="table-control">
                            <span className="sr-only">
                              Quantity for {product.sku}
                            </span>
                            <input
                              aria-label={`Quantity for ${product.sku}`}
                              inputMode="decimal"
                              value={line.quantity}
                              onChange={(event) =>
                                setLines((current) =>
                                  current.map((entry) =>
                                    entry.key === line.key
                                      ? {
                                          ...entry,
                                          quantity: event.target.value,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            />
                          </label>{" "}
                          {product.unitCode}
                        </td>
                        <td className="money">
                          {formatMinor(
                            product.unitPriceMinor,
                            product.currencyCode,
                            locale,
                          )}
                        </td>
                        <td>{product.taxCode}</td>
                        <td className="money">
                          {calculated
                            ? formatMinor(
                                calculateExtendedLineAmountMinor({
                                  unitPriceMinor:
                                    calculated.unit_price_minor_snapshot,
                                  quantityScaled: calculated.quantity_scaled,
                                  quantityScale: calculated.quantity_scale,
                                }),
                                currencyCode,
                                locale,
                              )
                            : "—"}
                        </td>
                        <td>
                          <div className="table-row-actions">
                            {line.lineId && (
                              <button
                                className="text-action"
                                type="button"
                                onClick={() => void refreshLine(line.lineId!)}
                                disabled={
                                  saveState !== "Saved" ||
                                  refreshingLineId !== null
                                }
                              >
                                {refreshingLineId === line.lineId
                                  ? "Refreshing…"
                                  : "Refresh pricing"}
                              </button>
                            )}
                            <button
                              className="text-action"
                              type="button"
                              aria-label={`Remove ${product.sku}`}
                              onClick={() =>
                                setLines((current) =>
                                  current.filter(
                                    (entry) => entry.key !== line.key,
                                  ),
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!lines.length && (
                    <tr>
                      <td colSpan={6} className="table-empty">
                        Add a catalog product to prepare this quotation.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="quote-charges" aria-labelledby="charges-heading">
            <header>
              <div>
                <p className="eyebrow">Additional commercial amounts</p>
                <h2 id="charges-heading">Charges</h2>
              </div>
              <button
                className="button"
                type="button"
                onClick={addCharge}
                disabled={!taxProfiles.length}
              >
                Add charge
              </button>
            </header>
            {charges.map((charge, index) => (
              <div
                className="charge-row"
                key={charge.key}
                data-charge-id={charge.chargeId ?? "new"}
              >
                <label>
                  Type
                  <select
                    aria-label={`Charge ${index + 1} type`}
                    value={charge.chargeType}
                    onChange={(event) =>
                      setCharges((current) =>
                        current.map((entry) =>
                          entry.key === charge.key
                            ? {
                                ...entry,
                                chargeType: event.target.value as ChargeType,
                              }
                            : entry,
                        ),
                      )
                    }
                  >
                    {[
                      "freight",
                      "shipping",
                      "handling",
                      "insurance",
                      "packaging",
                      "customs_duties",
                      "other",
                    ].map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="charge-description">
                  Description
                  <input
                    aria-label={`Charge ${index + 1} description`}
                    value={charge.description}
                    maxLength={300}
                    onChange={(event) =>
                      setCharges((current) =>
                        current.map((entry) =>
                          entry.key === charge.key
                            ? { ...entry, description: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Amount
                  <input
                    aria-label={`Charge ${index + 1} amount`}
                    inputMode="decimal"
                    value={charge.amount}
                    onChange={(event) =>
                      setCharges((current) =>
                        current.map((entry) =>
                          entry.key === charge.key
                            ? { ...entry, amount: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                {charge.chargeId ? (
                  <label>
                    Tax snapshot
                    <input
                      aria-label={`Charge ${index + 1} tax snapshot`}
                      value={`${charge.taxCode} · ${(charge.taxBps / 100).toFixed(2)}%`}
                      readOnly
                    />
                  </label>
                ) : (
                  <label>
                    Tax profile
                    <select
                      aria-label={`Charge ${index + 1} tax profile`}
                      value={charge.taxProfileId}
                      onChange={(event) =>
                        setCharges((current) =>
                          current.map((entry) =>
                            entry.key === charge.key
                              ? { ...entry, taxProfileId: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    >
                      {taxProfiles.map((tax) => (
                        <option key={tax.id} value={tax.id}>
                          {tax.code} — {tax.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={charge.discountApplies}
                    onChange={(event) =>
                      setCharges((current) =>
                        current.map((entry) =>
                          entry.key === charge.key
                            ? {
                                ...entry,
                                discountApplies: event.target.checked,
                              }
                            : entry,
                        ),
                      )
                    }
                  />{" "}
                  Apply quote discount
                </label>
                <button
                  className="text-action"
                  type="button"
                  onClick={() =>
                    setCharges((current) =>
                      current.filter((entry) => entry.key !== charge.key),
                    )
                  }
                >
                  Remove charge
                </button>
              </div>
            ))}
            {!charges.length && (
              <p className="quiet-empty">No additional charges.</p>
            )}
          </section>

          <label className="notes-field">
            Commercial notes
            <textarea
              value={notes}
              maxLength={5000}
              rows={6}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </fieldset>
      </section>

      <aside className="quote-summary" aria-label="Quotation summary">
        <p className="eyebrow">Calculation summary</p>
        <h2>Exact totals</h2>
        {prepared.error && (
          <div className="form-error" role="alert">
            {prepared.error}
          </div>
        )}
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>
              {formatMinor(displayTotals.subtotal_minor, currencyCode, locale)}
            </dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>
              −{" "}
              {formatMinor(displayTotals.discount_minor, currencyCode, locale)}
            </dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>
              {formatMinor(displayTotals.tax_minor, currencyCode, locale)}
            </dd>
          </div>
          <div>
            <dt>Charges</dt>
            <dd>
              {formatMinor(displayTotals.charges_minor, currencyCode, locale)}
            </dd>
          </div>
          <div className="total-row">
            <dt>Total</dt>
            <dd>
              {formatMinor(displayTotals.total_minor, currencyCode, locale)}
            </dd>
          </div>
        </dl>
        <p className="legal-note">
          {taxMode === "inclusive"
            ? "Prices are marked tax-inclusive."
            : "Prices are marked tax-exclusive."}{" "}
          {customerTreatment.replaceAll("_", " ")} treatment.
        </p>
        <div
          className={`save-indicator save-${saveState.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`}
          aria-live="polite"
          role="status"
        >
          <strong>{saveState}</strong>
          <span>{saveMessage}</span>
        </div>
        {staleConflict && (
          <button
            className="button"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload server state
          </button>
        )}
        <div className="summary-actions">
          {editable && (
            <button
              className="button"
              type="button"
              onClick={saveNow}
              disabled={saveState === "Saving…"}
            >
              Save draft <span className="shortcut">⌘/Ctrl S</span>
            </button>
          )}
          {quote.state === "draft" && capabilities.includes("quote.submit") && (
            <button
              className="button button-primary"
              type="button"
              onClick={() => void runWorkflow("submit")}
              disabled={
                workflowBusy || saveState !== "Saved" || lines.length === 0
              }
            >
              Submit for decision <span className="shortcut">⌘/Ctrl Enter</span>
            </button>
          )}
          {quote.state === "waiting" &&
            capabilities.includes("quote.approve") && (
              <button
                className="button button-primary"
                type="button"
                onClick={() => void runWorkflow("approve")}
                disabled={workflowBusy}
              >
                Approve quote
              </button>
            )}
          {quote.state === "waiting" &&
            capabilities.includes("quote.reject") && (
              <button
                ref={rejectButtonRef}
                className="button"
                type="button"
                onClick={openRejectDialog}
                disabled={workflowBusy}
              >
                Reject quote
              </button>
            )}
          {quote.state === "approved" &&
            capabilities.includes("quote.issue") && (
              <button
                className="button button-primary"
                type="button"
                onClick={() => void runWorkflow("issue")}
                disabled={workflowBusy}
              >
                Issue quote
              </button>
            )}
          {quote.state === "issued" && capabilities.includes("quote.print") && (
            <button
              className="button button-primary"
              type="button"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </button>
          )}
        </div>
        {workflowMessage && (
          <p className="workflow-message" role="status" aria-live="polite">
            {workflowMessage}
          </p>
        )}
        <p className="legal-note">
          Server calculations, authorization and version are authoritative.
          Approved is not Issued; Issued does not mean Delivered.
        </p>
      </aside>
      <dialog
        className="reject-dialog"
        ref={rejectDialogRef}
        onClose={() => {
          setWorkflowMessage("");
          rejectButtonRef.current?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "textarea, button:not([disabled])",
            ),
          );
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first && last) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement === last &&
            first
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
        aria-labelledby="reject-heading"
      >
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = rejectReasonRef.current?.value ?? "";
            if (reason.trim().length >= 3) void runWorkflow("reject", reason);
          }}
        >
          <p className="eyebrow">Commercial decision</p>
          <h2 id="reject-heading">Reject quotation</h2>
          <p>
            Give a meaningful reason. It becomes untrusted text in the
            commercial Activity record.
          </p>
          <label>
            Rejection reason
            <textarea
              ref={rejectReasonRef}
              required
              minLength={3}
              maxLength={1000}
              rows={6}
            />
          </label>
          {workflowMessage && (
            <p className="workflow-message" role="status" aria-live="polite">
              {workflowMessage}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button"
              type="button"
              onClick={() => rejectDialogRef.current?.close()}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={workflowBusy}
            >
              Confirm rejection
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
