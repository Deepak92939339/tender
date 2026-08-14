export const SNAPSHOT_FORMAT_VERSION = 1 as const;
export const CALCULATION_FORMAT_VERSION = 1 as const;

/**
 * Canonical JSON v1:
 * - NFC-normalize every string and object key (Unicode normalization stability applies).
 * - Reject object-key collisions after normalization; order keys by normalized UTF-8 bytes.
 * - Preserve arrays after the domain sort: items/charges by ascending position and unique
 *   reason codes by normalized UTF-8 bytes.
 * - Emit every schema key, including empty strings/arrays and explicit nulls.
 * - Emit booleans/null as JSON literals and safe integers as minimal base-10 (`-0` becomes `0`).
 * - Escape JSON controls, quote, and backslash with lowercase `\\u00xx` for other controls.
 * - Encode as UTF-8 without BOM or trailing newline. Format changes require a new version.
 */

export type NullableText = string | null;

export type CanonicalQuoteSnapshotV1 = {
  format_version: typeof SNAPSHOT_FORMAT_VERSION;
  quote: {
    id: string;
    number: string;
    revision_number: number;
    parent_snapshot_hash: NullableText;
  };
  seller: {
    legal_name: string;
    address_line1: string;
    address_line2: string;
    city: string;
    region: string;
    postal_code: string;
    country_code: string;
    tax_identifier: NullableText;
    contact_email: NullableText;
    contact_phone: NullableText;
  };
  buyer: {
    customer_id: string;
    name: string;
    contact_name: string;
    email: string;
    address_line1: string;
    address_line2: string;
    city: string;
    region: string;
    postal_code: string;
    country_code: string;
    tax_identifier: NullableText;
  };
  commercial: {
    currency_code: string;
    locale: string;
    tax_label: string;
    tax_mode: "exclusive" | "inclusive";
    customer_tax_treatment:
      "standard" | "exempt" | "zero_rated" | "reverse_charge";
    discount_bps: number;
    issue_date: string;
    valid_until: string;
    notes: string;
  };
  items: CanonicalSnapshotItemV1[];
  charges: CanonicalSnapshotChargeV1[];
  totals: CanonicalTotalsV1;
  approval_policy: {
    threshold_bps: number;
    requires_manual_approval: boolean;
    reason_codes: string[];
  };
  calculation: {
    format_version: typeof CALCULATION_FORMAT_VERSION;
    fingerprint: string;
  };
};

export type CanonicalSnapshotItemV1 = {
  id: string;
  position: number;
  product_id: NullableText;
  sku: string;
  description: string;
  unit_code: string;
  quantity_precision: number;
  unit_price_minor: number;
  currency_code: string;
  quantity_scaled: number;
  quantity_scale: number;
  tax_code: string;
  tax_bps: number;
  tax_price_basis: "exclusive" | "inclusive";
  tax_treatment: "standard" | "exempt" | "zero_rated" | "reverse_charge";
  base_minor: number;
  discount_minor: number;
  net_minor: number;
  tax_minor: number;
  line_total_minor: number;
};

export type CanonicalSnapshotChargeV1 = {
  id: string;
  position: number;
  charge_type: string;
  description: string;
  amount_minor: number;
  currency_code: string;
  tax_code: string;
  tax_bps: number;
  tax_price_basis: "exclusive" | "inclusive";
  tax_treatment: "standard" | "exempt" | "zero_rated" | "reverse_charge";
  discount_applies: boolean;
  discount_minor: number;
  net_minor: number;
  tax_minor: number;
  total_minor: number;
};

export type CanonicalTotalsV1 = {
  subtotal_minor: number;
  discount_minor: number;
  item_tax_minor: number;
  charge_net_minor: number;
  charge_tax_minor: number;
  tax_minor: number;
  charges_minor: number;
  total_minor: number;
};

