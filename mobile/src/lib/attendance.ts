import { getSupabase } from "./supabase";

function todayRangeIso(): { start: string; end: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const date = `${y}-${m}-${day}`;
  return { start: `${date}T00:00:00`, end: `${date}T23:59:59` };
}

export async function hasAttendanceToday(memberId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { start, end } = todayRangeIso();
  const { count, error } = await supabase
    .from("attendance_logs")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .is("canceled_at", null)
    .gte("checkin_at", start)
    .lte("checkin_at", end);

  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

export async function recordAttendance(memberId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("rpc_record_attendance", {
    p_member_id: memberId,
  });
  if (error) {
    const msg = error.message;
    if (msg.includes("???") || msg.includes("access denied")) {
      throw new Error("??? ????.");
    }
    if (msg.toLowerCase().includes("not found")) {
      throw new Error("??? ?? ? ????.");
    }
    throw new Error(msg);
  }
}
