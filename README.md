# Finance Reports — Pacific Surfaces

Customer payment tracking as a standalone application: every invoice, every
receipt, credit and debit notes, ageing, customer-wise summaries and
downloadable Excel reports.

It was split out of `pacific-accounts-erp`, where it was the **Payment
Tracking** section. It keeps the same technology and versions (Next.js 15.5,
React 19, Prisma 6 with SQLite, ExcelJS, Tailwind 4, Vitest) and the same
`pt_*` database tables, so the data carried over is read as it is. The original
project is not changed by this one and does not depend on it.

## Running it

```powershell
npm install
npm run db:push
npm run dev
```

Then open <http://localhost:3000>.

- `npm install` installs the packages (once, and after any update).
- `npm run db:push` brings the database up to date with the schema. The
  database delivered with the project already is, so it reports *in sync*.
- `npm test` runs the test suite; `npm run typecheck` and `npm run lint` check
  the code.

The database is the file `prisma/dev.db`. Copy it to back up your data. The
`.env` file holds `DATABASE_URL="file:./dev.db"` and `HOME_CURRENCY="INR"`.

## The six sections

| # | Section | What it is for |
|---|---------|----------------|
| 1 | **Dashboard & Master Table** | KPI cards per currency (total invoice value, received, outstanding, overdue outstanding, needs attention), the ageing summary as cards, every invoice in the full table grouped by customer, and the customer-wise summary at the bottom. Click an ageing card or a status to see those invoices. |
| 2 | **Search Invoices** | Every filter: search by invoice number or customer, customer, currency, status, ageing, PO number, payment terms, *Date Range On* (Invoice Date, Due Date, Overdue Date) with From/To, group by, outstanding only, needs attention, nothing received, requires verification. Apply and Reset. With no filter, every record is shown. |
| 3 | **Upload Sheet** | Upload a customer payment sheet. Each upload lists its invoices with **EDIT OR ADD EXTRA INFORMATIONS** and **Delete**; a whole upload can be deleted together with the invoices that belong to it alone. |
| 4 | **New Record** | The full entry form in ten sections — customer, invoice, parties, terms and dates, shipping, currency, receipts (as many as needed), credit/debit notes, books balances, remarks. No field is required. |
| 5 | **Reports & Downloads Sheets** | Choose records by customer, invoice number, ageing, PO number and a date range, check them, then **Export Sheet** to a formatted Excel report. |
| 6 | **Settings & Rules** | Payment terms recognised, your own payment-term rules, the status thresholds, and every formula with a live worked example. |

Each invoice also has its own screen (from any invoice number) and each
customer has a screen with an editable payment register.

## How the parts fit

- **One set of records, one set of calculations.** Every figure — balance,
  due date, overdue days, ageing, forex, status — is worked out from the stored
  fields each time it is shown, by `src/lib/payments/record.ts`. The dashboard,
  search, reports, invoice and customer screens and every export call it, so
  none of them can disagree, and a change shows everywhere at once.
- **New Record and EDIT OR ADD EXTRA INFORMATIONS are one form**
  (`src/components/tracking/RecordForm.tsx`) with one parser
  (`src/lib/payments/recordForm.ts`) and one save action
  (`src/server/payments/recordActions.ts`). The figures beside the boxes are
  calculated as you type by the same functions. Every change is recorded in the
  invoice's correction history.
- **Nothing missing is invented.** Without the date a payment term counts from,
  there is no due date and the invoice is marked *Requires verification* — never
  reported as late.
- **Payment-term rules** (`pt_term_rules`) are checked before the built-in
  readings, so a wording can be given its exact meaning once and every invoice,
  summary and export follows.
- **Deleting an upload** removes only the invoices it created that no other
  upload also carries (`src/lib/payments/uploads.ts`); everything else is kept.

## Formulas in brief

Full reference with live examples: **Settings & Rules → Formulas and
calculation rules**.

- Outstanding = invoice value − total received − credit notes + debit notes
- Total received = Σ receipt amounts (invoice currency)
- Rate difference = receipt rate − invoice rate (INR per unit of the currency)
- Forex gain/loss (INR) = rate difference × receipt amount
- Value in INR = amount × that invoice's own exchange rate
- Due date = basis date + days, per portion of the terms; the invoice's due
  date is the next portion still owing; an entered due date is used as entered
- Overdue days = today − due date; Overdue date = due date + 1 day
- Ageing (open invoices, each in one category): No due date, Not yet due,
  1–30, 31–60, 61–90, Over 90 days

## Project layout

```
prisma/schema.prisma           the pt_* tables, term rules and settings
src/app/(app)/                 the six sections, invoice and customer screens
src/app/api/                   the Excel/CSV downloads
src/components/tracking/       the screens' building blocks
src/lib/payments/              pure calculation and parsing — no database
src/server/payments/           reading, saving, importing and exporting
tests/                         Vitest suites and the four reference sheets
```

## Moving to PostgreSQL later

Change `provider = "sqlite"` to `"postgresql"` in `prisma/schema.prisma`, set
`DATABASE_URL` to the server, and run `npm run db:push`. Nothing in the code
depends on SQLite.
