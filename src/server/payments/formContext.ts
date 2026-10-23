/**
 * What the full record form needs besides the record itself: the customers to
 * pick from, the payment-term wordings to suggest, and the rules and thresholds
 * its live calculations apply — the same ones every other screen applies.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { matchErpClient } from "@/lib/payments/erpClients";
import { SUPPORTED_TERMS } from "@/lib/payments/terms";
import { todayIso } from "@/lib/text";
import type { CustomerOption } from "@/components/tracking/RecordForm";
import { loadParams, loadRules } from "@/server/payments/settings";

export async function loadFormContext() {
  const [customers, rules, params, used, erp] = await Promise.all([
    prisma.ptCustomer.findMany({ orderBy: { name: "asc" } }),
    loadRules(),
    loadParams(),
    prisma.ptInvoice.findMany({
      where: { paymentTerms: { not: null } },
      distinct: ["paymentTerms"],
      select: { paymentTerms: true },
    }),
    prisma.ptErpClient.findMany(),
  ]);
  const erpByKey = new Map(erp.map((e) => [e.nameKey, e]));

  const termOptions = [
    ...new Set([
      ...used.map((u) => u.paymentTerms ?? ""),
      ...rules.filter((r) => r.active).map((r) => r.matchText),
      ...SUPPORTED_TERMS.map((t) => t.example),
    ]),
  ].filter(Boolean);

  const options: CustomerOption[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    contact: c.contact,
    currency: c.currency,
    erpCurrency: matchErpClient(c.name, erpByKey)?.currency ?? null,
    defaultPaymentTerms: c.defaultPaymentTerms,
    notes: c.notes,
    country: c.country,
    consignee: c.consignee,
    notifyParty: c.notifyParty,
  }));

  return { customers: options, rules, params, today: todayIso(), termOptions };
}

/** A stored value as a form box shows it: dates as YYYY-MM-DD, blanks as "". */
export function asInput(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}
