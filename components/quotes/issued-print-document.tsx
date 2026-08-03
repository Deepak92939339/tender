import { formatMinor } from "@/lib/formatting/money";

export function chunkPrintItems<T>(items: T[], size = 14) {
  if (size < 1) throw new RangeError("Print chunk size must be positive.");
  if (items.length === 0) return [[]] as T[][];
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

type PrintItem = {
  id: string;
  position: number;
  sku: string;
  description: string;
  unitCode: string;
  quantityScaled: number;
  quantityScale: number;
  unitPriceMinor: number;
  taxCode: string;
  lineTotalMinor: number;
};
type PrintCharge = {
  id: string;
  description: string;
  amountMinor: number;
  taxMinor: number;
  totalMinor: number;
};
type SellerSnapshot = {
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  taxIdentifier: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

function quantity(scaled: number, scale: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.round(Math.log10(scale)),
  }).format(scaled / scale);
}

export function IssuedPrintDocument({
  quote,
  seller,
  customer,
  items,
  charges,
  issuedActor,
}: {
  quote: {
    number: string;
    issueDate: string;
    validUntil: string;
    currencyCode: string;
    locale: string;
    taxLabel: string;
    taxMode: "exclusive" | "inclusive";
    notes: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    chargesMinor: number;
    totalMinor: number;
    issuedAt: string;
  };
  seller: SellerSnapshot | null;
  customer: {
    name: string;
    contactName: string;
    email: string;
    address: string;
    taxIdentifier: string | null;
  };
  items: PrintItem[];
  charges: PrintCharge[];
  issuedActor: string;
}) {
  const pages = chunkPrintItems(items);
  return (
    <section
      className="print-document"
      aria-label={`Print presentation for ${quote.number}`}
    >
      {pages.map((pageItems, pageIndex) => {
        const finalPage = pageIndex === pages.length - 1;
        return (
          <article className="print-page" key={pageIndex}>
            <header className="print-header">
              <div>
                <strong className="print-document-title">
                  Commercial quotation
                </strong>
                <p>
                  Prepared in <span className="brand-word">Tender</span>
                </p>
              </div>
              <div className="print-meta">
                <strong>{quote.number}</strong>
                <span>Issued</span>
                <small>Issue date · {quote.issueDate}</small>
                <small>Valid until · {quote.validUntil}</small>
              </div>
            </header>
            <section className="print-parties" aria-label="Commercial parties">
              <div className="print-party print-seller" aria-label="Seller">
                <span>Seller</span>
                {seller ? (
                  <>
                    <strong>{seller.legalName}</strong>
                    <address>
                      <small>{seller.addressLine1}</small>
                      {seller.addressLine2 && (
                        <small>{seller.addressLine2}</small>
                      )}
                      <small>
                        {[seller.city, seller.region, seller.postalCode]
                          .filter(Boolean)
                          .join(", ")}
                      </small>
                      <small>{seller.countryCode}</small>
                    </address>
                    {seller.taxIdentifier && (
                      <small>Tax ID: {seller.taxIdentifier}</small>
                    )}
                    {(seller.contactEmail || seller.contactPhone) && (
                      <small>
                        {[seller.contactEmail, seller.contactPhone]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    )}
                  </>
                ) : (
                  <p className="print-snapshot-missing">
                    Seller identity was not captured when this pre-R local
                    quotation was issued.
                  </p>
                )}
              </div>
              <div className="print-party print-customer" aria-label="Customer">
                <span>Customer</span>
                <strong>{customer.name}</strong>
                <small>
                  {[customer.contactName, customer.email]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <small>{customer.address}</small>
                {customer.taxIdentifier && (
                  <small>Tax ID: {customer.taxIdentifier}</small>
                )}
              </div>
            </section>
            {pageIndex > 0 && (
              <p className="continued-label">Continued — commercial lines</p>
            )}
            <table className="print-lines">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Unit price</th>
                  <th>Tax</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.sku}</strong>
                      <span>{item.description}</span>
                    </td>
                    <td>
                      {quantity(
                        item.quantityScaled,
                        item.quantityScale,
                        quote.locale,
                      )}{" "}
                      {item.unitCode}
                    </td>
                    <td>
                      {formatMinor(
                        item.unitPriceMinor,
                        quote.currencyCode,
                        quote.locale,
                      )}
                    </td>
                    <td>{item.taxCode}</td>
                    <td>
                      {formatMinor(
                        item.lineTotalMinor,
                        quote.currencyCode,
                        quote.locale,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {finalPage && (
              <div className="print-final">
                {charges.length > 0 && (
                  <section>
                    <h2>Charges</h2>
                    {charges.map((charge) => (
                      <div className="print-charge" key={charge.id}>
                        <span>{charge.description}</span>
                        <strong>
                          {formatMinor(
                            charge.totalMinor,
                            quote.currencyCode,
                            quote.locale,
                          )}
                        </strong>
                      </div>
                    ))}
                  </section>
                )}
                <dl className="print-totals">
                  <div>
                    <dt>Subtotal</dt>
                    <dd>
                      {formatMinor(
                        quote.subtotalMinor,
                        quote.currencyCode,
                        quote.locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Discount</dt>
                    <dd>
                      −{" "}
                      {formatMinor(
                        quote.discountMinor,
                        quote.currencyCode,
                        quote.locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{quote.taxLabel}</dt>
                    <dd>
                      {formatMinor(
                        quote.taxMinor,
                        quote.currencyCode,
                        quote.locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Charges</dt>
                    <dd>
                      {formatMinor(
                        quote.chargesMinor,
                        quote.currencyCode,
                        quote.locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>
                      {formatMinor(
                        quote.totalMinor,
                        quote.currencyCode,
                        quote.locale,
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="print-issuance">
                  Prices are tax-{quote.taxMode}. The quotation tax mode is
                  authoritative for all item and charge amounts.
                </p>
                {quote.notes && (
                  <section className="print-notes">
                    <h2>Commercial notes</h2>
                    <p>{quote.notes}</p>
                  </section>
                )}
                <p className="print-issuance">
                  Issued by {issuedActor} on{" "}
                  {new Intl.DateTimeFormat(quote.locale, {
                    dateStyle: "long",
                    timeStyle: "short",
                  }).format(new Date(quote.issuedAt))}
                  . Issuance does not mean delivery.
                </p>
              </div>
            )}
            <footer>
              <span>{finalPage ? "Final page" : "Continued"}</span>
              <span>
                Page {pageIndex + 1} of {pages.length}
              </span>
            </footer>
          </article>
        );
      })}
    </section>
  );
}
