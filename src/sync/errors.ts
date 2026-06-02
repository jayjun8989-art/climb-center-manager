import type { AuthError, PostgrestError } from "@supabase/supabase-js";

function isPostgrestError(error: unknown): error is PostgrestError {
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

export function formatSyncError(error: unknown): string {
  if (isPostgrestError(error)) {
    const message = error.message.toLowerCase();
    const details = (error.details ?? "").toLowerCase();
    const combined = `${message} ${details}`;

    if (error.code === "42501" || combined.includes("row-level security")) {
      return "?? ?? ??? ????. Supabase user_center_roles ??? ?????.";
    }
    if (error.code === "23505" || combined.includes("idx_members_center_phone")) {
      return "?? ??? ??? ???? ??? ?? ????.";
    }
    if (error.code === "23503") {
      return "??? ?? ?? ?? ???? ????.";
    }
    if (error.code === "PGRST116") {
      return "?? ??? ?? ? ????.";
    }
    return error.message || "Supabase ??? ??????.";
  }

  if (isAuthError(error)) {
    if (error.status === 401 || error.message.toLowerCase().includes("jwt")) {
      return "???? ???????. ?? ???????.";
    }
    return error.message || "??? ??????.";
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("access denied") || message.includes("??")) {
      return "?? ?? ??? ????. Supabase user_center_roles ??? ?????.";
    }
    if (message.includes("fetch") || message.includes("network")) {
      return "???? ??? ??????.";
    }
    return error.message;
  }

  return String(error);
}
