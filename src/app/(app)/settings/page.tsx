/**
 * Settings & Rules.
 *
 * The payment terms the system recognises, the rules the business has added,
 * the thresholds the status rules use, and a reference for every formula. The
 * worked examples are calculated live by the same functions every other screen
 * uses, so the reference cannot drift from what the application actually does.
 */
import Link from "next/link";

import { ConfirmDelete } from "@/components/tracking/ConfirmDelete";
import { ParamsForm, TermRuleForm, type RuleDraft } from "@/components/tracking/SettingsForms";
import { day, money, rate, StatusChip } from "@/components/tracking/bits";
import { PageHead } from "@/components/ui";
import { formatMoney, HOME_CURRENCY } from "@/lib/money";
import { ageingOrder } from "@/lib/payments/ageing";
import { buildTrackedInvoice, STATUS_LABELS, STATUS_ORDER } from "@/lib/payments/record";
import { BASIS_LABELS, DATE_BASES, readTerm, SUPPORTED_TERMS } from "@/lib/payments/terms";
import { ROUTES } from "@/lib/routes";
import { addDays } from "@/lib/text";
import { clearErpClientsAction, importErpClientsAction } from "@/server/payments/erpClientActions";
import { loadErpOverview, loadTracking } from "@/server/payments/query";
import { PARAM_FIELDS } from "@/server/payments/settings";
import { deleteTermRuleAction, toggleTermRuleAction } from "@/server/payments/settingsActions";

export const dynamic = "force-dynamic";

const head = "bg-[#eef2f7] text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-2)]";

