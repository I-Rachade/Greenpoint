import { describe, expect, it } from "vitest";
import { LEGAL_DOCS, LEGAL_PLACEHOLDER, type LegalDocId } from "../legal/content";

const ids: LegalDocId[] = ["notice", "terms", "privacy"];
const texts = (doc: (typeof LEGAL_DOCS)["fr"][LegalDocId]) =>
  doc.sections.flatMap((s) => s.body.flatMap((b) => (typeof b === "string" ? [b] : b)));
const placeholders = (doc: (typeof LEGAL_DOCS)["fr"][LegalDocId]) =>
  texts(doc).filter((t) => LEGAL_PLACEHOLDER.test(t)).length;

describe("legal pages", () => {
  it.each(ids)("%s has the same structure in French and English", (id) => {
    const fr = LEGAL_DOCS.fr[id];
    const en = LEGAL_DOCS.en[id];
    expect(en.sections.map((s) => s.body.map((b) => (typeof b === "string" ? 1 : b.length)))).toEqual(
      fr.sections.map((s) => s.body.map((b) => (typeof b === "string" ? 1 : b.length))),
    );
    expect(placeholders(en)).toBe(placeholders(fr));
  });

  it("finds open placeholders in both languages", () => {
    expect(LEGAL_PLACEHOLDER.test("RCCM : [À COMPLÉTER : numéro]")).toBe(true);
    expect(LEGAL_PLACEHOLDER.test("RCCM: [TO BE COMPLETED: number]")).toBe(true);
    expect(LEGAL_PLACEHOLDER.test("Lomé, Togo")).toBe(false);
  });
});
