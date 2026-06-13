import type { MemberListItem } from "../types";

/**
 * Final display-layer dedupe defense.
 *
 * Some local DBs accumulated genuinely duplicate member rows from before the
 * v1.0.26 pull-matching fix (e.g. "김경준" shown 10+ times). This function
 * groups member rows that represent the same logical person and keeps only
 * one representative per group for display, while attaching `_duplicateInfo`
 * to the kept row for future manual-merge tooling.
 *
 * Grouping key (in priority order):
 *  1. remote_id, if present
 *  2. member.id (always unique on its own, used as fallback bucket)
 *  3. fingerprint when remote_id is absent and ids differ:
 *     - with phone: center + name + phone + member_type + membership_type +
 *       end_date + remaining_count + status
 *     - without phone: center + name + member_type + membership_type +
 *       end_date + status
 *
 * Representative selection within a group:
 *  1. has remote_id (prefer non-null)
 *  2. most recent updated_at
 *  3. oldest created_at
 */

type DuplicateInfo = {
  duplicate_count: number;
  duplicate_local_ids: number[];
  duplicate_remote_ids: string[];
};

type DedupedMember = MemberListItem & {
  remote_id?: string | null;
  _duplicateInfo?: DuplicateInfo;
};

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").trim();
}

function normalizePhoneKey(phone: string | null | undefined): string {
  return (phone ?? "").replace(/[\s-]/g, "");
}

function fingerprintKey(member: MemberListItem): string {
  const center = member.center ?? "";
  const name = normalizeName(member.name);
  const memberType = member.member_type ?? "";
  const membershipType = member.membership_type ?? "";
  const endDate = member.end_date ?? "";
  const status = member.status ?? "";
  const phoneKey = normalizePhoneKey(member.phone);

  if (phoneKey) {
    const remaining = member.remaining_count ?? "";
    return `fp|${center}|${name}|${phoneKey}|${memberType}|${membershipType}|${endDate}|${remaining}|${status}`;
  }

  return `fp|${center}|${name}|${memberType}|${membershipType}|${endDate}|${status}`;
}

function groupKey(member: MemberListItem): string {
  const remoteId = (member as DedupedMember).remote_id;
  if (remoteId) return `remote|${remoteId}`;
  return fingerprintKey(member);
}

/** Returns true if `a` should be preferred over `b` as the group representative. */
function isBetterRepresentative(a: DedupedMember, b: DedupedMember): boolean {
  const aRemote = !!a.remote_id;
  const bRemote = !!b.remote_id;
  if (aRemote !== bRemote) return aRemote;

  const aUpdated = a.updated_at ?? "";
  const bUpdated = b.updated_at ?? "";
  if (aUpdated !== bUpdated) return aUpdated > bUpdated;

  const aCreated = a.created_at ?? "";
  const bCreated = b.created_at ?? "";
  if (aCreated !== bCreated) return aCreated < bCreated;

  return a.id < b.id;
}

export function normalizeMembers(members: MemberListItem[]): MemberListItem[] {
  // First pass: remove exact id duplicates (shouldn't normally happen, but
  // is cheap insurance against the SQL list query ever returning the same
  // row twice).
  const seenIds = new Set<number>();
  const deduped: DedupedMember[] = [];
  for (const member of members) {
    if (seenIds.has(member.id)) continue;
    seenIds.add(member.id);
    deduped.push(member as DedupedMember);
  }

  // Second pass: group by remote_id / fingerprint and keep one representative.
  const groups = new Map<string, DedupedMember[]>();
  const order: string[] = [];
  for (const member of deduped) {
    const key = groupKey(member);
    const group = groups.get(key);
    if (group) {
      group.push(member);
    } else {
      groups.set(key, [member]);
      order.push(key);
    }
  }

  const result: DedupedMember[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    let representative = group[0];
    for (let i = 1; i < group.length; i++) {
      if (isBetterRepresentative(group[i], representative)) {
        representative = group[i];
      }
    }

    const others = group.filter((m) => m !== representative);
    const duplicateRemoteIds = others
      .map((m) => m.remote_id)
      .filter((id): id is string => !!id);

    representative._duplicateInfo = {
      duplicate_count: group.length,
      duplicate_local_ids: group.map((m) => m.id),
      duplicate_remote_ids: duplicateRemoteIds,
    };

    console.warn(
      "[normalizeMembers] 중복 회원 표시 통합:",
      key,
      "ids:",
      group.map((m) => m.id),
    );

    result.push(representative);
  }

  return result;
}
