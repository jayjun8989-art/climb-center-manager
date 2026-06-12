import type { Center, CenterRole, StaffRoleAssignment, UserCenterRoleRow } from "../../types";
import { centerCodeFromId } from "./centers";
import { getSupabaseClient } from "./client";
import { isSupabaseConfigured } from "./config";

type RoleRow = {
  id: string;
  user_id: string;
  center_id: string;
  role: CenterRole;
  created_at: string;
  centers: { code: Center; name: string } | null;
};

function mapRoleRow(row: RoleRow): UserCenterRoleRow {
  const center = row.centers?.code ?? centerCodeFromId(row.center_id);
  if (!center) {
    throw new Error(`알 수 없는 센터 ID: ${row.center_id}`);
  }
  return {
    id: row.id,
    userId: row.user_id,
    centerId: row.center_id,
    center,
    centerName: row.centers?.name ?? center,
    role: row.role,
    createdAt: row.created_at,
  };
}

export async function fetchMyCenterRoles(userId: string): Promise<UserCenterRoleRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("user_center_roles")
    .select("id, user_id, center_id, role, created_at, centers(code, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => {
    const record = row as {
      id: string;
      user_id: string;
      center_id: string;
      role: CenterRole;
      created_at: string;
      centers: { code: Center; name: string } | { code: Center; name: string }[] | null;
    };
    const centerInfo = Array.isArray(record.centers) ? record.centers[0] : record.centers;
    return mapRoleRow({
      ...record,
      centers: centerInfo,
    });
  });
}

export async function lookupUserByEmail(
  email: string,
): Promise<{ userId: string; displayName: string; email: string } | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("rpc_find_user_by_email", {
    p_email: email.trim(),
  });

  if (error) throw new Error(error.message);
  const row = (data as Array<{ user_id: string; display_name: string; email: string }> | null)?.[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
  };
}

export async function listStaffRoles(): Promise<StaffRoleAssignment[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("rpc_list_center_roles");
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<{
    user_id: string;
    user_email: string | null;
    center_id: string;
    center_code: Center;
    center_name: string;
    role: CenterRole;
    created_at: string;
  }>).map((row) => ({
    id: `${row.user_id}:${row.center_id}`,
    userId: row.user_id,
    centerId: row.center_id,
    center: row.center_code,
    centerName: row.center_name,
    role: row.role,
    email: row.user_email ?? "",
    createdAt: row.created_at,
  }));
}

export async function assignCenterRole(
  userId: string,
  center: Center,
  role: CenterRole,
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("서버 연결을 확인해주세요.");

  let { error } = await supabase.rpc("rpc_grant_center_role", {
    p_user_id: userId,
    p_center_code: center,
    p_role: role,
  });
  if (error) {
    ({ error } = await supabase.rpc("rpc_assign_center_role", {
      p_user_id: userId,
      p_center_code: center,
      p_role: role,
    }));
  }

  if (error) throw new Error(error.message);
}

export async function removeCenterRole(userId: string, center: Center): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("서버 연결을 확인해주세요.");

  let { error } = await supabase.rpc("rpc_revoke_center_role", {
    p_user_id: userId,
    p_center_code: center,
  });
  if (error) {
    ({ error } = await supabase.rpc("rpc_remove_center_role_by_user_center", {
      p_user_id: userId,
      p_center_code: center,
    }));
  }

  if (error) throw new Error(error.message);
}
