import type { SupabaseClient } from "@supabase/supabase-js";

export async function consumeApiQuota(
  supabase: SupabaseClient,
  scope: string,
  limit: number,
  windowSeconds = 3600,
) {
  const { data, error } = await supabase.rpc("consume_api_quota", {
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Quota check failed: ${error.message}`);
  return data === true;
}
