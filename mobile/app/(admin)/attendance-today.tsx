import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Stack } from "expo-router";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { cancelAttendance, fetchTodayAttendance, type TodayAttendanceRow } from "../../src/lib/admin";

export default function AttendanceTodayScreen() {
  const [center, setCenter] = useState<CenterFilterValue>("ALL");
  const [rows, setRows] = useState<TodayAttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRows(await fetchTodayAttendance(center));
  }, [center]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  async function handleCancel(row: TodayAttendanceRow) {
    Alert.alert("출석 취소", `${row.member_name}의 출석을 취소하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      {
        text: "출석 취소", style: "destructive", onPress: async () => {
          try {
            await cancelAttendance(row.id);
            await load();
          } catch (e) {
            Alert.alert("실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
          }
        },
      },
    ]);
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
              <View style={styles.cardFooter}>
                <Text style={styles.cardLine}>
                  차감: {row.deducted_count != null && row.deducted_count > 0 ? `${row.deducted_count}회` : "없음"} · 잔여: {row.remaining_sessions ?? "-"}
                </Text>
                <Pressable style={styles.cancelBtn} onPress={() => void handleCancel(row)}>
                  <Text style={styles.cancelBtnText}>취소</Text>
                </Pressable>
              </View>
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
  card: {
    margin: 8, marginTop: 0, backgroundColor: "#fff", borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: "#e2e8f0",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardName: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  cardTime: { fontSize: 13, fontWeight: "700", color: "#0284c7" },
  cardLine: { marginTop: 4, fontSize: 13, color: "#475569" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  cancelBtn: { backgroundColor: "#fee2e2", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  cancelBtnText: { color: "#dc2626", fontSize: 12, fontWeight: "700" },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
