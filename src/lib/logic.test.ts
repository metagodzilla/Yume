import { extractLoras, formatParameters, parseParameters, plainPrompt } from '@/src/lib/a1111';
import { bytesToBase64, base64ToBytes } from '@/src/lib/base64';
import { DEFAULT_CHECKPOINT } from '@/src/lib/defaultModel';
import { embedParameters, readParameters } from '@/src/lib/pngmeta';
import { composePreview } from '@/src/lib/compose';
import { friendlyOpenAIError } from '@/src/lib/errors';
import {
  builtinStyles,
  defaultLibrary,
  defaultWildcards,
  duplicateStyle,
  exportBundle,
  mergeLibrary,
  moveStyle,
  parseBundle,
} from '@/src/lib/library';
import { ASPECTS, STYLES } from '@/src/lib/presets';
import { buildEnhancedPrompt, characterClause } from '@/src/lib/prompt';
import { buildMockGlb, parseGlb } from '@/src/lib/glb';
import { encodePng } from '@/src/lib/png';
import { produceImages, resolveSeeds } from '@/src/lib/produce';
import { renderDemoFrames } from '@/src/lib/render';
import { buildSaladBody, saladErrorMessage } from '@/src/lib/salad';
import { browsingParams, civitaiModelUrl, filterModels, loraPage, pickPreview, thumbnailUrl, type CivitaiModel } from '@/src/lib/civitai';
import { buildYumeContainerGroup, choicesFromGpuClasses, costLine, describeDeploy, maskKey, pickDefaultGpu, serverUrlFromLink, shouldIdleStop } from '@/src/lib/saladCloud';
import { capReached, cloudChecklist, deploymentForEndpoint, formatCostLine, sessionUsd } from '@/src/lib/cloudSteps';
import { classifyHeat, estimatePowerWatts, shouldKeepScreenAwake, throttleFor, throttleSteps } from '@/src/lib/phonePower';
import { composeSheet, decodePng } from '@/src/lib/sheet';
import { applyInstruction, consistencyNote, expressionPrompt, undoVersion, viewPrompt } from '@/src/lib/turnaround';
import type { Character } from '@/src/lib/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const banned = [
  'ghibli',
  'miyazaki',
  'disney',
  'pixar',
  'kyoto animation',
  'ufotable',
  'toei',
  'shonen jump',
  'pokemon',
  'naruto',
];

function assertClean(text: string, label: string) {
  const lower = text.toLowerCase();
  for (const word of banned) {
    assert(!lower.includes(word), `${label} contains "${word}"`);
  }
}

const character: Character = {
  id: 'aoi',
  name: 'Aoi',
  saved: true,
  hairColor: 'pink',
  hairStyle: 'twintails',
  eyeColor: 'crimson',
  outfit: 'cape',
  expression: 'smile',
  pose: 'standing',
  setting: 'shrine',
  lighting: 'moon',
  updatedAt: 0,
};

for (const style of STYLES) {
  assertClean(style.lead, `${style.id} lead`);
  assertClean(style.finish, `${style.id} finish`);
}

for (const aspect of ASPECTS) assertClean(aspect.composition, aspect.id);

for (const style of STYLES) {
  for (const aspect of ASPECTS) {
    const prompt = buildEnhancedPrompt({
      userPrompt: 'waiting in the rain with a paper fox mask',
      styleId: style.id,
      aspectId: aspect.id,
      character,
    });
    assertClean(prompt, `${style.id}/${aspect.id}`);
    assert(!prompt.includes(style.note), `${style.id} UI note leaked into the prompt`);
    assert(!prompt.includes('Aoi'), 'character name leaked into the prompt');
    assert(prompt.includes('paper fox mask'), 'user scene missing');
    assert(prompt.includes('sakura-pink hair in long twin tails'), 'character traits missing');
    assert(prompt.includes(aspect.composition), 'aspect composition missing');
    assert(prompt.includes(style.lead), 'style lead missing');
  }
}

