import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, View,
} from "react-native";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { hasAttendanceToday, recordAttendance } from "../../src/lib/attendance";
import { fetchRoster } from "../../src/lib/admin";
import type { RosterRow } from "../../src/types";
import { Pressable } from "react-native";

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function AdminAttendanceScreen() {
  const [center, setCenter] = useState<CenterFilterValue>("ONCLE");
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (center === "ALL") return;
    setLoading(true);
    try {
      const data = await fetchRoster(center);
      setRoster(data);
    } finally {
      setLoading(false);
    }
  }, [center]);

  useEffect(() => { void load(); }, [load]);

  const filtered = roster.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return r.member_name.toLowerCase().includes(q) || (r.phone ?? "").includes(q);
  });

  async function handleAttendance(row: RosterRow) {
    const run = async (force: boolean) => {
      if (!force) {
        const dup = await hasAttendanceToday(row.member_id);
        if (dup) {
          Alert.alert("중복 출석", "오늘 이미 출석한 회원입니다. 중복 등록하시겠습니까?", [
            { text: "취소", style: "cancel" },
            { text: "중복 등록", onPress: () => void run(true) },
          ]);
          return;
        }
      }
      try {
        await recordAttendance(row.member_id);
        setMessage(`${row.member_name} 출석 완료`);
        setTimeout(() => setMessage(""), 3000);
      } catch (e) {
        Alert.alert("출석 실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
      }
    };
    await run(false);
  }

  const today = todayStr();

  return (
    <View style={styles.container}>
      <CenterFilter value={center} onChange={setCenter} />
      <TextInput
        style={styles.search}
        placeholder="이름 또는 연락처 검색..."
        value={query}
        onChangeText={setQuery}
      />
      {message ? <Text style={styles.toast}>{message}</Text> : null}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0f172a" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.member_id}
          renderItem={({ item }) => {
            const statusColor = item.membership_status === "paused" ? "#64748b"
              : !item.membership_id ? "#94a3b8"
              : "#15803d";
            return (
              <View style={styles.card}>
                <View style={styles.cardLeft}>
                  <Text style={styles.name}>{item.member_name}</Text>
                  <Text style={styles.sub}>
                    {item.phone ?? "연락처 없음"} · {item.membership_type_label ?? "회원권 없음"}
                  </Text>
                  {item.remaining_sessions != null && (
                    <Text style={[styles.sub, { color: statusColor }]}>잔여 {item.remaining_sessions}회</Text>
                  )}
                </View>
                <Pressable
                  style={[styles.btn, !item.membership_id && styles.btnDisabled]}
                  onPress={() => void handleAttendance(item)}
                  disabled={!item.membership_id}
                >
                  <Text style={styles.btnText}>출석</Text>
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>회원이 없습니다.</Text>}
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
  card: {
    marginHorizontal: 12, marginBottom: 8, backgroundColor: "#fff", borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: "#e2e8f0",
    flexDirection: "row", alignItems: "center",
  },
  cardLeft: { flex: 1 },
  name: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  sub: { fontSize: 13, color: "#64748b", marginTop: 2 },
  btn: {
    backgroundColor: "#0f172a", borderRadius: 10, paddingHorizontal: 16,
    paddingVertical: 10, marginLeft: 12,
  },
  btnDisabled: { backgroundColor: "#cbd5e1" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
