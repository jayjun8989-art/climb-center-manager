/**
 * Supabase-direct member list reader.
 *
 * Reads members + memberships from Supabase on every call so both computers
 * always see the canonical server state — no local-cache drift possible.
 *
 * Write operations (add/edit/attendance/…) still go through the local SQLite
 * path; only the *read* path is Supabase-direct.
 */

import type {
  Center,
  MemberGroupFilter,
  MemberListItem,
  MemberStatusFilter,
  PaginatedMembers,
} from "../types";
import { getSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { resolveCenterId, centerCodeFromId } from "../lib/supabase/centers";
import { safeInvoke } from "../lib/tauri";

// ---------------------------------------------------------------------------
// Types for raw Supabase rows
// ---------------------------------------------------------------------------

interface SupabaseMember {
  id: string;
  center_id: string;
  name: string;
  phone: string | null;
  member_type: string;
  parent_name: string | null;
  parent_phone: string | null;
  memo: string | null;
  address: string | null;
  status: string;
  member_no: number | null;
  is_focus_care: boolean | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface SupabaseMembership {
  id: string;
  member_id: string;
  membership_type: string;
  pass_type: string;
  start_date: string;
  end_date: string | null;
  total_count: number | null;
  remaining_count: number | null;
  status: string;
  price: number | null;
  created_at: string;
  updated_at: string;
}

interface LocalIdEntry {
  remote_id: string;
  local_member_id: number | null;
  local_membership_id: number | null;
}

// ---------------------------------------------------------------------------
// Membership type normalisation
// Server uses: monthly / session / junior / trial
// UI uses:     30days / 60days / 90days / 180days / 5times / 8times / 16times / junior / trial
// ---------------------------------------------------------------------------

function serverTypeToDisplayType(
  serverType: string,
  startDate: string,
  endDate: string | null,
): string {
  if (serverType === "monthly") {
    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
      if (days >= 150) return "180days";
      if (days >= 80) return "90days";
      if (days >= 50) return "60days";
    }
    return "30days";
  }
  if (serverType === "session") return "5times";
  return serverType; // junior / trial / or already normalised
}

// ---------------------------------------------------------------------------
// Status computation from Supabase data
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function computeMemberStatus(
  membership: SupabaseMembership | undefined,
): { display_status: string; remaining_text: string; membership_status: string | null } {
  if (!membership) {
    return { display_status: "회원권없음", remaining_text: "회원권 없음", membership_status: null };
  }

  const t = today();

  if (membership.status === "paused") {
    return { display_status: "정지", remaining_text: "정지 중", membership_status: "paused" };
  }

  if (membership.pass_type === "count") {
    const rem = membership.remaining_count ?? 0;
    if (membership.status === "finished" || rem <= 0) {
      return { display_status: "만료", remaining_text: "소진", membership_status: "finished" };
    }
    return { display_status: "이용중", remaining_text: `${rem}회 남음`, membership_status: "active" };
  }

  // period-based
  const end = membership.end_date;
  if (!end) {
    return { display_status: "이용중", remaining_text: "기간 미설정", membership_status: "active" };
  }

  if (end < t) {
    const diffDays = Math.round((new Date(t).getTime() - new Date(end).getTime()) / 86400000);
    return {
      display_status: "만료",
      remaining_text: `${diffDays}일 전 만료`,
      membership_status: "expired",
    };
  }

  const remaining = Math.round((new Date(end).getTime() - new Date(t).getTime()) / 86400000);
  return {
    display_status: "이용중",
    remaining_text: `${remaining}일 남음`,
    membership_status: "active",
  };
}

// ---------------------------------------------------------------------------
// Best membership selector
// Pick the best active/paused membership; fall back to most-recent expired.
// ---------------------------------------------------------------------------

function pickBestMembership(memberships: SupabaseMembership[]): SupabaseMembership | undefined {
  if (memberships.length === 0) return undefined;

  const t = today();

  const active = memberships.filter((m) => {
    if (m.status === "paused") return true;
    if (m.status === "active") {
      if (m.pass_type === "count") return (m.remaining_count ?? 0) > 0;
      return !m.end_date || m.end_date >= t;
    }
    return false;
  });

  if (active.length > 0) {
    return active.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  }

  return memberships.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

// ---------------------------------------------------------------------------
// Fetch last-visit dates for all members in a single query
// ---------------------------------------------------------------------------

async function fetchLastVisits(
  supabase: ReturnType<typeof getSupabaseClient>,
  memberIds: string[],
): Promise<Map<string, string>> {
  if (!supabase || memberIds.length === 0) return new Map();

  const { data } = await supabase
    .from("attendance_logs")
    .select("member_id, checkin_at")
    .in("member_id", memberIds)
    .is("canceled_at", null)
    .order("checkin_at", { ascending: false });

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const mid = row.member_id as string;
    if (!map.has(mid)) {
      map.set(mid, row.checkin_at as string);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Resolve local SQLite ids via Tauri command
// ---------------------------------------------------------------------------

async function resolveLocalIds(remoteIds: string[]): Promise<Map<string, LocalIdEntry>> {
  if (remoteIds.length === 0) return new Map();

  const entries =
    (await safeInvoke<LocalIdEntry[]>("batch_get_local_ids_cmd", { remoteIds })) ?? [];

  const map = new Map<string, LocalIdEntry>();
  for (const e of entries) map.set(e.remote_id, e);
  return map;
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function matchesSearch(item: MemberListItem, search: string): boolean {
  if (!search) return true;
  const q = search.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    (item.phone ?? "").replace(/-/g, "").includes(q.replace(/-/g, ""))
  );
}

function matchesStatusFilter(item: MemberListItem, filter: MemberStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return item.display_status === "이용중";
  if (filter === "expired") return item.display_status === "만료";
  return true;
}

function matchesGroup(item: MemberListItem, group: MemberGroupFilter): boolean {
  if (group === "all") return true;
  if (group === "junior") return item.member_type === "junior";
  if (group === "regular") return item.member_type === "regular" || item.member_type === "general";
  if (group === "inactive_30") {
    if (!item.last_visit_at) return true;
    const daysSince = Math.round(
      (Date.now() - new Date(item.last_visit_at).getTime()) / 86400000,
    );
    return daysSince >= 30;
  }
  if (group === "no_member_no") return !item.member_no;
  return true;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function fetchSupabaseMemberList(params: {
  center: Center;
  search?: string;
  memberGroup?: MemberGroupFilter;
  statusFilter?: MemberStatusFilter;
  page?: number;
  page_size?: number;
}): Promise<PaginatedMembers> {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error("Supabase 미설정");
  }

  const centerId = await resolveCenterId(params.center);
  const page = params.page ?? 1;
  const page_size = params.page_size ?? 50;

  // 1. Fetch all non-deleted members for this center
  const { data: rawMembers, error: membersError } = await supabase
    .from("members")
    .select(
      "id, center_id, name, phone, member_type, parent_name, parent_phone, memo, address, status, member_no, is_focus_care, created_at, updated_at, deleted_at",
    )
    .eq("center_id", centerId)
    .is("deleted_at", null)
    .order("name");

  if (membersError) throw new Error(membersError.message);
  const members = (rawMembers ?? []) as SupabaseMember[];
  const memberIds = members.map((m) => m.id);

  if (memberIds.length === 0) {
    return { members: [], total: 0, page, page_size };
  }

  // 2. Fetch all memberships for these members
  const { data: rawMemberships, error: membershipsError } = await supabase
    .from("memberships")
    .select(
      "id, member_id, membership_type, pass_type, start_date, end_date, total_count, remaining_count, status, price, created_at, updated_at",
    )
    .in("member_id", memberIds);

  if (membershipsError) throw new Error(membershipsError.message);
  const allMemberships = (rawMemberships ?? []) as SupabaseMembership[];

  // 3. Last visit per member
  const lastVisitMap = await fetchLastVisits(supabase, memberIds);

  // 4. Resolve local SQLite ids (for mutations)
  const localIdMap = await resolveLocalIds(memberIds);

  // 5. Group memberships by member
  const membershipsByMember = new Map<string, SupabaseMembership[]>();
  for (const ms of allMemberships) {
    const arr = membershipsByMember.get(ms.member_id) ?? [];
    arr.push(ms);
    membershipsByMember.set(ms.member_id, arr);
  }

  // 6. Build MemberListItem list
  const items: MemberListItem[] = members.map((m) => {
    const memberships = membershipsByMember.get(m.id) ?? [];
    const best = pickBestMembership(memberships);
    const { display_status, remaining_text, membership_status } = computeMemberStatus(best);
    const local = localIdMap.get(m.id);

    const memberType =
      m.member_type === "regular" ? "general" : (m.member_type as MemberListItem["member_type"]);

    const center = centerCodeFromId(m.center_id) ?? params.center;

    const displayMembershipType = best
      ? serverTypeToDisplayType(best.membership_type, best.start_date, best.end_date)
      : null;

    return {
      // Use local id when available; fall back to 0 (mutations will be blocked
      // until a pull sync brings the member into local DB).
      id: local?.local_member_id ?? 0,
      name: m.name,
      phone: m.phone,
      member_type: memberType,
      center,
      memo: m.memo,
      status: m.status,
      membership_id: local?.local_membership_id ?? null,
      membership_type: displayMembershipType,
      pass_type: best?.pass_type ?? null,
      start_date: best?.start_date ?? null,
      end_date: best?.end_date ?? null,
      total_count: best?.total_count ?? null,
      remaining_count: best?.remaining_count ?? null,
      membership_status,
      display_status,
      remaining_text,
      last_visit_at: lastVisitMap.get(m.id) ?? null,
      pause_remaining_days: null,
      member_no: m.member_no,
      remote_id: m.id,
      is_focus_care: m.is_focus_care ?? false,
      created_at: m.created_at,
      updated_at: m.updated_at,
    };
  });

  // 7. Cleanup orphan local members with ALL remote ids (before pagination).
  //    Fire-and-forget: hides local-only members that don't exist in Supabase.
  if (memberIds.length > 0) {
    safeInvoke("cleanup_orphan_local_members_cmd", {
      center: params.center,
      activeRemoteIds: memberIds,
    }).catch(() => undefined);
  }

  // 8. Apply filters
  const search = params.search?.trim() ?? "";
  const statusFilter = params.statusFilter ?? "all";
  const memberGroup = params.memberGroup ?? "all";

  const filtered = items.filter(
    (item) =>
      matchesSearch(item, search) &&
      matchesStatusFilter(item, statusFilter) &&
      matchesGroup(item, memberGroup),
  );

  // 9. Pagination
  const total = filtered.length;
  const offset = (page - 1) * page_size;
  const paginated = filtered.slice(offset, offset + page_size);

  return { members: paginated, total, page, page_size };
}
