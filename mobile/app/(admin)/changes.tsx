import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { CenterFilter, type CenterFilterValue } from "../../src/components/CenterFilter";
import { fetchAuditLogs } from "../../src/lib/admin";
import type { AuditLogRow } from "../../src/types";

const PERIOD_OPTIONS: { label: string; days: number | null }[] = [
  { label: "전체", days: null },
  { label: "오늘", days: 1 },
  { label: "7일", days: 7 },
  { label: "30일", days: 30 },
];

const ENTITY_OPTIONS: { label: string; value: AuditLogRow["entity_type"] | "ALL" }[] = [
  { label: "전체", value: "ALL" },
  { label: "회원", value: "member" },
  { label: "회원권", value: "membership" },
  { label: "출석", value: "attendance" },
  { label: "락카", value: "locker" },
];

const ACTION_OPTIONS: { label: string; value: "ALL" | "update" | "delete" }[] = [
  { label: "전체", value: "ALL" },
  { label: "수정", value: "update" },
  { label: "삭제", value: "delete" },
];

const ENTITY_LABEL: Record<string, string> = { member: "회원", membership: "회원권", attendance: "출석", locker: "락카" };
const ACTION_LABEL: Record<string, string> = {
  update: "수정",
  delete: "삭제",
  soft_delete: "삭제",
  restore: "복구",
  clear_locker: "비우기",
};

function summarize(data: Record<string, unknown> | null): string {
  if (!data) return "-";
  const keys = Object.keys(data).filter((k) => !["id", "created_at", "updated_at", "version"].includes(k));
  return keys
    .slice(0, 4)
    .map((k) => `${k}: ${String(data[k])}`)
    .join(", ");
}

export default function ChangesScreen() {
  const [center, setCenter] = useState<CenterFilterValue>("ALL");
  const [period, setPeriod] = useState<number | null>(null);
  const [entity, setEntity] = useState<AuditLogRow["entity_type"] | "ALL">("ALL");
  const [action, setAction] = useState<"ALL" | "update" | "delete">("ALL");
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRows(
      await fetchAuditLogs({
        center,
        entityType: entity,
        action,
        sinceDays: period,
      })
    );
  }, [center, entity, action, period]);

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
      <Stack.Screen options={{ title: "변경 내역" }} />
      <CenterFilter value={center} onChange={setCenter} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subRow}>
        {PERIOD_OPTIONS.map((p) => (
          <Pressable key={p.label} style={[styles.chip, period === p.days && styles.chipActive]} onPress={() => setPeriod(p.days)}>
            <Text style={[styles.chipText, period === p.days && styles.chipTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
        <View style={styles.divider} />
        {ENTITY_OPTIONS.map((e) => (
          <Pressable key={e.value} style={[styles.chip, entity === e.value && styles.chipActive]} onPress={() => setEntity(e.value)}>
            <Text style={[styles.chipText, entity === e.value && styles.chipTextActive]}>{e.label}</Text>
          </Pressable>
        ))}
        <View style={styles.divider} />
        {ACTION_OPTIONS.map((a) => (
          <Pressable key={a.value} style={[styles.chip, action === a.value && styles.chipActive]} onPress={() => setAction(a.value)}>
            <Text style={[styles.chipText, action === a.value && styles.chipTextActive]}>{a.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0f172a" />
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
          {rows.map((row) => (
            <View key={row.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {ENTITY_LABEL[row.entity_type] ?? row.entity_type} · {row.entity_name ?? "-"}
                </Text>
                <Text style={styles.cardAction}>{ACTION_LABEL[row.action] ?? row.action}</Text>
              </View>
              <Text style={styles.cardMeta}>
                {new Date(row.created_at).toLocaleString("ko-KR")} · {row.actor_email ?? "-"}
              </Text>
              <Text style={styles.cardDiff}>변경 전: {summarize(row.before_data)}</Text>
              <Text style={styles.cardDiff}>변경 후: {summarize(row.after_data)}</Text>
              {row.memo ? <Text style={styles.cardMemo}>메모: {row.memo}</Text> : null}
            </View>
          ))}
          {rows.length === 0 ? <Text style={styles.empty}>변경 내역이 없습니다.</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  subRow: { paddingHorizontal: 8, marginBottom: 4 },
  divider: { width: 1, backgroundColor: "#e2e8f0", marginHorizontal: 6 },
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
  card: { margin: 8, marginTop: 6, backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#e2e8f0" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  cardAction: { fontSize: 12, fontWeight: "700", color: "#0284c7" },
  cardMeta: { marginTop: 4, fontSize: 11, color: "#94a3b8" },
  cardDiff: { marginTop: 6, fontSize: 12, color: "#475569" },
  cardMemo: { marginTop: 6, fontSize: 12, color: "#94a3b8" },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
