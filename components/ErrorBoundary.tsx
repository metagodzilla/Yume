import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { pushLog } from '@/src/lib/log';
import { colors, font } from '@/src/theme';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  componentDidCatch(error: Error) {
    pushLog('error', error.message);
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center', gap: 12 }}>
        <Text style={{ color: colors.text, fontFamily: font.black, fontSize: 22 }}>Something broke</Text>
        <Text style={{ color: colors.muted, fontFamily: font.semibold }}>{this.state.message}</Text>
        <Pressable onPress={() => this.setState({ message: null })}>
          <Text style={{ color: colors.accent, fontFamily: font.black }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
