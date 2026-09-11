import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

interface UseRealtimeUpdatesOptions {
  enabled: boolean;
  centerId: string | null;
  onMemberChange?: () => void;
  onMembershipChange?: () => void;
  onAttendanceChange?: () => void;
  onCareChange?: () => void;
}

export function useRealtimeUpdates({
  enabled,
  centerId,
  onMemberChange,
  onMembershipChange,
  onAttendanceChange,
  onCareChange,
}: UseRealtimeUpdatesOptions): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured() || !centerId) {
      setStatus("disconnected");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;

    setStatus("connecting");

    const channel = supabase
      .channel(`dashboard-${centerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "members", filter: `center_id=eq.${centerId}` },
        () => onMemberChange?.(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "memberships" },
        () => onMembershipChange?.(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance_logs" },
        () => onAttendanceChange?.(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "member_care_profiles", filter: `center_id=eq.${centerId}` },
        () => onCareChange?.(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "member_care_logs", filter: `center_id=eq.${centerId}` },
        () => onCareChange?.(),
      )
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("connected");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setStatus("disconnected");
      });

    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setStatus("disconnected");
    };
  }, [enabled, centerId, onMemberChange, onMembershipChange, onAttendanceChange, onCareChange]);

  return status;
}
