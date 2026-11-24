import { MochiyPopOne_400Regular } from '@expo-google-fonts/mochiy-pop-one';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import 'react-native-reanimated';

import { AppErrorBoundary } from '@/components/ErrorBoundary';
import { IdleStop } from '@/components/IdleStop';
import { Viewer } from '@/components/Viewer';
import { installErrorHooks } from '@/src/lib/log';
import { StudioProvider, useStudio } from '@/src/studio';
import { colors } from '@/src/theme';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.ink,
    text: colors.text,
    border: colors.line,
    primary: colors.sakura,
    notification: colors.sakuraDeep,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    MochiyPopOne_400Regular,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;
  installErrorHooks();

  return (
    <AppErrorBoundary>
    <StudioProvider>
      <FirstLaunch />
      <IdleStop />
      <StatusBar style="light" />
      <ThemeProvider value={navTheme}>
        <View style={phone.outer}>
          <View style={phone.inner}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="character" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="styles" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="library" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="turnaround" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="mesh" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="model" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="import" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="cloud-check" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="setup" options={{ animation: 'fade' }} />
              <Stack.Screen name="connect" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="report" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="offline" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="watch" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="shorts" options={{ animation: 'fade' }} />
            </Stack>
          </View>
        </View>
      </ThemeProvider>
      <Viewer />
    </StudioProvider>
    </AppErrorBoundary>
  );
}

function FirstLaunch() {
  const studio = useStudio();
  const path = usePathname();
  useEffect(() => {
    if (!studio.ready || studio.settings.setupComplete) return;
    if (path === '/setup' || path === '/connect') return;
    router.replace('/setup');
  }, [path, studio.ready, studio.settings.setupComplete]);
  return null;
}

const phone = {
  outer: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? '#07040c' : colors.bg,
    alignItems: Platform.OS === 'web' ? ('center' as const) : ('stretch' as const),
  },
  inner: {
    flex: 1,
    width: '100%' as const,
    maxWidth: Platform.OS === 'web' ? 480 : undefined,
    backgroundColor: colors.bg,
  },
};
