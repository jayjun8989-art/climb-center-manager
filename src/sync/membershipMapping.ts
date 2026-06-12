import type { LegacyMembershipType, MemberInput } from "../types";

export type SupabaseMemberType = "regular" | "junior";
export type SupabaseMembershipType = "monthly" | "session" | "junior";

type MembershipPayload = Pick<
  MemberInput,
  | "membership_type"
  | "member_type"
  | "start_date"
  | "end_date"
  | "total_sessions"
  | "remaining_sessions"
  | "price"
> & {
  local_membership_id?: number | null;
};

export function supabaseMemberTypeFromPayload(payload: MembershipPayload): SupabaseMemberType {
  const memberType = String(payload.member_type ?? "").toLowerCase();
  if (memberType === "junior") return "junior";
  if (memberType === "trial") return "regular";
  if (memberType === "regular" || memberType === "general") return "regular";
  if (payload.membership_type === "junior") return "junior";
  return "regular";
}

export function supabaseMembershipTypeFromLegacy(
  legacyType: LegacyMembershipType | string,
): SupabaseMembershipType {
  switch (legacyType) {
    case "monthly_1":
    case "monthly_3":
    case "monthly_6":
    case "30days":
    case "90days":
    case "180days":
    case "monthly":
      return "monthly";
    case "session":
    case "5times":
      return "session";
    case "junior":
    case "8times":
    case "16times":
      return "junior";
    default:
      return "monthly";
  }
}

export function supabaseMembershipTypeFromPayload(
  payload: MembershipPayload,
): SupabaseMembershipType {
  return supabaseMembershipTypeFromLegacy(payload.membership_type);
}

export function supabasePassType(membershipType: SupabaseMembershipType): "period" | "count" {
  return membershipType === "monthly" ? "period" : "count";
}

export function buildSupabaseMembershipRow(
  payload: MembershipPayload,
  remoteMemberId: string,
  centerId: string,
) {
  const membershipType = supabaseMembershipTypeFromPayload(payload);
  const passType = supabasePassType(membershipType);
  const totalCount = payload.total_sessions ?? null;
  const remainingCount =
    payload.remaining_sessions ?? payload.total_sessions ?? (passType === "count" ? 0 : null);
  const usedCount =
    totalCount != null && remainingCount != null
      ? Math.max(0, totalCount - remainingCount)
      : 0;

  return {
    member_id: remoteMemberId,
    center_id: centerId,
    membership_type: membershipType,
    pass_type: passType,
    start_date: payload.start_date,
    end_date: payload.end_date ?? null,
    total_count: totalCount,
    remaining_count: remainingCount,
    used_count: usedCount,
    price: payload.price ?? null,
    status: "active" as const,
  };
}
