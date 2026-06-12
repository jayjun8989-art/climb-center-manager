import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { fetchTodayAttendance, type TodayAttendanceRow } from "../../src/lib/admin";

export default function AttendanceTodayScreen() {
  const [center, setCenter] = useState<CenterFilterValue>("ALL");
  const [rows, setRows] = useState<TodayAttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRows(await fetchTodayAttendance(center));
  }, [center]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "오늘 출석" }} />
      <CenterFilter value={center} onChange={setCenter} />
      <Text style={styles.count}>{rows.length}건</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0f172a" />
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
          {rows.map((row) => (
            <View key={row.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>{row.member_name}</Text>
                <Text style={styles.cardTime}>{new Date(row.checkin_at).toLocaleTimeString("ko-KR")}</Text>
              </View>
              <Text style={styles.cardLine}>
                {row.center_code} · {row.member_type_label} · {row.membership_type_label ?? "-"}
              </Text>
              <Text style={styles.cardLine}>
                차감: {row.deducted_count != null && row.deducted_count > 0 ? `${row.deducted_count}회` : "없음"} · 잔여:{" "}
                {row.remaining_sessions ?? "-"}
              </Text>
            </View>
          ))}
          {rows.length === 0 ? <Text style={styles.empty}>오늘 출석한 회원이 없습니다.</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  count: { fontSize: 13, color: "#64748b", fontWeight: "600", paddingHorizontal: 12, marginBottom: 4 },
  card: { margin: 8, marginTop: 0, backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#e2e8f0" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardName: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  cardTime: { fontSize: 13, fontWeight: "700", color: "#0284c7" },
  cardLine: { marginTop: 4, fontSize: 13, color: "#475569" },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
