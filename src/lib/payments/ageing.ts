/**
 * The ageing summary on the dashboard.
 *
 * Two different questions, kept apart so nothing is counted twice:
 *
 *   **Ageing of the outstanding balance** puts every invoice that still owes
 *   money into exactly one bucket — no due date, not yet due, 1–30, 31–60,
 *   61–90 or over 90 days past due — so the buckets add up to the total
 *   outstanding. An invoice without a due date is never put in an overdue
 *   bucket, because nobody knows that it is late.
 *
 *   **Nothing received** is a separate lens across those same invoices: the
 *   ones where not a single receipt has arrived. It overlaps the buckets by
 *   design and is therefore shown beside them, not added to them.
 */
import { round2 } from "../text";
import { ageingLabels, AGEING_BUCKETS, NO_DUE_DATE, NOT_YET_DUE } from "./money";
import type { TrackedInvoice } from "./record";

export interface AgeingCard {
  /** The label, and the value the ageing filter takes for it. */
  label: string;
  count: number;
  amount: number;
}

export interface AgeingSummary {
  /** Outstanding invoices with nothing received against them. */
  nothingReceived: AgeingCard;
  /** Every outstanding invoice in exactly one of these, in display order. */
  buckets: AgeingCard[];
  /** Σ bucket amounts — equal to the total outstanding of open invoices. */
  totalOutstanding: number;
  openInvoices: number;
}

/** The bucket order: undated first, then by how late. */
export function ageingOrder(buckets: number[] = AGEING_BUCKETS): string[] {
  const labels = ageingLabels(buckets).filter((l) => l !== NOT_YET_DUE);
  return [NO_DUE_DATE, NOT_YET_DUE, ...labels];
}

/** One currency's invoices in, the summary out. Never mix currencies here. */
export function ageingSummary(
  invoices: TrackedInvoice[],
  buckets: number[] = AGEING_BUCKETS,
): AgeingSummary {
  const order = ageingOrder(buckets);
  const cards = new Map<string, AgeingCard>(order.map((l) => [l, { label: l, count: 0, amount: 0 }]));
  const nothingReceived: AgeingCard = { label: "Nothing received", count: 0, amount: 0 };
  let total = 0;
  let open = 0;

  for (const i of invoices) {
    const outstanding = i.money.calculatedOutstanding ?? 0;
    if (outstanding <= 0.01) continue;
    open += 1;
    total = round2(total + outstanding);

    const card = cards.get(i.ageing);
    if (card) {
      card.count += 1;
      card.amount = round2(card.amount + outstanding);
    }
    if (i.money.totalReceived <= 0.01) {
      nothingReceived.count += 1;
      nothingReceived.amount = round2(nothingReceived.amount + outstanding);
    }
  }

  return { nothingReceived, buckets: [...cards.values()], totalOutstanding: total, openInvoices: open };
}
