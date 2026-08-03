import {
  isSupportedCurrency,
  SUPPORTED_CURRENCY_CODES,
} from "../formatting/currency.ts";

export const CURRENCY_CODES = SUPPORTED_CURRENCY_CODES;
export const UNIT_CODES = ["EA", "M", "KG", "L", "BOX"] as const;
export const TAX_TREATMENTS = [
  "standard",
  "exempt",
  "zero_rated",
  "reverse_charge",
] as const;
export const CHARGE_TYPES = [
  "freight",
  "shipping",
  "handling",
  "insurance",
  "packaging",
  "customs_duties",
  "other",
] as const;

export type UnitCode = (typeof UNIT_CODES)[number];
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];
export type ChargeType = (typeof CHARGE_TYPES)[number];
export type TaxPriceBasis = "exclusive" | "inclusive";

export type QuoteCalculationItemInput = {
  position: number;
  product_id: string;
  sku_snapshot: string;
  description_snapshot: string;
  unit_code_snapshot: UnitCode;
  quantity_precision_snapshot: number;
  unit_price_minor_snapshot: number;
  currency_code: string;
  quantity_scaled: number;
  quantity_scale: number;
  tax_code_snapshot: string;
  tax_bps_snapshot: number;
  tax_price_basis_snapshot: TaxPriceBasis;
  tax_treatment_snapshot: TaxTreatment;
};

export type QuoteCalculationChargeInput = {
  position: number;
  charge_type: ChargeType;
  description_snapshot: string;
  amount_minor: number;
  currency_code: string;
  tax_code_snapshot: string;
  tax_bps_snapshot: number;
  tax_price_basis_snapshot: TaxPriceBasis;
  tax_treatment_snapshot: TaxTreatment;
  discount_applies: boolean;
};

