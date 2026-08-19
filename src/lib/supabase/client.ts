import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./config";

/** Browser Supabase client. Uses only the public anon key — safe for Client Components. */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
