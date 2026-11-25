import { fetchResources } from '@/src/lib/checkpointUse';
import { keepInstalled } from '@/src/lib/restoreModels';
import { friendlyLoraMessage, missingSelectedLoras } from '@/src/lib/loraGate';
import { runModelInstall } from '@/src/lib/modelInstall';

export async function ensureSelectedLoras(input: {
  loras: { name: string; versionId?: number; baseModel?: string; triggers?: string[] }[];
  endpoint: string;
  apiKey: string;
  civitaiToken?: string | null;
  onProgress: (label: string) => void;
}): Promise<void> {
  const catalog = await fetchResources(input.endpoint, input.apiKey);
  const missing = missingSelectedLoras(input.loras, catalog.models);
  for (const lora of missing) {
    if (!lora.versionId) throw new Error(friendlyLoraMessage(`LoRA not found on the server: ${lora.name}`));
    const filename = /\.(safetensors|pt|ckpt|bin)$/i.test(lora.name) ? lora.name : `${lora.name}.safetensors`;
    await keepInstalled({
      versionId: lora.versionId,
      type: 'LORA',
      name: lora.name,
      filename,
      baseModel: lora.baseModel,
      triggers: lora.triggers,
    });
    await runModelInstall({
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      civitaiToken: input.civitaiToken,
      versionId: lora.versionId,
      type: 'LORA',
      name: lora.name,
      filename,
      baseModel: lora.baseModel,
      triggers: lora.triggers,
      onProgress: (_label, fraction) => input.onProgress(`Downloading LoRA ${Math.round(fraction * 100)}%`),
    });
  }
}
