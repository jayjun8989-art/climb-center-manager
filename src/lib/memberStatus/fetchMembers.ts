import { api } from "../../api/client";
import { invokeCommand, isTauriApp } from "../../lib/tauri";
import type { Center, MemberListItem } from "../../types";

export async function fetchMembersForCenters(centers: Center[]): Promise<MemberListItem[]> {
  if (centers.length === 0) return [];

  if (isTauriApp()) {
    try {
      await invokeCommand<void>("ensure_local_db_ready");
    } catch (error) {
      console.error("[memberStatus] ensure_local_db_ready failed", error);
    }
  }

  const pages = await Promise.all(
    centers.map((center) =>
      api.getMembers({
        center,
        search: "",
        memberGroup: "all",
        statusFilter: "all",
        page: 1,
        pageSize: 5000,
      }),
    ),
  );

  const merged = pages.flatMap((page) => page.members);
  const seen = new Set<number>();
  return merged.filter((member) => {
    if (seen.has(member.id)) return false;
    seen.add(member.id);
    return true;
  });
}
