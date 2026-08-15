import type {
  BuyerQuoteProjection,
  VerificationProjection,
} from "@/lib/quotes/commitment-contracts";
import { formatMinor } from "@/lib/formatting/money";

export type RecipientQuoteViewModel = {
  quoteNumber: string;
  revisionNumber: number;
  effectiveState: BuyerQuoteProjection["effectiveState"];
  responseType: BuyerQuoteProjection["responseType"];
  acceptanceAllowed: boolean;
  acceptanceStatementVersion: 1;
  acceptanceStatement: string;
  currencyCode: string;
  locale: string;
  issueDate: string;
  validUntil: string;
  seller: BuyerQuoteProjection["snapshot"]["seller"];
  buyer: BuyerQuoteProjection["snapshot"]["buyer"];
  items: Array<
    BuyerQuoteProjection["snapshot"]["items"][number] & {
      totalDisplay: string;
      unitPriceDisplay: string;
    }
  >;
  charges: Array<
    BuyerQuoteProjection["snapshot"]["charges"][number] & {
      totalDisplay: string;
    }
  >;
  totals: {
    subtotal: string;
    discount: string;
    tax: string;
    charges: string;
    total: string;
  };
  taxLabel: string;
  taxMode: "exclusive" | "inclusive";
  notes: string;
  snapshotHash: string;
  calculationFingerprint: string;
};

export function recipientQuoteViewModel(
  projection: BuyerQuoteProjection,
): RecipientQuoteViewModel {
  const { snapshot } = projection;
  const { currency_code: currencyCode, locale } = snapshot.commercial;
  const money = (minor: number) => formatMinor(minor, currencyCode, locale);
  return {
    quoteNumber: projection.quoteNumber,
    revisionNumber: projection.revisionNumber,
    effectiveState: projection.effectiveState,
    responseType: projection.responseType,
    acceptanceAllowed: projection.acceptanceAllowed,
    acceptanceStatementVersion: projection.acceptanceStatementVersion,
    acceptanceStatement: projection.acceptanceStatement,
    currencyCode,
    locale,
    issueDate: snapshot.commercial.issue_date,
    validUntil: snapshot.commercial.valid_until,
    seller: snapshot.seller,
    buyer: snapshot.buyer,
    items: snapshot.items.map((item) => ({
      ...item,
      unitPriceDisplay: money(item.unit_price_minor),
      totalDisplay: money(item.line_total_minor),
    })),
    charges: snapshot.charges.map((charge) => ({
      ...charge,
      totalDisplay: money(charge.total_minor),
    })),
    totals: {
      subtotal: money(snapshot.totals.subtotal_minor),
      discount: money(snapshot.totals.discount_minor),
      tax: money(snapshot.totals.tax_minor),
      charges: money(snapshot.totals.charges_minor),
      total: money(snapshot.totals.total_minor),
    },
    taxLabel: snapshot.commercial.tax_label,
    taxMode: snapshot.commercial.tax_mode,
    notes: snapshot.commercial.notes,
    snapshotHash: projection.snapshotHash,
    calculationFingerprint: projection.calculationFingerprint,
  };
}

export function verificationViewModel(value: VerificationProjection) {
  if (!value.verified || !value.currencyCode || value.totalMinor === null)
    return null;
  return {
    ...value,
    totalDisplay: formatMinor(value.totalMinor, value.currencyCode),
    snapshotHashShort: value.snapshotHash?.slice(0, 16) ?? null,
    calculationFingerprintShort:
      value.calculationFingerprint?.slice(0, 16) ?? null,
  };
}

export function normalizeVerificationCode(value: string) {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  return /^[A-F0-9]{32}$/.test(normalized) ? normalized : null;
}