function Formula({
  title,
  formula,
  children,
}: {
  title: string;
  formula: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] p-4">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <div className="mt-1.5 rounded bg-[#f4f7fb] px-3 py-2 font-mono text-[12px] text-[var(--color-brand)]">
        {formula}
      </div>
      {children && <div className="mt-2 space-y-1 text-[12px] text-[var(--color-ink-2)]">{children}</div>}
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; test?: string; wording?: string; erp?: string }>;
}) {
  const sp = await searchParams;
  const { invoices, rules, params, today } = await loadTracking();
  const erp = await loadErpOverview();
  const matched = erp.customers.filter((c) => c.erp);
  const unmatched = erp.customers.filter((c) => !c.erp && !c.own);

  // ---- the wordings in use, as they are currently understood
  const inUse = new Map<string, { count: number; reading: ReturnType<typeof readTerm> }>();
  for (const i of invoices) {
    const raw = (i.paymentTerms ?? "").trim();
    if (!raw) continue;
    const e = inUse.get(raw);
    if (e) e.count += 1;
    else inUse.set(raw, { count: 1, reading: i.schedule.term });
  }
  const noTerms = invoices.filter((i) => !(i.paymentTerms ?? "").trim()).length;
  const ruleUse = new Map<string, number>();
  for (const i of invoices) {
    const id = i.schedule.term.rule?.id;
    if (id) ruleUse.set(id, (ruleUse.get(id) ?? 0) + 1);
  }

  // ---- the rule being edited, or a blank one (prefilled from "Create rule")
  const editing = sp.edit ? rules.find((r) => r.id === sp.edit) : undefined;
  const draft: RuleDraft = editing
    ? {
        id: editing.id,
        name: editing.name,
        matchText: editing.matchText,
        matchMode: editing.matchMode,
        active: editing.active,
        notes: "",
        milestones: editing.milestones.map((m) => ({
          percent: String(m.percent),
          days: String(m.days),
          basis: m.basis,
        })),
      }
    : {
        name: "",
        matchText: sp.wording ?? "",
        matchMode: "EXACT",
        active: true,
        notes: "",
        milestones: [],
      };
  const bases: Array<[string, string]> = DATE_BASES.map((b) => [b, BASIS_LABELS[b]]);
  const tested = sp.test ? readTerm(sp.test, rules) : null;

  // ---- a worked example, calculated by the real functions
  const docs = addDays(today, -100);
  const bl = addDays(today, -96);
  const example = buildTrackedInvoice(
    {
      id: "example",
      customerId: null,
      customerName: "Example customer",
      invoiceNo: "EX-001",
      invoiceDate: addDays(today, -110),
      customerInvoiceValue: 10000,
      customsInvoiceValue: null,
      exchangeRate: 83,
      currency: "USD",
      consignee: null,
      notifyParty: null,
      country: null,
      paymentTerms: "70% Cash Against Documents (CAD), Balance 30% at 90 Days",
      enteredDueDate: null,
      piNo: null,
      poNo: null,
      shippingBillNo: null,
      shippingBillDate: null,
      blNo: null,
      blDate: bl,
      containerNo: null,
      eta: null,
      docsPresentedDate: docs,
      booksBalance: 3000,
      remarks: null,
      followUpNotes: null,
      source: "MANUAL",
      sourceFile: null,
      sourceAsOn: null,
      receipts: [{ id: "r1", seq: 1, receiptDate: addDays(docs, 5), amountFcy: 6800, exchangeRate: 83.5 }],
      notes: [
        { id: "n1", noteType: "CREDIT", amount: 200 },
        { id: "n2", noteType: "DEBIT", amount: 50 },
      ],
    },
    { today, params, rules },
  );
  const em = example.money;
  const r1 = em.receipts[0];
  const usd = (n: number | null | undefined) => money(n, "USD");

  return (
    <>
      <PageHead
        title="Settings & Rules"
        lead="Payment terms recognised, your own term rules, the thresholds the statuses use, and every formula."
      />

      {/* ------------------------------------------------ 1. terms recognised */}
      <section className="card mb-5" id="terms">
        <h2 className="card-title">Payment terms recognised</h2>
        <div className="grid gap-5 xl:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-ink-2)]">Built-in readings</h3>
            <div className="tablewrap">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className={head}>
                    <th className="px-3 py-2">Written as</th>
                    <th className="px-3 py-2">Taken to mean</th>
                  </tr>
                </thead>
                <tbody>
                  {SUPPORTED_TERMS.map((t) => (
                    <tr key={t.example} className="border-t border-[var(--color-line)]">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{t.example}</td>
                      <td className="px-3 py-2 text-[var(--color-ink-2)]">{t.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
              Spelling, capitals and spacing do not matter. A wording not recognised gives no due
              date of its own: the invoice falls due {params.defaultDueDays || "—"} day(s) after its
              invoice date (the default credit period
              {params.defaultDueDays ? "" : ", switched off — then it is marked Requires verification"}) — add a rule below to define it.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-ink-2)]">
              Wordings in your records
            </h3>
            <div className="tablewrap">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className={head}>
                    <th className="px-3 py-2">Wording</th>
                    <th className="px-3 py-2 text-right">Invoices</th>
                    <th className="px-3 py-2">Understood as</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {[...inUse.entries()]
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([raw, { count, reading }]) => (
                      <tr key={raw} className="border-t border-[var(--color-line)] align-top">
                        <td className="px-3 py-2 font-medium">{raw}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{count}</td>
                        <td className={`px-3 py-2 ${reading.unknown ? "text-[var(--color-bad-fg)]" : ""}`}>
                          {reading.unknown ? "Not recognised" : reading.description}
                          {reading.rule && (
                            <span className="chip ml-1 bg-[var(--color-info-bg)] text-[var(--color-info-fg)]">
                              rule: {reading.rule.name}
                            </span>
                          )}
                          {reading.assumptions.length > 0 && (
                            <div className="mt-0.5 text-[11px] text-[var(--color-warn-fg)]">
                              {reading.assumptions[0]}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {!reading.rule && (
                            <Link
                              href={`${ROUTES.settings}?wording=${encodeURIComponent(raw)}#rules`}
                              className="link text-[11px]"
                            >
                              {reading.unknown ? "Define a rule" : "Override with a rule"}
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  {noTerms > 0 && (
                    <tr className="border-t border-[var(--color-line)]">
                      <td className="px-3 py-2 italic text-[var(--color-ink-3)]">No terms recorded</td>
                      <td className="px-3 py-2 text-right tabular-nums">{noTerms}</td>
                      <td className="px-3 py-2 text-[var(--color-warn-fg)]">
                        No due date can be worked out — add the terms on each invoice
                      </td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <form method="get" action={`${ROUTES.settings}#terms`} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block min-w-[260px] flex-1">
                <span className="field-label">Test a wording</span>
                <input name="test" defaultValue={sp.test ?? ""} className="input" placeholder="e.g. 50% advance + 50% at 60 days from BL" />
              </label>
              <button type="submit" className="btn-ghost">
                Test
              </button>
            </form>
            {tested && (
              <div className="mt-2 rounded-lg border border-[var(--color-line)] bg-[#fbfcfe] px-3 py-2 text-[12px]">
                <strong className={tested.unknown ? "text-[var(--color-bad-fg)]" : ""}>
                  {tested.unknown ? "Not recognised" : tested.description}
                </strong>
                {tested.rule && <span className="ml-1 text-[var(--color-info-fg)]">(rule: {tested.rule.name})</span>}
                {tested.assumptions.map((a) => (
                  <p key={a} className="mt-1 text-[11px] text-[var(--color-warn-fg)]">
                    {a}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ 2. rules */}
      <section className="card mb-5" id="rules">
        <h2 className="card-title">Your payment-term rules</h2>
        <p className="mb-3 text-[12px] text-[var(--color-ink-2)]">
          A rule gives a wording its exact meaning — one portion or several, each with its own share
          and the date it counts from. Rules are checked before the built-in readings and apply to
          every invoice, the dashboard, the summaries and every export.
        </p>

        {rules.length > 0 && (
          <div className="tablewrap mb-4">
            <table className="w-full text-[12px]">
              <thead>
                <tr className={head}>
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2">Recognises</th>
                  <th className="px-3 py-2">Meaning</th>
                  <th className="px-3 py-2 text-right">Invoices</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--color-line)] align-top">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">
                      &ldquo;{r.matchText}&rdquo;
                      <div className="text-[10px] text-[var(--color-ink-3)]">
                        {r.matchMode === "EXACT" ? "exact wording" : "wording containing this"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-ink-2)]">
                      {readTerm(r.matchText, [{ ...r, active: true }]).description}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{ruleUse.get(r.id) ?? 0}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`chip ${
                          r.active
                            ? "bg-[var(--color-ok-bg)] text-[var(--color-ok-fg)]"
                            : "bg-[var(--color-mute-bg)] text-[var(--color-mute-fg)]"
                        }`}
                      >
                        {r.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`${ROUTES.settings}?edit=${r.id}#rules`} className="link text-[11px]">
                          Edit
                        </Link>
                        <form action={toggleTermRuleAction}>
                          <input type="hidden" name="ruleId" value={r.id} />
                          <button type="submit" className="link text-[11px]">
                            {r.active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                        <ConfirmDelete
                          small
                          action={deleteTermRuleAction}
                          fields={{ ruleId: r.id }}
                          label="Delete"
                          question={`Delete the rule "${r.name}"? Invoices using this wording go back to the built-in reading.`}
                          confirmLabel="Yes, delete"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="rounded-lg border border-dashed border-[#c3d1e0] p-4">
          <h3 className="mb-3 text-[13px] font-semibold">
            {editing ? `Edit rule "${editing.name}"` : "Add a rule"}
          </h3>
          <TermRuleForm key={editing?.id ?? `new-${sp.wording ?? ""}`} draft={draft} bases={bases} />
        </div>
      </section>

      {/* ------------------------------------------------ 3. thresholds */}
      <section className="card mb-5" id="thresholds">
        <h2 className="card-title">Status thresholds</h2>
        <ParamsForm
          fields={PARAM_FIELDS.map((f) => ({
            key: f.key,
            label: f.label,
            help: f.help,
            value: params[f.key],
            min: f.min,
            max: f.max,
          }))}
        />
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          Ageing categories are fixed: {ageingOrder(params.ageingBuckets).join(", ")}.
        </p>
      </section>

      {/* ------------------------------------------------ 4. ERP client list */}
      <section className="card mb-5 scroll-mt-4" id="erp-clients">
        <h2 className="card-title">Customer currencies from the main ERP</h2>
        <p className="mb-3 max-w-[90ch] text-[12px] text-[var(--color-ink-2)]">
          The main ERP keeps each client&rsquo;s default currency. Upload its client list here — the
          ERP&rsquo;s own <em>Customer list</em> workbook, or any .xlsx or .csv with a customer name
          column and a currency column — and every customer here without a currency of its own takes
          the ERP&rsquo;s, matched by name. A currency set on a customer in this module always wins,
          and nothing is ever written back to the ERP.
        </p>

        {sp.erp && (
          <div className="banner mb-3 border-[#c6dcf3] bg-[var(--color-info-bg)] text-[var(--color-info-fg)]">
            {sp.erp}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px]">
          <span>
            <strong className="tabular-nums">{erp.clients.length}</strong> ERP client(s) on file
            {erp.source && <> · from <strong>{erp.source}</strong></>}
            {erp.loadedAt && <> · {erp.loadedAt.toISOString().slice(0, 10)}</>}
          </span>
          <span>
            <strong className="tabular-nums">{matched.length}</strong> of {erp.customers.length} customer(s)
            matched
          </span>
          {unmatched.length > 0 && (
            <span className="text-[var(--color-warn-fg)]">
              {unmatched.length} customer(s) have no currency from anywhere
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <form action={importErpClientsAction} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="field-label" htmlFor="erp-file">
                ERP client list (.xlsx or .csv)
              </label>
              <input id="erp-file" name="file" type="file" accept=".xlsx,.csv" className="input" />
            </div>
            <button type="submit" className="btn">
              {erp.clients.length ? "Replace the list" : "Upload the list"}
            </button>
          </form>
          {erp.clients.length > 0 && (
            <ConfirmDelete
              action={clearErpClientsAction}
              fields={{}}
              label="Remove the list"
              question="Customers without a currency of their own go back to having none. Currencies set here are kept."
              confirmLabel="Yes, remove it"
            />
          )}
        </div>

        {(matched.length > 0 || unmatched.length > 0) && (
          <div className="tablewrap mt-4 max-h-[360px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className={head}>
                  <th className="px-3 py-2">Customer here</th>
                  <th className="px-3 py-2">Set here</th>
                  <th className="px-3 py-2">ERP client</th>
                  <th className="px-3 py-2">ERP currency</th>
                  <th className="px-3 py-2">Used</th>
                </tr>
              </thead>
              <tbody>
                {[...matched, ...unmatched].map((c) => (
                  <tr key={c.id} className="border-t border-[var(--color-line)]">
                    <td className="px-3 py-1.5">
                      <Link href={ROUTES.customer(c.id)} className="link">
                        {c.name ?? "(unnamed)"}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">{c.own ?? "—"}</td>
                    <td className="px-3 py-1.5 text-[var(--color-ink-2)]">{c.erp?.name ?? "no match"}</td>
                    <td className="px-3 py-1.5">{c.erp?.currency ?? "—"}</td>
                    <td className="px-3 py-1.5 font-semibold">
                      {c.own ?? c.erp?.currency ?? (
                        <span className="font-normal text-[var(--color-warn-fg)]">none — set it on the customer</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ 5. formulas */}
      <section className="card" id="formulas">
        <h2 className="card-title">Formulas and calculation rules</h2>
        <p className="mb-4 text-[12px] text-[var(--color-ink-2)]">
          Every figure is calculated from the stored fields each time it is shown, by one set of
          functions, so the dashboard, Search, the invoice and customer screens and every export
          always agree. Without the date a term counts from, or without terms the engine can read,
          the default credit period stands in: the invoice falls due {params.defaultDueDays} day(s)
          after its invoice date, and every screen labels that due date <em>default</em>. With the
          default set to 0, or no invoice date either, there is no due date and the invoice is marked{" "}
          <em>Requires verification</em> rather than late.
          The examples use one sample invoice — USD 10,000 at {rate(83)}, terms &ldquo;70% Cash Against
          Documents (CAD), Balance 30% at 90 Days&rdquo;, documents presented {day(docs)}, BL {day(bl)},
          one receipt of USD 6,800 at {rate(83.5)}, a credit note of USD 200 and a debit note of USD 50 —
          calculated live as at {day(today)}.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <Formula title="Due date from payment terms" formula="Due date = basis date + days, for each portion of the terms">
            <p>
              The basis is the date the wording counts from: {DATE_BASES.map((b) => BASIS_LABELS[b]).join(", ")}.
              A wording that does not say (&ldquo;balance at 90 days&rdquo;) is counted from the BL date and
              the assumption is shown.
            </p>
            <p>
              The invoice&apos;s due date is the next portion still owing. An entered due date is used
              as entered, in place of the calculation.
            </p>
            <p className="text-[var(--color-ink-3)]">
              Example: {example.schedule.milestones.map((m) => `${m.label} → ${m.dueDate ? day(m.dueDate) : "no date"}`).join("; ")}.
              Due date shown: {day(example.schedule.dueDate)}.
            </p>
          </Formula>

          <Formula
            title="Mixed terms and multiple milestones"
            formula="Portion amount = invoice value × portion %   ·   money received settles the earliest portion first"
          >
            <p>
              Each portion has its own due date, so an invoice can be partly due. Only the portions
              whose own due date has passed count as overdue (&ldquo;Of which past due&rdquo;). The
              last portion absorbs rounding, so the portions always add up to the invoice value.
            </p>
            <p className="text-[var(--color-ink-3)]">
              Example:{" "}
              {example.schedule.milestones
                .map((m) => `${m.percent}% = ${usd(m.amount)}, settled ${usd(m.settled)}, ${m.state.replace("_", " ").toLowerCase()}`)
                .join("; ")}
              .
            </p>
          </Formula>

          <Formula title="Overdue days, overdue date and ageing" formula="Overdue days = today − due date   ·   Overdue date = due date + 1 day">
            <p>
              Ageing places every invoice that still owes money in exactly one category by its overdue
              days: {ageingOrder(params.ageingBuckets).join(", ")}. An invoice dated by the default
              credit period is aged like any other; one with no due date at all is never put in an
              overdue category. Paid invoices are <em>Settled</em>.
            </p>
            <p>
              The overdue date is the day an invoice became overdue; only invoices still owing money
              past their due date have one. &ldquo;Date Range On: Overdue Date&rdquo; filters on it.
            </p>
            <p className="text-[var(--color-ink-3)]">
              Example: {example.overdueDays !== null && example.overdueDays > 0
                ? `${example.overdueDays} day(s) overdue since ${day(example.overdueSince)} — ${example.ageing}`
                : `not overdue — ${example.ageing}`}
              .
            </p>
          </Formula>

          <Formula title="Total received" formula="Total received = Σ receipt amounts (FCY)">
            <p>Every receipt counts, however many there are. Receipt amounts are in the invoice currency.</p>
            <p className="text-[var(--color-ink-3)]">Example: {usd(em.totalReceived)}.</p>
          </Formula>

          <Formula
            title="Outstanding balance, credit notes and debit notes"
            formula="Outstanding = invoice value − total received − credit notes + debit notes"
          >
            <p>
              A credit note (CN) reduces what the customer owes; a debit note (DN) adds to it. The
              balance as per books is entered separately and never enters this sum — the difference
              is shown so the two can be reconciled.
            </p>
            <p className="text-[var(--color-ink-3)]">
              Example: 10,000.00 − {em.totalReceived.toFixed(2)} − {em.creditNotes.toFixed(2)} +{" "}
              {em.debitNotes.toFixed(2)} = {usd(em.calculatedOutstanding)}; books {usd(em.booksBalance)},
              difference {usd(em.booksDifference)}.
            </p>
          </Formula>

          <Formula
            title="Exchange rate difference and forex gain/loss"
            formula={`Rate difference = receipt rate − invoice rate   ·   Forex gain/loss (${HOME_CURRENCY}) = rate difference × receipt amount`}
          >
            <p>
              Rates are {HOME_CURRENCY} per one unit of the invoice currency. A positive figure is a gain.
              Without both rates there is no forex figure — never a zero.
            </p>
            <p className="text-[var(--color-ink-3)]">
              Example: {rate(r1?.exchangeRate)} − {rate(83)} = {rate(r1?.rateDifference)}; ×{" "}
              {r1?.amountFcy?.toFixed(2)} = {formatMoney(r1?.forexGainLoss, HOME_CURRENCY)}.
            </p>
          </Formula>

          <Formula
            title={`Foreign currency to ${HOME_CURRENCY}`}
            formula={`Value (${HOME_CURRENCY}) = amount × that invoice's own exchange rate`}
          >
            <p>
              Totals in {HOME_CURRENCY} add each invoice at its own rate and say how many invoices carry
              one; an invoice without a rate is left out rather than counted as zero. Amounts in two
              different currencies are never added together.
            </p>
            <p className="text-[var(--color-ink-3)]">
              Example: 10,000.00 × {rate(83)} = {formatMoney(em.homeInvoiceValue, HOME_CURRENCY)}.
            </p>
          </Formula>

          <Formula
            title="Payment and collection percentages"
            formula="Collected % = total received ÷ invoice value × 100   ·   Settled = received + CN − DN"
          >
            <p>
              A portion&apos;s share is its percentage of the invoice value. A balance under{" "}
              {params.nearlySettledPct}% of the value is <em>Nearly settled</em>.
            </p>
            <p className="text-[var(--color-ink-3)]">
              Example: {em.collectedPct}% collected; settled {usd(em.settled)}.
            </p>
          </Formula>

          <Formula title="Payment status" formula="The first rule that applies, in this order">
            <ol className="list-decimal space-y-0.5 pl-5">
              <li>No invoice value → <em>{STATUS_LABELS.NO_VALUE}</em></li>
              <li>Received more than the value → <em>{STATUS_LABELS.OVERPAID}</em></li>
              <li>Nothing outstanding → <em>{STATUS_LABELS.PAID}</em></li>
              <li>
                No due date can be established, not even by the default ({params.defaultDueDays} day(s) after the
                invoice date) → <em>{STATUS_LABELS.REQUIRES_VERIFICATION}</em>
              </li>
              <li>Any portion past its due date → <em>{STATUS_LABELS.OVERDUE}</em></li>
              <li>Due within {params.dueSoonDays} day(s) → <em>{STATUS_LABELS.DUE_SOON}</em></li>
              <li>Under {params.nearlySettledPct}% left → <em>{STATUS_LABELS.NEARLY_SETTLED}</em></li>
              <li>Something received → <em>{STATUS_LABELS.PARTLY_PAID}</em></li>
              <li>Nothing received → <em>{STATUS_LABELS.UNPAID}</em></li>
            </ol>
            <p className="text-[var(--color-ink-3)]">
              Example: <StatusChip status={example.status} note={example.statusNote} />
            </p>
            <p className="text-[11px] text-[var(--color-ink-3)]">
              All statuses: {STATUS_ORDER.map((s) => STATUS_LABELS[s]).join(", ")}.
            </p>
          </Formula>

          <Formula title="Needs attention" formula="Owing money and: past due, no due date, unrecognised terms, or overpaid">
            <p>
              An invoice with nothing received and no due date is also flagged once it is{" "}
              {params.attentionAfterDays} day(s) old. A paid invoice is never flagged, except when
              overpaid.
            </p>
          </Formula>
        </div>
      </section>
    </>
  );
}
