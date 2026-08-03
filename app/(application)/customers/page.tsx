import Link from "next/link";
import { CustomerForm } from "@/components/customers/customer-form";
import { requireApplicationContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const context = await requireApplicationContext();
  const query = await searchParams;
  const search = (query.q ?? "").trim().slice(0, 100);
  const supabase = await createClient();
  const { data: customers, error } = await supabase.rpc("search_customers", {
    p_organization_id: context.membership.organizationId,
    p_query: search,
    p_state: "active",
    p_limit: 100,
    p_offset: 0,
  });
  if (error) throw new Error("Unable to load tenant-scoped customers.");
  return (
    <section className="destination-page">
      <header className="destination-header">
        <div>
          <p className="eyebrow">Commercial parties</p>
          <h1>Customers</h1>
          <p>Tenant-scoped contacts, billing details and tax treatment.</p>
        </div>
      </header>
      <div className="destination-tools">
        <form className="filter-form">
          <label>
            Search customers
            <input name="q" defaultValue={search} maxLength={100} />
          </label>
          <button className="button" type="submit">
            Search
          </button>
        </form>
        {context.capabilities.includes("customer.manage") && (
          <details>
            <summary className="button">Create customer</summary>
            <CustomerForm
              commandId={crypto.randomUUID()}
              defaults={{
                locale: context.membership.organization.default_locale,
                currencyCode:
                  context.membership.organization.default_currency_code,
              }}
            />
          </details>
        )}
      </div>
      <div
        className="table-region"
        tabIndex={0}
        role="region"
        aria-label="Customers table"
      >
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Contact</th>
              <th>Location</th>
              <th>Currency</th>
              <th>Tax treatment</th>
            </tr>
          </thead>
          <tbody>
            {customers?.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <Link
                    className="record-link"
                    href={`/customers/${customer.id}`}
                  >
                    {customer.name}
                  </Link>
                </td>
                <td>{customer.contact_name || customer.email || "—"}</td>
                <td>
                  {[customer.billing_city, customer.billing_country_code]
                    .filter(Boolean)
                    .join(", ")}
                </td>
                <td>{customer.preferred_currency_code}</td>
                <td>{customer.tax_treatment.replace("_", " ")}</td>
              </tr>
            ))}
            {!customers?.length && (
              <tr>
                <td colSpan={5} className="table-empty">
                  No customers match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
