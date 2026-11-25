export type MeasureUnit = 'cm' | 'in';

export type Measurements = {
  bustCm?: number;
  waistCm?: number;
  hipCm?: number;
  heightCm?: number;
  unit?: MeasureUnit;
};

const CHILD = /\b(loli|lolita|shota|child|children|kid|kids|teen|teenage|underage|young girl|little girl|young boy|little boy|flat chest)\b/i;

export function isChildTag(tag: string): boolean {
  return CHILD.test(tag);
}

export function adultTags(): string[] {
  return ['adult', 'mature female'];
}

export function toCm(value: number, unit: MeasureUnit): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const cm = unit === 'in' ? value * 2.54 : value;
  return Math.round(cm * 10) / 10;
}

export function fromCm(cm: number, unit: MeasureUnit): number {
  if (!Number.isFinite(cm) || cm <= 0) return 0;
  const shown = unit === 'in' ? cm / 2.54 : cm;
  return Math.round(shown * 10) / 10;
}

export function bodyShapeTags(measurements: Measurements | null | undefined): string[] {
  if (!measurements) return [];
  const bust = measurements.bustCm ?? 0;
  const waist = measurements.waistCm ?? 0;
  const hip = measurements.hipCm ?? 0;
  const height = measurements.heightCm ?? 0;
  const tags: string[] = [];
  if (bust > 0) {
    if (bust < 82) tags.push('small breasts');
    else if (bust < 90) tags.push('medium breasts');
    else if (bust < 100) tags.push('large breasts');
    else tags.push('huge breasts');
  }
  if (waist > 0 && hip > 0) {
    const diff = hip - waist;
    if (waist <= 66 && diff >= 16) tags.push('narrow waist');
    if (hip >= 98 || diff >= 26) tags.push('wide hips');
    if (diff >= 24 && bust >= 88) tags.push('curvy');
    else if (waist <= 64 && hip <= 92) tags.push('slim');
  } else if (waist > 0 && waist <= 64) {
    tags.push('slim');
  }
  if (height > 0) {
    if (height < 155) tags.push('short');
    else if (height >= 170) tags.push('tall');
  }
  return tags.filter((tag) => !isChildTag(tag));
}

export function measurementLine(measurements: Measurements | null | undefined): string {
  if (!measurements) return '';
  const unit = measurements.unit === 'in' ? 'in' : 'cm';
  const show = (cm?: number) => (cm && cm > 0 ? String(fromCm(cm, unit)) : '');
  const bust = show(measurements.bustCm);
  const waist = show(measurements.waistCm);
  const hip = show(measurements.hipCm);
  const height = show(measurements.heightCm);
  const sizes = [bust && `bust ${bust}`, waist && `waist ${waist}`, hip && `hip ${hip}`].filter(Boolean).join(', ');
  const tall = height ? `height ${height}` : '';
  const text = [sizes, tall].filter(Boolean).join(' · ');
  return text ? `${text} ${unit}` : '';
}
