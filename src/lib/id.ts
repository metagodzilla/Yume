export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ago(timestamp: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function blankCharacter(id = uid('cast')): import('@/src/lib/types').Character {
  return {
    id,
    name: '',
    saved: true,
    hairColor: '',
    hairStyle: '',
    eyeColor: '',
    outfit: '',
    expression: '',
    pose: '',
    setting: '',
    lighting: '',
    notes: '',
    updatedAt: Date.now(),
  };
}
