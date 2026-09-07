"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { exportCsv, exportPdf, exportXlsx, printTable, type ExportTable } from "@/lib/export";
import { errorMessage } from "@/lib/utils";

/** One button for every table: CSV, Excel, PDF and print, using exactly the rows currently shown. */
export function ExportMenu({ table, disabled }: { table: () => ExportTable; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: (t: ExportTable) => void | Promise<void>) => { setBusy(true); try { await fn(table()); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[13px] font-medium hover:bg-muted disabled:opacity-50" />}><Download className="size-3.5" />Export<ChevronDown className="size-3 text-fg-tertiary" /></PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <Item busy={busy} icon={<FileText className="size-3.5 text-fg-tertiary" />} label="CSV" onClick={() => void run(exportCsv)} />
        <Item busy={busy} icon={<FileSpreadsheet className="size-3.5 text-fg-tertiary" />} label="Excel (.xlsx)" onClick={() => void run(exportXlsx)} />
        <Item busy={busy} icon={<FileText className="size-3.5 text-fg-tertiary" />} label="PDF" onClick={() => void run((t) => exportPdf(t))} />
        <Item busy={busy} icon={<Printer className="size-3.5 text-fg-tertiary" />} label="Print" onClick={() => void run(printTable)} />
      </PopoverContent>
    </Popover>
  );
}

function Item({ icon, label, onClick, busy }: { icon: React.ReactNode; label: string; onClick: () => void; busy: boolean }) {
  return <button type="button" onClick={onClick} disabled={busy} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50">{icon}{label}</button>;
}
