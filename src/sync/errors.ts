import type { Center } from "../types";
import type { AuthError, PostgrestError } from "@supabase/supabase-js";
import {
  formatAccessDeniedMessage,
  isAccessDeniedMessage,
  requiredRoleForMemberWrite,
  type SyncErrorContext,
} from "./permissionContext";

export function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}

function isAuthError(error: unknown): error is AuthError {
  return typeof error === "object" && error !== null && "status" in error && "message" in error;
}

export function formatSyncError(
  error: unknown,
  ctx?: SyncErrorContext,
  center?: Center | null,
): string {
  if (isPostgrestError(error)) {
    const message = error.message.toLowerCase();
    const details = (error.details ?? "").toLowerCase();
    const combined = `${message} ${details}`;

    if (error.code === "42501" || combined.includes("row-level security")) {
      if (ctx) {
        return formatAccessDeniedMessage(ctx, center ?? null, requiredRoleForMemberWrite());
      }
      return "센터 접근 권한이 없습니다. 관리자에게 권한 부여를 요청하세요.";
    }
    if (error.code === "23505" || combined.includes("idx_members_center_phone")) {
      return "같은 센터에 동일한 전화번호 회원이 이미 있습니다.";
    }
    if (error.code === "23503") {
      return "센터 정보가 올바르지 않습니다. 관리자에게 문의하세요.";
    }
    if (error.code === "PGRST116") {
      return "대상 회원을 찾을 수 없습니다.";
    }
    return error.message || "서버 요청에 실패했습니다.";
  }

  if (isAuthError(error)) {
    if (error.status === 401 || error.message.toLowerCase().includes("jwt")) {
      return "로그인이 만료되었습니다. 다시 로그인하세요.";
    }
    return error.message || "인증 오류입니다.";
  }

  if (error instanceof Error) {
    const message = error.message;
    if (isAccessDeniedMessage(message)) {
      if (ctx) {
        return formatAccessDeniedMessage(ctx, center ?? null, requiredRoleForMemberWrite());
      }
      return "센터 접근 권한이 없습니다. 관리자에게 권한 부여를 요청하세요.";
    }
    if (message.toLowerCase().includes("fetch") || message.toLowerCase().includes("network")) {
      return "네트워크 연결을 확인하세요.";
    }
    return message;
  }

  return String(error);
}
