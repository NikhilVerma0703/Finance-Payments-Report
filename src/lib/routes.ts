/** Every address in the application, in one place. */
export const ROUTES = {
  dashboard: "/",
  /** Every invoice, grouped by customer — a section of its own after the dashboard. */
  masterTable: "/master",
  search: "/search",
  upload: "/upload",
  newRecord: "/new",
  reports: "/reports",
  settings: "/settings",
  invoice: (id: string) => `/invoice/${id}`,
  editInvoice: (id: string) => `/invoice/${id}/edit`,
  customer: (id: string) => `/customer/${id}`,
  /** The current view as a workbook (or CSV with `format=csv`). */
  exportView: "/api/export",
  /** The detailed report workbook from Reports & Downloads Sheets. */
  exportReport: "/api/reports/export",
  /** One customer's outstanding sheet as a PDF (?customer=&currency=). */
  customerSheet: "/api/customer-sheet",
} as const;
