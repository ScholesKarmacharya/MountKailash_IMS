"use client";
import { useEffect, useState } from "react";
import Dexie from "dexie";
import { offlineDB } from "@/lib/offline/store";
import { Message, T } from "../localization";

export function OfflineDeviceBanner({
  user,
  driver,
}: {
  user: string;
  driver: boolean;
}) {
  const [pending, setPending] = useState<number>();
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (
        typeof indexedDB === "undefined" ||
        !(await Dexie.exists("mount-kailash-offline"))
      )
        return;
      const db = offlineDB();
      try {
        const previous = (await db.settings.get("active-user"))?.value;
        if (previous && previous !== user) {
          const channel = new BroadcastChannel("mk-offline-session");
          channel.postMessage({ lock: true });
          channel.close();
          window.dispatchEvent(new Event("mk-offline-locked"));
        }
        await db.settings.put({ key: "active-user", value: user });
        const rows = await db.vaults.where("user").equals(user).toArray();
        if (!cancelled && rows.length)
          setPending(rows.reduce((n, r) => n + r.pending, 0));
      } finally {
        db.close();
      }
    };
    void load().catch(() => {});
    const refresh = () => void load().catch(() => {});
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [user]);
  if (!driver || pending === undefined) return null;
  return (
    <a
      href="/offline"
      className="block rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
    >
      <T k="Offline driver workspace" /> · <T k="Waiting to Sync" />: {pending}{" "}
      ·{" "}
      <Message value="Open this device workspace to check server confirmation." />
    </a>
  );
}
