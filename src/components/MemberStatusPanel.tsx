import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Center, MemberListItem, PermissionSet, UserCenterRoleRow } from "../types";
import { CENTER_LABELS, formatLatestMembershipTypeLabel, normalizeMemberType } from "../utils/member";
import { hasUnifiedCenterAccess } from "../lib/permissions";
import {
  countByCategory,
  hasNoMembership,
  isDepletionSoon,
  isPausedMember,
  matchesCenterFilter,
  matchesMemberTypeFilter,
  matchesSearch,
  memberInCategory,
  sortMembersForCategory,
} from "../lib/memberStatus/classify";
import {
  DEFAULT_EXPIRED_DAYS,
  DEFAULT_EXPIRING_DAYS,
  EXPIRED_DAY_OPTIONS,
  EXPIRING_DAY_OPTIONS,
  expiredDayLabel,
  expiringDayLabel,
  MEMBER_STATUS_CATEGORY_LABELS,
  type ExpiredDayOption,
  type ExpiringDayOption,
  type MemberStatusCategory,
  type MemberStatusMemberTypeFilter,
} from "../lib/memberStatus/constants";
import { fetchMembersForCenters } from "../lib/memberStatus/fetchMembers";

interface MemberStatusPanelProps {
  permissions: PermissionSet;
  roles: UserCenterRoleRow[];
  accessibleCenters: Center[];
}

type CenterFilter = Center | "all";

const DASH = "-";

function memberTypeLabel(member: MemberListItem): string {
  const kind = normalizeMemberType(member.member_type, member.membership_type);
  if (kind === "junior") return "주니어";
  if (kind === "trial") return "체험";
  return "일반";
}

function membershipTypeLabel(member: MemberListItem): string {
  if (hasNoMembership(member)) return DASH;
  return formatLatestMembershipTypeLabel(member.membership_type ?? member.latest_membership_type);
}

