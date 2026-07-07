import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useApp } from "../src/context/AppContext";
import { isAdminOrOwner } from "../src/lib/permissions";

export default function LoginScreen() {
  const { signIn, roles } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    setError("");
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그인 실패했습니다.");
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.brand}>ONCLE / GRABIT</Text>
      <Text style={styles.title}>클라이밍 센터 관리</Text>
      <Text style={styles.sub}>관리자 및 직원 전용</Text>

      <TextInput
        style={styles.input}
        placeholder="이메일"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="비밀번호"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => void handleLogin()}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.btn} onPress={() => void handleLogin()} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>로그인</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#f0f9ff" },
  brand: { fontSize: 13, fontWeight: "700", color: "#0284c7", letterSpacing: 1 },
  title: { fontSize: 26, fontWeight: "800", color: "#0f172a", marginTop: 8 },
  sub: { fontSize: 14, color: "#64748b", marginBottom: 28 },
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1",
    borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 16,
  },
  btn: {
    backgroundColor: "#0284c7", borderRadius: 12, padding: 16,
    alignItems: "center", marginTop: 8,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  error: { color: "#dc2626", marginBottom: 8, fontSize: 14 },
});
