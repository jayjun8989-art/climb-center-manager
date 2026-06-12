import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useApp } from "../../../src/context/AppContext";
import { hasAttendanceToday, recordAttendance } from "../../../src/lib/attendance";
import {
  fetchMemberById,
  formatMembershipLabel,
  formatStatus,
} from "../../../src/lib/members";
import type { MemberListRow } from "../../../src/types";

export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { permissions } = useApp();
  const [member, setMember] = useState<MemberListRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setMember(await fetchMemberById(id));
    } catch (e) {
      Alert.alert("??", e instanceof Error ? e.message : "?? ??? ???? ?????.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAttendance() {
    if (!member) return;
    if (!permissions.canCheckAttendance) {
      Alert.alert("??", permissions.denyReason);
      return;
    }

    const run = async (force: boolean) => {
      if (!force) {
        const dup = await hasAttendanceToday(member.id);
        if (dup) {
          Alert.alert(
            "?? ??",
            "?? ?? ?? ??? ?????. ??? ?? ?????????",
            [
              { text: "??", style: "cancel" },
              { text: "?? ??", onPress: () => void run(true) },
            ],
          );
          return;
        }
      }
      try {
        await recordAttendance(member.id);
        Alert.alert("??", `${member.name}? ??? ???????.`);
        await load();
      } catch (e) {
        Alert.alert("?? ??", e instanceof Error ? e.message : "?? ??? ??????.");
      }
    };

    await run(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: true, title: "?? ??" }} />
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  if (!member) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: true, title: "?? ??" }} />
        <Text>??? ?? ? ????.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: member.name }} />
      <Text style={styles.name}>{member.name}</Text>
      <Text style={styles.badge}>{formatStatus(member)}</Text>
      <Text style={styles.line}>{formatMembershipLabel(member)}</Text>
      {member.phone ? <Text style={styles.line}>???: {member.phone}</Text> : null}
      {member.start_date ? (
        <Text style={styles.line}>
          ??: {member.start_date.slice(0, 10)} ~ {member.end_date?.slice(0, 10) ?? "-"}
        </Text>
      ) : null}
      {member.last_visit_at ? (
        <Text style={styles.line}>?? ??: {member.last_visit_at.slice(0, 16).replace("T", " ")}</Text>
      ) : null}
      {member.memo ? <Text style={styles.memo}>??: {member.memo}</Text> : null}

      {permissions.canCheckAttendance ? (
        <Pressable style={styles.btn} onPress={() => void handleAttendance()}>
          <Text style={styles.btnText}>?? ??</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  name: { fontSize: 24, fontWeight: "800", color: "#0f172a" },
  badge: { marginTop: 8, fontSize: 14, color: "#0284c7", fontWeight: "600" },
  line: { marginTop: 10, fontSize: 15, color: "#334155" },
  memo: { marginTop: 16, fontSize: 14, color: "#64748b", lineHeight: 20 },
  btn: {
    marginTop: 28,
    backgroundColor: "#0284c7",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
