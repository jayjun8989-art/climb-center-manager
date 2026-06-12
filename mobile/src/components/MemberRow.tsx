import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MemberListRow } from "../types";
import { formatMembershipLabel, formatStatus } from "../lib/members";

type Props = {
  member: MemberListRow;
  onPress: () => void;
  onAttendance?: () => void;
  showAttendanceButton?: boolean;
};

export function MemberRow({ member, onPress, onAttendance, showAttendanceButton }: Props) {
  const status = formatStatus(member);
  const statusStyle =
    status === "??" ? styles.badgeActive : status === "??" ? styles.badgePaused : styles.badgeMuted;

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.main}>
        <Text style={styles.name}>{member.name}</Text>
        <View style={styles.meta}>
          <Text style={[styles.badge, statusStyle]}>{status}</Text>
          <Text style={styles.sub}>{formatMembershipLabel(member)}</Text>
        </View>
        {member.phone ? <Text style={styles.phone}>{member.phone}</Text> : null}
      </View>
      {showAttendanceButton && onAttendance ? (
        <Pressable
          style={styles.attendBtn}
          onPress={(e) => {
            if (e?.stopPropagation) e.stopPropagation();
            onAttendance();
          }}
        >
          <Text style={styles.attendBtnText}>??</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#fff",
  },
  main: { flex: 1 },
  name: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  sub: { fontSize: 13, color: "#64748b" },
  phone: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  badge: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  badgeActive: { backgroundColor: "#dcfce7", color: "#166534" },
  badgePaused: { backgroundColor: "#fef3c7", color: "#92400e" },
  badgeMuted: { backgroundColor: "#f1f5f9", color: "#475569" },
  attendBtn: {
    backgroundColor: "#0284c7",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginLeft: 8,
  },
  attendBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
