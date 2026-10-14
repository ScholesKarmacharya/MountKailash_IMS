import type { SupabaseClient } from "@supabase/supabase-js";

/** The transport never supplies trusted business data; every event refetches
 * the current recipient's RLS-protected inbox. One owner, one cleanup. */
export function subscribeNotifications(
  client: SupabaseClient,
  user: string,
  changed: () => void,
  status: (connected: boolean) => void,
) {
  let stopped = false;
  const receive = () => {
    if (!stopped) changed();
  };
  const filter = {
    schema: "public",
    table: "notifications",
    filter: `recipient_id=eq.${user}`,
  };
  const channel = client
    .channel(`notifications:${user}`)
    .on("postgres_changes", { ...filter, event: "INSERT" }, receive)
    .on("postgres_changes", { ...filter, event: "UPDATE" }, receive)
    .subscribe((state) => {
      if (stopped) return;
      status(state === "SUBSCRIBED");
      if (state === "SUBSCRIBED") changed();
    });
  return () => {
    stopped = true;
    void client.removeChannel(channel);
  };
}
