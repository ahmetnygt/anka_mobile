import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

export default function RootLayout() {
  return (
    <>
      {/* Stack yapısı: Sadece sayfalar arası geçiş içindir, tab bar yoktur */}
      <Stack screenOptions={{ headerShown: false }}>
        {/* Ana sayfa olarak index.tsx'i belirledik */}
        <Stack.Screen name="index" />
      </Stack>
      
      {/* Status Bar'ı global olarak gizle */}
      <StatusBar hidden={true} style="light" />
    </>
  );
}