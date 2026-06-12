import { Tabs, router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "../../src/context/AppContext";
import type { Center } from "../../src/types";

function CenterSwitcher() {
  const { center, setCenter, accessibleCenters } = useApp();

  return (
    <View style={styles.centers}>
      {(["ONCLE", "GRABIT"] as Center[]).map((c) => {
        const allowed = accessibleCenters.includes(c);
        return (
          <Pressable
            key={c}
            style={[styles.chip, center === c && styles.chipActive, !allowed && styles.chipDisabled]}
            disabled={!allowed}
            onPress={() => setCenter(c)}
          >
            <Text style={[styles.chipText, center === c && styles.chipTextActive]}>{c}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function AppLayout() {
  const { signOut } = useApp();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#0284c7" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: "#0284c7",
        headerRight: () => (
          <Pressable onPress={() => void signOut().then(() => router.replace("/login"))} style={{ marginRight: 12 }}>
            <Text style={{ color: "#fff", fontSize: 13 }}>????</Text>
          </Pressable>
        ),
        headerTitle: () => (
          <View>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>???? ??</Text>
            <CenterSwitcher />
          </View>
        ),
      }}
    >
      <Tabs.Screen name="attendance" options={{ title: "??", tabBarLabel: "?? ??" }} />
      <Tabs.Screen name="members" options={{ title: "??", tabBarLabel: "?? ??" }} />
      <Tabs.Screen
        name="member/[id]"
        options={{ href: null, title: "?? ??" }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centers: { flexDirection: "row", gap: 6, marginTop: 4 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  chipActive: { backgroundColor: "#fff" },
  chipDisabled: { opacity: 0.4 },
  chipText: { color: "#e0f2fe", fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#0284c7" },
});
