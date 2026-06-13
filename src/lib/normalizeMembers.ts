import type { MemberListItem } from "../types";

/**
 * Defensive de-duplication for member lists returned from the backend.
 *
 * Primary key: member.id (and remote_id when present) — removes exact
 * duplicate rows that may slip through if the SQL list query or local DB
 * ever returns the same member more than once.
 *
 * Secondary heuristic: when remote_id is missing, members that share the
 * same center + name + phone are flagged as "중복 후보" (duplicate
 * candidates) via console.warn for internal diagnostics only — they are
 * NOT merged or hidden automatically, since two different people can share
 * a name/phone (e.g. family members). Only the case of an identical id is
 * removed from the rendered list.
 *
 * TODO(dedup): once a manual-merge UI exists, use the "중복 후보" groups
 * surfaced here (and via the find_duplicate_members command) to let staff
 * merge genuinely duplicated local rows.
 */
export function normalizeMembers(members: MemberListItem[]): MemberListItem[] {
  const seenIds = new Set<number>();
  const seenRemoteIds = new Set<string>();
  const result: MemberListItem[] = [];

  for (const member of members) {
    if (seenIds.has(member.id)) continue;

    const remoteId = (member as { remote_id?: string | null }).remote_id;
    if (remoteId) {
      if (seenRemoteIds.has(remoteId)) continue;
      seenRemoteIds.add(remoteId);
    }

    seenIds.add(member.id);
    result.push(member);
  }

  // Diagnostic-only: detect likely duplicate person records (same center +
  // name + phone but different ids). Does not affect what's rendered.
  const candidateKeys = new Map<string, number[]>();
  for (const member of result) {
    const key = `${member.center}|${member.name}|${member.phone ?? ""}`;
    const ids = candidateKeys.get(key) ?? [];
    ids.push(member.id);
    candidateKeys.set(key, ids);
  }
  for (const [key, ids] of candidateKeys) {
    if (ids.length > 1) {
      console.warn("[normalizeMembers] 중복 후보 (center|name|phone):", key, "ids:", ids);
    }
  }

  return result;
}
