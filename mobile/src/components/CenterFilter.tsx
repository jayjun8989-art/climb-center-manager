import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Center } from "../types";

export type CenterFilterValue = Center | "ALL";

const OPTIONS: { value: CenterFilterValue; label: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "ONCLE", label: "ONCLE" },
  { value: "GRABIT", label: "GRABIT" },
];

export function CenterFilter({
  value,
  onChange,
}: {
  value: CenterFilterValue;
  onChange: (v: CenterFilterValue) => void;
}) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((opt) => (
        <Pressable
          key={opt.value}
          style={[styles.chip, value === opt.value && styles.chipActive]}
          onPress={() => onChange(opt.value)}
        >
          <Text style={[styles.text, value === opt.value && styles.textActive]}>{opt.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  chipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  text: { fontSize: 13, fontWeight: "600", color: "#475569" },
  textActive: { color: "#fff" },
});
