"use client";
import { T } from "@/components/localization";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer, Trip, Workspace } from "@/domain/operations/types";
import { DeliveryCustomerForm } from "./delivery-customers";
import { OperationalRefresh } from "./operational-refresh";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";

export function DriverCustomers({
  workspace: w,
  trip,
}: {
  workspace: Workspace;
  trip?: Trip;
}) {
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Customer | "new" | null>(null);
  const router = useRouter();
  const customers = w.customers.filter(
    (c) =>
      c.is_active &&
      `${c.name} ${c.shop_name} ${c.contact_person ?? ""} ${c.phone} ${c.address} ${c.customer_type ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      {!editor && <OperationalRefresh />}
      <label className="grid gap-2 text-sm font-semibold">
        {" "}
        <T k="Search active customers" />{" "}
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {!w.customer_details && (
        <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm">
          <T k="Migration 014 is required for customer lookup while waiting for loading and extended contact details. Current permitted contacts remain available." />
        </p>
      )}
      {trip ? (
        <Button className="min-h-14 w-full" onClick={() => setEditor("new")}>
          <T k="Add New Customer" />
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          <T k="Customer lookup is available while waiting. Start an assigned loaded round on an open business day to register or edit a customer." />
        </p>
      )}
      {editor && trip && (
        <DeliveryCustomerForm
          key={editor === "new" ? "new" : editor.id}
          trip={trip.id}
          customer={editor === "new" ? undefined : editor}
          detailsEnabled={w.customer_details}
          onCancel={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            router.refresh();
          }}
        />
      )}
      {!customers.length && (
        <Card>
          <T k="No matching active customers." />
        </Card>
      )}
      <ul className="space-y-3">
        {customers.map((c) => (
          <li key={c.id}>
            <Card className="space-y-3">
              <h2 className="font-semibold">
                {c.name}
                {c.shop_name && ` · ${c.shop_name}`}
              </h2>
              {c.contact_person && (
                <p className="text-sm">
                  <T k="Contact: {0}" values={[c.contact_person]} />
                </p>
              )}
              {c.customer_type && (
                <p className="text-sm">
                  <T k="Customer type: {0}" values={[c.customer_type]} />
                </p>
              )}
              {c.phone && (
                <a
                  className="inline-block min-h-11 py-2 text-primary underline"
                  href={`tel:${c.phone.replace(/[^+0-9]/g, "")}`}
                >
                  {c.phone}
                </a>
              )}
              {c.address && <p className="text-sm">{c.address}</p>}
              {c.delivery_notes && (
                <p className="text-sm">{c.delivery_notes}</p>
              )}
              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/driver/pending-jars?customer=${c.id}`}
                  className="inline-block min-h-12 py-3 font-semibold text-primary underline"
                >
                  <T k="Pending jars" />
                </Link>
                {trip && (
                  <>
                    <Link
                      href={`/driver/delivery?customer=${c.id}`}
                      className="inline-block min-h-12 py-3 font-semibold text-primary underline"
                    >
                      <T k="New Delivery" />
                    </Link>
                    <Button variant="outline" onClick={() => setEditor(c)}>
                      <T k="Edit contact" />
                    </Button>
                  </>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
