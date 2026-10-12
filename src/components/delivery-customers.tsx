"use client";
import { T, Message, DateValue, Value } from "@/components/localization";

import { useActionState, useRef, useState } from "react";
import {
  deliveryCustomerAction,
  operationAction,
} from "@/app/operations-actions";
import type { Customer, Workspace } from "@/domain/operations/types";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import { npr } from "@/domain/finance/money";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { PendingJars } from "./pending-jars";

export function useDeliveryCustomer(trip: string, enabled: boolean) {
  const [customer, setCustomer] = useState("");
  const [context, setContext] = useState<DeliveryCustomerContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  async function selectCustomer(id: string) {
    const current = ++sequence.current;
    setCustomer(id);
    setContext(null);
    setError(null);
    setLoading(!!id && enabled);
    if (!id || !enabled) return;
    const result = await deliveryCustomerAction(trip, id);
    if (sequence.current !== current) return;
    setContext(result.data);
    setError(result.error);
    setLoading(false);
  }
  return { customer, context, loading, error, selectCustomer };
}

export function DeliveryCustomerForm({
  trip,
  customer,
  onSaved,
  onCancel,
  detailsEnabled = false,
}: {
  trip: string;
  customer?: Customer;
  onSaved: (id: string) => void;
  onCancel: () => void;
  detailsEnabled?: boolean;
}) {
  const [id] = useState(() => customer?.id ?? crypto.randomUUID());
  const [key] = useState(() => crypto.randomUUID());
  const [contacts, setContacts] = useState({
    name: customer?.name ?? "",
    shop_name: customer?.shop_name ?? "",
    phone: customer?.phone ?? "",
    address: customer?.address ?? "",
    contact_person: customer?.contact_person ?? "",
    customer_type: customer?.customer_type ?? "",
    delivery_notes: customer?.delivery_notes ?? "",
  });
  const [duplicate, setDuplicate] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: Parameters<typeof operationAction>[0], form: FormData) => {
      const result = await operationAction(previous, form);
      if (result?.id && result.success) onSaved(result.id);
      return result;
    },
    null,
  );
  return (
    <Card id="customer-editor" className="space-y-4 border-primary">
      <h3 className="text-lg font-bold">
        <Message
          value={customer ? "Edit customer contact" : "Add New Customer"}
        />
      </h3>
      <p className="text-sm text-muted-foreground">
        <T k="Save contact details and continue this delivery. Prices, credit, deposits and jar balances are managed separately." />
      </p>
      <form action={action} className="space-y-4">
        <input
          type="hidden"
          name="operation"
          value={detailsEnabled ? "delivery-contact" : "delivery-customer"}
        />
        <input type="hidden" name="trip" value={trip} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="key" value={key} />
        <input type="hidden" name="version" value={customer?.version ?? 0} />
        <fieldset disabled={pending} className="space-y-4">
          {(
            [
              ["name", "Customer name"],
              ["shop_name", "Shop name (optional)"],
              ["phone", "Customer phone (optional)"],
              ["address", "Customer address (optional)"],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="grid gap-2 text-sm font-semibold">
              <Message value={label} />
              <Input
                name={field}
                value={contacts[field]}
                required={field === "name"}
                autoFocus={field === "name"}
                type={field === "phone" ? "tel" : "text"}
                maxLength={
                  { name: 120, shop_name: 160, phone: 40, address: 500 }[field]
                }
                onChange={(e) => {
                  setContacts({ ...contacts, [field]: e.target.value });
                  setDuplicate(false);
                }}
              />
            </label>
          ))}
          {detailsEnabled &&
            (
              [
                ["contact_person", "Contact person (optional)", 120],
                ["customer_type", "Customer type (optional)", 80],
                ["delivery_notes", "Delivery notes (optional)", 2000],
              ] as const
            ).map(([field, label, max]) => (
              <label key={field} className="grid gap-2 text-sm font-semibold">
                <Message value={label} />
                <Input
                  name={field}
                  value={contacts[field]}
                  maxLength={max}
                  onChange={(e) =>
                    setContacts({ ...contacts, [field]: e.target.value })
                  }
                />
              </label>
            ))}
          {detailsEnabled && (
            <p className="text-xs text-muted-foreground">
              <T k="Customer type is a descriptive label. Monthly credit, prices and deposits remain under existing billing arrangements." />
            </p>
          )}
          {(duplicate || state?.error?.includes("matching customer")) && (
            <label className="flex min-h-14 items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm">
              <input
                name="duplicate_confirmed"
                type="checkbox"
                checked={duplicate}
                onChange={(e) => setDuplicate(e.target.checked)}
                className="size-5"
              />{" "}
              <T k="I checked the directory; this is a separate customer with matching details." />{" "}
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-14" type="submit">
              <Message
                value={
                  pending
                    ? "Saving…"
                    : customer
                      ? "Save contact details"
                      : "Save and select customer"
                }
              />
            </Button>
            <Button
              className="min-h-14"
              variant="outline"
              type="button"
              onClick={onCancel}
            >
              <T k="Cancel contact changes" />
            </Button>
          </div>
        </fieldset>
        {state?.error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
          >
            <Message value={state.error} />
          </p>
        )}
      </form>
    </Card>
  );
}

export function DeliveryCustomerHistory({
  context,
  products,
}: {
  context: DeliveryCustomerContext;
  products: Workspace["products"];
}) {
  return (
    <details className="rounded-lg border border-border p-4 text-sm">
      <summary className="min-h-11 cursor-pointer font-semibold">
        <T k="Customer credit and jar history" />
      </summary>
      <div className="mt-4 space-y-4">
        <PendingJars
          workspace={{
            available: context.pending_jars !== undefined,
            rows: context.pending_jars ?? [],
          }}
        />
        {context.jar_allocations && context.jar_allocations.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer font-semibold">
              <T k="FIFO empty-return allocations" />
            </summary>
            {context.jar_allocations.map((a) => (
              <p
                className="py-2"
                key={`${a.return_entry_id}:${a.delivery_entry_id}`}
              >
                <T
                  k="{0} jars · {1} · {2} against original date {3}"
                  values={[
                    <Value key="v0" value={a.quantity} />,
                    <Message key="v1" value={a.source} />,
                    <DateValue key="v2" value={a.returned_at} time />,
                    <DateValue key="v3" value={a.original_date} time />,
                  ]}
                />
              </p>
            ))}
          </details>
        )}
        <div>
          <h4 className="font-semibold">
            <T k="Recent credit entries" />
          </h4>
          {!context.credit_history.length && (
            <p>
              <T k="No credit history recorded." />
            </p>
          )}
          {context.credit_history.map((e) => (
            <p key={e.id} className="py-2">
              <Message value={e.kind.replaceAll("_", " ")} /> ·{" "}
              <Value value={npr(e.amount)} /> ·{" "}
              <DateValue value={e.created_at} time />
            </p>
          ))}
        </div>
        <div>
          <h4 className="font-semibold">
            <T k="Recent jar entries" />
          </h4>
          {!context.custody_history.length && (
            <p>
              <T k="No jar history recorded." />
            </p>
          )}
          {context.custody_history.map((e) => (
            <p key={e.id} className="py-2">
              <T
                k="{0} · {1} {2} jars · balance {3} · {4}"
                values={[
                  products.find((p) => p.id === e.product_id)?.name,
                  e.delta > 0 ? "+" : "",
                  e.delta,
                  e.resulting_balance,
                  <DateValue key="v4" value={e.created_at} time />,
                ]}
              />
            </p>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <T k="Latest 50 entries per ledger. Posted transactions remain immutable." />
        </p>
      </div>
    </details>
  );
}