const empty: Character = { ...character, hairColor: '', hairStyle: '', eyeColor: '', outfit: '', expression: '', pose: '', setting: '', lighting: '' };
assert(characterClause(empty) === '', 'empty sheet should not invent a character');

const roundtrip = new Uint8Array([0, 1, 2, 250, 255, 127]);
const decoded = base64ToBytes(bytesToBase64(roundtrip));
assert(decoded.length === roundtrip.length, 'base64 length');
for (let i = 0; i < roundtrip.length; i += 1) assert(decoded[i] === roundtrip[i], 'base64 byte');

assert(
  friendlyOpenAIError(401, { error: { code: 'invalid_api_key', message: 'Incorrect API key' } }).includes('rejected that key'),
  'bad key',
);
assert(
  friendlyOpenAIError(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit' } }).includes('rate-limiting'),
  'rate limit',
);
assert(
  friendlyOpenAIError(400, { error: { code: 'content_policy_violation', message: 'safety' } }).includes('content policy'),
  'policy',
);
assert(
  friendlyOpenAIError(402, { error: { code: 'insufficient_quota', message: 'quota' } }).includes('credits'),
  'quota',
);
const scrubbed = friendlyOpenAIError(400, { error: { message: 'bad sk-proj-secret123 value' } });
assert(!scrubbed.includes('secret'), 'key leaked in error');

const started = Date.now();
const frames = renderDemoFrames({
  prompt: 'rain on the shrine steps',
  styleId: 'watercolor',
  aspectId: 'wallpaper',
  character,
  count: 2,
});
assert(frames.length === 2, 'frame count');
assert(frames[0][0] === 137 && frames[0][1] === 80 && frames[0][2] === 78 && frames[0][3] === 71, 'png signature');
assert(frames[0].length !== frames[1].length || frames[0][80] !== frames[1][80], 'frames should vary');
const view = new DataView(frames[0].buffer, frames[0].byteOffset, frames[0].byteLength);
assert(view.getUint32(16) === 540 && view.getUint32(20) === 960, 'wallpaper size');
console.log(`logic ok in ${Date.now() - started}ms, png ${frames[0].length} bytes`);

const library = defaultLibrary();
const watercolor = builtinStyles().find((style) => style.id === 'watercolor') ?? builtinStyles()[0];
for (const style of builtinStyles()) {
  assertClean(style.prefix, `${style.id} prefix`);
  assertClean(style.suffix, `${style.id} suffix`);
  assertClean(style.negative, `${style.id} negative`);
  assert(!style.prefix.includes(style.note) && !style.suffix.includes(style.note), `${style.id} note leaked`);
}

const raw = composePreview({
  userPrompt: 'exactly this {hair_color}',
  enhance: false,
  expandSnippets: false,
  style: watercolor,
  aspectId: 'wallpaper',
  character: null,
  wildcards: defaultWildcards(),
});
assert(raw === 'exactly this {hair_color}', `raw mode changed the prompt: ${raw}`);

const expanded = composePreview({
  userPrompt: 'exactly this {hair_color}',
  enhance: false,
  expandSnippets: true,
  style: watercolor,
  aspectId: 'wallpaper',
  character: null,
  wildcards: defaultWildcards(),
  rng: () => 0,
});
assert(expanded === 'exactly this black', `snippet did not expand: ${expanded}`);

const wrapped = composePreview({
  userPrompt: 'rain on the steps',
  enhance: true,
  expandSnippets: false,
  style: watercolor,
  aspectId: 'avatar',
  character,
  wildcards: [],
});
assert(wrapped.includes(watercolor.prefix), 'enhancer dropped the prefix');
assert(wrapped.includes('sakura-pink hair'), 'enhancer dropped the character');
assert(wrapped.includes('rain on the steps'), 'enhancer dropped the scene');
assert(!wrapped.toLowerCase().includes('ghibli'), 'enhancer added a studio name');
assert(!wrapped.includes('Aoi'), 'enhancer added the character name');

const seeds = resolveSeeds('fixed', 10, 3, () => 0);
assert(seeds.join(',') === '10,11,12', `seeds ${seeds.join(',')}`);

const body = buildSaladBody({
  prompt: wrapped,
  negative: watercolor.negative,
  width: 832,
  height: 1216,
  count: 2,
  seed: 10,
  steps: 20,
  cfg: 5.5,
  sampler: 'euler_a',
  model: 'cagliostrolab/animagine-xl-4.0',
  loras: [{ id: '1', name: 'ribbon.safetensors', weight: 0.7 }],
});
assert(body.seed === 10 && body.steps === 20 && body.cfg === 5.5 && body.scheduler === 'euler_a', 'salad body dropped settings');
assert(body.loras[0]?.name === 'ribbon.safetensors' && body.loras[0]?.weight === 0.7, 'lora missing');
assert(body.model === 'cagliostrolab/animagine-xl-4.0', 'checkpoint missing');
assert(!body.reference_image, 'plain salad body should not send a reference');
const referenced = buildSaladBody({
  prompt: wrapped,
  negative: watercolor.negative,
  width: 832,
  height: 1216,
  count: 1,
  seed: 10,
  steps: 20,
  cfg: 5.5,
  sampler: 'euler_a',
  model: '',
  loras: [],
  referencePng: new Uint8Array([137, 80, 78, 71]),
});
assert(referenced.mode === 'img2img' && referenced.strength === 0.45 && Boolean(referenced.reference_image), 'reference image was dropped');

const frontPrompt = viewPrompt(character, 'full-body front view, facing the viewer');
const sidePrompt = viewPrompt(character, 'full-body exact side profile, facing left');
assert(frontPrompt.includes('sakura-pink hair') && sidePrompt.includes('sakura-pink hair'), 'angles lost the character');
assert(frontPrompt !== sidePrompt && sidePrompt.includes('side profile'), 'angles used the same wording');
assert(!frontPrompt.includes('Aoi'), 'turnaround prompt included the name');
const frontPng = renderDemoFrames({
  prompt: 'front',
  styleId: 'watercolor',
  aspectId: 'wallpaper',
  character,
  count: 1,
  seed: 10,
  angle: 'front',
})[0];
const backPng = renderDemoFrames({
  prompt: 'front',
  styleId: 'watercolor',
  aspectId: 'wallpaper',
  character,
  count: 1,
  seed: 10,
  angle: 'back',
})[0];
let anglesDiffer = frontPng.length !== backPng.length;
for (let i = 0; i < frontPng.length && !anglesDiffer; i += 64) anglesDiffer = frontPng[i] !== backPng[i];
assert(anglesDiffer, 'front and back views were the same picture');

const longer = applyInstruction(character, 'make her hair longer');
assert(longer.character.hairStyle === 'long', 'hair longer did not stick');
assert(longer.character.eyeColor === 'crimson', 'a hair note wiped the eyes');
const jacket = applyInstruction(character, 'jacket should be red');
assert(jacket.character.outfit === 'a red jacket', `outfit became ${jacket.character.outfit}`);
const hands = applyInstruction(character, 'fix the hands on the side view');
assert(hands.character.hairStyle === 'twintails' && hands.character.notes === 'fix the hands on the side view', 'a hand note changed the design');
assert(expressionPrompt(character, 'angry').includes('angry'), 'expression prompt dropped the mood');
assert(consistencyNote('demo', 'gpt-image-1').toLowerCase().includes('does not copy pixels'), 'demo note overclaims');
assert(consistencyNote('openai', 'dall-e-3').toLowerCase().includes('cannot edit'), 'dall-e note overclaims');

const pixel = new Uint8ClampedArray(8 * 8 * 4);
pixel[0] = 10;
pixel[1] = 20;
pixel[2] = 30;
pixel[3] = 255;
const round = decodePng(encodePng(8, 8, pixel));
assert(round.width === 8 && round.rgba[0] === 10 && round.rgba[1] === 20, 'png decode did not round-trip');
const sheet = composeSheet(
  [
    { label: 'FRONT', png: encodePng(8, 8, pixel) },
    { label: 'SIDE', png: encodePng(8, 8, pixel) },
  ],
  16,
  16,
);
assert(sheet[0] === 137 && sheet[1] === 80, 'sheet is not a png');
const sheetSize = decodePng(sheet);
assert(sheetSize.width > 16, 'sheet is not wider than one cell');
const glb = buildMockGlb({ hair: 'pink', outfit: 'cape', eye: 'blue' });
assert(glb[0] === 0x67 && glb[1] === 0x6c && glb[2] === 0x54 && glb[3] === 0x46, 'stand-in is not a glb');
const parsed = parseGlb(glb);
assert(parsed.length === 1 && parsed[0]!.positions.length > 30, 'stand-in mesh was empty');
assert(parsed[0]!.png?.[0] === 137, 'stand-in has no png texture');
const darker = buildMockGlb({ hair: 'black', outfit: 'kimono', eye: 'gold' });
assert(darker.some((byte, index) => byte !== glb[index]), 'hair color did not change the glb');
assert(DEFAULT_CHECKPOINT.versionId === 1337429 && DEFAULT_CHECKPOINT.hash === '1d5b43ff75', 'default checkpoint drifted');
const tagged = extractLoras('a shrine <lora:ribbon:0.8> at dusk');
assert(tagged.loras[0]?.name === 'ribbon' && tagged.loras[0]?.weight === 0.8, 'lora tag was not read');
assert(!tagged.prompt.includes('<lora:'), 'lora tag stayed in the prompt');
assert(plainPrompt('(red hair:1.4), [blurry]').includes('red hair') && !plainPrompt('(red hair:1.4)').includes('1.4'), 'weights were not simplified');
const parameters = formatParameters({
  prompt: 'a shrine',
  negative: 'lowres',
  steps: 25,
  sampler: 'Euler a',
  cfg: 6,
  seed: 42,
  width: 832,
  height: 1216,
  model: DEFAULT_CHECKPOINT.name,
  modelHash: DEFAULT_CHECKPOINT.hash,
  clipSkip: 2,
  loras: [{ name: 'ribbon', weight: 0.8 }],
  hires: null,
});
const imported = parseParameters(parameters);
assert(imported.prompt === 'a shrine' && imported.sampler === 'Euler a' && imported.seed === 42 && imported.clipSkip === 2, 'parameters did not round-trip');
assert(imported.loras?.[0]?.name === 'ribbon', 'lora hash line was dropped');
const taggedPng = embedParameters(encodePng(2, 2, new Uint8ClampedArray(16).fill(255)), parameters);
assert(readParameters(taggedPng)?.includes('Model hash: 1d5b43ff75'), 'png dropped the parameters chunk');

import { interpretConnection } from '@/src/lib/connection';
import { profileFor, offlineBlockedReason } from '@/src/lib/offline';
import { buildReport, redact } from '@/src/lib/report';
import { checksumMatches, parseManifest, updateAvailable } from '@/src/lib/updates';
import { capWarning, sessionCost } from '@/src/lib/usage';
import {
  cancelJob,
  emptyQueue,
  enqueue,
  markFailed,
  moveToTop,
  pauseJob,
  recover,
  resumeAll,
  resumeJob,
  thermalPause,
  thermalResume,
} from '@/src/lib/queue';

const demoConn = interpretConnection({ provider: 'demo', endpoint: '', hasKey: false });
assert(demoConn.kind === 'demo', 'demo status');
const offlineConn = interpretConnection({
  provider: 'salad',
  endpoint: 'https://gpu.example',
  hasKey: true,
  health: { ok: false, ms: 12, error: 'timeout' },
});
assert(offlineConn.kind === 'offline' && offlineConn.detail.toLowerCase().includes('time'), 'timeout status');
const startingConn = interpretConnection({
  provider: 'salad',
  endpoint: 'https://gpu.example',
  hasKey: true,
  health: { ok: true, status: 200, ms: 40, body: { gpu: 'RTX 3090', model: 'Animagine XL 4.0' } },
  ready: { ok: false, status: 503, ms: 41, body: { detail: 'Model is still downloading.' } },
});
assert(startingConn.kind === 'starting' && startingConn.latencyMs === 40, 'starting status');
const authConn = interpretConnection({
  provider: 'salad',
  endpoint: 'https://gpu.example',
  hasKey: true,
  health: { ok: true, status: 200, ms: 20, body: { model: 'Animagine XL 4.0' } },
  ready: { ok: true, status: 200, ms: 21 },
  auth: { ok: false, status: 401, ms: 22 },
});
assert(authConn.kind === 'auth', 'auth status');
const okConn = interpretConnection({
  provider: 'salad',
  endpoint: 'https://gpu.example',
  hasKey: true,
  health: { ok: true, status: 200, ms: 18, body: { gpu: 'RTX 3090', model: 'Animagine XL 4.0' } },
  ready: { ok: true, status: 200, ms: 19 },
  auth: { ok: true, status: 200, ms: 19 },
});
assert(okConn.kind === 'connected' && okConn.model === 'Animagine XL 4.0', 'connected status');

let queue = enqueue(emptyQueue(), { id: 'a', kind: 'generate', title: 'frame', createdAt: 1 });
queue = enqueue(queue, { id: 'b', kind: 'install', title: 'lora', createdAt: 2 });
queue = pauseJob(queue, 'a');
assert(queue.jobs.find((job) => job.id === 'a')?.pausedByUser, 'pause marks the user');
const recovered = recover(queue, true);
assert(recovered.state.jobs.find((job) => job.id === 'a')?.status === 'paused', 'user pause survives reconnect');
queue = resumeJob(queue, 'a');
assert(queue.jobs.find((job) => job.id === 'a')?.status === 'waiting', 'resume puts the job back in line');
queue = moveToTop(queue, 'b');
assert(queue.jobs.find((job) => job.id === 'b')!.order < queue.jobs.find((job) => job.id === 'a')!.order, 'move to top');
const dropped = recover({ ...queue, jobs: queue.jobs.map((job) => (job.id === 'a' ? { ...job, status: 'running' } : job)) }, false);
assert(dropped.state.jobs.find((job) => job.id === 'a')?.status === 'paused', 'offline holds a running job');
assert(dropped.state.jobs.find((job) => job.id === 'a')?.pausedByUser === false, 'network pause is not a user pause');
const back = recover(dropped.state, true);
assert(back.state.jobs.find((job) => job.id === 'a')?.status === 'waiting', 'auto-resume when the connection returns');
assert(back.effects.some((effect) => effect.type === 'retry'), 'retry is scheduled');
const resumed = resumeAll(pauseJob(enqueue(emptyQueue(false), { id: 'c', kind: 'update', title: 'apk', createdAt: 3 }), 'c'));
assert(resumed.jobs[0]?.status === 'waiting', 'resume all');
const failed = markFailed(enqueue(emptyQueue(), { id: 'd', kind: 'generate', title: 'x', createdAt: 4 }), 'd', 'timeout talking to the server', false);
assert(failed.state.jobs[0]?.status === 'paused' && failed.state.jobs[0]?.pausedByUser === false, 'network failure waits');
assert(cancelJob(failed.state, 'd').jobs[0]?.status === 'cancelled', 'cancel');

const manifest = parseManifest('{"version":"1.2.0","versionCode":9,"apkUrl":"https://example.com/yume.apk","sha256":"ABC"}');
assert(updateAvailable(3, manifest) && !updateAvailable(9, manifest), 'version code compare');
assert(checksumMatches('abc', 'ABC'), 'checksum');
assert(sessionCost(30 * 60 * 1000, 0.13) > 0.06 && sessionCost(30 * 60 * 1000, 0.13) < 0.07, 'half hour cost');
assert(capWarning(1, 1)?.includes('over'), 'cap');
assert(redact('key sk-abcdef1234567890 https://gpu.example/generate').includes('[redacted]'), 'redact secret');
assert(!buildReport({ version: '1.2.0', versionCode: 3, device: 'SM-S938U', android: '15', settings: { saladEndpoint: 'https://x', apiKey: 'supersecretvalue' }, errors: ['sk-abcdef1234567890'] }).includes('supersecretvalue'), 'report leaked a key');
const s25 = profileFor({ model: 'SM-S938U', ramGb: 12, qnnPresent: true });
assert(s25.s25 && s25.backend === 'qnn' && s25.height === 768 && s25.steps === 8, 's25 profile');
const weak = profileFor({ model: 'other', ramGb: 4 });
assert(weak.width === 512 && weak.warning, 'low ram warning');
assert(offlineBlockedReason({ modelReady: false, runtime: 'missing' })?.toLowerCase().includes('download'), 'offline needs a model');
assert(offlineBlockedReason({ modelReady: true, runtime: 'missing' })?.toLowerCase().includes('qnn'), 'do not fake diffusion');

const undone = undoVersion({
  characterId: 'aoi',
  seed: 10,
  versions: [
    {
      id: 'b',
      createdAt: 2,
      note: 'hair longer',
      views: [],
      sheetUri: '',
      character: longer.character,
    },
    {
      id: 'a',
      createdAt: 1,
      note: 'First turnaround',
      views: [],
      sheetUri: '',
      character,
    },
  ],
});
assert(undone?.versions.length === 1 && undone.versions[0]?.id === 'a', 'undo did not restore the earlier sheet');
assert(undoVersion({ characterId: 'aoi', seed: 1, versions: [] }) === null, 'undo of an empty book should refuse');

const container = buildYumeContainerGroup({ apiKey: 'salad-key', gpuClassId: 'gpu-4090' }) as {
  container: { image: string; priority: string; environment_variables: Record<string, string>; resources: { gpu_classes: string[]; cpu: number; memory: number; storage_amount: number } };
  networking: { port: number; auth: boolean };
  startup_probe: { http: { path: string } };
  readiness_probe: { http: { path: string } };
  liveness_probe: { http: { path: string } };
};
assert(container.container.image === 'ghcr.io/metagodzilla/yume-server:latest', 'deploy image');
assert(container.container.priority === 'low' && container.networking.port === 8080 && container.networking.auth === true, 'deploy gateway');
assert(container.startup_probe.http.path === '/ready' && container.readiness_probe.http.path === '/ready' && container.liveness_probe.http.path === '/health', 'deploy probes');
assert(container.container.environment_variables.HF_HOME === '/models' && container.container.environment_variables.YUME_MODEL_ID === 'cagliostrolab/animagine-xl-4.0', 'deploy model env');
assert(container.container.environment_variables.YUME_MODEL_DIR === '/models' && !('CIVITAI_TOKEN' in container.container.environment_variables), 'model dir without civitai token');
assert(container.container.resources.cpu === 4 && container.container.resources.memory === 16384 && container.container.resources.storage_amount === 26843545600, 'deploy size');
const gpus = choicesFromGpuClasses({
  items: [
    { id: 'a', name: 'RTX 3090 (24 GB)', prices: [{ priority: 'low', price: '0.127' }] },
    { id: 'b', name: 'RTX 4090 (24 GB)', prices: [{ priority: 'high', price: '0.440' }, { priority: 'low', price: '0.160' }] },
  ],
});
assert(pickDefaultGpu(gpus)?.id === 'b' && pickDefaultGpu(gpus)?.hourly === 0.16, 'default 4090 low');
assert(costLine(0.16, 'RTX 4090 (24 GB)').includes('$0.160 per hour') && costLine(0.16, 'RTX 4090 (24 GB)').includes('$3.84 per day'), 'cost line');
assert(describeDeploy({ creating: 1 }).title === 'Pulling the image', 'pulling phase');
assert(describeDeploy({ running: 1, groupStatus: 'running' }).title === 'Downloading the model', 'model phase');
assert(describeDeploy({ running: 1, ready: true }).phase === 'ready', 'ready phase');
assert(serverUrlFromLink('yume://setup?url=https://example.salad.cloud&key=secret') === 'https://example.salad.cloud', 'deep link drops the key');
assert(serverUrlFromLink('https://example.salad.cloud/path?apiKey=secret') === 'https://example.salad.cloud/path', 'https link drops the key');
assert(serverUrlFromLink('yume://setup?key=secret') === null, 'key-only link is ignored');
assert(maskKey('supersecretvalue') === '••••alue' && !maskKey('supersecretvalue').includes('supersecret'), 'key stays masked');
assert(shouldIdleStop({ idleMinutes: 15, lastActivityMs: 0, now: 20 * 60_000, activeJobs: 0, running: true }) === false, 'missing activity does not stop');
assert(shouldIdleStop({ idleMinutes: 15, lastActivityMs: 1_000, now: 16 * 60_000, activeJobs: 0, running: true }) === true, 'idle stop');
const live = deploymentForEndpoint('https://persimmon-potato-w36vqxy5bseqmtk4.salad.cloud', null);
assert(live?.organization === 'seeyeevang707' && live.project === 'default' && live.group === 'yume-server', 'live server identity');
const downloading = cloudChecklist({
  hasEndpoint: true,
  groupStatus: 'running',
  running: 1,
  healthStatus: 200,
  readyStatus: 503,
  healthReady: false,
  readyDetail: 'Model is still downloading.',
});
assert(downloading.phase === 'starting' && downloading.steps[4]?.state === 'current' && downloading.steps[3]?.state === 'done', 'model download step');
assert(downloading.liveTitle.toLowerCase().includes('downloading model'), 'model download title');
const locked = cloudChecklist({ hasEndpoint: true, healthStatus: 403, readyStatus: 403 });
assert(locked.authBlocked && locked.steps[0]?.state === 'done' && locked.steps[1]?.state === 'current', 'gateway 403 needs the key');
const readyCloud = cloudChecklist({ hasEndpoint: true, readyStatus: 200, healthStatus: 200 });
assert(readyCloud.phase === 'running' && readyCloud.steps[5]?.state === 'current' && readyCloud.steps[4]?.state === 'done', 'ready step');
assert(formatCostLine({ sessionUsd: sessionUsd(0, 0.44), hourly: 0.44, upMin: 0, cap: 5 }).includes('$0.00 this session') && formatCostLine({ sessionUsd: 0.41, hourly: 0.44, upMin: 0, cap: 5 }).includes('$4.59 left'), 'cost line');
assert(capReached(5, 5) && !capReached(1, 0), 'session cap');
assert(estimatePowerWatts(-1_500_000, 4000)?.toFixed(1) === '6.0', 'power estimate from current and voltage');
assert(classifyHeat({ tempC: 43, thermalStatus: 0, lowPower: false }) === 'hot', 'hot battery');
assert(classifyHeat({ tempC: 39, thermalStatus: null, lowPower: false }) === 'warm', 'warm battery');
assert(throttleFor('hot').pauseQueue && throttleSteps(28, 4, throttleFor('warm')).count === 1, 'thermal throttle');
assert(shouldKeepScreenAwake('background') === false && shouldKeepScreenAwake('active') === false, 'no wake lock');
const hotQueue = thermalPause(enqueue(emptyQueue(), { id: 'hot', kind: 'offline-generate', title: 'Draw', createdAt: 1 }));
assert(hotQueue.jobs[0]?.status === 'paused' && hotQueue.jobs[0]?.thermalHold, 'hot pause');
assert(recover(hotQueue, true).state.jobs[0]?.status === 'paused', 'thermal hold survives reconnect');
assert(thermalResume(hotQueue).jobs[0]?.status === 'waiting', 'cool resumes thermal hold');
assert(shouldIdleStop({ idleMinutes: 15, lastActivityMs: 1_000, now: 16 * 60_000, activeJobs: 1, running: true }) === false, 'queue holds the server');
assert(browsingParams('sfw').nsfw === 'false' && browsingParams('nsfw').browsingLevel === '28', 'civitai filter params');
const sfwModel = { id: 1, name: 'Safe', type: 'LORA', nsfw: false, nsfwLevel: 1, modelVersions: [{ id: 9, modelId: 1, name: 'v', baseModel: 'SDXL 1.0', trainedWords: [], downloadUrl: '', files: [], images: [{ url: 'https://image.civitai.com/a/original=true/1.jpeg', nsfwLevel: 1, type: 'image' }, { url: 'https://image.civitai.com/a/original=true/1.mp4', type: 'video', nsfwLevel: 1 }] }] } as CivitaiModel;
const nsfwModel = { id: 2, name: 'Adult', type: 'LORA', nsfw: true, nsfwLevel: 8, modelVersions: [{ id: 10, modelId: 2, name: 'v', baseModel: 'SDXL 1.0', trainedWords: [], downloadUrl: '', files: [], images: [{ url: 'https://image.civitai.com/a/original=true/2.jpeg', nsfwLevel: 1, type: 'image' }, { url: 'https://image.civitai.com/a/original=true/3.jpeg', nsfwLevel: 8, type: 'image' }] }] } as CivitaiModel;
assert(filterModels([sfwModel, nsfwModel], 'sfw').length === 1 && filterModels([sfwModel, nsfwModel], 'nsfw')[0]?.id === 2, 'client nsfw split');
assert(pickPreview(sfwModel, 'sfw')?.kind === 'image' && thumbnailUrl(pickPreview(sfwModel, 'sfw')?.url || '').includes('/width=450/'), 'thumbnail skips video and shrinks original');
assert(pickPreview(nsfwModel, 'nsfw')?.url.endsWith('3.jpeg') && pickPreview(nsfwModel, 'sfw')?.url.endsWith('2.jpeg'), 'thumbnail follows the filter');
assert(loraPage({ name: 'ribbon', modelId: 5, versionId: 9 }).url === civitaiModelUrl(5, 9), 'lora page uses ids');
assert(loraPage({ name: 'ribbon' }).label === 'Search on Civitai', 'lora without ids searches');
assert(saladErrorMessage({ aborted: true }).toLowerCase().includes('waking'), 'cold start copy');
assert(saladErrorMessage({ aborted: false, status: 503 }).toLowerCase().includes('not ready'), '503 copy');

async function demoFlow() {
const demo = await produceImages({
  provider: 'demo',
  prompt: wrapped,
  negative: watercolor.negative,
  styleId: 'watercolor',
  aspectId: 'wallpaper',
  character,
  count: 2,
  width: 832,
  height: 1216,
  steps: 20,
  cfg: 5.5,
  sampler: 'euler_a',
  seedMode: 'fixed',
  seed: 10,
  saladModel: '',
  loras: [],
  openaiModel: 'gpt-image-1',
  openaiKey: null,
  saladEndpoint: '',
  saladKey: null,
  platform: 'web',
  rng: () => 0,
});
assert(demo.pngs.length === 2 && demo.seeds[0] === 10 && demo.source === 'demo', 'demo flow did not keep the seed');
}

demoFlow()
  .then(() => {
    const moved = moveStyle(library.styles, 'watercolor', -1);
    assert(moved.findIndex((style) => style.id === 'watercolor') === 4, 'reorder failed');
    const copied = duplicateStyle(library.styles, 'chibi', 'chibi-copy');
    assert(copied.some((style) => style.id === 'chibi-copy' && style.builtIn === false), 'duplicate failed');
    const exported = exportBundle(library);
    const parsed = parseBundle(exported);
    assert(parsed.ok, 'export was not valid');
    if (parsed.ok) {
      const merged = mergeLibrary(library, parsed.bundle);
      assert(merged.styles.length === library.styles.length, 'merge duplicated styles');
      assert(merged.wildcards.some((card) => card.token === 'hair_color'), 'snippets dropped');
    }
    const bad = parseBundle('{');
    assert(!bad.ok, 'bad json was accepted');
    console.log('creative controls ok');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
