import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, View,
} from "react-native";
import { router } from "expo-router";
import { MemberRow } from "../../src/components/MemberRow";
import { useApp } from "../../src/context/AppContext";
import { hasAttendanceToday, recordAttendance } from "../../src/lib/attendance";
import { searchMembers } from "../../src/lib/members";
import type { MemberListRow } from "../../src/types";

export default function AttendanceScreen() {
  const { center, permissions } = useApp();
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<MemberListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const list = await searchMembers(center, query);
      setMembers(list);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "회원 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [center, query]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(timer);
  }, [load]);

  async function handleAttendance(member: MemberListRow) {
    if (!permissions.canCheckAttendance) {
      Alert.alert("권한 없음", permissions.denyReason);
      return;
    }
    const run = async (force: boolean) => {
      if (!force) {
        const dup = await hasAttendanceToday(member.id);
        if (dup) {
          Alert.alert("중복 출석", "오늘 이미 출석했습니다. 중복 등록하시겠습니까?", [
            { text: "취소", style: "cancel" },
            { text: "중복 등록", onPress: () => void run(true) },
          ]);
          return;
        }
      }
      try {
        await recordAttendance(member.id);
        setMessage(`${member.name} 출석 완료`);
        setTimeout(() => setMessage(""), 3000);
        await load();
      } catch (e) {
        Alert.alert("출석 실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
      }
    };
    await run(false);
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="이름 또는 연락처 검색..."
        value={query}
        onChangeText={setQuery}
      />
      {message ? <Text style={styles.toast}>{message}</Text> : null}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0284c7" />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              showAttendanceButton={permissions.canCheckAttendance}
              onPress={() => router.push(`/(app)/member/${item.id}`)}
              onAttendance={() => void handleAttendance(item)}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>회원을 검색해주세요.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  search: {
    margin: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0",
    borderRadius: 12, padding: 12, fontSize: 16,
  },
  toast: {
    marginHorizontal: 12, marginBottom: 8, padding: 10,
    backgroundColor: "#dcfce7", borderRadius: 8, color: "#166534", fontSize: 14,
  },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
