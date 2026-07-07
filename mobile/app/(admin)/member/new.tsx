import { useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Stack, router } from "expo-router";
import { createMember } from "../../../src/lib/admin";
import { useApp } from "../../../src/context/AppContext";
import type { Center } from "../../../src/types";

const MEMBER_TYPES = [
  { value: "general", label: "일반" },
  { value: "junior", label: "주니어" },
  { value: "trial", label: "체험" },
];

const CENTERS: { value: Center; label: string }[] = [
  { value: "ONCLE", label: "ONCLE" },
  { value: "GRABIT", label: "GRABIT" },
];

export default function NewMemberScreen() {
  const { center: defaultCenter } = useApp();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [memo, setMemo] = useState("");
  const [memberType, setMemberType] = useState("general");
  const [selectedCenter, setSelectedCenter] = useState<Center>(defaultCenter);

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert("입력 오류", "이름을 입력해주세요.");
      return;
    }
    Alert.alert("회원 등록", `${name} 회원을 ${selectedCenter}에 등록하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "등록", onPress: () => void save() },
    ]);
  }

  async function save() {
    setSaving(true);
    try {
      const memberId = await createMember({
        centerCode: selectedCenter,
        name: name.trim(),
        phone: phone.trim() || undefined,
        memberType,
        memo: memo.trim() || undefined,
      });
      Alert.alert("등록 완료", `${name} 회원이 등록되었습니다.`, [
        {
          text: "회원 상세로 이동",
          onPress: () => router.replace(`/(admin)/member/${memberId}`),
        },
        { text: "계속 등록", onPress: () => { setName(""); setPhone(""); setMemo(""); } },
      ]);
    } catch (e) {
      Alert.alert("등록 실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: "신규 회원 등록" }} />

      <Text style={styles.section}>센터</Text>
      <View style={styles.row}>
        {CENTERS.map((c) => (
          <Pressable
            key={c.value}
            style={[styles.chip, selectedCenter === c.value && styles.chipActive]}
            onPress={() => setSelectedCenter(c.value)}
          >
            <Text style={[styles.chipText, selectedCenter === c.value && styles.chipTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>기본 정보</Text>

      <Text style={styles.label}>이름 *</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="홍길동" />

      <Text style={styles.label}>연락처</Text>
      <TextInput
        style={styles.input} value={phone} onChangeText={setPhone}
        keyboardType="phone-pad" placeholder="010-0000-0000"
      />

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
      <TextInput
        style={[styles.input, styles.textarea]} value={memo} onChangeText={setMemo} multiline
      />

      <Pressable style={styles.saveBtn} onPress={() => void handleSave()} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>회원 등록</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  section: { fontSize: 14, fontWeight: "800", color: "#0f172a", marginTop: 18, marginBottom: 8 },
  label: { fontSize: 12, color: "#64748b", marginTop: 10, marginBottom: 4, fontWeight: "600" },
  input: {
    backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0",
    borderRadius: 10, padding: 12, fontSize: 15,
  },
  textarea: { minHeight: 70, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0",
  },
  chipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  chipText: { fontSize: 13, fontWeight: "700", color: "#475569" },
  chipTextActive: { color: "#fff" },
  saveBtn: {
    marginTop: 28, marginBottom: 40, backgroundColor: "#0284c7",
    borderRadius: 12, padding: 16, alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