export type QuoteCalculationInput = {
  currency_code: string;
  tax_mode: TaxPriceBasis;
  discount_bps: number;
  items: QuoteCalculationItemInput[];
  charges: QuoteCalculationChargeInput[];
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const BASIS_POINTS = 10_000n;

function integer(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  return BigInt(value);
}

function safe(value: bigint, label: string) {
  if (value < 0n || value > MAX_SAFE)
    throw new RangeError(`${label} exceeds the safe integer range.`);
  return Number(value);
}

function roundedRatio(value: bigint, multiplier: bigint, divisor: bigint) {
  if (value < 0n || multiplier < 0n || divisor <= 0n)
    throw new RangeError(
      "Rounded ratio requires non-negative values and a positive divisor.",
    );
  return (value * multiplier + divisor / 2n) / divisor;
}

export function quantityIsValid(
  unitCode: UnitCode,
  precision: number,
  scaled: number,
  scale: number,
) {
  if (
    !Number.isSafeInteger(scaled) ||
    scaled <= 0 ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 3
  )
    return false;
  if (unitCode === "EA" || unitCode === "BOX")
    return precision === 0 && scale === 1;
  return scale === 10 ** precision;
}

export function calculateQuote(input: QuoteCalculationInput) {
  if (!isSupportedCurrency(input.currency_code)) {
    throw new RangeError("Quote calculation uses an unsupported currency.");
  }
  if (
    !Number.isInteger(input.discount_bps) ||
    input.discount_bps < 0 ||
    input.discount_bps > 10_000
  ) {
    throw new RangeError("Quote calculation header is invalid.");
  }
  const discountBps = BigInt(input.discount_bps);
  let subtotal = 0n;
  let discount = 0n;
  let itemTax = 0n;
  let chargeNet = 0n;
  let chargeTax = 0n;
  let chargeDiscount = 0n;

  const items = input.items.map((item, index) => {
    if (item.currency_code !== input.currency_code)
      throw new RangeError(`items[${index}] has mixed currency.`);
    if (
      !quantityIsValid(
        item.unit_code_snapshot,
        item.quantity_precision_snapshot,
        item.quantity_scaled,
        item.quantity_scale,
      )
    ) {
      throw new RangeError(`items[${index}] has invalid quantity precision.`);
    }
    const unitPrice = integer(
      item.unit_price_minor_snapshot,
      `items[${index}].unit_price_minor_snapshot`,
    );
    const quantityScaled = integer(
      item.quantity_scaled,
      `items[${index}].quantity_scaled`,
    );
    const quantityScale = integer(
      item.quantity_scale,
      `items[${index}].quantity_scale`,
    );
    const taxBps = integer(
      item.tax_bps_snapshot,
      `items[${index}].tax_bps_snapshot`,
    );
    if (taxBps > BASIS_POINTS)
      throw new RangeError(`items[${index}].tax_bps_snapshot exceeds 10000.`);
    const priceBase = roundedRatio(unitPrice, quantityScaled, quantityScale);
    let base: bigint;
    let lineDiscount: bigint;
    let net: bigint;
    let tax: bigint;
    let lineTotal: bigint;

    if (item.tax_treatment_snapshot !== "standard") {
      base = priceBase;
      net = roundedRatio(priceBase, BASIS_POINTS - discountBps, BASIS_POINTS);
      lineDiscount = base - net;
      tax = 0n;
      lineTotal = net;
    } else if (input.tax_mode === "inclusive") {
      base = roundedRatio(priceBase, BASIS_POINTS, BASIS_POINTS + taxBps);
      const discountedGross = roundedRatio(
        priceBase,
        BASIS_POINTS - discountBps,
        BASIS_POINTS,
      );
      net = roundedRatio(discountedGross, BASIS_POINTS, BASIS_POINTS + taxBps);
      lineDiscount = base - net;
      tax = discountedGross - net;
      lineTotal = discountedGross;
    } else if (input.tax_mode === "exclusive") {
      base = priceBase;
      net = roundedRatio(base, BASIS_POINTS - discountBps, BASIS_POINTS);
      lineDiscount = base - net;
      tax = roundedRatio(net, taxBps, BASIS_POINTS);
      lineTotal = net + tax;
    } else {
      throw new RangeError(`items[${index}] has invalid tax basis.`);
    }
    subtotal += base;
    discount += lineDiscount;
    itemTax += tax;
    return {
      ...item,
      tax_price_basis_snapshot: input.tax_mode,
      base_minor: safe(base, `items[${index}].base_minor`),
      discount_minor: safe(lineDiscount, `items[${index}].discount_minor`),
      net_minor: safe(net, `items[${index}].net_minor`),
      tax_minor: safe(tax, `items[${index}].tax_minor`),
      line_total_minor: safe(lineTotal, `items[${index}].line_total_minor`),
    };
  });

  const charges = input.charges.map((charge, index) => {
    if (charge.currency_code !== input.currency_code)
      throw new RangeError(`charges[${index}] has mixed currency.`);
    if (!CHARGE_TYPES.includes(charge.charge_type))
      throw new RangeError(`charges[${index}] has invalid type.`);
    const amount = integer(
      charge.amount_minor,
      `charges[${index}].amount_minor`,
    );
    const taxBps = integer(
      charge.tax_bps_snapshot,
      `charges[${index}].tax_bps_snapshot`,
    );
    if (taxBps > BASIS_POINTS)
      throw new RangeError(`charges[${index}].tax_bps_snapshot exceeds 10000.`);
    let base: bigint;
    let calculatedDiscount: bigint;
    let net: bigint;
    let tax: bigint;
    let chargeTotal: bigint;

    if (charge.tax_treatment_snapshot !== "standard") {
      base = amount;
      net = charge.discount_applies
        ? roundedRatio(base, BASIS_POINTS - discountBps, BASIS_POINTS)
        : base;
      calculatedDiscount = base - net;
      tax = 0n;
      chargeTotal = net;
    } else if (input.tax_mode === "inclusive") {
      base = roundedRatio(amount, BASIS_POINTS, BASIS_POINTS + taxBps);
      const discountedGross = charge.discount_applies
        ? roundedRatio(amount, BASIS_POINTS - discountBps, BASIS_POINTS)
        : amount;
      net = roundedRatio(discountedGross, BASIS_POINTS, BASIS_POINTS + taxBps);
      calculatedDiscount = base - net;
      tax = discountedGross - net;
      chargeTotal = discountedGross;
    } else if (input.tax_mode === "exclusive") {
      base = amount;
      net = charge.discount_applies
        ? roundedRatio(base, BASIS_POINTS - discountBps, BASIS_POINTS)
        : base;
      calculatedDiscount = base - net;
      tax = roundedRatio(net, taxBps, BASIS_POINTS);
      chargeTotal = net + tax;
    } else {
      throw new RangeError(`charges[${index}] has invalid tax basis.`);
    }
    chargeNet += net;
    chargeTax += tax;
    chargeDiscount += calculatedDiscount;
    return {
      ...charge,
      tax_price_basis_snapshot: input.tax_mode,
      discount_minor: safe(
        calculatedDiscount,
        `charges[${index}].discount_minor`,
      ),
      net_minor: safe(net, `charges[${index}].net_minor`),
      tax_minor: safe(tax, `charges[${index}].tax_minor`),
      charge_total_minor: safe(
        chargeTotal,
        `charges[${index}].charge_total_minor`,
      ),
    };
  });

  const total = subtotal - discount + itemTax + chargeNet + chargeTax;
  return {
    currency_code: input.currency_code,
    tax_mode: input.tax_mode,
    discount_bps: input.discount_bps,
    items,
    charges,
    subtotal_minor: safe(subtotal, "subtotal_minor"),
    discount_minor: safe(discount, "discount_minor"),
    item_tax_minor: safe(itemTax, "item_tax_minor"),
    charge_net_minor: safe(chargeNet, "charge_net_minor"),
    charge_tax_minor: safe(chargeTax, "charge_tax_minor"),
    charge_discount_minor: safe(chargeDiscount, "charge_discount_minor"),
    tax_minor: safe(itemTax + chargeTax, "tax_minor"),
    charges_minor: safe(chargeNet + chargeTax, "charges_minor"),
    total_minor: safe(total, "total_minor"),
  };
}
