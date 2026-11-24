import { base64ToBytes } from '@/src/lib/base64';
import { friendlyOpenAIError } from '@/src/lib/errors';
import { aspectById } from '@/src/lib/presets';
import type { AspectId, ModelId } from '@/src/lib/types';

const ENDPOINT = 'https://api.openai.com/v1/images/generations';

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
};

async function oneImage(input: {
  apiKey: string;
  model: ModelId;
  prompt: string;
  size: string;
}): Promise<Uint8Array> {
  let response: Response;
  try {
    const body: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt,
      n: 1,
      size: input.size,
    };
    if (input.model === 'dall-e-3') {
      body.response_format = 'b64_json';
      body.quality = 'standard';
    } else {
      body.quality = 'medium';
      body.output_format = 'png';
    }
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach OpenAI. Check your connection and try again.");
  }

  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(friendlyOpenAIError(response.status, payload, raw));
  }

  const images = (payload as ImageResponse | null)?.data;
  const encoded = images?.[0]?.b64_json;
  if (!encoded) {
    throw new Error('OpenAI returned no image. Try again in a moment.');
  }
  return base64ToBytes(encoded);
}

export async function generateOpenAI(input: {
  apiKey: string;
  model: ModelId;
  prompt: string;
  aspectId: AspectId;
  count: number;
  size?: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ images: Uint8Array[]; warning?: string }> {
  const key = input.apiKey.trim();
  if (!key) {
    throw new Error('No OpenAI key yet. Add one in Settings, or switch the provider.');
  }
  const size = input.size || aspectById(input.aspectId).sizes[input.model];
  const images: Uint8Array[] = [];
  let warning: string | undefined;
  for (let index = 0; index < input.count; index += 1) {
    input.onProgress?.(index, input.count);
    try {
      images.push(
        await oneImage({
          apiKey: key,
          model: input.model,
          prompt: input.prompt,
          size,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenAI had a problem answering.';
      if (!images.length) throw new Error(message);
      warning = `Got ${images.length} of ${input.count} frames. ${message}`;
      break;
    }
  }
  input.onProgress?.(images.length, input.count);
  return { images, warning };
}

/** gpt-image-1 can edit a reference image. dall-e-3 cannot. */
export async function editOpenAIImage(input: {
  apiKey: string;
  prompt: string;
  png: Uint8Array;
  size: string;
}): Promise<Uint8Array> {
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', input.prompt);
  form.append('size', input.size);
  form.append('image', new Blob([Uint8Array.from(input.png)], { type: 'image/png' }), 'front.png');
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey.trim()}` },
      body: form,
    });
  } catch {
    throw new Error("Couldn't reach OpenAI. Check your connection and try again.");
  }
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(friendlyOpenAIError(response.status, payload, raw));
  const encoded = (payload as { data?: { b64_json?: string }[] } | null)?.data?.[0]?.b64_json;
  if (!encoded) throw new Error('OpenAI returned no edited image. Try the front view again.');
  return base64ToBytes(encoded);
}
