/**
 * Health Check verdict logic fixture tests.
 * Run with: npx tsx src/sync/healthCheck.test.ts
 *
 * These tests verify the verdict classification WITHOUT calling Supabase.
 * They simulate the data shapes that healthCheck.ts receives and check the final verdict.
 */

type HealthVerdict = "ok" | "ok_info" | "caution" | "admin_required" | "server_error" | "offline";

interface TestFixture {
  name: string;
  centerDataClean: boolean;
  rawPending: number;
  rawFailed: number;
  hasDataIssue: boolean;
  hasSyncWarning: boolean;
  hasInfoOnly: boolean;
  expectedVerdict: HealthVerdict;
}

function computeVerdict(f: TestFixture): HealthVerdict {
  if (f.hasDataIssue) return "admin_required";
  if (f.hasSyncWarning) return "caution";
  if (f.hasInfoOnly) return "ok_info";
  return "ok";
}

// Additional logic from healthCheck.ts:
// - centerDataClean && rawPending > 0 → hasInfoOnly (not hasSyncWarning)
// - centerDataClean && rawFailed > 0 → hasInfoOnly (not hasDataIssue)
// - !centerDataClean && rawPending > 0 → hasSyncWarning
// - rawFailed > 0 && !centerDataClean → hasDataIssue

function simulateHealthCheck(input: {
  serverMembers: number;
  displayMembers: number;
  noRemoteMembers: number;
  msNoRemote: number;  // operational only (excludes test/hidden/duplicate)
  attNoRemote: number; // operational only (excludes test names)
  rawPending: number;  // operational only (excludes test attendance)
  rawFailed: number;   // operational only (excludes resolved + entity-has-remote-id)
  blocked: number;     // operational only
}): { verdict: HealthVerdict; reasons: string[] } {
  let dataIssue = false;
  let syncWarning = false;
  let hasInfoOnly = false;
  let centerDataClean = true;
  const reasons: string[] = [];

  // Member count checks
  if (input.noRemoteMembers > 0) {
    dataIssue = true;
    centerDataClean = false;
    reasons.push(`remote_id 없는 표시 회원 ${input.noRemoteMembers}명`);
  }

  if (input.serverMembers > 0 && input.displayMembers < input.serverMembers * 0.5) {
    dataIssue = true;
    centerDataClean = false;
    reasons.push(`서버 ${input.serverMembers} vs 화면 ${input.displayMembers}`);
  } else if (input.serverMembers > 0 && Math.abs(input.displayMembers - input.serverMembers) > 2) {
    syncWarning = true;
    centerDataClean = false;
    reasons.push(`회원 수 차이 ${input.displayMembers - input.serverMembers}`);
  } else if (input.serverMembers > 0 && Math.abs(input.displayMembers - input.serverMembers) > 0) {
    hasInfoOnly = true;
    reasons.push(`회원 수 차이 (hidden/필터)`);
  }

  if (input.msNoRemote > 0) {
    syncWarning = true;
    centerDataClean = false;
    reasons.push(`회원권 미연결 ${input.msNoRemote}건`);
  }

  if (input.attNoRemote > 0) {
    syncWarning = true;
    centerDataClean = false;
    reasons.push(`출석 미연결 ${input.attNoRemote}건`);
  }

  if (input.blocked > 0) {
    hasInfoOnly = true;
    reasons.push(`테스트/정리 완료 ${input.blocked}건`);
  }

  // Sync queue with center context
  if (centerDataClean && input.rawPending > 0) {
    hasInfoOnly = true;
    reasons.push(`sync 대기 ${input.rawPending}건 (테스트/정리 — 운영 영향 없음)`);
  } else if (!centerDataClean && input.rawPending > 0) {
    syncWarning = true;
    reasons.push(`서버 미반영 대기 ${input.rawPending}건`);
  }

  if (centerDataClean && input.rawFailed > 0) {
    hasInfoOnly = true;
    reasons.push(`sync 실패 ${input.rawFailed}건 (테스트/차단 — 운영 영향 없음)`);
  } else if (input.rawFailed > 0) {
    dataIssue = true;
    reasons.push(`동기화 실패 ${input.rawFailed}건`);
  }

  // Final verdict
  if (dataIssue) return { verdict: "admin_required", reasons };
  if (syncWarning) return { verdict: "caution", reasons };
  if (hasInfoOnly) return { verdict: "ok_info", reasons };
  return { verdict: "ok", reasons };
}

