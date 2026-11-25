export type LoraChoice = {
  versionId: number;
  name: string;
  filename?: string;
  baseModel?: string;
  triggers?: string[];
  type?: string;
  restoring?: boolean;
};

export function loraStem(name: string): string {
  return name
    .replace(/^.*[\\/]/, '')
    .replace(/\.(safetensors|pt|ckpt|bin)$/i, '')
    .trim()
    .toLowerCase();
}

export function isLoraType(type?: string): boolean {
  const kind = (type || '').toLowerCase().replace(/[\s_]/g, '');
  return kind === 'lora' || kind === 'locon' || kind === 'lycoris' || kind === 'dora';
}

export function loraChoices(
  serverModels: { versionId: number; name: string; filename?: string; baseModel?: string; triggers?: string[]; type?: string }[],
  restoring: { versionId: number; name: string; filename?: string; baseModel?: string; triggers?: string[]; type?: string }[],
): LoraChoice[] {
  const installed = serverModels.filter((item) => isLoraType(item.type)).map((item) => ({ ...item, restoring: false }));
  const present = new Set(installed.map((item) => item.versionId));
  const pending = restoring
    .filter((item) => isLoraType(item.type) && !present.has(item.versionId))
    .map((item) => ({ ...item, restoring: true }));
  return [...installed, ...pending];
}

export function missingSelectedLoras<T extends { name: string; versionId?: number }>(
  selected: T[],
  serverModels: { versionId: number; filename?: string; name?: string; type?: string }[],
): T[] {
  const ids = new Set(serverModels.filter((item) => isLoraType(item.type)).map((item) => item.versionId));
  const stems = new Set(
    serverModels.filter((item) => isLoraType(item.type)).flatMap((item) => [loraStem(item.filename || ''), loraStem(item.name || '')]).filter(Boolean),
  );
  return selected.filter((item) => {
    if (item.versionId && ids.has(item.versionId)) return false;
    const stem = loraStem(item.name);
    return !stem || !stems.has(stem);
  });
}

export function friendlyLoraMessage(message: string): string {
  if (/lora not found on the server/i.test(message)) return 'That LoRA is not on the cloud yet. Yume will download it before drawing.';
  if (/^installing\b/i.test(message)) return 'Downloading that LoRA. It will be ready in a moment.';
  return message;
}
