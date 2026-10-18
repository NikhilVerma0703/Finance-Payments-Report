/**
 * Serving a download: the filtered invoices as the report workbook, or as CSV.
 * Both export routes use this, so a download from the dashboard, from Search
 * and from Reports is the same report for the same filters.
 */
import "server-only";

import { NextResponse } from "next/server";

import { filterInvoices, filtersFrom, loadTracking } from "@/server/payments/query";
import { buildInvoicesCsv, buildReportWorkbook, safeFileName } from "@/server/payments/workbook";

export async function download(params: URLSearchParams, title: string, prefix: string) {
  const filters = filtersFrom(params);
  const { invoices, today, params: tracking } = await loadTracking();
  const rows = filterInvoices(invoices, filters);

  const scope = filters.customer ? `_${safeFileName(filters.customer)}` : "";
  const name = `${prefix}${scope}_${today.replace(/-/g, "")}`;

  if ((params.get("format") ?? "xlsx") === "csv") {
    return new NextResponse(buildInvoicesCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
      },
    });
  }

  const buffer = await buildReportWorkbook(rows, { today, filters, params: tracking, title });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
    },
  });
}
