"use client";
import { useState } from "react";
import { localCustomers, localStock } from "@/domain/offline/operations";
import type { LocalState, ContactDraft } from "@/domain/offline/types";
import { T, Message, useLocale } from "../localization";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card } from "../ui/card";
import { Counter } from "../operation-form";
export function OfflineCustomers({
  state,
  busy,
  save,
}: {
  state: LocalState;
  busy: boolean;
  save: (d: ContactDraft, edit: boolean) => Promise<boolean>;
}) {
  const [search, setSearch] = useState(""),
    [draft, setDraft] = useState<ContactDraft>({
      id: crypto.randomUUID(),
      name: "",
      shop_name: "",
      phone: "",
      address: "",
      version: 0,
    });
  const { t } = useLocale();
  return (
    <>
      <Card className="space-y-4">
        <h1 className="text-xl font-bold">
          <T k="Customers" />
        </h1>
        <Input
          aria-label={t("Search customers")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {localCustomers(state)
          .filter(
            (c) =>
              !c.is_one_time &&
              `${c.name} ${c.phone} ${c.shop_name}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .map((c) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-b py-3"
              key={c.id}
            >
              <span>
                {c.name} · {c.phone}
              </span>
              <Button
                variant="outline"
                disabled={state.sealed}
                onClick={() => setDraft(c)}
              >
                <T k="Edit contact" />
              </Button>
            </div>
          ))}
      </Card>
      <Card className="space-y-4">
        <h2 className="font-bold">
          <T k={draft.version ? "Edit contact" : "Add customer"} />
        </h2>
        <label className="block">
          <T k="Customer Type" />
          <select
            aria-label={t("Customer Type")}
            className="mt-2 min-h-12 w-full rounded-lg border bg-card p-2"
            value={draft.supply_type ?? "REGULAR"}
            onChange={(e) =>
              setDraft({
                ...draft,
                supply_type: e.target.value as "REGULAR" | "HOUSE",
              })
            }
          >
            <option
              value="REGULAR"
              disabled={
                localCustomers(state).find((c) => c.id === draft.id)
                  ?.supply_type === "HOUSE"
              }
            >
              {t("Regular Customer")}
            </option>
            <option value="HOUSE">{t("HOUSE")}</option>
          </select>
        </label>
        {draft.supply_type === "HOUSE" && (
          <p>
            <T k="Admin approval is required before free delivery." />
          </p>
        )}
        {(["contact_person", "delivery_notes"] as const).map((k) => (
          <label className="block" key={k}>
            <T
              k={
                k === "contact_person"
                  ? "Contact person (optional)"
                  : "Delivery notes (optional)"
              }
            />
            <Input
              value={draft[k] ?? ""}
              maxLength={k === "contact_person" ? 120 : 2000}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            />
          </label>
        ))}
        {(["name", "shop_name", "phone", "address"] as const).map((k) => (
          <label key={k} className="block">
            <Message
              value={
                {
                  name: "Customer name",
                  shop_name: "Shop name",
                  phone: "Phone",
                  address: "Address",
                }[k]
              }
            />
            <Input
              value={draft[k]}
              maxLength={
                k === "address"
                  ? 500
                  : k === "name"
                    ? 120
                    : k === "shop_name"
                      ? 160
                      : 40
              }
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            />
          </label>
        ))}
        <Button
          disabled={busy || state.sealed}
          onClick={() => {
            void save(draft, draft.version > 0).then((ok) => {
              if (ok)
                setDraft({
                  id: crypto.randomUUID(),
                  name: "",
                  shop_name: "",
                  phone: "",
                  address: "",
                  version: 0,
                });
            });
          }}
        >
          <T k="Save customer" />
        </Button>
      </Card>
    </>
  );
}
export function OfflineReturnForm({
  state,
  busy,
  save,
}: {
  state: LocalState;
  busy: boolean;
  save: (counts: ReturnType<typeof localStock>) => Promise<boolean>;
}) {
  const { t } = useLocale();
  const expected = localStock(state);
  const [values, setValues] = useState<Record<string, number>>({});
  const [reviewed, setReviewed] = useState("");
  const actual = expected.map((c) => ({
    ...c,
    quantity: values[c.product_id + c.stock_kind] ?? c.quantity,
  }));
  const signature = JSON.stringify(actual);
  const reviewing = reviewed === signature;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">
        <T k={reviewing ? "You are returning" : "Returning"} />
      </h2>
      <p className="text-sm text-muted-foreground">
        <T k="Count the stock on your vehicle." />
      </p>
      {reviewing ? (
        <div className="space-y-3 rounded-xl bg-muted p-4">
          {actual.map((c) => (
            <p
              className="flex justify-between gap-3"
              key={c.product_id + c.stock_kind}
            >
              <span>
                {
                  state.snapshot.workspace.products.find(
                    (p) => p.id === c.product_id,
                  )?.name
                }{" "}
                ·{" "}
                <T
                  k={
                    c.stock_kind === "FULL_JAR"
                      ? "Full jars"
                      : c.stock_kind === "EMPTY_JAR"
                        ? "Empty jars"
                        : "Cartons"
                  }
                />
              </span>
              <strong>{c.quantity}</strong>
            </p>
          ))}
        </div>
      ) : (
        expected.map((c) => (
          <Counter
            key={c.product_id + c.stock_kind}
            label={`${state.snapshot.workspace.products.find((p) => p.id === c.product_id)?.name} · ${t(c.stock_kind === "FULL_JAR" ? "Full jars" : c.stock_kind === "EMPTY_JAR" ? "Empty jars" : "Cartons")}`}
            value={values[c.product_id + c.stock_kind] ?? c.quantity}
            onChange={(n) =>
              setValues((v) => ({ ...v, [c.product_id + c.stock_kind]: n }))
            }
          />
        ))
      )}
      {reviewing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setReviewed("")}
          >
            <T k="Edit counts" />
          </Button>
          <Button
            className="min-h-14"
            disabled={busy || state.sealed}
            onClick={() => void save(actual)}
          >
            <T k="Confirm Return" />
          </Button>
        </div>
      ) : (
        <Button
          className="min-h-14 w-full"
          disabled={busy || state.sealed}
          onClick={() => setReviewed(signature)}
        >
          <T k="Review Return" />
        </Button>
      )}
    </div>
  );
}
