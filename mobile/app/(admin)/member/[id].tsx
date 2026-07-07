import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { getSupabase } from "../../../src/lib/supabase";
import {
  statusCategory, updateMember, updateMembership, createMembership,
  pauseMembership, resumeMembership, deleteMember,
} from "../../../src/lib/admin";
import type { RosterRow } from "../../../src/types";

const MEMBER_TYPES = [
  { value: "general", label: "일반" },
  { value: "junior", label: "주니어" },
  { value: "trial", label: "체험" },
];

const MEMBERSHIP_TYPES = [
  { value: "30days", label: "1개월", passType: "period" },
  { value: "90days", label: "3개월", passType: "period" },
  { value: "180days", label: "6개월", passType: "period" },
  { value: "count", label: "회수권", passType: "count" },
  { value: "junior", label: "주니어", passType: "count" },
  { value: "trial", label: "체험", passType: "period" },
];

export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [row, setRow] = useState<RosterRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"info" | "membership">("info");

  // 기본 정보
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [memo, setMemo] = useState("");
  const [memberType, setMemberType] = useState("general");

  // 회원권
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [totalCount, setTotalCount] = useState("");
  const [remainingCount, setRemainingCount] = useState("");

  // 신규 회원권 추가
  const [newMembershipType, setNewMembershipType] = useState("30days");
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [newEndDate, setNewEndDate] = useState("");
  const [newTotalCount, setNewTotalCount] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("member_roster_view").select("*").eq("member_id", id).maybeSingle();
      if (error) throw new Error(error.message);
      const r = data as RosterRow | null;
      setRow(r);
      if (r) {
        setName(r.member_name);
        setPhone(r.phone ?? "");
        setMemo(r.memo ?? "");
        setMemberType(r.member_type);
        setStartDate(r.start_date?.slice(0, 10) ?? "");
        setEndDate(r.end_date?.slice(0, 10) ?? "");
        setTotalCount(r.total_sessions != null ? String(r.total_sessions) : "");
        setRemainingCount(r.remaining_sessions != null ? String(r.remaining_sessions) : "");
      }
    } catch (e) {
      Alert.alert("오류", e instanceof Error ? e.message : "회원 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function saveInfo() {
    if (!row) return;
    setSaving(true);
    try {
      const memberPatch: Record<string, unknown> = {};
      if (name !== row.member_name) memberPatch.name = name;
      if (phone !== (row.phone ?? "")) memberPatch.phone = phone || null;
      if (memo !== (row.memo ?? "")) memberPatch.memo = memo || null;
      if (memberType !== row.member_type) memberPatch.member_type = memberType;
      if (Object.keys(memberPatch).length > 0) await updateMember(row.member_id, memberPatch);

      if (row.membership_id) {
        const membershipPatch: Record<string, unknown> = {};
        const newStart = startDate || null;
        const newEnd = endDate || null;
        if (newStart !== (row.start_date?.slice(0, 10) ?? null)) membershipPatch.start_date = newStart;
        if (newEnd !== (row.end_date?.slice(0, 10) ?? null)) membershipPatch.end_date = newEnd;
        const newTotal = totalCount === "" ? null : Number(totalCount);
        const newRemaining = remainingCount === "" ? null : Number(remainingCount);
        if (newTotal !== row.total_sessions) membershipPatch.total_count = newTotal;
        if (newRemaining !== row.remaining_sessions) membershipPatch.remaining_count = newRemaining;
        if (Object.keys(membershipPatch).length > 0) await updateMembership(row.membership_id, membershipPatch);
      }
      Alert.alert("완료", "저장되었습니다.");
      await load();
    } catch (e) {
      Alert.alert("저장 실패", e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMembership() {
    if (!row) return;
    const mt = MEMBERSHIP_TYPES.find((m) => m.value === newMembershipType);
    if (!mt) return;
    const isCount = mt.passType === "count";
    if (!newStartDate) { Alert.alert("입력 오류", "시작일을 입력해주세요."); return; }
    if (!isCount && !newEndDate) { Alert.alert("입력 오류", "종료일을 입력해주세요."); return; }
    if (isCount && !newTotalCount) { Alert.alert("입력 오류", "총 횟수를 입력해주세요."); return; }

    Alert.alert("회원권 등록", `${mt.label} 회원권을 등록하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      {
        text: "등록", onPress: async () => {
          setSaving(true);
          try {
            const total = isCount ? Number(newTotalCount) : null;
            await createMembership({
              memberId: row.member_id,
              membershipType: newMembershipType,
              passType: mt.passType,
              startDate: newStartDate,
              endDate: isCount ? null : newEndDate,
              totalSessions: total,
              remainingSessions: total,
            });
            Alert.alert("완료", "회원권이 등록되었습니다.");
            await load();
            setTab("info");
          } catch (e) {
            Alert.alert("등록 실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  }

  async function handlePause() {
    if (!row?.membership_id) return;
    Alert.prompt("회원권 정지", "정지 사유를 입력해주세요 (선택)", async (reason) => {
      setSaving(true);
      try {
        await pauseMembership(row.membership_id!, reason || undefined);
        Alert.alert("완료", "회원권이 정지되었습니다.");
        await load();
      } catch (e) {
        Alert.alert("실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
      } finally {
        setSaving(false);
      }
    });
  }

  async function handleResume() {
    if (!row?.membership_id) return;
    Alert.alert("회원권 재개", "회원권을 재개하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "재개", onPress: async () => {
          setSaving(true);
          try {
            await resumeMembership(row.membership_id!);
            Alert.alert("완료", "회원권이 재개되었습니다.");
            await load();
          } catch (e) {
            Alert.alert("실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  }

  async function handleDelete() {
    if (!row) return;
    Alert.alert(
      "회원 삭제",
      `${row.member_name} 회원을 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제", style: "destructive", onPress: async () => {
            setSaving(true);
            try {
              await deleteMember(row.member_id);
              Alert.alert("완료", "회원이 삭제되었습니다.", [
                { text: "확인", onPress: () => router.back() },
              ]);
            } catch (e) {
              Alert.alert("실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "회원 상세" }} />
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  if (!row) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "회원 상세" }} />
        <Text>회원을 찾을 수 없습니다.</Text>
      </View>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const status = statusCategory(row, today);
  const isPaused = status === "정지회원";
  const hasMembership = !!row.membership_id;
  const selectedMT = MEMBERSHIP_TYPES.find((m) => m.value === newMembershipType);
  const isCountType = selectedMT?.passType === "count";

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: row.member_name }} />

      {/* 탭 */}
      <View style={styles.tabs}>
        <Pressable style={[styles.tabItem, tab === "info" && styles.tabActive]} onPress={() => setTab("info")}>
          <Text style={[styles.tabText, tab === "info" && styles.tabTextActive]}>기본 정보</Text>
        </Pressable>
        <Pressable style={[styles.tabItem, tab === "membership" && styles.tabActive]} onPress={() => setTab("membership")}>
          <Text style={[styles.tabText, tab === "membership" && styles.tabTextActive]}>
            {hasMembership ? "회원권 수정" : "회원권 등록"}
          </Text>
        </Pressable>
      </View>

      {tab === "info" && (
        <>
          <Text style={styles.label}>이름</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />
          <Text style={styles.label}>연락처</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Text style={styles.label}>회원 구분</Text>
          <View style={styles.row}>
            {MEMBER_TYPES.map((t) => (
              <Pressable
                key={t.value}
                style={[styles.chip, memberType === t.value && styles.chipActive]}
                onPress={() => setMemberType(t.value)}
              >
                <Text style={[styles.chipText, memberType === t.value && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>메모</Text>
          <TextInput style={[styles.input, styles.textarea]} value={memo} onChangeText={setMemo} multiline />

          <Text style={styles.infoLine}>최근 출석: {row.latest_visit_at?.slice(0, 10) ?? "-"}</Text>
          <Text style={styles.infoLine}>락카: {row.locker_number ?? "사용 안함"}</Text>
          <Text style={styles.infoLine}>상태: {status}</Text>

          <Pressable style={styles.saveBtn} onPress={() => void saveInfo()} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
          </Pressable>

          {/* 정지/재개 */}
          {hasMembership && (
            <Pressable
              style={[styles.actionBtn, isPaused ? styles.resumeBtn : styles.pauseBtn]}
              onPress={() => void (isPaused ? handleResume() : handlePause())}
              disabled={saving}
            >
              <Text style={styles.actionBtnText}>{isPaused ? "회원권 재개" : "회원권 정지"}</Text>
            </Pressable>
          )}

          {/* 삭제 */}
          <Pressable style={[styles.actionBtn, styles.deleteBtn]} onPress={() => void handleDelete()} disabled={saving}>
            <Text style={styles.actionBtnText}>회원 삭제</Text>
          </Pressable>
        </>
      )}

      {tab === "membership" && (
        <>
          {hasMembership ? (
            <>
              <Text style={styles.infoLine}>
                종류: {row.membership_type_label ?? "-"} · 상태: {status}
              </Text>
              <Text style={styles.label}>시작일 (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" />
              <Text style={styles.label}>종료일 (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" />
              <Text style={styles.label}>총 횟수</Text>
              <TextInput style={styles.input} value={totalCount} onChangeText={setTotalCount} keyboardType="number-pad" />
              <Text style={styles.label}>잔여 횟수</Text>
              <TextInput style={styles.input} value={remainingCount} onChangeText={setRemainingCount} keyboardType="number-pad" />
              <Pressable style={styles.saveBtn} onPress={() => void saveInfo()} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
              </Pressable>
            </>
          ) : (
            <Text style={styles.infoLine}>등록된 회원권이 없습니다.</Text>
          )}

          {/* 신규 회원권 등록 */}
          <Text style={styles.section}>신규 회원권 등록</Text>
          <Text style={styles.label}>회원권 종류</Text>
          <View style={styles.row}>
            {MEMBERSHIP_TYPES.map((t) => (
              <Pressable
                key={t.value}
                style={[styles.chip, newMembershipType === t.value && styles.chipActive]}
                onPress={() => setNewMembershipType(t.value)}
              >
                <Text style={[styles.chipText, newMembershipType === t.value && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>시작일 *</Text>
          <TextInput style={styles.input} value={newStartDate} onChangeText={setNewStartDate} placeholder="YYYY-MM-DD" />
          {!isCountType && (
            <>
              <Text style={styles.label}>종료일 *</Text>
              <TextInput style={styles.input} value={newEndDate} onChangeText={setNewEndDate} placeholder="YYYY-MM-DD" />
            </>
          )}
          {isCountType && (
            <>
              <Text style={styles.label}>총 횟수 *</Text>
              <TextInput style={styles.input} value={newTotalCount} onChangeText={setNewTotalCount} keyboardType="number-pad" />
            </>
          )}
          <Pressable style={[styles.saveBtn, { backgroundColor: "#0284c7", marginTop: 16 }]} onPress={() => void handleAddMembership()} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>회원권 등록</Text>}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  tabs: { flexDirection: "row", marginBottom: 16, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0" },
  tabItem: { flex: 1, padding: 12, alignItems: "center", backgroundColor: "#f8fafc" },
  tabActive: { backgroundColor: "#0f172a" },
  tabText: { fontSize: 14, fontWeight: "700", color: "#64748b" },
  tabTextActive: { color: "#fff" },
  section: { fontSize: 14, fontWeight: "800", color: "#0f172a", marginTop: 24, marginBottom: 8 },
  label: { fontSize: 12, color: "#64748b", marginTop: 10, marginBottom: 4, fontWeight: "600" },
  input: { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, padding: 12, fontSize: 15 },
  textarea: { minHeight: 70, textAlignVertical: "top" },
  infoLine: { fontSize: 13, color: "#475569", marginTop: 6 },
  row: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  chipText: { fontSize: 13, fontWeight: "700", color: "#475569" },
  chipTextActive: { color: "#fff" },
  saveBtn: { marginTop: 20, marginBottom: 8, backgroundColor: "#0f172a", borderRadius: 12, padding: 16, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  actionBtn: { marginTop: 10, borderRadius: 12, padding: 14, alignItems: "center" },
  pauseBtn: { backgroundColor: "#f59e0b" },
  resumeBtn: { backgroundColor: "#10b981" },
  deleteBtn: { backgroundColor: "#ef4444", marginBottom: 40 },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
