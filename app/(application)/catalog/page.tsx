import { ProductForm } from "@/components/catalog/product-form";
import { CatalogImport } from "@/components/catalog/catalog-import";
import { formatMinor } from "@/lib/formatting/money";
import { requireApplicationContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string }>;
}) {
  const context = await requireApplicationContext();
  const query = await searchParams;
  const search = (query.q ?? "").trim().slice(0, 100);
  const state =
    query.state === "inactive"
      ? "inactive"
      : query.state === "all"
        ? "all"
        : "active";
  const supabase = await createClient();
  const [{ data: products, error }, { data: taxProfiles }] = await Promise.all([
    supabase.rpc("search_products", {
      p_organization_id: context.membership.organizationId,
      p_query: search,
      p_state: state,
      p_limit: 100,
      p_offset: 0,
    }),
    supabase
      .from("tax_profiles")
      .select("id, code, label")
      .eq("organization_id", context.membership.organizationId)
      .eq("active", true)
      .order("code"),
  ]);
  if (error) throw new Error("Unable to load the tenant-scoped catalog.");

  return (
    <section className="destination-page">
      <header className="destination-header">
        <div>
          <p className="eyebrow">Commercial source</p>
          <h1>Catalog</h1>
          <p>
            Organization products, units, prices and configured tax treatments.
          </p>
        </div>
      </header>
      <div className="destination-tools">
        <form className="filter-form">
          <label>
            Search catalog
            <input name="q" defaultValue={search} maxLength={100} />
          </label>
          <label>
            State
            <select name="state" defaultValue={query.state ?? "active"}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </label>
          <button className="button" type="submit">
            Apply
          </button>
        </form>
        {context.capabilities.includes("catalog.manage") && (
          <details name="catalog-tool">
            <summary className="button">Create product</summary>
            <ProductForm
              taxProfiles={taxProfiles ?? []}
              currencyCode={
                context.membership.organization.default_currency_code
              }
              commandId={crypto.randomUUID()}
            />
          </details>
        )}
        {context.capabilities.includes("catalog.import") && (
          <details name="catalog-tool">
            <summary className="button">Import CSV</summary>
            <CatalogImport />
          </details>
        )}
      </div>
      <div
        className="table-region"
        tabIndex={0}
        role="region"
        aria-label="Catalog table"
      >
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Description</th>
              <th>Unit</th>
              <th>Unit price</th>
              <th>Tax profile</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {products?.map((product) => (
              <tr key={product.id}>
                <td className="mono">{product.sku}</td>
                <td>{product.description}</td>
                <td>
                  {product.unit_code}
                  {product.quantity_precision > 0
                    ? ` · ${product.quantity_precision} decimals`
                    : ""}
                </td>
                <td className="money">
                  {formatMinor(
                    product.unit_price_minor,
                    product.currency_code,
                    context.membership.organization.default_locale,
                  )}
                </td>
                <td>{product.tax_code}</td>
                <td>{product.active ? "Active" : "Inactive"}</td>
              </tr>
            ))}
            {!products?.length && (
              <tr>
                <td colSpan={6} className="table-empty">
                  No catalog products match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="legal-note">
        Tax profiles are organization configuration for demonstration and
        calculation; they are not universal legal tax advice.
      </p>
    </section>
  );
}
