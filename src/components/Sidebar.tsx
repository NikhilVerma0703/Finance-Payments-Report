"use client";

/**
 * The navigation, and the one piece of state it needs: where you are.
 *
 * A client component reading `usePathname()`, so the layout never reads the
 * request — it renders once and stays mounted while only the content changes.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { APP_NAME, APP_OWNER, APP_TAGLINE } from "@/lib/config";
import { activeNav, NAV } from "@/lib/modules";

export function Sidebar() {
  const active = activeNav(usePathname());

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-[var(--color-brand)] text-[#dbe6f2] lg:flex">
      <div className="px-5 pb-3 pt-5">
        <div className="text-[16px] font-semibold text-white">{APP_NAME}</div>
        <div className="text-[11px] text-[#9db6d4]">{APP_OWNER}</div>
      </div>
      <div className="border-b border-[#2c4c74] px-5 pb-3 text-[11px] text-[#9db6d4]">
        {APP_TAGLINE}
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {NAV.map((item, i) => {
          const on = active === item.key;
          return (
            <Link
              key={item.key}
              href={item.href}
              title={item.hint}
              aria-current={on ? "page" : undefined}
              className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] ${
                on
                  ? "bg-white font-semibold text-[var(--color-brand)]"
                  : "text-[#cfdcec] hover:bg-[#28496f] hover:text-white"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                  on ? "bg-[var(--color-brand)] text-white" : "bg-[#2c4c74] text-[#cfdcec]"
                }`}
              >
                {i + 1}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[#2c4c74] p-4 text-[11px] text-[#8fa9c8]">
        Enter once, reuse everywhere.
      </div>
    </aside>
  );
}

/** The same six sections on a narrow screen. */
export function MobileNav() {
  const active = activeNav(usePathname());
  return (
    <div className="mb-4 flex flex-wrap gap-1.5 lg:hidden">
      {NAV.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
            active === item.key
              ? "bg-[var(--color-brand)] text-white"
              : "border border-[var(--color-line)] bg-white text-[var(--color-brand)]"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
