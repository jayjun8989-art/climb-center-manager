import type { Center, MemberListRow, UserCenterRoleRow } from "../types";
import { getSupabase } from "./supabase";
import type { CenterRole } from "../types";

export async function fetchMyRoles(userId: string): Promise<UserCenterRoleRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_center_roles")
    .select("id, user_id, center_id, role, centers(code, name)")
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const centers = row.centers as { code: Center; name: string } | { code: Center; name: string }[] | null;
    const centerInfo = Array.isArray(centers) ? centers[0] : centers;
    if (!centerInfo?.code) {
      throw new Error("?? ??? ???? ?????.");
    }
    return {
      id: row.id as string,
      userId: row.user_id as string,
      centerId: row.center_id as string,
      center: centerInfo.code,
      centerName: centerInfo.name,
      role: row.role as CenterRole,
    };
  });
}

export async function searchMembers(center: Center, query: string): Promise<MemberListRow[]> {
  const supabase = getSupabase();
  let builder = supabase
    .from("member_list_view")
    .select("*")
    .eq("center_code", center)
    .order("name", { ascending: true })
    .limit(80);

  const q = query.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      builder = builder.or(`name.ilike.%${q}%,phone.ilike.%${digits}%`);
    } else {
      builder = builder.ilike("name", `%${q}%`);
    }
  }

  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberListRow[];
}

export async function fetchMemberById(id: string): Promise<MemberListRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("member_list_view").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberListRow | null) ?? null;
}

export function formatMembershipLabel(member: MemberListRow): string {
  if (!member.membership_type) return "??? ??";
  const type = member.membership_type;
  if (member.pass_type === "count") {
    return `??? � ?? ${member.remaining_count ?? 0}?`;
  }
  if (type === "30days") return "?? 1??";
  if (type === "90days") return "?? 3??";
  if (type === "180days") return "?? 6??";
  if (type === "junior") return `??? ${member.total_count ?? ""}?`;
  if (type === "trial") return "??";
  return type;
}

export function formatStatus(member: MemberListRow): string {
  if (member.status === "paused" || member.membership_status === "paused") return "??";
  if (member.membership_status === "finished") return "??";
  if (member.status === "expired") return "??";
  return "??";
}
