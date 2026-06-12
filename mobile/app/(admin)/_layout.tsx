import { useEffect } from "react";
import { Tabs, router } from "expo-router";
import { Alert } from "react-native";
import { useApp } from "../../src/context/AppContext";
import { GRABON_ADMIN_EMAIL } from "../../src/lib/admin";

export default function AdminLayout() {
  const { session, loading, signOut } = useApp();

  useEffect(() => {
    if (loading) return;
    if (!session || session.user.email !== GRABON_ADMIN_EMAIL) {
      void signOut().then(() => {
        Alert.alert("접근 제한", "모바일 앱은 관리자 계정만 사용할 수 있습니다.");
        router.replace("/login");
      });
    }
  }, [session, loading, signOut]);

  if (loading || !session || session.user.email !== GRABON_ADMIN_EMAIL) {
    return null;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: "#0f172a",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "GRABON Manager", tabBarLabel: "홈" }} />
      <Tabs.Screen name="members" options={{ title: "회원", tabBarLabel: "회원" }} />
      <Tabs.Screen name="status" options={{ title: "회원 현황", tabBarLabel: "현황" }} />
      <Tabs.Screen name="more" options={{ title: "더보기", tabBarLabel: "더보기" }} />
      <Tabs.Screen name="member/[id]" options={{ href: null, title: "회원 상세" }} />
      <Tabs.Screen name="lockers" options={{ href: null, title: "락카 현황" }} />
      <Tabs.Screen name="locker/[id]" options={{ href: null, title: "락카 수정" }} />
      <Tabs.Screen name="changes" options={{ href: null, title: "변경 내역" }} />
      <Tabs.Screen name="attendance-today" options={{ href: null, title: "오늘 출석" }} />
      <Tabs.Screen name="settings" options={{ href: null, title: "설정" }} />
    </Tabs>
  );
}
