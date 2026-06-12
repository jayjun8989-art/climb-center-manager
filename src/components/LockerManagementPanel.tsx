import { KeyRound, Search } from "lucide-react";
import type { LockerFilter, LockerListItem } from "../types";

interface LockerManagementPanelProps {
  lockers: LockerListItem[];
  loading: boolean;
  filter: LockerFilter;
  onFilterChange: (filter: LockerFilter) => void;
  search: string;
  onSearch: (value: string) => void;
  onLockerClick: (memberId: number) => void;
}

const FILTER_LABELS: Record<LockerFilter, string> = {
  all: "전체",
  occupied: "사용중",
  empty: "비어있음",
  expiring: "만료 예정",
};

const STATUS_LABELS: Record<string, string> = {
  empty: "비어있음",
  active: "사용중",
  occupied: "사용중",
  expiring: "만료 예정",
  expired: "만료됨",
};

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "empty":
      return "badge badge-muted";
    case "active":
    case "occupied":
      return "badge badge-active";
    case "expiring":
      return "badge badge-warning";
    case "expired":
      return "badge badge-danger";
    default:
      return "badge badge-muted";
  }
}

function getStatusAccentClass(status: string): string {
  switch (status) {
    case "empty":
      return "border-l-4 border-l-transparent";
    case "active":
    case "occupied":
      return "border-l-4 border-l-emerald-500/60";
    case "expiring":
      return "border-l-4 border-l-amber-500/60";
    case "expired":
      return "border-l-4 border-l-rose-500/60";
    default:
      return "border-l-4 border-l-transparent";
  }
}

function formatLockerDate(value: string | null): string {
  if (!value) return "-";
  return value.slice(0, 10);
}

export function LockerManagementPanel({
  lockers,
  loading,
  filter,
  onFilterChange,
  search,
  onSearch,
  onLockerClick,
}: LockerManagementPanelProps) {
  const filteredLockers = lockers.filter((locker) => {
    const status = locker.locker_status;
    if (filter === "empty" && status !== "empty") return false;
    if (
      filter === "occupied" &&
      status !== "active" &&
      status !== "occupied"
    ) {
      return false;
    }
    if (filter === "expiring" && status !== "expiring") return false;
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      const number = locker.locker_number.toLowerCase();
      const name = (locker.member_name ?? "").toLowerCase();
      if (!number.includes(query) && !name.includes(query)) return false;
    }
    return true;
  });

  const totalCount = lockers.length;
  const occupiedCount = lockers.filter(
    (locker) => locker.locker_status === "active" || locker.locker_status === "occupied",
  ).length;
  const emptyCount = lockers.filter((locker) => locker.locker_status === "empty").length;
  const expiringCount = lockers.filter((locker) => locker.locker_status === "expiring").length;

  const SUMMARY_CARDS: { key: LockerFilter; label: string; count: number }[] = [
    { key: "all", label: "전체 락카", count: totalCount },
    { key: "occupied", label: "사용중", count: occupiedCount },
    { key: "empty", label: "비어있음", count: emptyCount },
    { key: "expiring", label: "만료 예정", count: expiringCount },
  ];

  return (
    <section className="glass-panel flex min-h-[520px] flex-col rounded-[1.5rem] p-5">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <KeyRound size={20} className="text-sky-500" />
          <div>
            <h2 className="text-lg font-bold">락카 관리</h2>
            <p className="text-sm text-[var(--muted)]">락카 번호 검색 · 상태별 필터</p>
          </div>
        </div>
        <span className="badge badge-muted">{filteredLockers.length}건</span>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              filter === card.key
                ? "border-sky-500/60 bg-sky-500/10"
                : "border-[var(--border)] bg-[var(--panel-strong)] hover:border-sky-500/30"
            }`}
            onClick={() => onFilterChange(card.key)}
          >
            <p className="text-xs text-[var(--muted)]">{card.label}</p>
            <p className="mt-1 text-2xl font-bold">{card.count}</p>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as LockerFilter[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`btn ${filter === item ? "btn-primary" : "btn-secondary"}`}
            onClick={() => onFilterChange(item)}
          >
            {FILTER_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          className="input pl-11"
          placeholder="락카 번호 또는 회원명 검색..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      <div className="mb-3 grid grid-cols-[0.8fr_0.8fr_1fr_1fr_1fr] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        <span>락카 번호</span>
        <span>상태</span>
        <span>회원</span>
        <span>시작일</span>
        <span>만료일</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[var(--border)]">
        {loading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
            불러오는 중...
          </div>
        ) : filteredLockers.length === 0 ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
            표시할 락카가 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filteredLockers.map((locker) => (
              <button
                key={locker.id}
                type="button"
                className={`grid w-full grid-cols-[0.8fr_0.8fr_1fr_1fr_1fr] items-center gap-3 bg-[var(--panel-strong)] px-3 py-4 text-left transition hover:bg-[var(--brand-soft)]/50 ${getStatusAccentClass(locker.locker_status)}`}
                onClick={() => onLockerClick(locker.id)}
              >
                <p className="font-semibold">{locker.locker_number}</p>
                <span className={getStatusBadgeClass(locker.locker_status)}>
                  {STATUS_LABELS[locker.locker_status] ?? locker.locker_status}
                </span>
                <p className="text-sm">{locker.member_name ?? "-"}</p>
                <p className="text-sm text-[var(--muted)]">
                  {formatLockerDate(locker.locker_start_date)}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {formatLockerDate(locker.locker_end_date)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