// ─── Test cases ───

const tests: Array<{ name: string; input: Parameters<typeof simulateHealthCheck>[0]; expected: HealthVerdict }> = [
  {
    name: "GRABIT 현재 상태: BLOCK_TEST_DATA + ALREADY_RESOLVED만",
    input: { serverMembers: 48, displayMembers: 48, noRemoteMembers: 0, msNoRemote: 0, attNoRemote: 0, rawPending: 0, rawFailed: 0, blocked: 4 },
    expected: "ok_info",
  },
  {
    name: "완벽한 상태: 아무 잔여 항목 없음",
    input: { serverMembers: 48, displayMembers: 48, noRemoteMembers: 0, msNoRemote: 0, attNoRemote: 0, rawPending: 0, rawFailed: 0, blocked: 0 },
    expected: "ok",
  },
  {
    name: "SAFE_UPLOAD_CANDIDATE 회원권 있음",
    input: { serverMembers: 48, displayMembers: 48, noRemoteMembers: 0, msNoRemote: 3, attNoRemote: 0, rawPending: 0, rawFailed: 0, blocked: 0 },
    expected: "caution",
  },
  {
    name: "ATTENDANCE_UPLOAD_CANDIDATE 있음",
    input: { serverMembers: 48, displayMembers: 48, noRemoteMembers: 0, msNoRemote: 0, attNoRemote: 2, rawPending: 0, rawFailed: 0, blocked: 0 },
    expected: "caution",
  },
  {
    name: "failed 있음",
    input: { serverMembers: 48, displayMembers: 48, noRemoteMembers: 0, msNoRemote: 0, attNoRemote: 0, rawPending: 0, rawFailed: 2, blocked: 0 },
    expected: "ok_info",  // centerDataClean=true, so failed becomes info
  },
  {
    name: "failed 있음 + 데이터 불일치",
    input: { serverMembers: 48, displayMembers: 48, noRemoteMembers: 1, msNoRemote: 0, attNoRemote: 0, rawPending: 0, rawFailed: 2, blocked: 0 },
    expected: "admin_required",
  },
  {
    name: "remote_id 없는 표시 회원 있음",
    input: { serverMembers: 48, displayMembers: 48, noRemoteMembers: 1, msNoRemote: 0, attNoRemote: 0, rawPending: 0, rawFailed: 0, blocked: 0 },
    expected: "admin_required",
  },
  {
    name: "서버 >> 화면 (pull 필요)",
    input: { serverMembers: 1730, displayMembers: 40, noRemoteMembers: 0, msNoRemote: 0, attNoRemote: 0, rawPending: 0, rawFailed: 0, blocked: 0 },
    expected: "admin_required",
  },
  {
    name: "회원 수 차이 작음 (hidden 차이)",
    input: { serverMembers: 48, displayMembers: 47, noRemoteMembers: 0, msNoRemote: 0, attNoRemote: 0, rawPending: 0, rawFailed: 0, blocked: 0 },
    expected: "ok_info",
  },
  {
    name: "centerDataClean + rawPending (테스트 잔여)",
    input: { serverMembers: 48, displayMembers: 48, noRemoteMembers: 0, msNoRemote: 0, attNoRemote: 0, rawPending: 4, rawFailed: 0, blocked: 0 },
    expected: "ok_info",
  },
];

// ─── Run tests ───

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = simulateHealthCheck(t.input);
  const ok = result.verdict === t.expected;
  if (ok) {
    passed++;
    console.log(`  PASS: ${t.name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${t.name} — expected ${t.expected}, got ${result.verdict} (${result.reasons.join(", ")})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);
if (failed > 0) throw new Error(`${failed} tests failed`);
