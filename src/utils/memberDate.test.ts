/**
 * Tests for calcMonthlyEndDateSafe.
 * Run with: npx tsx src/utils/memberDate.test.ts
 */

import { calcMonthlyEndDateSafe } from "./member";

let passed = 0;
let failed = 0;

function expect(label: string, result: string, expected: string) {
  if (result === expected) {
    console.log(`  ✅ ${label}: ${result}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}: got ${result}, expected ${expected}`);
    failed++;
  }
}

console.log("\n=== calcMonthlyEndDateSafe ===\n");

// ── 1개월권 ─────────────────────────────────────────────────────────────────
console.log("[ 1개월 ]");
// Normal: same day exists in target month
expect("2026-08-10 +1", calcMonthlyEndDateSafe("2026-08-10", 1), "2026-09-09");
expect("2026-01-15 +1", calcMonthlyEndDateSafe("2026-01-15", 1), "2026-02-14");
// Start on day 1 → end = last day of current month
expect("2026-08-01 +1", calcMonthlyEndDateSafe("2026-08-01", 1), "2026-08-31");
expect("2026-02-01 +1", calcMonthlyEndDateSafe("2026-02-01", 1), "2026-02-28");
// Aug 31 → Sep has 30 days, 31 doesn't exist → Sep 30
expect("2026-08-31 +1", calcMonthlyEndDateSafe("2026-08-31", 1), "2026-09-30");
// Jan 31 → Feb has 28 days (2026), 31 doesn't exist → Feb 28
expect("2026-01-31 +1", calcMonthlyEndDateSafe("2026-01-31", 1), "2026-02-28");
// Jan 31 → Feb 29 in leap year 2028
expect("2028-01-31 +1", calcMonthlyEndDateSafe("2028-01-31", 1), "2028-02-29");
// Mar 31 → Apr 30 (Apr has 30 days)
expect("2026-03-31 +1", calcMonthlyEndDateSafe("2026-03-31", 1), "2026-04-30");
// Dec 31 → Jan 30 of next year (Jan 31 exists → Jan 30)
expect("2026-12-31 +1", calcMonthlyEndDateSafe("2026-12-31", 1), "2027-01-30");
// Sep 30 → Oct has 31, day 30 exists → Oct 29
expect("2026-09-30 +1", calcMonthlyEndDateSafe("2026-09-30", 1), "2026-10-29");

// ── 3개월권 ─────────────────────────────────────────────────────────────────
console.log("\n[ 3개월 ]");
expect("2026-08-10 +3", calcMonthlyEndDateSafe("2026-08-10", 3), "2026-11-09");
expect("2026-08-31 +3", calcMonthlyEndDateSafe("2026-08-31", 3), "2026-11-30");
expect("2026-01-31 +3", calcMonthlyEndDateSafe("2026-01-31", 3), "2026-04-30");
expect("2026-11-30 +3", calcMonthlyEndDateSafe("2026-11-30", 3), "2027-02-28");
// Dec → cross year
expect("2025-12-01 +3", calcMonthlyEndDateSafe("2025-12-01", 3), "2026-02-28");

// ── 6개월권 ─────────────────────────────────────────────────────────────────
console.log("\n[ 6개월 ]");
expect("2026-08-10 +6", calcMonthlyEndDateSafe("2026-08-10", 6), "2027-02-09");
expect("2026-08-31 +6", calcMonthlyEndDateSafe("2026-08-31", 6), "2027-02-28");
// Leap year: 2027-08-31 + 6 → Feb 2028 (leap) → Feb 29
expect("2027-08-31 +6", calcMonthlyEndDateSafe("2027-08-31", 6), "2028-02-29");
expect("2026-03-01 +6", calcMonthlyEndDateSafe("2026-03-01", 6), "2026-08-31");
// Sep 30 + 6 → Mar 30 exists → Mar 29
expect("2026-09-30 +6", calcMonthlyEndDateSafe("2026-09-30", 6), "2027-03-29");

// ── 요약 ─────────────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed}개 통과, ${failed}개 실패\n`);

if (failed > 0) {
  throw new Error(`${failed}개 테스트 실패`);
}
