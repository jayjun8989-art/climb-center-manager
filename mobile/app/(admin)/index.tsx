import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { fetchLockers, fetchRoster, fetchTodayAttendance, isExpiringSoon, statusCategory } from "../../src/lib/admin";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminHome() {
  const [center, setCenter] = useState<CenterFilterValue>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [counts, setCounts] = useState({
    total: 0,
    active: 0,
    expiringSoon: 0,
    expired: 0,
    paused: 0,
    todayAttendance: 0,
    junior: 0,
    lockersInUse: 0,
  });

  const load = useCallback(async () => {
    const today = todayStr();
    const [roster, attendance, lockers] = await Promise.all([
      fetchRoster(center),
      fetchTodayAttendance(center),
      fetchLockers(center),
    ]);

    let active = 0;
    let expiringSoon = 0;
    let expired = 0;
    let paused = 0;
    let junior = 0;

    for (const row of roster) {
      const cat = statusCategory(row, today);
      if (cat === "유효회원") {
        active += 1;
        if (isExpiringSoon(row, today, 7)) expiringSoon += 1;
      } else if (cat === "만료소진") {
        expired += 1;
      } else if (cat === "정지회원") {
        paused += 1;
      }
      if (row.member_type === "junior") junior += 1;
    }

    setCounts({
      total: roster.length,
      active,
      expiringSoon,
      expired,
      paused,
      todayAttendance: attendance.length,
      junior,
      lockersInUse: lockers.filter((l) => l.member_id).length,
    });
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

  const cards: { label: string; value: number; color: string }[] = [
    { label: "전체 회원 수", value: counts.total, color: "#0f172a" },
    { label: "유효회원", value: counts.active, color: "#15803d" },
    { label: "만료예정 (7일)", value: counts.expiringSoon, color: "#b45309" },
    { label: "만료·소진", value: counts.expired, color: "#b91c1c" },
    { label: "정지회원", value: counts.paused, color: "#64748b" },
    { label: "오늘 출석", value: counts.todayAttendance, color: "#0284c7" },
    { label: "주니어 회원", value: counts.junior, color: "#7c3aed" },
    { label: "락카 사용중", value: counts.lockersInUse, color: "#0d9488" },
  ];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      <CenterFilter value={center} onChange={setCenter} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#0f172a" />
      ) : (
        <View style={styles.grid}>
          {cards.map((c) => (
            <View key={c.label} style={styles.card}>
              <Text style={[styles.cardValue, { color: c.color }]}>{c.value}</Text>
              <Text style={styles.cardLabel}>{c.label}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 8, gap: 8 },
  card: {
    width: "47%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardValue: { fontSize: 30, fontWeight: "800" },
  cardLabel: { marginTop: 6, fontSize: 13, color: "#64748b", fontWeight: "600" },
});
