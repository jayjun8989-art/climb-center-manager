import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { fetchRoster, statusCategory } from "../../src/lib/admin";
import type { RosterRow } from "../../src/types";

type SubFilter =
  | "ALL"
  | "general"
  | "junior"
  | "trial"
  | "유효회원"
  | "만료예정"
  | "만료소진"
  | "정지회원"
  | "회원권없음";

const SUB_FILTERS: { value: SubFilter; label: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "general", label: "일반" },
  { value: "junior", label: "주니어" },
  { value: "trial", label: "체험" },
  { value: "유효회원", label: "유효회원" },
  { value: "만료예정", label: "만료예정" },
  { value: "만료소진", label: "만료·소진" },
  { value: "정지회원", label: "정지회원" },
  { value: "회원권없음", label: "회원권 없음" },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const COLS = [
  { key: "center_code", label: "센터", width: 70 },
  { key: "member_name", label: "이름", width: 90 },
  { key: "phone", label: "연락처", width: 120 },
  { key: "member_type_label", label: "구분", width: 60 },
  { key: "membership_type_label", label: "회원권", width: 90 },
  { key: "start_date", label: "시작일", width: 90 },
  { key: "end_date", label: "종료일", width: 90 },
  { key: "total_count", label: "총횟수", width: 70 },
  { key: "remaining_count", label: "잔여횟수", width: 70 },
  { key: "junior_total", label: "주니어총", width: 70 },
  { key: "junior_remaining", label: "주니어잔여", width: 80 },
  { key: "status", label: "상태", width: 80 },
  { key: "latest_visit_at", label: "최근출석", width: 90 },
  { key: "memo", label: "메모", width: 140 },
] as const;

function cellValue(row: RosterRow, key: string, today: string): string {
  const isJunior = row.member_type === "junior";
  switch (key) {
    case "center_code":
      return row.center_code;
    case "member_name":
      return row.member_name;
    case "phone":
      return row.phone ?? "-";
    case "member_type_label":
      return row.member_type_label;
    case "membership_type_label":
      return row.membership_type_label ?? "-";
    case "start_date":
      return row.start_date?.slice(0, 10) ?? "-";
    case "end_date":
      return row.end_date?.slice(0, 10) ?? "-";
    case "total_count":
      return isJunior ? "-" : row.total_sessions != null ? String(row.total_sessions) : "-";
    case "remaining_count":
      return isJunior ? "-" : row.remaining_sessions != null ? String(row.remaining_sessions) : "-";
    case "junior_total":
      return isJunior && row.total_sessions != null ? String(row.total_sessions) : "-";
    case "junior_remaining":
      return isJunior && row.remaining_sessions != null ? String(row.remaining_sessions) : "-";
    case "status":
      return statusCategory(row, today);
    case "latest_visit_at":
      return row.latest_visit_at?.slice(0, 10) ?? "-";
    case "memo":
      return row.memo ?? "-";
    default:
      return "-";
  }
}

export default function MembersScreen() {
  const [center, setCenter] = useState<CenterFilterValue>("ALL");
  const [sub, setSub] = useState<SubFilter>("ALL");
  const [query, setQuery] = useState("");
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
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (sub === "general" && row.member_type !== "general" && row.member_type !== "regular") return false;
      if (sub === "junior" && row.member_type !== "junior") return false;
      if (sub === "trial" && row.member_type !== "trial") return false;
      if (["유효회원", "만료예정", "만료소진", "정지회원", "회원권없음"].includes(sub)) {
        const cat = statusCategory(row, today);
        if (sub === "만료예정") {
          if (cat !== "유효회원") return false;
        } else if (cat !== sub) {
          return false;
        }
      }
      if (q) {
        const haystack = `${row.member_name} ${row.phone ?? ""} ${row.memo ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, sub, query, today]);

  return (
    <View style={styles.container}>
      <CenterFilter value={center} onChange={setCenter} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subRow}>
        {SUB_FILTERS.map((f) => (
          <Pressable
            key={f.value}
            style={[styles.chip, sub === f.value && styles.chipActive]}
            onPress={() => setSub(f.value)}
          >
            <Text style={[styles.chipText, sub === f.value && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="이름/전화번호/메모 검색"
          value={query}
          onChangeText={setQuery}
        />
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
                <Text style={styles.cardBadge}>{statusCategory(row, today)}</Text>
              </View>
              <Text style={styles.cardLine}>
                {row.center_code} · {row.member_type_label} · {row.membership_type_label ?? "회원권 없음"}
              </Text>
              {row.phone ? <Text style={styles.cardLine}>{row.phone}</Text> : null}
              {row.end_date ? (
                <Text style={styles.cardLine}>
                  종료일: {row.end_date.slice(0, 10)} / 잔여: {row.remaining_sessions ?? "-"}
                </Text>
              ) : null}
              {row.memo ? <Text style={styles.cardMemo}>{row.memo}</Text> : null}
            </Pressable>
          ))}
          {filtered.length === 0 ? <Text style={styles.empty}>조건에 맞는 회원이 없습니다.</Text> : null}
        </ScrollView>
      ) : (
        <ScrollView horizontal refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
          <View>
            <View style={[styles.row, styles.headerRow]}>
              {COLS.map((c) => (
                <Text key={c.key} style={[styles.cell, styles.headerCell, { width: c.width }]}>
                  {c.label}
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
                  {COLS.map((c) => (
                    <Text key={c.key} style={[styles.cell, { width: c.width }]} numberOfLines={1}>
                      {cellValue(row, c.key, today)}
                    </Text>
                  ))}
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
  searchRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginBottom: 4 },
  search: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
  },
  toggle: { backgroundColor: "#0f172a", borderRadius: 10, paddingHorizontal: 14, justifyContent: "center" },
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
  cardMemo: { marginTop: 6, fontSize: 12, color: "#94a3b8" },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", backgroundColor: "#fff" },
  headerRow: { backgroundColor: "#f1f5f9" },
  cell: { padding: 8, fontSize: 12, color: "#334155" },
  headerCell: { fontWeight: "700", color: "#0f172a" },
});
