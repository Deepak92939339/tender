import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/customers/customer-form";
import { requireApplicationContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const context = await requireApplicationContext();
  const supabase = await createClient();
  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("organization_id", context.membership.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error || !customer) notFound();
  return (
    <section className="destination-page customer-detail">
      <header className="destination-header">
        <div>
          <p className="eyebrow">Customer</p>
          <h1>{customer.name}</h1>
          <p>
            {customer.contact_name || "No named contact"} ·{" "}
            {customer.preferred_currency_code} · {customer.locale}
          </p>
        </div>
        <Link className="button" href="/customers">
          Back to customers
        </Link>
      </header>
      <div className="detail-grid">
        <dl>
          <div>
            <dt>Email</dt>
            <dd>{customer.email || "—"}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{customer.phone || "—"}</dd>
          </div>
          <div>
            <dt>Billing address</dt>
            <dd>
              {[
                customer.billing_address_line1,
                customer.billing_address_line2,
                customer.billing_city,
                customer.billing_region,
                customer.billing_postal_code,
                customer.billing_country_code,
              ]
                .filter(Boolean)
                .join(", ") || "—"}
            </dd>
          </div>
          <div>
            <dt>Tax treatment</dt>
            <dd>{customer.tax_treatment.replace("_", " ")}</dd>
          </div>
          <div>
            <dt>Tax identifier</dt>
            <dd>{customer.tax_identifier || "—"}</dd>
          </div>
        </dl>
        {context.capabilities.includes("customer.manage") && (
          <details>
            <summary className="button">Edit customer</summary>
            <CustomerForm
              mode="edit"
              commandId={crypto.randomUUID()}
              defaults={{
                id: customer.id,
                name: customer.name,
                contactName: customer.contact_name,
                email: customer.email,
                phone: customer.phone,
                address1: customer.billing_address_line1,
                address2: customer.billing_address_line2,
                city: customer.billing_city,
                region: customer.billing_region,
                postalCode: customer.billing_postal_code,
                countryCode: customer.billing_country_code,
                locale: customer.locale,
                currencyCode: customer.preferred_currency_code,
                taxTreatment: customer.tax_treatment,
                taxIdentifier: customer.tax_identifier ?? "",
                version: customer.version,
              }}
            />
          </details>
        )}
      </div>
    </section>
  );
}
