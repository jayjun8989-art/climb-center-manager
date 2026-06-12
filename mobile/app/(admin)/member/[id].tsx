import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { getSupabase } from "../../../src/lib/supabase";
import { statusCategory, updateMember, updateMembership } from "../../../src/lib/admin";
import type { RosterRow } from "../../../src/types";

const MEMBER_TYPES = [
  { value: "general", label: "일반" },
  { value: "junior", label: "주니어" },
  { value: "trial", label: "체험" },
];

export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [row, setRow] = useState<RosterRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [memo, setMemo] = useState("");
  const [memberType, setMemberType] = useState("general");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [totalCount, setTotalCount] = useState("");
  const [remainingCount, setRemainingCount] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("member_roster_view")
        .select("*")
        .eq("member_id", id)
        .maybeSingle();
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

  useEffect(() => {
    void load();
  }, [load]);

  function confirmAndSave() {
    Alert.alert("저장 확인", "수정 내용을 저장하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "저장", onPress: () => void save() },
    ]);
  }

  async function save() {
    if (!row) return;
    setSaving(true);
    try {
      const memberPatch: Record<string, unknown> = {};
      if (name !== row.member_name) memberPatch.name = name;
      if (phone !== (row.phone ?? "")) memberPatch.phone = phone;
      if (memo !== (row.memo ?? "")) memberPatch.memo = memo;
      if (memberType !== row.member_type) memberPatch.member_type = memberType;

      if (Object.keys(memberPatch).length > 0) {
        await updateMember(row.member_id, memberPatch);
      }

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

        if (Object.keys(membershipPatch).length > 0) {
          await updateMembership(row.membership_id, membershipPatch);
        }
      }

      Alert.alert("완료", "저장되었습니다.");
      await load();
    } catch (e) {
      Alert.alert("저장 실패", e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
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

  const isJunior = memberType === "junior";

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: row.member_name }} />

      <Text style={styles.section}>기본 정보</Text>
      <Text style={styles.label}>이름</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} />

      <Text style={styles.label}>연락처</Text>
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

      <Text style={styles.label}>회원 구분</Text>
      <View style={styles.row}>
        {MEMBER_TYPES.map((t) => (
          <Pressable
            key={t.value}
            style={[styles.typeChip, memberType === t.value && styles.typeChipActive]}
            onPress={() => setMemberType(t.value)}
          >
            <Text style={[styles.typeChipText, memberType === t.value && styles.typeChipTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>메모</Text>
      <TextInput style={[styles.input, styles.textarea]} value={memo} onChangeText={setMemo} multiline />

      <Text style={styles.section}>회원권</Text>
      <Text style={styles.info}>
        센터: {row.center_code} · 종류: {row.membership_type_label ?? "없음"} · 상태: {statusCategory(row, new Date().toISOString().slice(0, 10))}
      </Text>

      {row.membership_id ? (
        <>
          <Text style={styles.label}>시작일 (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" />

          <Text style={styles.label}>종료일 (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" />

          <Text style={styles.label}>{isJunior ? "주니어 총 수업 횟수" : "총 횟수"}</Text>
          <TextInput style={styles.input} value={totalCount} onChangeText={setTotalCount} keyboardType="number-pad" />

          <Text style={styles.label}>{isJunior ? "주니어 잔여 수업 횟수" : "잔여 횟수"}</Text>
          <TextInput style={styles.input} value={remainingCount} onChangeText={setRemainingCount} keyboardType="number-pad" />
        </>
      ) : (
        <Text style={styles.info}>등록된 회원권이 없습니다.</Text>
      )}

      <Text style={styles.section}>기타</Text>
      <Text style={styles.info}>최근 출석일: {row.latest_visit_at?.slice(0, 10) ?? "-"}</Text>
      <Text style={styles.info}>락카: {row.locker_number ?? "사용 안함"}</Text>

      <Pressable style={styles.saveBtn} onPress={confirmAndSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  section: { fontSize: 14, fontWeight: "800", color: "#0f172a", marginTop: 18, marginBottom: 8 },
  label: { fontSize: 12, color: "#64748b", marginTop: 10, marginBottom: 4, fontWeight: "600" },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
  },
  textarea: { minHeight: 70, textAlignVertical: "top" },
  info: { fontSize: 13, color: "#475569", marginTop: 4 },
  row: { flexDirection: "row", gap: 8, marginTop: 4 },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  typeChipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  typeChipText: { fontSize: 13, fontWeight: "700", color: "#475569" },
  typeChipTextActive: { color: "#fff" },
  saveBtn: {
    marginTop: 28,
    marginBottom: 40,
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
