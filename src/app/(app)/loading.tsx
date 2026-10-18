/**
 * The skeleton a section shows while its data is being fetched.
 *
 * This is not decoration. Without a Suspense boundary, Next holds the *previous*
 * page on screen until the next page's server render has completely finished —
 * so a click appeared to do nothing for as long as the query took. With this
 * file, the shell and the sidebar stay put, the content area swaps immediately,
 * and the router can prefetch this shell for every section.
 *
 * The work behind it was made small separately; this makes the small amount of
 * remaining work invisible rather than hiding a large amount.
 */
export default function SectionLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-56 rounded bg-[var(--color-mute-bg)]" />
          <div className="h-3 w-[46ch] rounded bg-[var(--color-mute-bg)]" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded-lg bg-[var(--color-mute-bg)]" />
          <div className="h-8 w-28 rounded-lg bg-[var(--color-mute-bg)]" />
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kpi">
            <div className="h-7 w-20 rounded bg-[var(--color-mute-bg)]" />
            <div className="mt-2 h-3 w-24 rounded bg-[var(--color-mute-bg)]" />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="mb-3 h-4 w-40 rounded bg-[var(--color-mute-bg)]" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-[var(--color-mute-bg)]" style={{ opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