export type CanonicalCalculationDocumentV1 = {
  format_version: typeof CALCULATION_FORMAT_VERSION;
  currency_code: string;
  tax_mode: "exclusive" | "inclusive";
  discount_bps: number;
  items: Array<{
    position: number;
    unit_code: string;
    quantity_precision: number;
    unit_price_minor: number;
    quantity_scaled: number;
    quantity_scale: number;
    tax_bps: number;
    tax_treatment: "standard" | "exempt" | "zero_rated" | "reverse_charge";
    base_minor: number;
    discount_minor: number;
    net_minor: number;
    tax_minor: number;
    line_total_minor: number;
  }>;
  charges: Array<{
    position: number;
    amount_minor: number;
    tax_bps: number;
    tax_treatment: "standard" | "exempt" | "zero_rated" | "reverse_charge";
    discount_applies: boolean;
    discount_minor: number;
    net_minor: number;
    tax_minor: number;
    total_minor: number;
  }>;
  totals: CanonicalTotalsV1;
};

const utf8 = new TextEncoder();

type UnknownRecord = Record<string, unknown>;

function object(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
): UnknownRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  const record = value as UnknownRecord;
  const normalizedKeys = new Set<string>();
  for (const key of Object.keys(record)) {
    const normalized = key.normalize("NFC");
    if (normalizedKeys.has(normalized)) {
      throw new RangeError(
        `${path} has duplicate object keys after NFC normalization.`,
      );
    }
    normalizedKeys.add(normalized);
  }
  const expected = new Set(requiredKeys);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(record, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      throw new TypeError(`${path}.${key} is not supported.`);
    }
  }
  return record;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string")
    throw new TypeError(`${path} must be a string.`);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (
      (unit >= 0xd800 &&
        unit <= 0xdbff &&
        (index + 1 >= value.length ||
          value.charCodeAt(index + 1) < 0xdc00 ||
          value.charCodeAt(index + 1) > 0xdfff)) ||
      (unit >= 0xdc00 &&
        unit <= 0xdfff &&
        (index === 0 ||
          value.charCodeAt(index - 1) < 0xd800 ||
          value.charCodeAt(index - 1) > 0xdbff))
    ) {
      throw new RangeError(`${path} cannot contain an unpaired surrogate.`);
    }
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function safeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${path} must be a safe integer.`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean")
    throw new TypeError(`${path} must be a boolean.`);
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new RangeError(`${path} has an unsupported value.`);
  }
  return value as T;
}

function version(value: unknown, path: string, expected: number): void {
  if (safeInteger(value, path) !== expected) {
    throw new RangeError(`${path} has an unsupported format version.`);
  }
}

const totalsKeys = [
  "subtotal_minor",
  "discount_minor",
  "item_tax_minor",
  "charge_net_minor",
  "charge_tax_minor",
  "tax_minor",
  "charges_minor",
  "total_minor",
] as const;

function validateTotals(value: unknown, path: string): void {
  const record = object(value, path, totalsKeys);
  for (const key of totalsKeys) safeInteger(record[key], `${path}.${key}`);
}

const calculationItemKeys = [
  "position",
  "unit_code",
  "quantity_precision",
  "unit_price_minor",
  "quantity_scaled",
  "quantity_scale",
  "tax_bps",
  "tax_treatment",
  "base_minor",
  "discount_minor",
  "net_minor",
  "tax_minor",
  "line_total_minor",
] as const;

function validateCalculationItem(value: unknown, path: string): void {
  const record = object(value, path, calculationItemKeys);
  for (const key of calculationItemKeys) {
    if (key !== "unit_code" && key !== "tax_treatment") {
      safeInteger(record[key], `${path}.${key}`);
    }
  }
  string(record.unit_code, `${path}.unit_code`);
  oneOf(record.tax_treatment, `${path}.tax_treatment`, [
    "standard",
    "exempt",
    "zero_rated",
    "reverse_charge",
  ] as const);
}

const calculationChargeKeys = [
  "position",
  "amount_minor",
  "tax_bps",
  "tax_treatment",
  "discount_applies",
  "discount_minor",
  "net_minor",
  "tax_minor",
  "total_minor",
] as const;

function validateCalculationCharge(value: unknown, path: string): void {
  const record = object(value, path, calculationChargeKeys);
  for (const key of calculationChargeKeys) {
    if (key !== "tax_treatment" && key !== "discount_applies") {
      safeInteger(record[key], `${path}.${key}`);
    }
  }
  oneOf(record.tax_treatment, `${path}.tax_treatment`, [
    "standard",
    "exempt",
    "zero_rated",
    "reverse_charge",
  ] as const);
  boolean(record.discount_applies, `${path}.discount_applies`);
}

function validateUniquePositions(values: unknown[], path: string): void {
  const positions = new Set<number>();
  values.forEach((value, index) => {
    const record = value as UnknownRecord;
    const position = safeInteger(record.position, `${path}[${index}].position`);
    if (position < 1 || positions.has(position)) {
      throw new RangeError(`${path} positions must be positive and unique.`);
    }
    positions.add(position);
  });
}

function validateCalculationDocumentV1(
  value: unknown,
): asserts value is CanonicalCalculationDocumentV1 {
  const record = object(value, "calculation", [
    "format_version",
    "currency_code",
    "tax_mode",
    "discount_bps",
    "items",
    "charges",
    "totals",
  ]);
  version(record.format_version, "calculation.format_version", 1);
  const currencyCode = string(
    record.currency_code,
    "calculation.currency_code",
  );
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new RangeError(
      "calculation.currency_code must be three uppercase letters.",
    );
  }
  oneOf(record.tax_mode, "calculation.tax_mode", [
    "exclusive",
    "inclusive",
  ] as const);
  safeInteger(record.discount_bps, "calculation.discount_bps");
  const items = array(record.items, "calculation.items");
  items.forEach((item, index) =>
    validateCalculationItem(item, `calculation.items[${index}]`),
  );
  validateUniquePositions(items, "calculation.items");
  const charges = array(record.charges, "calculation.charges");
  charges.forEach((charge, index) =>
    validateCalculationCharge(charge, `calculation.charges[${index}]`),
  );
  validateUniquePositions(charges, "calculation.charges");
  validateTotals(record.totals, "calculation.totals");
}

const snapshotItemKeys = [
  "id",
  "position",
  "product_id",
  "sku",
  "description",
  "unit_code",
  "quantity_precision",
  "unit_price_minor",
  "currency_code",
  "quantity_scaled",
  "quantity_scale",
  "tax_code",
  "tax_bps",
  "tax_price_basis",
  "tax_treatment",
  "base_minor",
  "discount_minor",
  "net_minor",
  "tax_minor",
  "line_total_minor",
] as const;

function validateSnapshotItem(value: unknown, path: string): void {
  const record = object(value, path, snapshotItemKeys);
  for (const key of [
    "id",
    "sku",
    "description",
    "unit_code",
    "currency_code",
    "tax_code",
  ] as const)
    string(record[key], `${path}.${key}`);
  nullableString(record.product_id, `${path}.product_id`);
  for (const key of snapshotItemKeys) {
    if (
      ![
        "id",
        "product_id",
        "sku",
        "description",
        "unit_code",
        "currency_code",
        "tax_code",
        "tax_price_basis",
        "tax_treatment",
      ].includes(key)
    )
      safeInteger(record[key], `${path}.${key}`);
  }
  oneOf(record.tax_price_basis, `${path}.tax_price_basis`, [
    "exclusive",
    "inclusive",
  ] as const);
  oneOf(record.tax_treatment, `${path}.tax_treatment`, [
    "standard",
    "exempt",
    "zero_rated",
    "reverse_charge",
  ] as const);
}

const snapshotChargeKeys = [
  "id",
  "position",
  "charge_type",
  "description",
  "amount_minor",
  "currency_code",
  "tax_code",
  "tax_bps",
  "tax_price_basis",
  "tax_treatment",
  "discount_applies",
  "discount_minor",
  "net_minor",
  "tax_minor",
  "total_minor",
] as const;

function validateSnapshotCharge(value: unknown, path: string): void {
  const record = object(value, path, snapshotChargeKeys);
  for (const key of [
    "id",
    "charge_type",
    "description",
    "currency_code",
    "tax_code",
  ] as const)
    string(record[key], `${path}.${key}`);
  for (const key of snapshotChargeKeys) {
    if (
      ![
        "id",
        "charge_type",
        "description",
        "currency_code",
        "tax_code",
        "tax_price_basis",
        "tax_treatment",
        "discount_applies",
      ].includes(key)
    )
      safeInteger(record[key], `${path}.${key}`);
  }
  oneOf(record.tax_price_basis, `${path}.tax_price_basis`, [
    "exclusive",
    "inclusive",
  ] as const);
  oneOf(record.tax_treatment, `${path}.tax_treatment`, [
    "standard",
    "exempt",
    "zero_rated",
    "reverse_charge",
  ] as const);
  boolean(record.discount_applies, `${path}.discount_applies`);
}

function validateQuoteSnapshotV1(
  value: unknown,
): asserts value is CanonicalQuoteSnapshotV1 {
  const record = object(value, "snapshot", [
    "format_version",
    "quote",
    "seller",
    "buyer",
    "commercial",
    "items",
    "charges",
    "totals",
    "approval_policy",
    "calculation",
  ]);
  version(record.format_version, "snapshot.format_version", 1);

  const quote = object(record.quote, "snapshot.quote", [
    "id",
    "number",
    "revision_number",
    "parent_snapshot_hash",
  ]);
  string(quote.id, "snapshot.quote.id");
  string(quote.number, "snapshot.quote.number");
  safeInteger(quote.revision_number, "snapshot.quote.revision_number");
  nullableString(
    quote.parent_snapshot_hash,
    "snapshot.quote.parent_snapshot_hash",
  );

  const seller = object(record.seller, "snapshot.seller", [
    "legal_name",
    "address_line1",
    "address_line2",
    "city",
    "region",
    "postal_code",
    "country_code",
    "tax_identifier",
    "contact_email",
    "contact_phone",
  ]);
  for (const key of [
    "legal_name",
    "address_line1",
    "address_line2",
    "city",
    "region",
    "postal_code",
    "country_code",
  ] as const) {
    string(seller[key], `snapshot.seller.${key}`);
  }
  for (const key of [
    "tax_identifier",
    "contact_email",
    "contact_phone",
  ] as const) {
    nullableString(seller[key], `snapshot.seller.${key}`);
  }

  const buyer = object(record.buyer, "snapshot.buyer", [
    "customer_id",
    "name",
    "contact_name",
    "email",
    "address_line1",
    "address_line2",
    "city",
    "region",
    "postal_code",
    "country_code",
    "tax_identifier",
  ]);
  for (const key of [
    "customer_id",
    "name",
    "contact_name",
    "email",
    "address_line1",
    "address_line2",
    "city",
    "region",
    "postal_code",
    "country_code",
  ] as const) {
    string(buyer[key], `snapshot.buyer.${key}`);
  }
  nullableString(buyer.tax_identifier, "snapshot.buyer.tax_identifier");

  const commercial = object(record.commercial, "snapshot.commercial", [
    "currency_code",
    "locale",
    "tax_label",
    "tax_mode",
    "customer_tax_treatment",
    "discount_bps",
    "issue_date",
    "valid_until",
    "notes",
  ]);
  for (const key of [
    "currency_code",
    "locale",
    "tax_label",
    "issue_date",
    "valid_until",
    "notes",
  ] as const) {
    string(commercial[key], `snapshot.commercial.${key}`);
  }
  oneOf(commercial.tax_mode, "snapshot.commercial.tax_mode", [
    "exclusive",
    "inclusive",
  ] as const);
  oneOf(
    commercial.customer_tax_treatment,
    "snapshot.commercial.customer_tax_treatment",
    ["standard", "exempt", "zero_rated", "reverse_charge"] as const,
  );
  safeInteger(commercial.discount_bps, "snapshot.commercial.discount_bps");

  const items = array(record.items, "snapshot.items");
  items.forEach((item, index) =>
    validateSnapshotItem(item, `snapshot.items[${index}]`),
  );
  validateUniquePositions(items, "snapshot.items");
  const charges = array(record.charges, "snapshot.charges");
  charges.forEach((charge, index) =>
    validateSnapshotCharge(charge, `snapshot.charges[${index}]`),
  );
  validateUniquePositions(charges, "snapshot.charges");
  validateTotals(record.totals, "snapshot.totals");

  const approval = object(record.approval_policy, "snapshot.approval_policy", [
    "threshold_bps",
    "requires_manual_approval",
    "reason_codes",
  ]);
  safeInteger(approval.threshold_bps, "snapshot.approval_policy.threshold_bps");
  boolean(
    approval.requires_manual_approval,
    "snapshot.approval_policy.requires_manual_approval",
  );
  array(approval.reason_codes, "snapshot.approval_policy.reason_codes").forEach(
    (reason, index) =>
      string(reason, `snapshot.approval_policy.reason_codes[${index}]`),
  );

  const calculation = object(record.calculation, "snapshot.calculation", [
    "format_version",
    "fingerprint",
  ]);
  version(calculation.format_version, "snapshot.calculation.format_version", 1);
  const fingerprint = string(
    calculation.fingerprint,
    "snapshot.calculation.fingerprint",
  );
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new RangeError(
      "snapshot.calculation.fingerprint must be a lowercase SHA-256 hash.",
    );
  }
}

function compareUtf8(left: string, right: string) {
  const leftBytes = utf8.encode(left);
  const rightBytes = utf8.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function integer(value: number) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Canonical integers must be safe integers.");
  }
  return Object.is(value, -0) ? "0" : String(value);
}

function jsonString(input: string) {
  const value = input.normalize("NFC");
  let output = '"';
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new RangeError(
        "Canonical strings cannot contain unpaired surrogates.",
      );
    }
    if (character === '"') output += '\\"';
    else if (character === "\\") output += "\\\\";
    else if (codePoint === 0x08) output += "\\b";
    else if (codePoint === 0x09) output += "\\t";
    else if (codePoint === 0x0a) output += "\\n";
    else if (codePoint === 0x0c) output += "\\f";
    else if (codePoint === 0x0d) output += "\\r";
    else if (codePoint < 0x20)
      output += `\\u${codePoint.toString(16).padStart(4, "0")}`;
    else output += character;
  }
  return `${output}"`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return jsonString(value);
  if (typeof value === "number") return integer(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const normalized = new Map<string, unknown>();
    for (const [key, entryValue] of Object.entries(value)) {
      const normalizedKey = key.normalize("NFC");
      if (normalized.has(normalizedKey)) {
        throw new RangeError(
          "Canonical object keys must be unique after NFC normalization.",
        );
      }
      normalized.set(normalizedKey, entryValue);
    }
    const keys = [...normalized.keys()].sort(compareUtf8);
    return `{${keys
      .map((key) => `${jsonString(key)}:${canonicalJson(normalized.get(key))}`)
      .join(",")}}`;
  }
  throw new TypeError(
    "Canonical JSON supports only null, booleans, strings, safe integers, arrays, and objects.",
  );
}

