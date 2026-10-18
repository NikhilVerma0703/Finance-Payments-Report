/**
 * The Excel upload action, deliberately in a file of its own.
 *
 * It reaches the workbook reader, which reaches exceljs — around 700 kB of
 * server graph. While this lived alongside the other form actions, every screen
 * importing any of them (the manual-entry form, the invoice screen, the customer
 * screen) inherited exceljs in its own route bundle, because a route carries the
 * whole module graph of what it imports.
 *
 * Reading a workbook belongs to the screen that uploads one and nowhere else.
 * `tests/navigation.test.ts` fails the build if that slips again.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { ROUTES } from "@/lib/routes";
import { uploadMembership } from "@/lib/payments/uploads";
import { importPaymentSheet } from "@/server/payments/import";
import { invoiceRefs, readUploadRefs } from "@/server/payments/uploads";

/** Every screen reads the same records, so every screen is refreshed. */
function refresh(): void {
  revalidatePath("/", "layout");
}

function text(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// ---------------------------------------------------------------------------
// Excel upload
// ---------------------------------------------------------------------------

export interface UploadState {
  ok: boolean;
  message: string;
  /** The upload just saved, so the screen can point at its invoices. */
  importId: string | null;
  mapping: Array<[string, string]>;
  unmapped: Array<{ column: string; heading: string }>;
  detail: string[];
  terms: Array<{ raw: string; understood: string; count: number; unknown: boolean }>;
  warnings: string[];
}

export async function uploadSheetAction(
  _prev: UploadState | null,
  form: FormData,
): Promise<UploadState> {
  const file = form.get("file");
  const empty: UploadState = {
    ok: false,
    message: "",
    importId: null,
    mapping: [],
    unmapped: [],
    detail: [],
    terms: [],
    warnings: [],
  };

  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, message: "Choose a file first." };
  }
  if (!/\.xlsx?$|\.xlsm$/i.test(file.name)) {
    return { ...empty, message: "That needs to be an Excel file (.xlsx, .xls or .xlsm)." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importPaymentSheet(buffer, file.name, {
    replace: form.get("replace") === "on",
    dryRun: form.get("dryRun") === "on",
  });

  const detail: string[] = [];
  detail.push(
    `Customer: ${result.customer ?? "none found"}${result.customerSource ? ` (from ${result.customerSource})` : ""}`,
  );
  if (result.currency) detail.push(`Currency: ${result.currency} — from ${result.currencySource}`);
  if (result.created.length) detail.push(`Added: ${result.created.join(", ")}`);
  if (result.updated.length) detail.push(`Updated: ${result.updated.join(", ")}`);
  for (const c of result.changes.slice(0, 25)) {
    detail.push(`  ${c.invoiceNo} ${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`);
  }
  for (const s of result.skipped) detail.push(`Skipped ${s.invoiceNo}: ${s.why}`);
  for (const dup of result.duplicates) {
    detail.push(`Duplicate invoice number ${dup.invoiceNo} in this sheet (${dup.where})`);
  }
  if (result.comparison.length) {
    detail.push(`The customer's own block differs on ${result.comparison.length} point(s):`);
    for (const c of result.comparison.slice(0, 25)) {
      detail.push(`  ${c.invoiceNo} ${c.what}: ours ${c.ours ?? "—"}, theirs ${c.theirs ?? "—"}`);
    }
  }

  // the upload form refreshes the screen itself once it has this result

  return {
    ok: result.ok,
    message: result.message,
    importId: result.importId ?? null,
    mapping: Object.entries(result.mapping),
    unmapped: result.unmapped,
    detail,
    terms: result.terms,
    warnings: result.warnings,
  };
}

/**
 * Delete an upload, and the invoices that belong to it alone.
 *
 * An invoice the upload created is removed with it — receipts, notes and
 * history included — unless another upload also carries it, in which case it
 * is kept. A customer the upload created is removed too once it has no
 * invoices left. Everything else is untouched.
 */
export async function deleteUploadAction(form: FormData): Promise<void> {
  const id = text(form, "importId");
  if (!id) return;

  const [uploads, refs] = await Promise.all([readUploadRefs(), invoiceRefs()]);
  const upload = uploads.find((u) => u.ref.id === id);
  if (!upload) return;
  const membership = uploadMembership(
    uploads.map((u) => u.ref),
    refs,
  ).get(id);
  const doomed = (membership?.exclusive ?? []).filter(
    (inv) => refs.find((r) => r.id === inv)?.source === "EXCEL",
  );

  const customers = await prisma.ptInvoice.findMany({
    where: { id: { in: doomed } },
    select: { customerId: true },
  });

  await prisma.ptInvoice.deleteMany({ where: { id: { in: doomed } } });
  await prisma.ptImport.delete({ where: { id } });

  // a customer this upload created, now with nothing left, goes with it
  for (const cid of new Set(customers.map((c) => c.customerId).filter(Boolean) as string[])) {
    const customer = await prisma.ptCustomer.findUnique({
      where: { id: cid },
      include: { _count: { select: { invoices: true } } },
    });
    if (
      customer &&
      customer._count.invoices === 0 &&
      (customer.notes ?? "").startsWith(`Created from ${upload.row.fileName}`)
    ) {
      await prisma.ptCustomer.delete({ where: { id: cid } });
    }
  }

  refresh();
  redirect(ROUTES.upload);
}
