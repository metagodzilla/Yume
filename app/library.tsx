import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { uid } from '@/src/lib/id';
import { useStudio } from '@/src/studio';
import { colors, font } from '@/src/theme';

function WildcardCard({
  token,
  values,
  onSave,
  onDelete,
}: {
  token: string;
  values: string;
  onSave: (token: string, values: string[]) => void;
  onDelete: () => void;
}) {
  const [tokenDraft, setTokenDraft] = useState(token);
  const [valuesDraft, setValuesDraft] = useState(values);
  useEffect(() => setTokenDraft(token), [token]);
  useEffect(() => setValuesDraft(values), [values]);
  return (
    <View style={styles.card}>
      <TextInput
        value={tokenDraft}
        onChangeText={setTokenDraft}
        onBlur={() => onSave(tokenDraft.replace(/[^a-zA-Z0-9_]/g, ''), valuesDraft.split(',').map((item) => item.trim()).filter(Boolean))}
        autoCapitalize="none"
        style={styles.input}
      />
      <TextInput
        value={valuesDraft}
        onChangeText={setValuesDraft}
        onBlur={() => onSave(tokenDraft.replace(/[^a-zA-Z0-9_]/g, ''), valuesDraft.split(',').map((item) => item.trim()).filter(Boolean))}
        placeholder="pink, silver, black"
        placeholderTextColor={colors.faint}
        style={styles.input}
      />
      <Pressable onPress={onDelete}>
        <Text style={styles.danger}>Delete snippet</Text>
      </Pressable>
    </View>
  );
}

export default function LibraryScreen() {
  const studio = useStudio();
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState<string | null>(null);

  async function copyExport() {
    const json = studio.exportLibrary();
    await Clipboard.setStringAsync(json);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      link.download = 'yume-presets.json';
      link.click();
    }
    setNote(Platform.OS === 'web' ? 'Copied and downloaded yume-presets.json.' : 'Copied the JSON. Paste it into another phone to import.');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.kicker}>Snippets</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.body}>
          A snippet is a list behind a token. {'{hair_color}'} in a prompt or a style becomes one of the words below when Expand snippets is on.
        </Text>
        {studio.library.wildcards.map((card) => (
          <WildcardCard key={card.id} token={card.token} values={card.values.join(', ')} onSave={(token, values) => void studio.saveWildcard({ ...card, token, values })} onDelete={() => void studio.deleteWildcard(card.id)} />
        ))}
        <Pressable
          style={styles.add}
          onPress={() => void studio.saveWildcard({ id: uid('wild'), token: 'new_token', values: ['option one', 'option two'] })}>
          <Text style={styles.addText}>New snippet</Text>
        </Pressable>

        <Text style={styles.heading}>Prompt templates</Text>
        {studio.library.templates.map((template) => (
          <View key={template.id} style={styles.card}>
            <TextInput
              value={template.name}
              onChangeText={(name) => void studio.saveTemplate({ ...template, name })}
              style={styles.input}
            />
            <TextInput
              value={template.prompt}
              onChangeText={(prompt) => void studio.saveTemplate({ ...template, prompt })}
              multiline
              style={[styles.input, styles.area]}
            />
            <TextInput
              value={template.negative}
              onChangeText={(negative) => void studio.saveTemplate({ ...template, negative })}
              placeholder="Negative, optional"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />
            <View style={styles.row}>
              <Pressable onPress={() => { studio.applyTemplate(template); router.navigate('/'); }}>
                <Text style={styles.link}>Use</Text>
              </Pressable>
              <Pressable onPress={() => void studio.deleteTemplate(template.id)}>
                <Text style={styles.danger}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Pressable
          style={styles.add}
          onPress={() => void studio.saveTemplate({ id: uid('tpl'), name: 'New template', prompt: '', negative: '' })}>
          <Text style={styles.addText}>New template</Text>
        </Pressable>

        <Text style={styles.heading}>Import and export</Text>
        <Pressable style={styles.add} onPress={() => void copyExport()}>
          <Text style={styles.addText}>Export JSON</Text>
        </Pressable>
        <TextInput
          value={raw}
          onChangeText={setRaw}
          placeholder="Paste a Yume preset file"
          placeholderTextColor={colors.faint}
          multiline
          style={[styles.input, styles.area]}
        />
        <View style={styles.row}>
          <Pressable
            onPress={() => {
              void studio.importLibrary(raw, 'merge').then(setNote);
            }}>
            <Text style={styles.link}>Merge</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void studio.importLibrary(raw, 'replace').then(setNote);
            }}>
            <Text style={styles.danger}>Replace</Text>
          </Pressable>
        </View>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  kicker: { color: colors.sakura, fontFamily: font.black, letterSpacing: 1, textTransform: 'uppercase' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  heading: { color: colors.text, fontFamily: font.black, fontSize: 18, marginTop: 8 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 8 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.text,
    fontFamily: font.semibold,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  area: { minHeight: 72, textAlignVertical: 'top' },
  add: { backgroundColor: colors.sakura, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start' },
  addText: { color: colors.ink, fontFamily: font.black },
  row: { flexDirection: 'row', gap: 16 },
  link: { color: colors.sakura, fontFamily: font.black },
  danger: { color: colors.danger, fontFamily: font.black },
  note: { color: colors.ok, fontFamily: font.bold },
});
