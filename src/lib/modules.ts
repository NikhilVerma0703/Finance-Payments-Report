/**
 * The six sections down the left-hand side.
 *
 * Flat rather than grouped: the whole application is one job — following
 * customer payments — so every screen is one click from every other.
 */
import { ROUTES } from "./routes";

export interface NavItem {
  href: string;
  label: string;
  key: string;
  /** One line explaining the item, shown on hover. */
  hint: string;
}

export const NAV: NavItem[] = [
  {
    href: ROUTES.dashboard,
    label: "Dashboard & Master Table",
    key: "dashboard",
    hint: "KPIs, ageing, every invoice grouped by customer, and the customer-wise summary",
  },
  {
    href: ROUTES.search,
    label: "Search Invoices",
    key: "search",
    hint: "Find invoices by number, customer, status, ageing, PO, terms or date range",
  },
  {
    href: ROUTES.upload,
    label: "Upload Sheet",
    key: "upload",
    hint: "Read a customer payment sheet; edit, complete or delete what it brought in",
  },
  {
    href: ROUTES.newRecord,
    label: "New Record",
    key: "new",
    hint: "Enter an invoice with its receipts and credit/debit notes by hand",
  },
  {
    href: ROUTES.reports,
    label: "Reports & Downloads Sheets",
    key: "reports",
    hint: "Filter and download a detailed, formatted Excel report",
  },
  {
    href: ROUTES.settings,
    label: "Settings & Rules",
    key: "settings",
    hint: "Payment terms recognised, your own term rules, thresholds and every formula",
  },
];

/** Which section a path belongs to. Invoice and customer screens sit under the dashboard. */
export function activeNav(pathname: string | null | undefined): string {
  const path = (pathname ?? "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (path === "/" || path.startsWith("/invoice/") || path.startsWith("/customer/")) {
    // an invoice's edit form is reached from Upload Sheet as often as from the
    // dashboard, but it is the same record — it stays with the master table
    return "dashboard";
  }
  const hit = NAV.find((n) => n.href !== "/" && (path === n.href || path.startsWith(`${n.href}/`)));
  return hit?.key ?? "dashboard";
}
