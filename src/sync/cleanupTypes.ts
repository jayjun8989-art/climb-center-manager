export interface TestMemberToHide {
  id: number;
  name: string;
  phone: string | null;
}

export interface CleanupDryRun {
  generatedAt: string;
  resolvableMemberQueue: number;
  resolvableAttendanceQueue: number;
  testMembersToHide: TestMemberToHide[];
  blockTestData: number;
  manualReview: number;
}

export interface CleanupResult {
  memberQueueResolved: number;
  attendanceQueueResolved: number;
  testMembersHidden: number;
  errors: string[];
}
