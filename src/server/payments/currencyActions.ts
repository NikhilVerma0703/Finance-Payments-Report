"use server";

/**
 * The dashboard's "Read currencies from the uploaded sheets": every invoice
 * with no currency is read again from the file it came from, and its customer
 * given the default its invoices agree on (server/payments/currencies.ts).
 * Touches nothing that has a currency already; every write is in the
 * correction history. Back to the dashboard with what it did.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { fillCurrenciesFromUploads } from "./currencies";

export async function fillCurrenciesAction(): Promise<void> {
  const f = await fillCurrenciesFromUploads();
  const codes = Object.entries(f.codes)
    .map(([code, n]) => `${n} in ${code}`)
    .join(", ");
  const message = f.invoices
    ? `${f.invoices} invoice(s) given the currency their uploaded sheet shows (${codes})${f.customers ? `, and ${f.customers} customer(s) the default their invoices agree on` : ""}.`
    : f.read
      ? "The uploaded sheets were read again; none of them shows a currency for the invoices still without one."
      : "Every invoice from an uploaded sheet already has a currency.";
  revalidatePath("/", "layout");
  redirect(`${ROUTES.dashboard}?currencies=${encodeURIComponent(message)}#currencies`);
}
