/**
 * When the figures last changed — what the dashboard's status bar says in
 * place of "Live" (owner, 30 Oct 2026: "instead of Live mention as of updated
 * on, then whichever data last change happened or last upload happened").
 *
 * The newest of: a sheet uploaded, an invoice, receipt, note, customer or
 * money on account saved, a correction logged, and an invoice marked
 * completed. A follow-up's status is not a figure and is left out. A row
 * deleted leaves no time behind. Read only.
 */
import "server-only";

import { prisma } from "@/lib/db";

export interface LastChange {
  at: Date;
  /** "upload" when the newest change is a sheet uploaded, "edit" otherwise. */
  source: "upload" | "edit";
  /** The uploaded sheet's name, for an upload. */
  fileName: string | null;
}

export async function lastDataChange(): Promise<LastChange | null> {
  const [invoice, receipt, note, customer, onAccount, edit, completed, upload] = await Promise.all([
    prisma.ptInvoice.aggregate({ _max: { updatedAt: true } }),
    prisma.ptReceipt.aggregate({ _max: { updatedAt: true } }),
    prisma.ptNote.aggregate({ _max: { updatedAt: true } }),
    prisma.ptCustomer.aggregate({ _max: { updatedAt: true } }),
    prisma.ptOnAccount.aggregate({ _max: { updatedAt: true } }),
    prisma.ptFieldEdit.aggregate({ _max: { createdAt: true } }),
    prisma.ptCompleted.aggregate({ _max: { completedAt: true } }),
    prisma.ptImport.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, fileName: true } }),
  ]);
  const editAt = [
    invoice._max.updatedAt, receipt._max.updatedAt, note._max.updatedAt, customer._max.updatedAt,
    onAccount._max.updatedAt, edit._max.createdAt, completed._max.completedAt,
  ].reduce<Date | null>((a, t) => (t && (!a || t > a) ? t : a), null);
  if (upload && (!editAt || upload.createdAt >= editAt)) return { at: upload.createdAt, source: "upload", fileName: upload.fileName };
  return editAt ? { at: editAt, source: "edit", fileName: null } : null;
}