function totals(value: CanonicalTotalsV1) {
  return value;
}

function calculationItem(
  value: CanonicalCalculationDocumentV1["items"][number],
) {
  return value;
}

function calculationCharge(
  value: CanonicalCalculationDocumentV1["charges"][number],
) {
  return value;
}

export function canonicalizeCalculationDocumentV1(value: unknown) {
  validateCalculationDocumentV1(value);
  const items = [...value.items].sort(
    (left, right) => left.position - right.position,
  );
  const charges = [...value.charges].sort(
    (left, right) => left.position - right.position,
  );
  return canonicalJson({
    ...value,
    items: items.map(calculationItem),
    charges: charges.map(calculationCharge),
    totals: totals(value.totals),
  });
}

function snapshotItem(value: CanonicalSnapshotItemV1) {
  return value;
}

function snapshotCharge(value: CanonicalSnapshotChargeV1) {
  return value;
}

export function canonicalizeQuoteSnapshotV1(value: unknown) {
  validateQuoteSnapshotV1(value);
  const items = [...value.items].sort(
    (left, right) => left.position - right.position,
  );
  const charges = [...value.charges].sort(
    (left, right) => left.position - right.position,
  );
  const reasonCodes = [
    ...new Set(
      value.approval_policy.reason_codes.map((code) => code.normalize("NFC")),
    ),
  ].sort(compareUtf8);
  return canonicalJson({
    ...value,
    items: items.map(snapshotItem),
    charges: charges.map(snapshotCharge),
    totals: totals(value.totals),
    approval_policy: { ...value.approval_policy, reason_codes: reasonCodes },
  });
}

export function canonicalUtf8(value: string) {
  return utf8.encode(value);
}
