/**
 * Currencies read again from the uploaded sheets (owner, 25 Oct 2026:
 * "automatically fetch the currency from the uploaded Excel sheets … without
 * manually entering or hardcoding it").
 *
 * Every upload's file is kept (pt_imports.content), so a sheet read before the
 * reader learned to look past the invoice-value column (sheetReader.ts
 * findCurrency) can be read again. This reads each kept file with today's
 * reader and, for every invoice that upload carries and that has no currency of
 * its own, writes the one the sheet shows; then gives each customer with no
 * default currency the one its invoices now agree on. Nothing that already has
 * a currency is touched, and every write is in the correction history, labelled
 * with the file it came from.
 *
 * New uploads need none of this: the import writes the currency it reads.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { readPaymentSheet } from "@/lib/payments/sheetReader";
import { nameKey } from "@/lib/payments/recordForm";
import { recordEdits } from "./audit";

export interface CurrencyFill {
  /** Uploads whose file was read again, and of those how many showed a currency. */
  read: number;
  found: number;
  /** Invoices and customers given a currency, and how many of each code. */
  invoices: number;
  customers: number;
  codes: Record<string, number>;
}

/** Invoices with no currency that came from a sheet — the ones this can help. */
export async function invoicesWithoutCurrency(): Promise<number> {
  return prisma.ptInvoice.count({ where: { currency: null, sourceFile: { not: null } } });
}

export async function fillCurrenciesFromUploads(): Promise<CurrencyFill> {
  const out: CurrencyFill = { read: 0, found: 0, invoices: 0, customers: 0, codes: {} };
  const wanted = await prisma.ptInvoice.findMany({
    where: { currency: null, sourceFile: { not: null } },
    select: { id: true, sourceFile: true, customerId: true, source: true, customer: { select: { name: true } } },
  });
  if (!wanted.length) return out;

  // newest first: a file uploaded twice is judged by its latest upload
  const files = [...new Set(wanted.map((i) => i.sourceFile!))];
  const uploads = await prisma.ptImport.findMany({
    where: { fileName: { in: files } },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, sheetName: true, customerName: true, currency: true, currencySource: true, content: true },
  });

  const byFile = new Map<string, Array<{ code: string; source: string; customer: string | null }>>();
  for (const u of uploads) {
    let code = u.currency;
    let source = u.currencySource ?? "";
    if (!code) {
      out.read += 1;
      const reads = await readPaymentSheet(Buffer.from(u.content), u.fileName).catch(() => []);
      const read = reads.find((r) => r.sheetName === u.sheetName) ?? (reads.length === 1 ? reads[0] : undefined);
      if (read?.currency) {
        code = read.currency;
        source = read.currencySource;
        await prisma.ptImport.update({ where: { id: u.id }, data: { currency: code, currencySource: source } });
      }
    }
    if (!code) continue;
    out.found += 1;
    byFile.set(u.fileName, [...(byFile.get(u.fileName) ?? []), { code, source, customer: u.customerName }]);
  }
  if (!byFile.size) return out;

  const touched = new Set<string>();
  for (const i of wanted) {
    const candidates = byFile.get(i.sourceFile!) ?? [];
    // the upload of this customer, where one file name was used for two
    const hit = candidates.find((c) => !c.customer || nameKey(c.customer) === nameKey(i.customer?.name)) ?? candidates[0];
    if (!hit) continue;
    await prisma.ptInvoice.update({ where: { id: i.id }, data: { currency: hit.code } });
    await recordEdits({
      entity: "INVOICE",
      entityId: i.id,
      invoiceId: i.id,
      customerId: i.customerId,
      recordSource: i.source,
      changes: [{ fieldKey: "currency", label: `Currency — read from ${i.sourceFile} (${hit.source})`, from: null, to: hit.code }],
    });
    out.invoices += 1;
    out.codes[hit.code] = (out.codes[hit.code] ?? 0) + 1;
    if (i.customerId) touched.add(i.customerId);
  }

  // a customer with no default takes the one currency its invoices now state
  const customers = await prisma.ptCustomer.findMany({
    where: { id: { in: [...touched] }, currency: null },
    select: { id: true, invoices: { select: { currency: true } } },
  });
  for (const c of customers) {
    const codes = new Set(c.invoices.map((i) => i.currency).filter((v): v is string => !!v));
    if (codes.size !== 1) continue;
    const [code] = [...codes];
    await prisma.ptCustomer.update({ where: { id: c.id }, data: { currency: code } });
    await recordEdits({
      entity: "CUSTOMER",
      entityId: c.id,
      customerId: c.id,
      recordSource: "EXCEL",
      changes: [{ fieldKey: "currency", label: "Currency — the one its uploaded sheets show", from: null, to: code }],
    });
    out.customers += 1;
  }
  return out;
}
