export type NewQuoteDefaultsCustomer = {
  id: string;
  preferredCurrencyCode: string | null;
  locale: string | null;
};

export function newQuoteDefaultsForCustomer(
  customers: NewQuoteDefaultsCustomer[],
  customerId: string,
  defaultCurrency: string,
  defaultLocale: string,
) {
  const customer = customers.find((candidate) => candidate.id === customerId);
  return {
    currencyCode: customer?.preferredCurrencyCode ?? defaultCurrency,
    locale: customer?.locale ?? defaultLocale,
  };
}
