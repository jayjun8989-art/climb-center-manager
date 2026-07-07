import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useApp } from "../src/context/AppContext";
import { isSupabaseConfigured } from "../src/lib/config";

export default function Index() {
  const { session, loading, isAdmin, roles } = useApp();

  if (!isSupabaseConfigured()) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>설정 필요</Text>
        <Text style={styles.msg}>
          mobile/.env 파일에{"\n"}EXPO_PUBLIC_SUPABASE_URL{"\n"}EXPO_PUBLIC_SUPABASE_ANON_KEY 를{"\n"}설정해주세요.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;

  // 역할 로드 전 로딩 중
  if (session && roles.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  if (isAdmin) return <Redirect href="/(admin)" />;
  return <Redirect href="/(app)/attendance" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12 },
  msg: { textAlign: "center", color: "#64748b", lineHeight: 22 },
});
