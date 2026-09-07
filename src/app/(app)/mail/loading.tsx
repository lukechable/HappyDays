/** Three-pane placeholder so a cold click on Inbox responds at once; the real page replaces it as soon as its code and payload land. */
export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh_-_48px)]" aria-busy>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
        <div className="h-8 max-w-xl flex-1 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[200px_minmax(320px,400px)_minmax(0,1fr)]">
        <aside className="hidden border-r border-border bg-surface-2/60 px-2 py-3 lg:block">
          {Array.from({ length: 11 }, (_, i) => <div key={i} className="mb-px h-[26px] animate-pulse rounded-lg bg-muted/70" style={{ width: `${70 + (i % 4) * 8}%` }} />)}
        </aside>
        <section className="border-r border-border">
          <div className="border-b border-border px-3 py-1.5"><div className="h-4 w-16 animate-pulse rounded bg-muted" /></div>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="space-y-1.5 border-b border-border/70 px-3 py-2.5">
              <div className="flex justify-between"><div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" /><div className="h-3 w-10 animate-pulse rounded bg-muted" /></div>
              <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted/70" />
            </div>
          ))}
        </section>
        <section className="hidden bg-surface/60 lg:block" />
      </div>
    </div>
  );
}
