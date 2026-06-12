import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { MemberRow } from "../../src/components/MemberRow";
import { useApp } from "../../src/context/AppContext";
import { searchMembers } from "../../src/lib/members";
import type { MemberListRow } from "../../src/types";

export default function MembersScreen() {
  const { center } = useApp();
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<MemberListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMembers(await searchMembers(center, query));
    } catch (e) {
      setError(e instanceof Error ? e.message : "?? ??? ???? ?????.");
    } finally {
      setLoading(false);
    }
  }, [center, query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 300);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="?? ?? ???? ??..."
        value={query}
        onChangeText={setQuery}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#0284c7" />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              onPress={() => router.push(`/(app)/member/${item.id}`)}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>?? ??? ????.</Text>}
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
  error: { color: "#dc2626", marginHorizontal: 12, marginBottom: 8 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
});
