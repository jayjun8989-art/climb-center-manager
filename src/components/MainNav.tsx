import {
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PermissionSet } from "../types";

export type AppView =
  | "dashboard"
  | "members"
  | "roster";

interface MainNavProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  permissions: PermissionSet;
  onOpenSettings: () => void;
}

const VIEW_ITEMS: { id: AppView; label: string; icon: LucideIcon }[] = [
  { id: "dashboard",  label: "대시보드",  icon: LayoutDashboard },
  { id: "members",    label: "회원 관리", icon: Users },
  { id: "roster",     label: "명단·현황", icon: ScrollText },
];

export function MainNav({
  activeView,
  onViewChange,
  permissions,
  onOpenSettings,
}: MainNavProps) {
  return (
    <nav className="glass-panel rounded-[1.5rem] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {VIEW_ITEMS.map(({ id, label, icon: Icon }) => (
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
