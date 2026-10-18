/** The few layout pieces every screen shares. */

const TONE_CLASS: Record<string, string> = {
  ok: "bg-[var(--color-ok-bg)] text-[var(--color-ok-fg)]",
  warn: "bg-[var(--color-warn-bg)] text-[var(--color-warn-fg)]",
  bad: "bg-[var(--color-bad-bg)] text-[var(--color-bad-fg)]",
  info: "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]",
};

export function Banner({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "info";
  children: React.ReactNode;
}) {
  const border: Record<string, string> = {
    ok: "border-[#bfe3cc]",
    warn: "border-[#efd9a1]",
    bad: "border-[#f0c9c9]",
    info: "border-[#c6dcf3]",
  };
  return <div className={`banner mb-4 ${TONE_CLASS[tone]} ${border[tone]}`}>{children}</div>;
}

export function PageHead({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {lead && <p className="mt-1 max-w-[72ch] text-[13px] text-[var(--color-ink-3)]">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-10 text-center text-[var(--color-ink-3)]">{children}</div>;
}
