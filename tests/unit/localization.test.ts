import { describe, it, expect } from "vitest";
import {
  adToBs,
  bsToAdIso,
  daysInBsMonth,
  bsWeekday,
  currentBs,
  formatBusinessDate,
  canonicalRange,
  bsMonthRange,
  presetRange,
  shiftDate,
  canonicalDate,
  inDateRange,
  nepalMidnight,
} from "@/domain/localization/calendar";
import { digits, latinDigits, userLocale } from "@/domain/localization/locale";
import { dictionaries, message, translateMessage } from "@/lib/i18n/messages";
import { creditStatement } from "@/domain/finance/statement";
import {
  statementCsv,
  statementDocument,
} from "@/domain/finance/statement-document";
import { emptyFinance, type Ledger } from "@/domain/finance/types";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
describe("BS conversion, Nepal timezone and canonical ranges", () => {
  it("respects historical Nepal timezone boundaries as well as today's offset", () => {
    expect(nepalMidnight("1985-12-31")).toBe("1985-12-30T18:30:00.000Z");
    expect(nepalMidnight("1986-01-01")).toBe("1985-12-31T18:30:00.000Z");
    expect(nepalMidnight("1986-01-02")).toBe("1986-01-01T18:15:00.000Z");
  });
  it("matches the confirmed reference in both languages and directions", () => {
    expect(adToBs("2026-10-12")).toEqual({ year: 2083, month: 6, day: 26 });
    expect(bsToAdIso({ year: 2083, month: 6, day: 26 })).toBe("2026-10-12");
    expect(formatBusinessDate("2026-10-12", "en")).toBe("26 Ashwin 2083");
    expect(formatBusinessDate("2026-10-12", "ne")).toBe("२६ असोज २०८३");
  });
  it("uses Nepal local dates independently of browser/server timezone", () => {
    expect(currentBs(new Date("2026-10-11T18:15:00Z"))).toEqual(
      adToBs("2026-10-12"),
    );
    expect(currentBs(new Date("2026-10-11T18:14:59Z"))).toEqual(
      adToBs("2026-10-11"),
    );
    expect(formatBusinessDate("2026-10-11T18:15:00Z", "ne", true)).toContain(
      "२६ असोज २०८३",
    );
    expect(formatBusinessDate("2026-10-11T18:15:00Z", "ne", true)).not.toMatch(
      /[0-9]/,
    );
  });
  it("round-trips every supported day with continuous weekday alignment", () => {
    let day = "1918-04-13",
      count = 0;
    while (day <= "2044-04-12") {
      const bs = adToBs(day);
      expect(bsToAdIso(bs)).toBe(day);
      expect(bs.day).toBeLessThanOrEqual(daysInBsMonth(bs.year, bs.month));
      expect(bsWeekday(bs)).toBe(new Date(day + "T00:00:00Z").getUTCDay());
      day = shiftDate(day, 1);
      count++;
    }
    expect(count).toBe(46022);
  }, 15000);
  it("validates actual month lengths, leap dates, year transitions and range edges", () => {
    expect(daysInBsMonth(2083, 3)).toBe(32);
    expect(daysInBsMonth(2083, 8)).toBe(29);
    expect(adToBs("2024-04-13")).toEqual({ year: 2081, month: 1, day: 1 });
    expect(
      adToBs(shiftDate(bsToAdIso({ year: 2083, month: 12, day: 30 }), 1)),
    ).toEqual({ year: 2084, month: 1, day: 1 });
    expect(bsToAdIso(adToBs("2024-02-29"))).toBe("2024-02-29");
    expect(() => bsToAdIso({ year: 2083, month: 8, day: 30 })).toThrow();
    expect(() => adToBs("2044-04-13")).toThrow();
    expect(() => canonicalDate("2026-02-30")).toThrow();
    expect(formatBusinessDate("1800-01-01")).toContain(
      "outside supported range",
    );
  });
  it("converts BS months to exact inclusive-start/exclusive-end canonical intervals", () => {
    const r = bsMonthRange(2083, 6);
    expect(r.from).toBe(bsToAdIso({ year: 2083, month: 6, day: 1 }));
    expect(r.to).toBe(bsToAdIso({ year: 2083, month: 6, day: 31 }));
    expect(r.start).toBe("2026-09-16T18:15:00.000Z");
    expect(r.end).toBe("2026-10-17T18:15:00.000Z");
    expect(inDateRange(r.start, r.from, r.to)).toBe(true);
    expect(inDateRange(r.end, r.from, r.to)).toBe(false);
    expect(
      presetRange("previous-month", new Date("2026-04-15T00:00:00Z")),
    ).toEqual(bsMonthRange(2082, 12));
    expect(
      presetRange("yesterday", new Date("2026-10-11T18:15:00Z")).from,
    ).toBe("2026-10-11");
    expect(() => canonicalRange(r.to, r.from)).toThrow();
  });
});
describe("language, translation coverage and exact finance", () => {
  it("has independent role defaults and accepts only the two supported locales", () => {
    expect(userLocale(undefined, "DRIVER")).toBe("ne");
    expect(userLocale(undefined, "ADMIN")).toBe("en");
    expect(userLocale("en", "DRIVER")).toBe("en");
    expect(userLocale("ne", "ADMIN")).toBe("ne");
    expect(userLocale("ADMIN", "DRIVER")).toBe("ne");
    expect(latinDigits(digits("15025.50", "ne"))).toBe("15025.50");
  });
  it("covers every dictionary key and does not introduce unknown interpolation tokens", () => {
    expect(Object.keys(dictionaries.ne).sort()).toEqual(
      Object.keys(dictionaries.en).sort(),
    );
    for (const [key, value] of Object.entries(dictionaries.ne)) {
      expect(value.trim(), key).not.toBe("");
      expect(value, key).not.toMatch(/\?{2,}/);
      const tokens = key.match(/\{\d+\}/g) ?? [];
      for (const token of value.match(/\{\d+\}/g) ?? [])
        expect(tokens, key).toContain(token);
    }
  });
  it("covers static UI keys, attributes, confirmations and domain display labels", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      );
    const missing = new Set<string>();
    for (const filename of files("src").filter(
      (f) => /\.tsx?$/.test(f) && !f.includes(path.join("lib", "i18n")),
    )) {
      const source = ts.createSourceFile(
        filename,
        readFileSync(filename, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        filename.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (n: ts.Node) => {
        if (ts.isStringLiteral(n)) {
          const parent = n.parent;
          const attr =
            ts.isJsxAttribute(parent) &&
            [
              "k",
              "label",
              "title",
              "description",
              "confirm",
              "placeholder",
              "aria-label",
            ].includes(parent.name.getText(source));
          const call =
            ts.isCallExpression(parent) &&
            ["t", "tr"].includes(parent.expression.getText(source));
          if (
            (attr || call) &&
            /[A-Za-z]/.test(n.text) &&
            !dictionaries.en[n.text]
          )
            missing.add(n.text);
        }
        if (
          ts.isJsxText(n) &&
          /[A-Za-z]/.test(n.text) &&
          !n.text.includes("BS")
        )
          missing.add(n.text.trim());
        ts.forEachChild(n, visit);
      };
      visit(source);
    }
    expect([...missing]).toEqual([]);
  });
  it("translates only explicit messages and preserves customer input", () => {
    expect(message("ne", "New Delivery")).toBe("नयाँ डेलिभरी");
    expect(translateMessage("ne", "Customer: ABC Hotel 123")).toBe(
      "ग्राहक: ABC Hotel 123",
    );
    expect(translateMessage("ne", "ABC Hotel 123")).toBe("ABC Hotel 123");
  });
  it("derives monthly opening, transactions and closing from signed exact journal money", () => {
    const range = bsMonthRange(2083, 6);
    const entry = (id: string, created_at: string, amount: string): Ledger => ({
      id,
      created_at,
      amount,
      customer_id: "customer",
      invoice_id: "invoice",
      kind: "INVOICE",
      business_day_id: "day",
    });
    const finance = {
      ...emptyFinance,
      ledger: [
        entry("old", "2026-01-01T00:00:00Z", "100.25"),
        entry("sale", range.start, "300.50"),
        entry(
          "partial",
          new Date(Date.parse(range.end) - 1).toISOString(),
          "-125.75",
        ),
        entry("next", range.end, "999.99"),
      ],
    };
    const result = creditStatement(finance, "customer", range);
    expect(result).toMatchObject({
      opening: "100.25",
      change: "174.75",
      closing: "275.00",
    });
    expect(result.rows.map((r) => r.id)).toEqual(["sale", "partial"]);
    expect(creditStatement(finance, "another", range).closing).toBe("0.00");
    const printable = {
      ...finance,
      company: {
        name: "Mount Kailash",
        address: "Kathmandu",
        phone: "",
        registration: "",
        tax_mode: "UNCONFIGURED" as const,
        tax_label: "",
        tax_rate: "0.00",
        version: 1,
      },
    };
    const customer = { id: "customer", name: "=ABC Hotel 123" };
    const pdf = statementDocument(printable, customer, range, "ne");
    expect(pdf.title).toBe("असोज २०८३ को उधारो विवरण");
    expect(pdf.lines).toContain("ग्राहक: =ABC Hotel 123");
    expect(pdf.lines.join("\n")).toContain("२७५.००");
    for (const locale of ["en", "ne"] as const) {
      const csv = statementCsv(printable, customer, range, locale);
      expect(csv).toContain(",100.25,");
      expect(csv).toContain(",-125.75,");
      expect(csv).toContain(",275.00,");
      expect(csv).toContain("CanonicalTimestamp");
      expect(csv).toContain(range.start);
      expect(csv).not.toContain("999.99");
    }
  });
});
