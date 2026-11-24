import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, font } from '@/src/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Missing', headerShown: true }} />
      <View style={styles.container}>
        <Text style={styles.title}>That screen wandered off.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Back to Create</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 24,
    gap: 12,
  },
  title: {
    color: colors.text,
    fontFamily: font.black,
    fontSize: 22,
  },
  link: {
    paddingVertical: 8,
  },
  linkText: {
    color: colors.sakura,
    fontFamily: font.bold,
    fontSize: 16,
  },
});
