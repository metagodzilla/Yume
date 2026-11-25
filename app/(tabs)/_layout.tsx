import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { colors, font } from '@/src/theme';

function iconColor(color: unknown): string {
  return typeof color === 'string' ? color : colors.faint;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: font.bold, fontSize: 11 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home" color={iconColor(color)} size={size} /> }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore', tabBarIcon: ({ color, size }) => <Ionicons name="compass" color={iconColor(color)} size={size} /> }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: ({ size }) => <Ionicons name="add-circle" color={colors.accent} size={size + 8} />,
        }}
      />
      <Tabs.Screen name="upscale" options={{ title: 'Upscale', tabBarIcon: ({ color, size }) => <Ionicons name="expand" color={iconColor(color)} size={size} /> }} />
      <Tabs.Screen name="manga" options={{ title: 'Manga', tabBarIcon: ({ color, size }) => <Ionicons name="book" color={iconColor(color)} size={size} /> }} />
      <Tabs.Screen name="queue" options={{ title: 'Queue', tabBarIcon: ({ color, size }) => <Ionicons name="time" color={iconColor(color)} size={size} /> }} />
      <Tabs.Screen name="shelf" options={{ title: 'Library', tabBarIcon: ({ color, size }) => <Ionicons name="library" color={iconColor(color)} size={size} /> }} />
      <Tabs.Screen name="models" options={{ href: null, tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="history" options={{ href: null, tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings" options={{ tabBarItemStyle: { display: 'none' } }} />
    </Tabs>
  );
}
