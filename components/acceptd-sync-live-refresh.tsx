"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

export function AcceptdSyncLiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin:acceptd-sync", { config: { private: true } })
      .on("broadcast", { event: "sync_changed" }, () => router.refresh());
    let disposed = false;
    void supabase.realtime.setAuth().then(() => {
      if (!disposed) channel.subscribe();
    }).catch(() => undefined);
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
