import type { CloudGate } from '@/src/lib/cloudGate';

export function cloudIsWaiting(gate: CloudGate): boolean {
  return gate === 'starting' || gate === 'stuck' || gate === 'slow' || gate === 'stopped';
}

export function shouldUsePhone(input: { provider: string; gate: CloudGate; auto: boolean; forced?: boolean }): boolean {
  if (input.provider !== 'salad') return false;
  if (!cloudIsWaiting(input.gate)) return false;
  return Boolean(input.forced) || input.auto;
}

export function phoneDropNote(input: { loras: number; reference: boolean }): string {
  const dropped: string[] = [];
  if (input.loras > 0) dropped.push('LoRA');
  if (input.reference) dropped.push('reference picture, ControlNet, and IP-Adapter');
  const kept = 'The prompt, clothes prompt, negative, character, and taste stay.';
  if (!dropped.length) return `Ran on this phone. ${kept}`;
  return `Ran on this phone. ${dropped.join(' and ')} need the cloud, so they were left out. ${kept}`;
}
