/**
 * Loading the main ERP's client list into this module.
 *
 * The ERP keeps each client's default currency; this module keeps a copy of
 * that list (`pt_erp_clients`) so a customer with no currency of its own can
 * take the ERP's. The copy is replaced as a whole by each upload — it is the
 * ERP's list, not one to be edited here. A currency that is wrong for a
 * customer is corrected on the customer here, which always wins over the copy
 * and never reaches the ERP.
 */
"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { parseCsv, readClientList } from "@/lib/payments/erpClients";
import { ROUTES } from "@/lib/routes";

function done(message: string): never {
  revalidatePath("/", "layout");
  redirect(`${ROUTES.settings}?erp=${encodeURIComponent(message)}#erp-clients`);
}

/** Every sheet of a workbook as rows of cell values, 0-indexed. */
async function sheetsOf(buffer: Buffer): Promise<unknown[][][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      rows.push(Array.isArray(values) ? values.slice(1) : []);
    });
    return rows;
  });
}

export async function importErpClientsAction(form: FormData): Promise<void> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) done("Choose the ERP client list to upload.");

  const name = file.name;
  const buffer = Buffer.from(await file.arrayBuffer());
  let sheets: unknown[][][];
  try {
    sheets = /\.csv$/i.test(name) ? [parseCsv(buffer.toString("utf8"))] : await sheetsOf(buffer);
  } catch {
    done(`${name} could not be read. Upload the client list as .xlsx or .csv.`);
  }

  const read = readClientList(sheets);
  if (read.problem) done(`${name}: ${read.problem}`);

  await prisma.$transaction([
    prisma.ptErpClient.deleteMany({}),
    prisma.ptErpClient.createMany({
      data: read.clients.map((c) => ({ ...c, source: name })),
    }),
  ]);

  const withCurrency = read.clients.filter((c) => c.currency).length;
  done(
    `${read.clients.length} client(s) read from ${name}, ${withCurrency} with a currency.` +
      (read.duplicates ? ` ${read.duplicates} repeated name(s) were read once.` : "") +
      (read.withoutCurrency ? ` ${read.withoutCurrency} row(s) had no currency the reader recognised.` : ""),
  );
}

export async function clearErpClientsAction(): Promise<void> {
  const { count } = await prisma.ptErpClient.deleteMany({});
  done(`The copy of the ERP client list was removed (${count} client(s)). Customers keep any currency set on them here.`);
}
