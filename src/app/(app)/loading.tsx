import { Loading as Rows } from "@/components/primitives";

/** Shown inside the shell while a page that wasn't prefetched arrives, so a click never looks ignored. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-muted" />)}</div>
      <Rows rows={5} />
    </div>
  );
}
