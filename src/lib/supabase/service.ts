import { createClient } from "@supabase/supabase-js";

// Service-Role-Client — NUR serverseitig verwenden (umgeht RLS). Gedacht für
// reine Server-Aufgaben wie den api_cache (Default-deny für anon/authenticated).
// NIEMALS in Client-Components importieren.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
