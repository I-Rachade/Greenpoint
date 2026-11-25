"use client";

import { useState } from "react";
import { downloadText, toCsv } from "@/lib/csv";
import { useErrorMessage } from "@/lib/hooks";
import { formatXof } from "@/lib/i18n/format";
import { swapDayRange } from "@shared/station-work";
import { swapSheet, swapSheetRows, type SwapSheet, type SwapSheetLabels } from "@shared/swap-sheet";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { Button, Input } from "../ui";

const today = () => new Date().toISOString().slice(0, 10);

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The annex as a page to print or save as PDF (landscape A4, the training sheet's layout). */
export function swapSheetHtml(sheet: SwapSheet, labels: SwapSheetLabels, total: string): string {
  const head = labels.columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = sheet.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(labels.title)} - ${esc(sheet.station)} - ${esc(sheet.date)}</title>
<style>
@page { size: A4 landscape; margin: 10mm; }
body { font: 11px/1.3 Arial, Helvetica, sans-serif; color: #0b2545; margin: 0; }
h1 { text-align: center; font-size: 18px; margin: 4px 0 10px; letter-spacing: .02em; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #9fb3c8; padding: 5px 4px; vertical-align: middle; }
.meta td { background: #f1f4f8; font-weight: 700; }
.meta td.v { background: #fff; font-weight: 400; }
thead th { background: #0b2545; color: #fff; font-size: 10px; text-align: center; }
td.n { text-align: center; color: #555; width: 24px; }
tr.total td { background: #f1f4f8; font-weight: 700; text-align: right; }
tr.total td.sum { background: #fff4cc; }
p { margin: 6px 0 0; font-size: 10px; }
</style></head><body>
<h1>${esc(labels.title)}</h1>
<table class="meta"><tr><td>${esc(labels.station)}</td><td class="v">${esc(sheet.station)}</td><td>${esc(labels.date)}</td><td class="v">${esc(sheet.date)}</td><td>${esc(labels.agent)}</td><td class="v">${esc(sheet.agents)}</td></tr></table>
<table><thead><tr>${head}</tr></thead><tbody>${body}
<tr class="total"><td colspan="9">${esc(labels.total)}</td><td class="sum">${esc(total)}</td><td colspan="2"></td></tr></tbody></table>
<p><b>${esc(labels.calc)}</b> ${esc(labels.signature)} ______________________________</p>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
}

/**
 * Exports a station's swaps as the swap sheet: pick the days (owners and admins; staff get
 * today's own swaps), then a CSV for a spreadsheet or the printable sheet (print or PDF).
 */
export function SwapSheetExport({ stationId, stationName, pickDates }: { stationId: string; stationName: string; pickDates: boolean }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const x = t.work.swapSheet;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<"csv" | "print" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const labels: SwapSheetLabels = { ...x.sheet, networks: { tmoney: "T-Money", flooz: "Flooz" } };

  async function run(kind: "csv" | "print") {
    setMessage(null);
    const day = today();
    const [a, b] = pickDates ? [from, to] : [day, day];
    if (!swapDayRange(a, b)) return setMessage(t.errors.invalid_date_range);
    // The printable page opens now, while the tap still counts as one (pop-up blockers).
    const win = kind === "print" ? window.open("", "_blank") : null;
    setBusy(kind);
    try {
      const swaps = await backend.stationSwaps(stationId, pickDates ? { from: a, to: b } : {});
      if (swaps.length === 0) {
        win?.close();
        return setMessage(x.none);
      }
      const name = `${x.fileName}-${stationName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase()}-${a}${a === b ? "" : `_${b}`}`;
      if (kind === "csv") {
        // Plain numbers in the spreadsheet, so its sums work.
        const sheet = swapSheet(swaps, { station: stationName, from: a, to: b, labels, amount: String });
        await downloadText(`${name}.csv`, toCsv(swapSheetRows(sheet, labels, String)));
      } else {
        const xof = (n: number) => formatXof(n, locale);
        const sheet = swapSheet(swaps, { station: stationName, from: a, to: b, labels, amount: xof });
        const html = swapSheetHtml(sheet, labels, xof(sheet.totalXof));
        if (win) {
          win.document.open();
          win.document.write(html);
          win.document.close();
        } else {
          // The app or a blocked pop-up: the page as a file, to open and print.
          await downloadText(`${name}.html`, html, "text/html;charset=utf-8");
        }
      }
    } catch (err) {
      win?.close();
      setMessage(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-gp-border bg-gp-surface p-4">
      <p className="font-semibold">{x.title}</p>
      {pickDates ? (
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-sm">
            <span className="block font-medium">{x.from}</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium">{x.to}</span>
            <Input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      ) : (
        <p className="text-sm text-gp-muted">{x.todayOnly}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy !== null} onClick={() => void run("csv")}>
          {x.csv}
        </Button>
        <Button variant="secondary" disabled={busy !== null} onClick={() => void run("print")}>
          {x.print}
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm text-gp-muted">
          {message}
        </p>
      )}
    </div>
  );
}
