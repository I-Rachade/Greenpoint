/** Replaces `{name}` placeholders: format("il y a {n} min", { n: 5 }). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Whole francs with a thousands separator: 25000 -> "25 000 FCFA". */
export function formatXof(amount: number, locale: "fr" | "en"): string {
  return `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 0 }).format(amount)} FCFA`;
}
