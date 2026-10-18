/**
 * New Record — an invoice with its receipts and credit/debit notes, entered by
 * hand. No field is required: save what is known now, complete it later.
 */
import Link from "next/link";

import { RecordForm } from "@/components/tracking/RecordForm";
import { PageHead } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import { loadFormContext } from "@/server/payments/formContext";

export const dynamic = "force-dynamic";

export default async function NewRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const ctx = await loadFormContext();
  const preset = customerId && ctx.customers.some((c) => c.id === customerId) ? customerId : null;

  return (
    <>
      <PageHead
        title="New Record"
        lead="Enter what you know — no field is required. Figures beside the boxes are calculated as you type."
        actions={
          <Link href={ROUTES.upload} className="btn-ghost">
            Upload a sheet instead
          </Link>
        }
      />
      <RecordForm
        initial={{}}
        customerId={preset}
        customers={ctx.customers}
        receipts={[]}
        notes={[]}
        termOptions={ctx.termOptions}
        rules={ctx.rules}
        params={ctx.params}
        today={ctx.today}
        submitLabel="Save record"
        cancelHref={ROUTES.dashboard}
      />
    </>
  );
}
