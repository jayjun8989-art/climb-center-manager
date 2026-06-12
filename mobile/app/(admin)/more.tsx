import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

const ITEMS = [
  { href: "/(admin)/attendance-today", label: "오늘 출석", desc: "오늘 출석한 회원 조회" },
  { href: "/(admin)/lockers", label: "락카 현황", desc: "락카 사용 현황 조회/수정" },
  { href: "/(admin)/changes", label: "변경 내역", desc: "회원/회원권/락카 수정·삭제 내역" },
  { href: "/(admin)/settings", label: "설정", desc: "계정, 버전, 업데이트" },
] as const;

export default function MoreScreen() {
  return (
    <View style={styles.container}>
      {ITEMS.map((item) => (
        <Pressable key={item.href} style={styles.row} onPress={() => router.push(item.href)}>
          <View>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.desc}>{item.desc}</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 12, gap: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  label: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  desc: { fontSize: 12, color: "#64748b", marginTop: 4 },
  arrow: { fontSize: 24, color: "#94a3b8" },
});
