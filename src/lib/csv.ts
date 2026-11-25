import { isNativeApp } from "./native";

/**
 * A CSV file as spreadsheets in French read it: fields split by ";" and a byte order mark
 * so accents show. Fields with ";", quotes or line breaks are quoted; a field that starts
 * with = + - or @ gets a leading ' so a spreadsheet does not run it as a formula.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const field = (value: string | number | null | undefined) => {
    let s = value == null ? "" : String(value);
    if (typeof value === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((row) => row.map(field).join(";")).join("\r\n")}\r\n`;
}

/**
 * Saves `text` as a file: a download in the browser; in the app, where a download link does
 * nothing, the phone's share sheet (save to files, send by e-mail or WhatsApp).
 */
export async function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const file = typeof File === "function" ? new File([blob], name, { type }) : null;
  if (isNativeApp() && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
