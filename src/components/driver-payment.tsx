"use client";
import { T } from "./localization";
import { Button } from "./ui/button";
import { AmountInput } from "./finance-payment";
export function DriverPayment({
  credit,
  amount,
  onCreditChange,
  onAmountChange,
}: {
  credit: boolean;
  amount: string;
  onCreditChange: (credit: boolean) => void;
  onAmountChange: (amount: string) => void;
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-base font-semibold">
        <T k="Payment Status" />
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          aria-pressed={!credit}
          variant={!credit ? "default" : "outline"}
          className="min-h-16 whitespace-normal text-lg"
          onClick={() => onCreditChange(false)}
        >
          <T k="Paid" />
        </Button>
        <Button
          type="button"
          aria-pressed={credit}
          variant={credit ? "default" : "outline"}
          className="min-h-16 whitespace-normal text-lg"
          onClick={() => onCreditChange(true)}
        >
          <T k="Credit" />
        </Button>
      </div>
      {credit ? (
        <p role="status" className="rounded-lg bg-muted p-3 font-semibold">
          <T k="Credit" />
        </p>
      ) : (
        <AmountInput
          label="Total Amount Received (NPR)"
          value={amount}
          onChange={onAmountChange}
          required
        />
      )}
    </fieldset>
  );
}
