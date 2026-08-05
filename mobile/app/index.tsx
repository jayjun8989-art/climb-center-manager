import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useApp } from "../src/context/AppContext";

export default function Index() {
  const { session, loading, rolesLoading, isAdmin } = useApp();

  if (loading || (session && rolesLoading)) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f0f9ff" }}>
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;
  if (isAdmin) return <Redirect href="/(admin)" />;
  return <Redirect href="/(app)/attendance" />;
}
