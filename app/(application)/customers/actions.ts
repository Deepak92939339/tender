"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApplicationContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { customerSchema } from "@/lib/validation/customer";
import {
  logMutationFailure,
  withReference,
} from "@/lib/errors/mutation-failure";

export type CustomerMutationState = {
  error?: string;
  message?: string;
  customerId?: string;
};

function payload(data: ReturnType<typeof customerSchema.parse>) {
  return {
    name: data.name,
    contact_name: data.contactName,
    email: data.email,
    phone: data.phone,
    billing_address_line1: data.billingAddressLine1,
    billing_address_line2: data.billingAddressLine2,
    billing_city: data.billingCity,
    billing_region: data.billingRegion,
    billing_postal_code: data.billingPostalCode,
    billing_country_code: data.billingCountryCode,
    locale: data.locale,
    preferred_currency_code: data.preferredCurrencyCode,
    tax_treatment: data.taxTreatment,
    tax_identifier: data.taxIdentifier || null,
    active: true,
  };
}

export async function createCustomer(
  _: CustomerMutationState,
  formData: FormData,
): Promise<CustomerMutationState> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("customer.manage"))
    return {
      error:
        "Customer creation failed. Nothing changed. Your role cannot manage customers.",
    };
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  const commandId = z.string().uuid().safeParse(formData.get("commandId"));
  if (!parsed.success || !commandId.success)
    return {
      error:
        "Customer creation failed. Nothing was saved. Correct the customer, address, locale and tax fields, then try again.",
    };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_customer", {
    p_organization_id: context.membership.organizationId,
    p_payload: payload(parsed.data),
    p_command_id: commandId.data,
  });
  if (
    error ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.id !== "string"
  ) {
    const reference = logMutationFailure("customer.create", error ?? undefined);
    return {
      error: withReference(
        "Customer creation failed. No customer was saved. Your existing data is preserved; check the fields and try again.",
        reference,
      ),
    };
  }
  revalidatePath("/customers");
  return { message: `${parsed.data.name} was created.`, customerId: data.id };
}

export async function updateCustomer(
  _: CustomerMutationState,
  formData: FormData,
): Promise<CustomerMutationState> {
  const context = await requireApplicationContext();
  if (!context.capabilities.includes("customer.manage"))
    return {
      error:
        "Customer update failed. Nothing changed. Your role cannot manage customers.",
    };
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  const customerId = String(formData.get("customerId") ?? "");
  const commandId = z.string().uuid().safeParse(formData.get("commandId"));
  if (
    !parsed.success ||
    !commandId.success ||
    !/^[0-9a-f-]{36}$/i.test(customerId) ||
    !parsed.data.expectedVersion
  )
    return {
      error:
        "Customer update failed. Nothing was saved. Reload the customer and correct the fields.",
    };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_customer", {
    p_customer_id: customerId,
    p_expected_version: parsed.data.expectedVersion,
    p_payload: payload(parsed.data),
    p_command_id: commandId.data,
  });
  if (
    error ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.id !== "string"
  ) {
    const reference = logMutationFailure("customer.update", error ?? undefined);
    return {
      error: withReference(
        "Customer update failed. No data was overwritten. The record may be stale; reload it and try again.",
        reference,
      ),
    };
  }
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { message: `${parsed.data.name} was updated.`, customerId };
}
