import type { Metadata } from "next";

import { APP_NAME, APP_OWNER } from "@/lib/config";

import "./globals.css";

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_OWNER}`,
  description: "Customer payment tracking, receipts, ageing and downloadable reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
