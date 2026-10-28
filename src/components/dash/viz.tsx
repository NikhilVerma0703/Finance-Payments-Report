// The deck's drawing primitives, ported from the Pacific ERP's Production
// overview (app/_dashboard/viz.tsx) so this dashboard reads as that one does:
// server components, plain props in, HTML out. Colour is never the only cue,
// and a figure that cannot be computed prints "—". Every figure carries its
// words for the hover bubble (tip.tsx, client/TipLayer.tsx).
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Num, TipText } from "./tip";

export { Num, TipText };

/** Where a figure leads: a path, or nowhere. */
export type Href = string | null;

type Vars = CSSProperties & Record<`--${string}`, string | number>;
export const iv = (i: number, extra?: Vars): Vars => ({ "--i": i, ...extra });
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export const TEAL = {
  50: "#eef5f7", 100: "#d7e8ec", 200: "#b0d1d9", 300: "#7fb3bf", 400: "#4b8fa0",
  500: "#1f6d80", 600: "#0f4c5c", 700: "#0d4150", 800: "#0a3540", 900: "#07262e",
} as const;
export const ACCENT = TEAL[500]; // brand teal: the deck's accent (5.9:1 on white)
export const GOOD = "#059669";   // emerald-600: a met standard (3.8:1 on white, fills only)

/* ------------------------------------------------------------ links ---- */
/** A link only where the viewer may open it; otherwise the same box as text.
 *  `tip`: the whole link IS the figure (a chip, a heat cell, a small tile) —
 *  it replaces `title`, which is then not rendered; with `ariaLabel` the tip
 *  is folded into the label, since an aria-labelled link's content is not read. */
export function LinkOr({ href, className = "", children, title, ariaLabel, inline = false, tip }: {
  href: Href; className?: string; children: ReactNode; title?: string; ariaLabel?: string; inline?: boolean; tip?: string;
}) {
  const t = tip ? { "data-tip": "" } : { title };
  // Only a link is named by its aria-label; the plain box reads its content.
  const label = href && ariaLabel ? (tip ? `${ariaLabel}, ${tip}` : ariaLabel) : undefined;
  const body = <>{children}{tip && <TipText tip={tip} spoken={!label} />}</>;
  if (!href) return inline ? <span className={className} {...t}>{body}</span> : <div className={className} {...t}>{body}</div>;
  return <Link href={href} className={className} {...t} aria-label={label} prefetch={false}>{body}</Link>;
}

/* ------------------------------------------------------------- Meter --- */
/** A bar against a whole. It always stands beside a printed figure that
 *  carries its own tip; give `tip` only where the bar itself is the figure
 *  (then it is folded into the aria-label, as a meter's children are not read). */
export function Meter({ value, max, color = TEAL[500], track = TEAL[100], h = 8, i = 0, label, className = "", tip }: {
  value: number | null; max: number; color?: string; track?: string; h?: number; i?: number; label: string; className?: string; tip?: string;
}) {
  const p = value == null ? 0 : clamp01(value / (max || 1));
  return (
    <div className={`w-full overflow-hidden rounded-full ${className}`} style={{ background: track, height: h }} role="meter" data-tip={tip ? "" : undefined}
         aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? undefined} aria-label={tip ? `${label}, ${tip}` : label}>
      <div className="dash-grow-x h-full rounded-full" style={iv(i, { width: `${(p * 100).toFixed(2)}%`, background: color })} />
      {tip && <TipText tip={tip} spoken={false} />}
    </div>
  );
}

/* ------------------------------------------------------- WorkingFold --- */
/** The (i) "How this is worked out" fold — a <details>, so no JS. min-h-0
 *  py-0 escape the coarse-pointer 44px summary rule (see ui.tsx Kpi). */
export function WorkingFold({ label, children, align = "right", wide = false }: { label: string; children: ReactNode; align?: "right" | "left";
  /** A longer explanation (several definitions set side by side): a wider panel, so it is not a tall column. */
  wide?: boolean }) {
  return (
    <details className="group relative shrink-0 print:hidden">
      <summary
        className="flex h-5 w-5 min-h-0 cursor-pointer list-none items-center justify-center rounded-full border border-gray-300 py-0 text-[10px] font-semibold text-gray-500 transition hover:border-brand hover:text-brand [&::-webkit-details-marker]:hidden"
        aria-label={`How ${label} is worked out`} title={`How ${label} is worked out`}
      >i</summary>
      <div className={`absolute ${align === "right" ? "right-0" : "left-0"} top-6 z-30 ${wide ? "w-[30rem]" : "w-72"} max-w-[80vw] rounded-xl border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-600 shadow-xl`}>
        {children}
      </div>
    </details>
  );
}

/* ----------------------------------------------------- TableFold ------ */
/** "View as table" — the server-rendered twin of a chart. */
export function TableFold({ children, label = "View as table" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group mt-3 print:hidden">
      <summary className="inline-flex min-h-0 cursor-pointer list-none items-center gap-1 py-0 text-xs font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
        <span className="transition group-open:rotate-90" aria-hidden>▸</span> {label}
      </summary>
      <div className="relative mt-2 max-h-72 overflow-auto rounded-lg border border-gray-100">{children}</div>
    </details>
  );
}


/* -------------------------------------------------------------- Chip --- */
export type Tone = "ok" | "warn" | "bad" | "info" | "mute";
const CHIP: Record<Tone, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warn: "bg-amber-50 text-amber-800 ring-amber-600/25",
  bad: "bg-red-50 text-red-700 ring-red-600/20",
  info: "bg-sky-50 text-sky-800 ring-sky-600/20",
  mute: "bg-gray-50 text-gray-600 ring-gray-500/20",
};
/** A status pill, in the deck's tones. */
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CHIP[tone]}`}>{children}</span>;
}
