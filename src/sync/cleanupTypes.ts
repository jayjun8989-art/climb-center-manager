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
  localDupMembersToHide: TestMemberToHide[];
  localDupMemberships: number;
  blockTestData: number;
  manualReview: number;
}

export interface CleanupResult {
  memberQueueResolved: number;
  attendanceQueueResolved: number;
  testMembersHidden: number;
  localDupMembersHidden: number;
  localDupMembershipsBackfilled: number;
  errors: string[];
}
