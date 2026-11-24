function errorParts(payload: unknown, raw: string): { code: string; message: string } {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return { code: '', message: raw };
  }
  const error = (payload as { error?: { code?: unknown; type?: unknown; message?: unknown } }).error;
  if (!error || typeof error !== 'object') return { code: '', message: raw };
  const code = String(error.code || error.type || '');
  const message = String(error.message || raw || '');
  return { code, message };
}

function scrub(message: string): string {
  return message.replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-…').replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function friendlyOpenAIError(status: number, payload: unknown, raw = ''): string {
  const { code, message } = errorParts(payload, raw);
  const blob = `${code} ${message}`.toLowerCase();

  if (
    status === 401 ||
    code === 'invalid_api_key' ||
    blob.includes('incorrect api key') ||
    blob.includes('invalid api key')
  ) {
    return 'OpenAI rejected that key. In Settings, replace it with a current key from platform.openai.com. It should start with sk-.';
  }

  if (status === 429 || code === 'rate_limit_exceeded' || blob.includes('rate limit')) {
    return 'OpenAI is rate-limiting this key. Give it a minute, then draw again.';
  }

  if (
    code === 'insufficient_quota' ||
    blob.includes('insufficient_quota') ||
    blob.includes('exceeded your current quota') ||
    blob.includes('billing_hard_limit')
  ) {
    return 'This OpenAI account is out of image credits. Check billing on platform.openai.com, or turn Demo studio back on.';
  }

  if (
    code === 'content_policy_violation' ||
    blob.includes('content policy') ||
    blob.includes('safety system') ||
    blob.includes('moderation_blocked') ||
    blob.includes('rejected by the safety')
  ) {
    return 'OpenAI declined this prompt under its content policy. Try describing the scene more gently.';
  }

  const clean = scrub(message);
  if (status === 400) {
    return clean
      ? `OpenAI couldn't use that request. ${clean}`
      : 'OpenAI could not use that request. Try a shorter prompt.';
  }

  return 'OpenAI had a problem answering. Try again in a moment.';
}
