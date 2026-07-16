import { createBrowserClient } from "@supabase/ssr";

// Browser-Client (Client-Components). Nutzt nur die öffentlichen ENV-Keys.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
