/**
 * The shape of a page, drawn before the page has any content to put in it.
 *
 * These exist for `loading.tsx`, which Next.js shows the moment a navigation
 * starts rather than when it finishes. Without one, a server page that queries
 * the database holds the whole navigation: the old screen stays put, nothing
 * acknowledges the tap, and on a slow connection people press the link again.
 * A skeleton turns that dead time into a screen that is visibly the right page,
 * already laid out, waiting on its numbers.
 *
 * Deliberately not a spinner. A spinner says "something is happening"; an
 * outline of the page says "this is the page you asked for, and here is where
 * everything will be", which is what stops the second tap. They are also
 * plain markup with no `"use client"`, so they cost nothing to render and add
 * nothing to the bundle.
 */

/** One grey bar. `w` and `h` are Tailwind classes so callers can size it inline. */
export function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[var(--line)] ${className}`} aria-hidden />;
}

/**
 * Title, subtitle and an action button — the header every screen opens with,
 * so the skeleton lines up with what replaces it instead of jumping.
 */
export function TitleSkeleton() {
  return <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0 space-y-2">
      <Bar className="h-7 w-52" />
      <Bar className="h-4 w-32" />
    </div>
    <Bar className="h-10 w-36 rounded-full" />
  </header>;
}

/** A card holding `rows` list entries, which is what most screens here are. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="card divide-y divide-[var(--line)]">
    {Array.from({ length: rows }, (_, row) => (
      <div key={row} className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Bar className="h-4 w-1/3" />
          <Bar className="h-3 w-2/3" />
        </div>
        <Bar className="h-6 w-16 rounded-full" />
      </div>
    ))}
  </div>;
}

/** The four-figure summary strip several screens lead with. */
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return <div className="card grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
    {Array.from({ length: count }, (_, stat) => (
      <div key={stat} className="space-y-2">
        <Bar className="h-3 w-20" />
        <Bar className="h-7 w-14" />
      </div>
    ))}
  </div>;
}

/**
 * The default whole-page skeleton: header, figures, list.
 *
 * `role="status"` with a label rather than silence, so a screen reader is told
 * the page is loading — the visual cue is an animation it cannot see.
 */
export function PageSkeleton({ stats = true, rows = 6 }: { stats?: boolean; rows?: number }) {
  return <div className="space-y-5" role="status" aria-label="Loading">
    <TitleSkeleton />
    {stats && <StatsSkeleton />}
    <ListSkeleton rows={rows} />
  </div>;
}
