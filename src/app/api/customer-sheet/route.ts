/**
 * One customer's outstanding sheet as a PDF (lib/payments/customerSheet.ts) —
 * the "PDF" beside each customer in the customer-wise summary.
 * ?customer=<id>&currency=<code or —>. Reads only.
 */
import type { NextRequest } from "next/server";

import { buildCustomerSheet } from "@/lib/payments/customerSheet";
import { loadCustomer } from "@/server/payments/query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const id = q.get("customer") ?? "";
  const currency = q.get("currency") ?? "";
  const { customer, invoices, today } = await loadCustomer(id);
  if (!customer) return new Response("No such customer", { status: 404 });

  // one sheet per currency, as the summary has one row per currency
  const rows = currency ? invoices.filter((i) => (i.currency ?? "—") === currency) : invoices;
  const name = customer.name ?? "Customer";
  const bytes = await buildCustomerSheet({
    customerName: name,
    currency: currency && currency !== "—" ? currency : (rows[0]?.currency ?? null),
    invoices: rows,
    today,
  });

  const file = `${name.replace(/[^A-Za-z0-9 _.-]+/g, "").trim() || "Customer"} - outstanding ${today}.pdf`;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