function StatusBadges({
  member,
  category,
}: {
  member: MemberListItem;
  category: MemberStatusCategory;
}) {
  const badges: { label: string; className: string }[] = [];

  if (hasNoMembership(member) && category === "expired") {
    badges.push({ label: "회원권 없음", className: "badge badge-danger" });
    return (
      <div className="flex flex-wrap gap-1">
        {badges.map((badge) => (
          <span key={badge.label} className={badge.className}>
            {badge.label}
          </span>
        ))}
      </div>
    );
  }

  if (isPausedMember(member)) {
    badges.push({ label: "휴면", className: "badge badge-warning" });
  } else if (isDepletionSoon(member)) {
    badges.push({ label: "소진 임박", className: "badge badge-warning" });
  } else if (category === "expiring") {
    badges.push({ label: "만료 예정", className: "badge badge-warning" });
  } else if (category === "expired") {
    badges.push({
      label: member.display_status.includes("소진") ? "소진" : "만료",
      className: "badge badge-danger",
    });
  } else {
    badges.push({ label: "정상 이용", className: "badge badge-success" });
  }

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span key={badge.label} className={badge.className}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

export function MemberStatusPanel({
  permissions,
  roles,
  accessibleCenters,
}: MemberStatusPanelProps) {
  const unifiedAccess = hasUnifiedCenterAccess(roles);
  const showAllCenterFilter = unifiedAccess || accessibleCenters.length > 1;

  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<MemberStatusCategory>("active");
  const [centerFilter, setCenterFilter] = useState<CenterFilter>(
    showAllCenterFilter ? "all" : accessibleCenters[0] ?? "ONCLE",
  );
  const [memberTypeFilter, setMemberTypeFilter] = useState<MemberStatusMemberTypeFilter>("all");
  const [expiringDays, setExpiringDays] = useState<ExpiringDayOption>(DEFAULT_EXPIRING_DAYS);
  const [expiredDays, setExpiredDays] = useState<ExpiredDayOption>(DEFAULT_EXPIRED_DAYS);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (centerFilter !== "all" && !accessibleCenters.includes(centerFilter)) {
      setCenterFilter(showAllCenterFilter ? "all" : accessibleCenters[0] ?? "ONCLE");
    }
  }, [accessibleCenters, centerFilter, showAllCenterFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMembersForCenters(accessibleCenters);
      setMembers(data);
    } finally {
      setLoading(false);
    }
  }, [accessibleCenters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onPullComplete = () => {
      void refresh();
    };
    window.addEventListener("climb-sync-pull-complete", onPullComplete);
    return () => window.removeEventListener("climb-sync-pull-complete", onPullComplete);
  }, [refresh]);

  const scopedMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          matchesCenterFilter(member, centerFilter, accessibleCenters) &&
          matchesMemberTypeFilter(member, memberTypeFilter) &&
          matchesSearch(member, search),
      ),
    [members, centerFilter, accessibleCenters, memberTypeFilter, search],
  );

  const summary = useMemo(
    () =>
      countByCategory(scopedMembers, {
        expiringDays,
        expiredDays,
      }),
    [scopedMembers, expiringDays, expiredDays],
  );

  const visibleMembers = useMemo(() => {
    const filtered = scopedMembers.filter((member) =>
      memberInCategory(member, category, { expiringDays, expiredDays }),
    );
    return sortMembersForCategory(filtered, category);
  }, [scopedMembers, category, expiringDays, expiredDays]);

  const categories: MemberStatusCategory[] = ["active", "expiring", "expired", "paused"];

  return (
    <section className="glass-panel rounded-[1.5rem] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">회원 현황</h2>
        <button className="btn btn-secondary" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {categories.map((key) => (
          <button
            key={key}
            type="button"
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              category === key
                ? "border-sky-500/60 bg-sky-500/10"
                : "border-[var(--border)] bg-[var(--panel-strong)] hover:border-sky-500/30"
            }`}
            onClick={() => setCategory(key)}
          >
            <p className="text-xs text-[var(--muted)]">{MEMBER_STATUS_CATEGORY_LABELS[key]}</p>
            <p className="mt-1 text-2xl font-bold">{summary[key]}</p>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {categories.map((key) => (
          <button
            key={key}
            type="button"
            className={`btn ${category === key ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setCategory(key)}
          >
            {MEMBER_STATUS_CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>

      {category === "expiring" && (
        <div className="mb-4 flex flex-wrap gap-2">
          {EXPIRING_DAY_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              className={`btn btn-sm ${expiringDays === days ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setExpiringDays(days)}
            >
              {expiringDayLabel(days)}
            </button>
          ))}
        </div>
      )}

      {category === "expired" && (
        <div className="mb-4 flex flex-wrap gap-2">
          {EXPIRED_DAY_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              className={`btn btn-sm ${expiredDays === days ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setExpiredDays(days)}
            >
              {expiredDayLabel(days)}
            </button>
          ))}
          <button
            type="button"
            className={`btn btn-sm ${expiredDays === "all" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setExpiredDays("all")}
          >
            {expiredDayLabel("all")}
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {showAllCenterFilter && (
          <>
            <button
              type="button"
              className={`btn btn-sm ${centerFilter === "all" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCenterFilter("all")}
            >
              전체
            </button>
            {accessibleCenters.includes("ONCLE") && (
              <button
                type="button"
                className={`btn btn-sm ${centerFilter === "ONCLE" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setCenterFilter("ONCLE")}
              >
                ONCLE
              </button>
            )}
            {accessibleCenters.includes("GRABIT") && (
              <button
                type="button"
                className={`btn btn-sm ${centerFilter === "GRABIT" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setCenterFilter("GRABIT")}
              >
                GRABIT
              </button>
            )}
          </>
        )}

        {(["all", "regular", "junior"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`btn btn-sm ${memberTypeFilter === value ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setMemberTypeFilter(value)}
          >
            {value === "all" ? "전체" : value === "regular" ? "일반" : "주니어"}
          </button>
        ))}

        <label className="relative ml-auto min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            className="input w-full pl-9"
            placeholder="이름 · 전화 · 메모"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <p className="mb-3 text-sm text-[var(--muted)]">
        {MEMBER_STATUS_CATEGORY_LABELS[category]} {visibleMembers.length}명
        {!permissions.enforced && " · 전체 회원 표시중"}
      </p>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--panel-strong)] text-left text-xs text-[var(--muted)]">
            <tr>
              {category === "paused" ? (
                <>
                  <th className="px-3 py-2">이름</th>
                  <th className="px-3 py-2">센터</th>
                  <th className="px-3 py-2">구분</th>
                  <th className="px-3 py-2">회원권</th>
                  <th className="px-3 py-2">정지 시작</th>
                  <th className="px-3 py-2">복귀 예정</th>
                  <th className="px-3 py-2">잔여 일수</th>
                  <th className="px-3 py-2">연락처</th>
                  <th className="px-3 py-2">상태</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2">이름</th>
                  <th className="px-3 py-2">센터</th>
                  <th className="px-3 py-2">구분</th>
                  <th className="px-3 py-2">회원권</th>
                  <th className="px-3 py-2">만료일</th>
                  <th className="px-3 py-2">잔여 기간</th>
                  <th className="px-3 py-2">잔여횟수</th>
                  <th className="px-3 py-2">연락처</th>
                  <th className="px-3 py-2">상태</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[var(--muted)]">
                  불러오는 중...
                </td>
              </tr>
            ) : visibleMembers.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[var(--muted)]">
                  표시할 회원이 없습니다.
                </td>
              </tr>
            ) : (
              visibleMembers.map((member) => {
                const noMembership = hasNoMembership(member);
                return (
                  <tr key={member.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-semibold">{member.name}</td>
                    <td className="px-3 py-2">{CENTER_LABELS[member.center]}</td>
                    <td className="px-3 py-2">{memberTypeLabel(member)}</td>
                    <td className="px-3 py-2">{membershipTypeLabel(member)}</td>
                    {category === "paused" ? (
                      <>
                        <td className="px-3 py-2">{member.pause_start_date ?? DASH}</td>
                        <td className="px-3 py-2">{DASH}</td>
                        <td className="px-3 py-2">
                          {member.pause_remaining_days != null
                            ? `${member.pause_remaining_days}일`
                            : DASH}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2">{noMembership ? DASH : member.end_date ?? DASH}</td>
                        <td className="px-3 py-2">
                          {noMembership ? DASH : member.remaining_text}
                        </td>
                        <td className="px-3 py-2">
                          {noMembership
                            ? DASH
                            : member.pass_type === "count" || member.remaining_count != null
                              ? `${member.remaining_count ?? 0}회`
                              : DASH}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2">{member.phone ?? DASH}</td>
                    <td className="px-3 py-2">
                      <StatusBadges member={member} category={category} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
