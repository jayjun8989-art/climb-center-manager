import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Stack } from "expo-router";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { fetchLockers } from "../../src/lib/admin";
import type { LockerRow } from "../../src/types";

export default function LockersScreen() {
  const [center, setCenter] = useState<CenterFilterValue>("ALL");
  const [view, setView] = useState<"card" | "table">("card");
  const [rows, setRows] = useState<LockerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRows(await fetchLockers(center));
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
      <Stack.Screen options={{ title: "락카 현황" }} />
      <CenterFilter value={center} onChange={setCenter} />
      <View style={styles.searchRow}>
        <Text style={styles.count}>{rows.length}개</Text>
        <Pressable style={styles.toggle} onPress={() => setView(view === "card" ? "table" : "card")}>
          <Text style={styles.toggleText}>{view === "card" ? "표 보기" : "카드 보기"}</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0f172a" />
      ) : view === "card" ? (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
          {rows.map((row) => (
            <Pressable key={row.id} style={styles.card} onPress={() => router.push(`/(admin)/locker/${row.id}`)}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>락카 {row.locker_number}</Text>
                <Text style={styles.cardBadge}>{row.status}</Text>
              </View>
              <Text style={styles.cardLine}>사용자: {row.members?.name ?? "-"}</Text>
              {row.members?.phone ? <Text style={styles.cardLine}>{row.members.phone}</Text> : null}
              <Text style={styles.cardLine}>
                {row.start_date?.slice(0, 10) ?? "-"} ~ {row.end_date?.slice(0, 10) ?? "-"}
              </Text>
              {row.memo ? <Text style={styles.cardMemo}>{row.memo}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView horizontal refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
          <View>
            <View style={[styles.row, styles.headerRow]}>
              {["센터", "락카번호", "사용자", "연락처", "시작일", "종료일", "상태", "메모"].map((h) => (
                <Text key={h} style={[styles.cell, styles.headerCell, { width: 90 }]}>
                  {h}
                </Text>
              ))}
            </View>
            <ScrollView>
              {rows.map((row) => (
                <Pressable key={row.id} style={styles.row} onPress={() => router.push(`/(admin)/locker/${row.id}`)}>
                  <Text style={[styles.cell, { width: 90 }]}>{center === "ALL" ? "-" : center}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.locker_number}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.members?.name ?? "-"}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.members?.phone ?? "-"}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.start_date?.slice(0, 10) ?? "-"}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.end_date?.slice(0, 10) ?? "-"}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.status}</Text>
                  <Text style={[styles.cell, { width: 90 }]} numberOfLines={1}>{row.memo ?? "-"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  searchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, marginBottom: 4 },
  count: { fontSize: 13, color: "#64748b", fontWeight: "600" },
  toggle: { backgroundColor: "#0f172a", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  toggleText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  card: { margin: 8, marginTop: 0, backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#e2e8f0" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardName: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  cardBadge: { fontSize: 12, fontWeight: "700", color: "#0284c7" },
  cardLine: { marginTop: 4, fontSize: 13, color: "#475569" },
  cardMemo: { marginTop: 6, fontSize: 12, color: "#94a3b8" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", backgroundColor: "#fff" },
  headerRow: { backgroundColor: "#f1f5f9" },
  cell: { padding: 8, fontSize: 12, color: "#334155" },
  headerCell: { fontWeight: "700", color: "#0f172a" },
});
