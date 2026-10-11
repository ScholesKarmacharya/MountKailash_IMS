import { describe, it, expect } from "vitest";
import {
  parseAdjustment,
  parseProduct,
  stockTotals,
} from "@/domain/inventory/validation";
const id = "00000000-0000-0000-0000-000000000001";
function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
const adjustment = {
  product: id,
  kind: "FULL_JAR",
  quantity: "20",
  direction: "increase",
  reason: "Opening counts",
  notes: "",
  day: id,
  key: id,
};
const product = {
  id,
  key: id,
  sku: "jar20",
  name: "20L water",
  kind: "FULL_JAR",
  unit: "jar",
  price: "150.25",
  active: "true",
  version: "0",
  reason: "Initial catalog",
};
describe("inventory domain validation", () => {
  it("preserves exact decimal price text and normalizes SKU", () => {
    expect(parseProduct(form(product))).toMatchObject({
      p_price: "150.25",
      p_sku: "JAR20",
      p_version: 0,
    });
  });
  it.each(["-1", "1.5", "0", "1e2", "1000000001", "NaN"])(
    "rejects unsafe quantity %s",
    (quantity) => {
      expect(() =>
        parseAdjustment(form({ ...adjustment, quantity })),
      ).toThrow();
    },
  );
  it.each(["-1", "1.001", "1e2", "1000000000000", "NaN"])(
    "rejects unsafe price %s",
    (price) => {
      expect(() => parseProduct(form({ ...product, price }))).toThrow();
    },
  );
  it("requires reason and valid UUID/state/direction", () => {
    for (const patch of [
      { reason: " " },
      { key: "bad" },
      { kind: "DAMAGED" },
      { direction: "other" },
    ])
      expect(() =>
        parseAdjustment(form({ ...adjustment, ...patch })),
      ).toThrow();
  });
  it("represents decrease as signed whole delta", () => {
    expect(
      parseAdjustment(form({ ...adjustment, direction: "decrease" })).p_delta,
    ).toBe(-20);
  });
  it("keeps full, empty and carton totals separate", () => {
    expect(
      stockTotals([
        { stock_kind: "FULL_JAR", quantity: 5 },
        { stock_kind: "EMPTY_JAR", quantity: 3 },
        { stock_kind: "FULL_JAR", quantity: 7 },
      ]),
    ).toEqual({ FULL_JAR: 12, EMPTY_JAR: 3, BOTTLE_CARTON: 0 });
  });
});
