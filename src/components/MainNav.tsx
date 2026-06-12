import {
  CalendarCheck2,
  ClipboardList,
  CreditCard,
  KeyRound,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PermissionSet } from "../types";

export type AppView =
  | "members"
  | "attendance"
  | "memberships"
  | "lockers"
  | "expiring"
  | "roster";

interface MainNavProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  permissions: PermissionSet;
  onOpenSettings: () => void;
}

const VIEW_ITEMS: { id: AppView; label: string; icon: LucideIcon }[] = [
  { id: "members", label: "회원 관리", icon: Users },
  { id: "attendance", label: "출석 체크", icon: CalendarCheck2 },
  { id: "memberships", label: "회원권 관리", icon: CreditCard },
  { id: "lockers", label: "락카 관리", icon: KeyRound },
  { id: "roster", label: "회원 명부", icon: ScrollText },
  { id: "expiring", label: "회원 현황", icon: ClipboardList },
];

export function MainNav({
  activeView,
  onViewChange,
  permissions,
  onOpenSettings,
}: MainNavProps) {
  const visibleViews = VIEW_ITEMS.filter((item) => {
    if (item.id === "lockers") return permissions.canManageLocker;
    if (item.id === "roster") return permissions.canViewRoster;
    if (item.id === "expiring") return permissions.canViewRoster;
    return true;
  });

  return (
    <nav className="glass-panel rounded-[1.5rem] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {visibleViews.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`btn ${activeView === id ? "btn-primary" : "btn-secondary"}`}
              onClick={() => onViewChange(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
          {permissions.canOpenSettings && (
            <button type="button" className="btn btn-secondary" onClick={onOpenSettings}>
              <Settings size={18} />
              설정
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
