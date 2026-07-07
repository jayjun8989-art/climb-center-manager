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
    if (!centerInfo?.code) throw new Error("센터 정보를 불러오지 못했습니다.");
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
    if (digits.length >= 4) builder = builder.or(`name.ilike.%${q}%,phone.ilike.%${digits}%`);
    else builder = builder.ilike("name", `%${q}%`);
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
  if (!member.membership_type) return "회원권 없음";
  const type = member.membership_type;
  if (member.pass_type === "count") return `회수권 · 잔여 ${member.remaining_count ?? 0}회`;
  if (type === "30days") return "기간 1개월";
  if (type === "90days") return "기간 3개월";
  if (type === "180days") return "기간 6개월";
  if (type === "junior") return `주니어 ${member.total_count ?? ""}회`;
  if (type === "trial") return "체험";
  return type;
}

export function formatStatus(member: MemberListRow): string {
  if (member.status === "paused" || member.membership_status === "paused") return "정지";
  if (member.membership_status === "finished") return "만료";
  if (member.status === "expired") return "만료";
  return "유효";
}
