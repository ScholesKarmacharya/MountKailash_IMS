"use client";
import { useState } from "react";
import type { LocalState, CollectionDraft } from "@/domain/offline/types";
import {
  cachedCredit,
  localCustomers,
  resolvedCustomer,
} from "@/domain/offline/operations";
import { allocations, cents, decimal } from "@/domain/finance/money";
import { AmountInput } from "../finance-payment";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { T, Message, useLocale } from "../localization";
export function OfflineCollection({
  state,
  busy,
  save,
}: {
  state: LocalState;
  busy: boolean;
  save: (d: CollectionDraft) => Promise<boolean>;
}) {
  const { t } = useLocale();
  const [customer, setCustomer] = useState(""),
    [amount, setAmount] = useState(""),
    [deposit, setDeposit] = useState(""),
    [method, setMethod] = useState<"CASH" | "FONEPAY">("CASH"),
    [reference, setReference] = useState("");
  const manual =
    state.snapshot.contexts.find(
      (c) => c.customer.id === resolvedCustomer(state, customer),
    )?.billing?.deposit_mode === "MANUAL";
  let error = "",
    draft: CollectionDraft | undefined;
  try {
    draft = {
      customer,
      method,
      amount: decimal(
        cents(amount || "0") + cents(manual ? deposit || "0" : "0"),
      ),
      current_amount: "0.00",
      deposit_amount: manual ? deposit || "0" : "0",
      reference,
      allocations: allocations(amount || "0", cachedCredit(state, customer)),
    };
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <Card className="space-y-4">
      <h2 className="text-xl font-bold">
        <T k="Collect outstanding credit" />
      </h2>
      <p className="text-sm">
        <T k="Collections do not create a sale. Fonepay remains pending until admin reconciliation." />
      </p>
      <label className="grid gap-2">
        <T k="Collection customer" />
        <select
          aria-label={t("Collection customer")}
          value={customer}
          onChange={(e) => {
            setCustomer(e.target.value);
            setAmount("");
            setDeposit("");
          }}
          className="min-h-12 rounded-lg border bg-card px-3"
        >
          <option value="">
            <T k="Choose customer" />
          </option>
          {localCustomers(state).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <AmountInput
        label="Credit amount received (NPR)"
        value={amount}
        onChange={setAmount}
      />
      {manual && (
        <AmountInput
          label="Jar deposit received (NPR)"
          value={deposit}
          onChange={setDeposit}
        />
      )}
      <label className="grid gap-2">
        <T k="Receipt method" />
        <select
          aria-label={t("Receipt method")}
          value={method}
          onChange={(e) => setMethod(e.target.value as "CASH" | "FONEPAY")}
          className="min-h-12 rounded-lg border bg-card px-3"
        >
          <option value="CASH">
            <T k="Cash" />
          </option>
          <option value="FONEPAY">
            <T k="Fonepay pending" />
          </option>
        </select>
      </label>
      {method === "FONEPAY" && (
        <label className="grid gap-2">
          <T k="Transaction reference" />
          <Input
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert">
          <Message value={error} />
        </p>
      )}
      <Button
        disabled={
          busy ||
          state.sealed ||
          !customer ||
          !draft ||
          !!error ||
          cents(draft.amount) <= 0n
        }
        onClick={() => {
          if (draft)
            void save(draft).then((ok) => {
              if (ok) {
                setAmount("");
                setDeposit("");
                setReference("");
              }
            });
        }}
      >
        <T k="Save collection" />
      </Button>
    </Card>
  );
}
