/**
 * The Upload Sheet screen's data: every upload, what it brought in, and which
 * of those invoices belong to it alone.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { fromJson } from "@/lib/json";
import type { TrackedInvoice } from "@/lib/payments/record";
import { uploadMembership, type InvoiceRef, type Membership, type UploadRef } from "@/lib/payments/uploads";
import { loadTracking } from "@/server/payments/query";

export interface UploadReport {
  mapping?: Record<string, string>;
  created?: string[];
  updated?: string[];
  unchanged?: string[];
  skipped?: Array<{ invoiceNo: string; why: string }>;
  duplicates?: Array<{ invoiceNo: string; where: string }>;
  comparison?: Array<{ invoiceNo: string; what: string; ours: string | null; theirs: string | null }>;
  terms?: Array<{ raw: string; understood: string; count: number; unknown?: boolean }>;
  totals?: { value: number; received: number; balance: number };
  statedTotals?: { value: number | null; received: number | null; balance: number | null } | null;
}

/** Every upload, with its report parsed and its membership worked out. */
export async function readUploadRefs() {
  const rows = await prisma.ptImport.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      sheetName: true,
      customerName: true,
      asOn: true,
      asOnSource: true,
      currency: true,
      rowsRead: true,
      created: true,
      updated: true,
      skipped: true,
      report: true,
      warnings: true,
      createdAt: true,
    },
  });
  const uploads = rows.map((r) => {
    const report = fromJson<UploadReport>(r.report, {});
    return {
      row: r,
      report,
      warnings: fromJson<string[]>(r.warnings, []),
      ref: {
        id: r.id,
        fileName: r.fileName,
        customerName: r.customerName,
        created: report.created ?? [],
        updated: report.updated ?? [],
        unchanged: report.unchanged ?? [],
      } satisfies UploadRef,
    };
  });
  return uploads;
}

export async function invoiceRefs(): Promise<InvoiceRef[]> {
  const rows = await prisma.ptInvoice.findMany({
    select: {
      id: true,
      invoiceNo: true,
      source: true,
      sourceFile: true,
      sourceRow: true,
      customer: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    customerName: r.customer?.name ?? null,
    invoiceNo: r.invoiceNo,
    source: r.source,
    sourceFile: r.sourceFile,
    sourceRow: r.sourceRow,
  }));
}

export interface UploadView {
  id: string;
  fileName: string;
  sheetName: string;
  customerName: string | null;
  asOn: string | null;
  asOnSource: string | null;
  currency: string | null;
  rowsRead: number;
  created: number;
  updated: number;
  skipped: number;
  createdAt: string;
  report: UploadReport;
  warnings: string[];
  membership: Membership;
  /** The invoices this upload added or updated, as they stand now. */
  invoices: TrackedInvoice[];
  /** Invoice ids with changes made by hand since they came in. */
  edited: string[];
}

export async function loadUploads(): Promise<{ uploads: UploadView[]; imported: TrackedInvoice[] }> {
  const [uploads, refs, view] = await Promise.all([readUploadRefs(), invoiceRefs(), loadTracking()]);
  const membership = uploadMembership(
    uploads.map((u) => u.ref),
    refs,
  );
  const byId = new Map(view.invoices.map((i) => [i.id, i]));

  const imported = view.invoices.filter((i) => i.source === "EXCEL");
  const edits = await prisma.ptFieldEdit.groupBy({
    by: ["invoiceId"],
    where: { invoiceId: { in: imported.map((i) => i.id) } },
    _count: { _all: true },
  });
  const edited = new Set(edits.filter((e) => e._count._all > 0).map((e) => e.invoiceId as string));

  return {
    imported,
    uploads: uploads.map(({ row, report, warnings }) => {
      const m = membership.get(row.id)!;
      const invoices = m.touched
        .map((id) => byId.get(id))
        .filter((i): i is TrackedInvoice => Boolean(i))
        .sort((a, b) => (a.invoiceNo ?? "").localeCompare(b.invoiceNo ?? "", undefined, { numeric: true }));
      return {
        id: row.id,
        fileName: row.fileName,
        sheetName: row.sheetName,
        customerName: row.customerName,
        asOn: row.asOn ? row.asOn.toISOString().slice(0, 10) : null,
        asOnSource: row.asOnSource,
        currency: row.currency,
        rowsRead: row.rowsRead,
        created: row.created,
        updated: row.updated,
        skipped: row.skipped,
        createdAt: row.createdAt.toISOString().slice(0, 10),
        report,
        warnings,
        membership: m,
        invoices,
        edited: invoices.filter((i) => edited.has(i.id)).map((i) => i.id),
      };
    }),
  };
}
