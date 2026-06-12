import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { fetchRoster, isExpiringSoon, statusCategory } from "../../src/lib/admin";
import type { RosterRow } from "../../src/types";

type Category = "유효회원" | "만료예정" | "만료소진" | "정지회원";

const CATEGORIES: Category[] = ["유효회원", "만료예정", "만료소진", "정지회원"];
const EXPIRING_DAYS = [0, 7, 15, 30, 60];
const EXPIRED_RANGES: { label: string; days: number | null }[] = [
  { label: "지난 7일", days: 7 },
  { label: "지난 30일", days: 30 },
  { label: "지난 90일", days: 90 },
  { label: "전체", days: null },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function StatusScreen() {
  const [center, setCenter] = useState<CenterFilterValue>("ALL");
  const [category, setCategory] = useState<Category>("유효회원");
  const [expiringDays, setExpiringDays] = useState(7);
  const [expiredRange, setExpiredRange] = useState<number | null>(30);
  const [view, setView] = useState<"card" | "table">("card");
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRows(await fetchRoster(center));
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

  const today = todayStr();

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const cat = statusCategory(row, today);
      if (category === "만료예정") {
        if (cat !== "유효회원") return false;
        return isExpiringSoon(row, today, expiringDays);
      }
      if (category === "만료소진") {
        if (cat !== "만료소진") return false;
        if (expiredRange == null) return true;
        if (!row.end_date) return true;
        const end = new Date(row.end_date);
        const diff = Math.floor((Date.now() - end.getTime()) / 86400000);
        return diff >= 0 && diff <= expiredRange;
      }
      return cat === category;
    });
  }, [rows, category, today, expiringDays, expiredRange]);

  return (
    <View style={styles.container}>
      <CenterFilter value={center} onChange={setCenter} />

      <View style={styles.tabRow}>
        {CATEGORIES.map((c) => (
          <Pressable key={c} style={[styles.tab, category === c && styles.tabActive]} onPress={() => setCategory(c)}>
            <Text style={[styles.tabText, category === c && styles.tabTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      {category === "만료예정" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subRow}>
          {EXPIRING_DAYS.map((d) => (
            <Pressable
              key={d}
              style={[styles.chip, expiringDays === d && styles.chipActive]}
              onPress={() => setExpiringDays(d)}
            >
              <Text style={[styles.chipText, expiringDays === d && styles.chipTextActive]}>
                {d === 0 ? "오늘" : `${d}일`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {category === "만료소진" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subRow}>
          {EXPIRED_RANGES.map((r) => (
            <Pressable
              key={r.label}
              style={[styles.chip, expiredRange === r.days && styles.chipActive]}
              onPress={() => setExpiredRange(r.days)}
            >
              <Text style={[styles.chipText, expiredRange === r.days && styles.chipTextActive]}>{r.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.searchRow}>
        <Text style={styles.count}>{filtered.length}명</Text>
        <Pressable style={styles.toggle} onPress={() => setView(view === "card" ? "table" : "card")}>
          <Text style={styles.toggleText}>{view === "card" ? "표 보기" : "카드 보기"}</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0f172a" />
      ) : view === "card" ? (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
          {filtered.map((row) => (
            <Pressable
              key={row.member_id}
              style={styles.card}
              onPress={() => router.push(`/(admin)/member/${row.member_id}`)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>{row.member_name}</Text>
                <Text style={styles.cardBadge}>{row.center_code}</Text>
              </View>
              <Text style={styles.cardLine}>{row.membership_type_label ?? "회원권 없음"}</Text>
              {row.phone ? <Text style={styles.cardLine}>{row.phone}</Text> : null}
              <Text style={styles.cardLine}>
                종료일: {row.end_date?.slice(0, 10) ?? "-"} / 잔여: {row.remaining_sessions ?? "-"}
              </Text>
            </Pressable>
          ))}
          {filtered.length === 0 ? <Text style={styles.empty}>대상 회원이 없습니다.</Text> : null}
        </ScrollView>
      ) : (
        <ScrollView horizontal refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
          <View>
            <View style={[styles.row, styles.headerRow]}>
              {["센터", "이름", "연락처", "회원권 종류", "종료일", "잔여 횟수", "주니어 잔여", "상태"].map((h) => (
                <Text key={h} style={[styles.cell, styles.headerCell, { width: 90 }]}>
                  {h}
                </Text>
              ))}
            </View>
            <ScrollView>
              {filtered.map((row) => (
                <Pressable
                  key={row.member_id}
                  style={styles.row}
                  onPress={() => router.push(`/(admin)/member/${row.member_id}`)}
                >
                  <Text style={[styles.cell, { width: 90 }]}>{row.center_code}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.member_name}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.phone ?? "-"}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.membership_type_label ?? "-"}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>{row.end_date?.slice(0, 10) ?? "-"}</Text>
                  <Text style={[styles.cell, { width: 90 }]}>
                    {row.member_type !== "junior" ? row.remaining_sessions ?? "-" : "-"}
                  </Text>
                  <Text style={[styles.cell, { width: 90 }]}>
                    {row.member_type === "junior" ? row.remaining_sessions ?? "-" : "-"}
                  </Text>
                  <Text style={[styles.cell, { width: 90 }]}>{statusCategory(row, today)}</Text>
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
  tabRow: { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center" },
  tabActive: { backgroundColor: "#0f172a" },
  tabText: { fontSize: 12, fontWeight: "700", color: "#475569" },
  tabTextActive: { color: "#fff" },
  subRow: { paddingHorizontal: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginRight: 6,
  },
  chipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  chipText: { fontSize: 12, fontWeight: "600", color: "#475569" },
  chipTextActive: { color: "#fff" },
  searchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, marginBottom: 4 },
  count: { fontSize: 13, color: "#64748b", fontWeight: "600" },
  toggle: { backgroundColor: "#0f172a", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  toggleText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  card: {
    margin: 8,
    marginTop: 0,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardName: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  cardBadge: { fontSize: 12, fontWeight: "700", color: "#0284c7" },
  cardLine: { marginTop: 4, fontSize: 13, color: "#475569" },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", backgroundColor: "#fff" },
  headerRow: { backgroundColor: "#f1f5f9" },
  cell: { padding: 8, fontSize: 12, color: "#334155" },
  headerCell: { fontWeight: "700", color: "#0f172a" },
});
