import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { MemberRow } from "../../src/components/MemberRow";
import { useApp } from "../../src/context/AppContext";
import { hasAttendanceToday, recordAttendance } from "../../src/lib/attendance";
import { searchMembers } from "../../src/lib/members";
import type { MemberListRow } from "../../src/types";

export default function AttendanceScreen() {
  const { center, permissions } = useApp();
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<MemberListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const list = await searchMembers(center, query);
      setMembers(list);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "?? ??? ???? ?????.");
    } finally {
      setLoading(false);
    }
  }, [center, query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 300);
    return () => clearTimeout(timer);
  }, [load]);

  async function handleAttendance(member: MemberListRow) {
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
        setMessage(`${member.name}? ?? ??`);
        await load();
      } catch (e) {
        Alert.alert("?? ??", e instanceof Error ? e.message : "?? ??? ??????.");
      }
    };

    await run(false);
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="?? ?? ???? ??..."
        value={query}
        onChangeText={setQuery}
      />
      {message ? <Text style={styles.toast}>{message}</Text> : null}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0284c7" />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              showAttendanceButton={permissions.canCheckAttendance}
              onPress={() => router.push(`/(app)/member/${item.id}`)}
              onAttendance={() => void handleAttendance(item)}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>?? ??? ????.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  search: {
    margin: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  toast: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    backgroundColor: "#e0f2fe",
    borderRadius: 8,
    color: "#0369a1",
    fontSize: 14,
  },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
