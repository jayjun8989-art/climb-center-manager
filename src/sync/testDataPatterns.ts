export const TEST_DATA_NAMES = new Set(["ddd", "dddd", "dfdfd", "주니어", "주니어 1", "온클", "목요일"]);
export const TEST_DATA_PHONES = new Set(["ddd", "ddff", "ㅎㅎㅎㅎ", "ㅈㅈㅈ", "939ㅇ"]);

export function isTestDataMember(name: string, phone: string | null | undefined): boolean {
  return (
    TEST_DATA_NAMES.has(name.trim()) ||
    TEST_DATA_PHONES.has((phone ?? "").trim())
  );
}
