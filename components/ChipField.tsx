import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { TraitOption } from '@/src/lib/presets';
import { colors, font } from '@/src/theme';

export function ChipField({
  label,
  options,
  value,
  onChange,
  customPlaceholder,
}: {
  label: string;
  options: TraitOption[];
  value: string;
  onChange: (value: string) => void;
  customPlaceholder: string;
}) {
  const known = options.some((option) => option.id === value);
  const [custom, setCustom] = useState(Boolean(value) && !known);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map((option) => {
          const on = value === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setCustom(false);
                onChange(on ? '' : option.id);
              }}
              style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{option.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setCustom(true);
            if (known) onChange('');
          }}
          style={[styles.chip, custom && styles.chipOn]}>
          <Text style={[styles.chipText, custom && styles.chipTextOn]}>Custom</Text>
        </Pressable>
      </View>
      {custom ? (
        <TextInput
          value={known ? '' : value}
          onChangeText={onChange}
          placeholder={customPlaceholder}
          placeholderTextColor={colors.faint}
          style={styles.input}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  label: {
    color: colors.sakura,
    fontFamily: font.black,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipOn: {
    backgroundColor: 'rgba(255, 142, 199, 0.18)',
    borderColor: colors.sakura,
  },
  chipText: {
    color: colors.muted,
    fontFamily: font.bold,
    fontSize: 14,
  },
  chipTextOn: {
    color: colors.text,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ink,
    color: colors.text,
    fontFamily: font.semibold,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
