"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./env";
export function browserClient() {
  const config = supabaseConfig();
  return config ? createBrowserClient(config.url, config.key) : null;
}
