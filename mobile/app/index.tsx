import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useApp } from "../src/context/AppContext";
import { isSupabaseConfigured } from "../src/lib/config";
import { GRABON_ADMIN_EMAIL } from "../src/lib/admin";

export default function Index() {
  const { session, loading } = useApp();

  if (!isSupabaseConfigured()) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>?? ??</Text>
        <Text style={styles.msg}>
          mobile/.env ???{"\n"}EXPO_PUBLIC_SUPABASE_URL{"\n"}EXPO_PUBLIC_SUPABASE_ANON_KEY ?
          ??????.
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

  if (!session) {
    return <Redirect href="/login" />;
  }

  if (session.user.email === GRABON_ADMIN_EMAIL) {
    return <Redirect href="/(admin)" />;
  }

  return <Redirect href="/(app)/attendance" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12 },
  msg: { textAlign: "center", color: "#64748b", lineHeight: 22 },
});
