import { expect, it } from "vitest";
import {
  availableStock,
  stockPreview,
  inventoryHistoryFilter,
  inventoryActivity,
  movementLabels,
  type MovementRecord,
} from "@/domain/inventory/presentation";
const base: MovementRecord = {
  id: "input",
  product_id: "jar",
  stock_kind: "EMPTY_JAR",
  quantity: 10,
  movement_type: "REFILL_INPUT",
  created_at: "2026-10-14T01:00:00Z",
  actor_user_id: "admin",
  business_day_id: "day",
  processing_id: "batch",
  from_location_id: "main",
  to_location_id: null,
};
const output: MovementRecord = {
  ...base,
  id: "output",
  stock_kind: "FULL_JAR",
  movement_type: "REFILL_OUTPUT",
  from_location_id: null,
  to_location_id: "main",
};
it("shows a completed refill once with both original unchanged movements", () => {
  const original = JSON.stringify([base, output]);
  const activity = inventoryActivity(output, [base, output]);
  expect(activity).toMatchObject({
    grouped: true,
    label: "Completed Refill",
    movements: [base, output],
  });
  expect(JSON.stringify([base, output])).toBe(original);
});
it.each([
  "processing_id",
  "product_id",
  "actor_user_id",
  "business_day_id",
  "quantity",
  "to_location_id",
] as const)("does not group mismatched %s", (field) => {
  const changed = {
    ...output,
    [field]: field === "quantity" ? 11 : "unrelated",
  };
  expect(inventoryActivity(base, [base, changed])).toMatchObject({
    grouped: false,
    movements: [base],
  });
});
it("never labels an isolated input/output as a completed refill", () => {
  expect(inventoryActivity(base, [base]).label).toBe(
    movementLabels.REFILL_INPUT,
  );
  expect(inventoryActivity(output, [output]).label).toBe(
    movementLabels.REFILL_OUTPUT,
  );
});
it("reads only the selected product and stock state for previews", () => {
  expect(
    availableStock(
      [
        { product_id: "jar", stock_kind: "EMPTY_JAR", quantity: 50 },
        { product_id: "jar", stock_kind: "FULL_JAR", quantity: 33 },
        { product_id: "other", stock_kind: "EMPTY_JAR", quantity: 900 },
      ],
      "jar",
      "EMPTY_JAR",
    ),
  ).toBe(50);
  expect(stockPreview(50, "10", "decrease")).toEqual({
    amount: 10,
    after: 40,
    valid: true,
  });
  expect(stockPreview(33, "10", "increase")).toEqual({
    amount: 10,
    after: 43,
    valid: true,
  });
});
it.each(["0", "-1", "1.5", "1e3", "1000000001"])(
  "rejects invalid quantities %s",
  (quantity) =>
    expect(stockPreview(50, quantity, "decrease").valid).toBe(false),
);
it("prevents negative balances and integer overflow in previews", () => {
  expect(stockPreview(9, "10", "decrease").valid).toBe(false);
  expect(stockPreview(2147483647, "1", "increase").valid).toBe(false);
});
it("defaults to warehouse scope and validates filter values", () => {
  expect(inventoryHistoryFilter({}).scope).toBe("warehouse");
  expect(() => inventoryHistoryFilter({ type: "toString" })).toThrow();
  expect(() => inventoryHistoryFilter({ scope: "arbitrary" })).toThrow();
  expect(() => inventoryHistoryFilter({ product: "arbitrary" })).toThrow();
  expect(() =>
    inventoryHistoryFilter({ from: "2026-10-14", to: "2026-10-13" }),
  ).toThrow();
});
it("keeps adjustment pagination and filters independent", () => {
  expect(
    inventoryHistoryFilter(
      {
        page: "2",
        product: "00000000-0000-0000-0000-000000000011",
        adjustment_page: "4",
        adjustment_state: "EMPTY_JAR",
      },
      "adjustment_",
    ),
  ).toMatchObject({ page: 4, state: "EMPTY_JAR", product: "" });
});
