import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as Updates from "expo-updates";
import { Stack, router } from "expo-router";
import { useApp } from "../../src/context/AppContext";
import { isSupabaseConfigured } from "../../src/lib/config";

const APP_VERSION = "mobile v0.1";

export default function SettingsScreen() {
  const { session, signOut } = useApp();
  const [checking, setChecking] = useState(false);

  async function checkForUpdate() {
    setChecking(true);
    try {
      if (__DEV__) {
        Alert.alert("업데이트", "개발 모드에서는 업데이트 확인이 비활성화되어 있습니다.");
        return;
      }
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert("업데이트", "최신 버전입니다.");
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert("업데이트", "새 업데이트를 다운로드했습니다. 앱을 다시 시작합니다.", [
        { text: "확인", onPress: () => void Updates.reloadAsync() },
      ]);
    } catch (e) {
      Alert.alert("업데이트 확인 실패", e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setChecking(false);
    }
  }

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "설정" }} />

      <View style={styles.row}>
        <Text style={styles.label}>로그인 계정</Text>
        <Text style={styles.value}>{session?.user.email ?? "-"}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>앱 버전</Text>
        <Text style={styles.value}>{APP_VERSION}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Supabase 연결</Text>
        <Text style={styles.value}>{isSupabaseConfigured() ? "연결됨" : "연결 안됨"}</Text>
      </View>

      <Pressable style={styles.btn} onPress={() => void checkForUpdate()} disabled={checking}>
        {checking ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>업데이트 확인</Text>}
      </Pressable>

      <Pressable style={[styles.btn, styles.logoutBtn]} onPress={() => void handleLogout()}>
        <Text style={styles.btnText}>로그아웃</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  label: { fontSize: 14, color: "#64748b", fontWeight: "600" },
  value: { fontSize: 14, color: "#0f172a", fontWeight: "700" },
  btn: { marginTop: 24, backgroundColor: "#0f172a", borderRadius: 12, padding: 16, alignItems: "center" },
  logoutBtn: { backgroundColor: "#dc2626", marginTop: 12 },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
