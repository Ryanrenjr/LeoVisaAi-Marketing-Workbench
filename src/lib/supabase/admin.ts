import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * SERVER-ONLY. Uses the service-role key and bypasses Row Level Security.
 *
 * Do not import this file from anything a Client Component can pull in.
 * Every caller must independently verify the current user is ADMIN before
 * using this client — see docs/security-boundaries.md "API key handling".
 * Only src/app/admin/actions.ts should import this module.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
