import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { router } from "expo-router";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { fetchRoster, statusCategory } from "../../src/lib/admin";
import type { RosterRow } from "../../src/types";

type SubFilter = "ALL" | "유효회원" | "만료소진" | "정지회원" | "회원권없음";

const SUB_FILTERS: { value: SubFilter; label: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "유효회원", label: "유효" },
  { value: "만료소진", label: "만료" },
  { value: "정지회원", label: "정지" },
  { value: "회원권없음", label: "회원권없음" },
];

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function AdminMembersScreen() {
  const [center, setCenter] = useState<CenterFilterValue>("ALL");
  const [query, setQuery] = useState("");
  const [subFilter, setSubFilter] = useState<SubFilter>("ALL");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchRoster(center);
    setRoster(data);
  }, [center]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  const today = todayStr();

  const filtered = useMemo(() => {
    return roster.filter((r) => {
      const q = query.trim().toLowerCase();
      if (q && !r.member_name.toLowerCase().includes(q) && !(r.phone ?? "").includes(q)) return false;
      if (subFilter !== "ALL" && statusCategory(r, today) !== subFilter) return false;
      return true;
    });
  }, [roster, query, subFilter, today]);

  const statusColor: Record<string, string> = {
    유효회원: "#15803d", 만료소진: "#b91c1c", 정지회원: "#64748b", 회원권없음: "#94a3b8",
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <CenterFilter value={center} onChange={setCenter} />
        <Pressable style={styles.addBtn} onPress={() => router.push("/(admin)/member/new")}>
          <Text style={styles.addBtnText}>+ 신규 등록</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.search}
        placeholder="이름 또는 연락처 검색..."
        value={query}
        onChangeText={setQuery}
      />
      <View style={styles.subFilters}>
        {SUB_FILTERS.map((f) => (
          <Pressable
            key={f.value}
            style={[styles.subChip, subFilter === f.value && styles.subChipActive]}
            onPress={() => setSubFilter(f.value)}
          >
            <Text style={[styles.subChipText, subFilter === f.value && styles.subChipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.count}>{filtered.length}명</Text>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0f172a" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.member_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
          renderItem={({ item }) => {
            const cat = statusCategory(item, today);
            return (
              <Pressable style={styles.card} onPress={() => router.push(`/(admin)/member/${item.member_id}`)}>
                <View style={styles.cardLeft}>
                  <Text style={styles.cardName}>{item.member_name}</Text>
                  <Text style={styles.cardSub}>{item.phone ?? "연락처 없음"}</Text>
                  <Text style={styles.cardSub}>
                    {item.membership_type_label ?? "회원권 없음"}
                    {item.remaining_sessions != null ? ` · 잔여 ${item.remaining_sessions}회` : ""}
                    {item.end_date ? ` · ~${item.end_date.slice(0, 10)}` : ""}
                  </Text>
                </View>
                <Text style={[styles.badge, { color: statusColor[cat] ?? "#64748b" }]}>{cat}</Text>
              </Pressable>
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
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 12 },
  addBtn: { backgroundColor: "#0284c7", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  search: {
    marginHorizontal: 12, marginBottom: 8, backgroundColor: "#fff", borderWidth: 1,
    borderColor: "#e2e8f0", borderRadius: 12, padding: 12, fontSize: 16,
  },
  subFilters: { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 6 },
  subChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  subChipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  subChipText: { fontSize: 12, fontWeight: "600", color: "#475569" },
  subChipTextActive: { color: "#fff" },
  count: { fontSize: 12, color: "#94a3b8", paddingHorizontal: 12, marginBottom: 4 },
  card: {
    marginHorizontal: 12, marginBottom: 8, backgroundColor: "#fff", borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: "#e2e8f0",
    flexDirection: "row", alignItems: "center",
  },
  cardLeft: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  cardSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  badge: { fontSize: 12, fontWeight: "700", marginLeft: 8 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
