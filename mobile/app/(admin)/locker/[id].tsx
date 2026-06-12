import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { getSupabase } from "../../../src/lib/supabase";
import { updateLocker } from "../../../src/lib/admin";
import type { LockerRow } from "../../../src/types";

export default function LockerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [row, setRow] = useState<LockerRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [memberName, setMemberName] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState("");
  const [memo, setMemo] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from("lockers").select("*, members(name, phone)").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      const r = data as unknown as LockerRow | null;
      setRow(r);
      if (r) {
        setMemberName(r.members?.name ?? "");
        setMemberPhone(r.members?.phone ?? "");
        setStartDate(r.start_date?.slice(0, 10) ?? "");
        setEndDate(r.end_date?.slice(0, 10) ?? "");
        setStatus(r.status);
        setMemo(r.memo ?? "");
      }
    } catch (e) {
      Alert.alert("오류", e instanceof Error ? e.message : "락카 정보를 불러오지 못했습니다.");
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
      const patch: Record<string, unknown> = {};
      if (startDate !== (row.start_date?.slice(0, 10) ?? "")) patch.start_date = startDate || null;
      if (endDate !== (row.end_date?.slice(0, 10) ?? "")) patch.end_date = endDate || null;
      if (status !== row.status) patch.status = status;
      if (memo !== (row.memo ?? "")) patch.memo = memo;
      if (row.member_id) {
        if (memberName !== (row.members?.name ?? "")) patch.member_name = memberName;
        if (memberPhone !== (row.members?.phone ?? "")) patch.member_phone = memberPhone;
      }
      if (Object.keys(patch).length > 0) {
        await updateLocker(row.id, patch);
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
        <Stack.Screen options={{ title: "락카 수정" }} />
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  if (!row) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "락카 수정" }} />
        <Text>락카를 찾을 수 없습니다.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: `락카 ${row.locker_number}` }} />

      {row.member_id ? (
        <>
          <Text style={styles.label}>사용자 이름</Text>
          <TextInput style={styles.input} value={memberName} onChangeText={setMemberName} />

          <Text style={styles.label}>연락처</Text>
          <TextInput style={styles.input} value={memberPhone} onChangeText={setMemberPhone} keyboardType="phone-pad" />
        </>
      ) : (
        <Text style={styles.info}>사용 중인 회원이 없습니다.</Text>
      )}

      <Text style={styles.label}>시작일 (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" />

      <Text style={styles.label}>종료일 (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" />

      <Text style={styles.label}>상태</Text>
      <TextInput style={styles.input} value={status} onChangeText={setStatus} />

      <Text style={styles.label}>메모</Text>
      <TextInput style={[styles.input, styles.textarea]} value={memo} onChangeText={setMemo} multiline />

      <Pressable style={styles.saveBtn} onPress={confirmAndSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  label: { fontSize: 12, color: "#64748b", marginTop: 10, marginBottom: 4, fontWeight: "600" },
  input: { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, padding: 12, fontSize: 15 },
  textarea: { minHeight: 70, textAlignVertical: "top" },
  info: { fontSize: 13, color: "#475569", marginTop: 4 },
  saveBtn: { marginTop: 28, marginBottom: 40, backgroundColor: "#0f172a", borderRadius: 12, padding: 16, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
