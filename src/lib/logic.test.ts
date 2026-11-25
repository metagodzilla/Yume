import { extractLoras, formatParameters, parseParameters, plainPrompt } from '@/src/lib/a1111';
import { bytesToBase64, base64ToBytes } from '@/src/lib/base64';
import { ANIME_STUDIO_CHECKPOINT, scaleLoraStack, studioSuffix } from '@/src/lib/animeStudio';
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
import { describeUpdateError, downloadLabel } from '@/src/lib/apkInstall';
import { baseFamily, baseLabel, defaultsForBase, familyPreset, settingsForCheckpoint, modelCardPress, routeLeavesCreate } from '@/src/lib/checkpoints';
import { modelsToRestore, modelPresence } from '@/src/lib/keptModels';
import { friendlyLoraMessage, loraChoices, loraStem, missingSelectedLoras } from '@/src/lib/loraGate';
import { meshPlan, PICTURE_SERVER_MESH_MESSAGE } from '@/src/lib/mesh';
import { newerServerRelease, serverUpdateCall } from '@/src/lib/serverUpdate';
import { CAST_ROUTE, castRouteOpensScreen } from '@/src/lib/routes';
import { chooseSeeds } from '@/src/lib/seeds';
import { redactValue } from '@/src/lib/reportText';
import { CREATE_PROMPT_FIELDS } from '@/src/lib/createFields';
import { describeToTags, settleSavedPrompts, supportTags } from '@/src/lib/positiveTags';
import { buildSaladGenerateBody, composeGenerationPrompt, sentPositiveText } from '@/src/lib/draw';
import { getGenerator, patchGenerator, resetBuiltPrompt, resetModelDefaults, resetQualityTags, type GeneratorState } from '@/src/lib/genstore';
import { downloadButtons, downloadKind, downloadPercent, formatEta, formatSpeed, RECONNECTING } from '@/src/lib/downloads';
import { installFailureMessage } from '@/src/lib/modelInstall';
import { buildSaladBody, classifyGatewayInput, friendlyGatewayMessage, generateUrl, LIVE_GATEWAY_URL, migrateKeyStoredAsUrl, normalizeEndpoint, redactSecrets, saladErrorMessage } from '@/src/lib/salad';
import { browsingParams, civitaiModelUrl, filterModels, loraPage, pickPreview, thumbnailUrl, type CivitaiModel } from '@/src/lib/civitai';
import { buildYumeContainerGroup, choicesFromGpuClasses, costLine, describeDeploy, groupStatusOf, maskKey, normalizeSaladKey, pickDefaultGpu, saladFailureMessage, saladRequest, serverUrlFromLink, shouldIdleStop, shouldIdleWarn } from '@/src/lib/saladCloud';
import { containerGroupUrl, liveContainerGroup, validateSaladKey } from '@/src/lib/cloudActions';
import { capReached, checkLine, cloudChecklist, deploymentForEndpoint, formatCostLine, resolveHourly, RTX_4090_LOW_HOURLY, sessionUsd, uptimeSeconds } from '@/src/lib/cloudSteps';
import { CLOUD_STOP_CHECK } from '@/src/lib/cloudRun';
import { CLOUD_OFF_INSTALL, canUseAsDefault, cloudIsOff, installAction, installRequest, isServerInstalled } from '@/src/lib/installGate';
import { dropTiles, filterTiles, galleryTiles, reusePatch } from '@/src/lib/gallery';
import type { Generation } from '@/src/lib/types';
import { pullPercent } from '@/src/lib/saladCloud';
import { areaCounts } from '@/src/lib/checkRows';
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
import { checksumMatches, decideReleaseCheck, parseGithubRelease, parseManifest, readInstalledVersionCode, releaseStatus, updateAvailable } from '@/src/lib/updates';
import { errorText } from '@/src/lib/civitai';
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
const zod = { error: { name: 'ZodError', message: 'Invalid input: expected number, received string' } };
assert(errorText(zod).includes('expected number') && !errorText(zod).includes('[object Object]'), 'civitai error stays text');
const release = parseGithubRelease({
  tag_name: 'v1.4.2',
  body: 'versionCode: 7\n',
  assets: [{ name: 'yume-1.4.2.apk', browser_download_url: 'https://github.com/metagodzilla/Yume/releases/download/v1.4.2/yume-1.4.2.apk' }],
});
assert(release.version === '1.4.2' && release.versionCode === 7 && release.apkUrl.endsWith('.apk'), 'github release apk');
assert(releaseStatus('1.4.1', 6, release).label === 'Update available v1.4.2', 'newer release');
assert(releaseStatus('1.4.2', 7, release).label === 'Up to date', 'same release');
assert(releaseStatus('1.4.3', 8, { version: '1.4.4', versionCode: 9 }).label === 'Update available v1.4.4', 'older versionCode is offered 1.4.4');
assert(releaseStatus('1.4.4', 9, { version: '1.4.4', versionCode: 9 }).label === 'Up to date', 'same versionCode is current');
const newerNotes = parseGithubRelease({
  tag_name: 'v1.4.6',
  body: 'versionCode: 11\n\nInstall only shows Installed when the server has the file.',
  assets: [{ name: 'yume-1.4.6.apk', browser_download_url: 'https://example.com/yume-1.4.6.apk' }],
});
assert(newerNotes.versionCode === 11 && releaseStatus('1.4.5', 10, newerNotes).available, 'release notes versionCode offers 1.4.6');
const emptyCache = decideReleaseCheck({ status: 304, release: null, localVersion: '1.4.5', localCode: 10 });
assert(emptyCache.bad && emptyCache.retry && !emptyCache.label.includes('Up to date'), '304 without a body is not up to date');
const rateLimit = decideReleaseCheck({ status: 429, release: null, localVersion: '1.4.5', localCode: 10 });
assert(rateLimit.bad && !rateLimit.label.includes('Up to date'), 'rate limit is not up to date');
assert(readInstalledVersionCode('10', 99) === 10 && readInstalledVersionCode('', 12) === 12, 'native versionCode wins when present');
assert(pullPercent({ instances: [{ state: 'creating', details: 'Pulling, 37% complete' }] }) === 37, 'salad pull percent');
assert(pullPercent({ state: 'running' }) === null, 'no fake pull percent');
const modelStep = cloudChecklist({ hasEndpoint: true, healthStatus: 200, readyStatus: 503, healthReady: false, modelDone: 50, modelTotal: 100 });
assert(modelStep.steps[4]?.percent === 50 && modelStep.overall != null, 'model download uses real bytes');
const unknownStep = cloudChecklist({ hasEndpoint: true, groupStatus: 'deploying', allocating: 1 });
assert(unknownStep.steps.find((step) => step.state === 'current')?.percent == null && unknownStep.overall == null, 'missing progress stays indeterminate');
assert(areaCounts([{ area: 'Cloud', name: 'Health', status: 'pass', message: '', ms: 1 }, { area: 'Cloud', name: 'Ready', status: 'skip', message: '', ms: 0 }])[0]?.pass === 1, 'area summary');
const unlocked = [chooseSeeds({ locked: false, seedText: '1', count: 2, rng: () => 0.1 }), chooseSeeds({ locked: false, seedText: '1', count: 2, rng: () => 0.2 })];
assert(unlocked[0].seeds[0] !== unlocked[1].seeds[0] && unlocked[0].seeds[0] !== unlocked[0].seeds[1], 'unlocked seeds change and stay distinct');
const lockedSeeds = chooseSeeds({ locked: true, seedText: '1', count: 2 });
assert(lockedSeeds.requestSeed === 1 && lockedSeeds.seeds.join(',') === '1,2', 'locked seed is reused');
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
assert(container.container.environment_variables.YUME_MODEL_DIR === '/models' && !('CIVITAI_TOKEN' in container.container.environment_variables) && !('YUME_ADMIN_TOKEN' in container.container.environment_variables), 'model dir without civitai token');
const withAdmin = buildYumeContainerGroup({ apiKey: 'salad-key', gpuClassId: 'gpu-4090', adminToken: 'phone-token' }) as {
  container: { environment_variables: Record<string, string> };
};
assert(withAdmin.container.environment_variables.YUME_ADMIN_TOKEN === 'phone-token' && withAdmin.container.environment_variables.YUME_SERVER_REF === 'latest', 'new container can carry an update token');
const offer = newerServerRelease(
  [
    { tag_name: 'v1.5.3' },
    { tag_name: 'server-v1.5.4', assets: [{ name: 'yume-server-code.sha256', browser_download_url: 'https://example.test/sha' }] },
  ],
  '1.5.2',
);
assert(offer?.ref === 'server-v1.5.4' && newerServerRelease([{ tag_name: 'server-v1.5.4', assets: [{ name: 'yume-server-code.sha256', browser_download_url: 'https://example.test/sha' }] }], '1.5.4') === null, 'server update skips app releases');
const updateCall = serverUpdateCall({ endpoint: 'https://cloud.example', adminToken: 'phone-token', gatewayKey: 'salad-key', ref: 'server-v1.5.4', sha256: 'abc' });
assert(updateCall.url === 'https://cloud.example/admin/update' && updateCall.headers['X-Admin-Token'] === 'phone-token' && updateCall.body.includes('server-v1.5.4'), 'update call sends the admin token');
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
assert(shouldIdleWarn({ idleMinutes: 15, lastActivityMs: 1_000, now: 1_000 + 14 * 60_000, activeJobs: 0, running: true }) === true, 'idle warning one minute before');
assert(shouldIdleWarn({ idleMinutes: 0, lastActivityMs: 1_000, now: 20 * 60_000, activeJobs: 0, running: true }) === false, 'idle warning stays off by default');
assert(cloudChecklist({ hasEndpoint: true, groupStatus: 'stopping' }).phase === 'stopping', 'stopping phase');
assert(formatCostLine({ sessionUsd: 1.25, hourly: 0.253, upMin: 10, cap: 5, final: true }).startsWith('Final session cost'), 'final session cost');
assert(CLOUD_STOP_CHECK.status === 'skip' && CLOUD_STOP_CHECK.runs === false && CLOUD_STOP_CHECK.message.includes('does not stop'), 'check never stops the cloud');
assert(containerGroupUrl(liveContainerGroup()).endsWith('/containers/yume-server'), 'stop targets yume-server');
const galleryItem = {
  id: 'g1',
  createdAt: 10,
  userPrompt: 'shrine',
  enhancedPrompt: 'shrine',
  finalPrompt: 'shrine maiden',
  negative: 'lowres',
  styleId: 'watercolor',
  styleName: 'Animagine',
  aspectId: 'wallpaper',
  count: 2,
  characterId: null,
  characterName: null,
  imageUris: ['a.png', 'b.png'],
  source: 'demo',
  model: 'Animagine XL 4.0',
  provider: 'demo',
  enhance: false,
  seed: 1,
  seeds: [1, 2],
  steps: 25,
  cfg: 6,
  sampler: 'euler_a',
  width: 832,
  height: 1216,
  saladModel: '',
  loras: [],
  favoriteIndexes: [1],
  durationMs: 1200,
} as Generation;
const tiles = galleryTiles([galleryItem]);
assert(tiles.length === 2 && tiles[1]?.favorite === true, 'gallery lists each saved picture');
assert(filterTiles(tiles, { favoritesOnly: true }).length === 1 && filterTiles(tiles, { query: 'maiden' }).length === 2, 'gallery filters favorites and prompts');
assert(dropTiles([galleryItem], [{ generationId: 'g1', index: 0 }]).next[0]?.imageUris[0] === 'b.png', 'gallery delete removes one picture');
assert(reusePatch(galleryItem, 1).seed === '2' && reusePatch(galleryItem, 1).seedRandom === false, 'reuse settings locks that seed');
const installBody = installRequest(1111838, 'civitai-token');
assert(!isServerInstalled([1337429], [], 1111838) && isServerInstalled([1111838], [], 1111838), 'installed ignores a phone-only checkpoint');
assert(installAction({ cloudReady: false, serverInstalled: false }) === 'start-and-install' && CLOUD_OFF_INSTALL.includes('Start cloud and install'), 'stopped cloud offers to start');
assert(cloudIsOff({ groupStatus: 'stopped', readyStatus: 200 }) && !cloudIsOff({ groupStatus: 'running', readyStatus: 200 }), 'stopped group is off');
assert(installBody.body.versionId === 1111838 && installBody.headers['X-Civitai-Token'] === 'civitai-token', 'install sends versionId and the Civitai token');
assert(!canUseAsDefault(false) && canUseAsDefault(true), 'use as default needs the server copy');
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
assert(readyCloud.phase === 'running' && readyCloud.steps.at(-1)?.state === 'current' && readyCloud.steps[4]?.state === 'done', 'ready step');
const readyOnly = cloudChecklist({ hasEndpoint: true, readyStatus: 200 });
assert(readyOnly.phase === 'running' && readyOnly.pill === 'Running' && readyOnly.liveTitle === 'Ready', 'ready 200 skips the GPU step');
const group = groupStatusOf({
  current_state: { status: 'running', start_time: '2026-11-24T15:00:00Z', instance_status_counts: { allocating_count: 0, creating_count: 0, running_count: 1 } },
  priority: 'low',
});
assert(group.status === 'running' && group.running === 1 && group.priority === 'low', 'live group shape');
assert(uptimeSeconds(group.startTime, Date.parse('2026-11-24T15:05:00Z')) === 300, 'uptime from start time');
const runningReady = cloudChecklist({ hasEndpoint: true, groupStatus: group.status, running: group.running, readyStatus: 200, healthStatus: 200 });
assert(runningReady.phase === 'running' && runningReady.steps.at(-1)?.state === 'current', 'running group with ready 200');
const probeFailed = cloudChecklist({ hasEndpoint: true, probeError: 'Network request failed' });
assert(!probeFailed.liveTitle.includes('Finding'), 'a probe error is not Finding an RTX 4090');
const overridden = deploymentForEndpoint(LIVE_GATEWAY_URL, { organization: 'other', project: 'yume', group: 'yume', gpuName: 'RTX 4090', gpuClassId: '', hourlyUsd: 0.13, image: '' });
assert(overridden?.project === 'default' && overridden.group === 'yume-server', 'live host ignores a saved yume/yume record');
assert(resolveHourly({ userRate: 0.13, touched: false, liveGateway: true }) === RTX_4090_LOW_HOURLY, 'default rate uses the 4090 low price');
assert(resolveHourly({ userRate: 0.4, touched: true, liveGateway: true }) === 0.4, 'a custom rate stays');
assert(checkLine('health', `${LIVE_GATEWAY_URL}/health`, { ok: true, status: 200 }).pass, 'health pass line');
const secret = 'salad_cloud_user_abcdefghijklmnopqrstuvwxyz';
assert(classifyGatewayInput(secret).kind === 'key' && normalizeEndpoint(secret) === '', 'a Salad key is not a URL');
assert(classifyGatewayInput('not a host').kind === 'key', 'text without a scheme or dot is refused');
const bareHost = classifyGatewayInput('persimmon-potato-w36vqxy5bseqmtk4.salad.cloud');
assert(bareHost.kind === 'url' && bareHost.url === LIVE_GATEWAY_URL, 'a bare host becomes https');
assert(generateUrl(`${LIVE_GATEWAY_URL}/generate/`) === `${LIVE_GATEWAY_URL}/generate`, 'generate path is not doubled');
assert(serverUrlFromLink(secret) === null, 'a key is not accepted from a link');
const leaked = saladErrorMessage({ aborted: false, url: `https://${secret}/generate`, body: `java.lang.IllegalArgumentException: Invalid URL host: "${secret}"` });
assert(!leaked.includes(secret) && leaked.includes('not an http'), 'errors redact the key');
assert(redactSecrets(secret) === 'salad_cloud_user_…', 'redaction keeps no secret characters');
const moved = migrateKeyStoredAsUrl(secret, null);
assert(moved.moved && moved.url === '' && moved.key === secret && !moved.notice?.includes(secret), 'launch moves a key out of the URL');
const kept = migrateKeyStoredAsUrl(secret, 'salad_cloud_user_existing');
assert(kept.key === 'salad_cloud_user_existing' && kept.url === '' && !kept.notice?.includes(secret), 'an existing key is not overwritten');
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
assert(downloadLabel({ bytesWritten: 38_334_282, totalBytes: 76_668_564 }).includes('50%') && downloadLabel({ bytesWritten: 38_334_282, totalBytes: 76_668_564 }).includes('73.1'), 'apk download percent');
assert(downloadLabel({ bytesWritten: 2048, totalBytes: 0 }).startsWith('Downloading'), 'apk download without a length');
const denial = describeUpdateError(new Error('java.lang.SecurityException: Permission Denial: reading expo.modules.filesystem.FileSystemFileProvider'));
assert(denial.includes('blocked Yume') && !denial.includes('Permission Denial') && !denial.includes('FileSystemFileProvider'), 'installer error stays readable');
assert(describeUpdateError(new Error('Android is asking Yume for permission to install apps. Turn on Allow from this source, then tap Update again.')).includes('Allow from this source'), 'unknown-apps prompt stays');
assert(saladErrorMessage({ aborted: true }).toLowerCase().includes('waking'), 'cold start copy');
assert(saladErrorMessage({ aborted: false, status: 503 }).toLowerCase().includes('not ready'), '503 copy');
assert(friendlyGatewayMessage(503, '<html><title>no healthy upstream</title></html>') === 'Cloud is starting / no machine ready yet', 'html gateway page');
assert(saladErrorMessage({ aborted: false, status: 404, body: '<!doctype html><html></html>' }).includes('no machine ready'), 'html 404');
const previewState = {
  prompt: '1girl',
  negative: 'lowres',
  sampler: 'Euler a',
  steps: 25,
  cfg: 6,
  seed: '1',
  seedRandom: false,
  width: 832,
  height: 1216,
  clipSkip: 2,
  count: 1,
  qualityTags: true,
  triggers: true,
  checkpointId: 1337429,
  loras: [{ name: '', weight: 0.8 }, { name: 'ribbon', weight: 0.8, triggers: [] }],
  embeddings: ' , easynegative , ',
  vae: '',
  hires: false,
  hiresScale: 1.5,
  hiresDenoise: 0.45,
  hiresUpscaler: 'Latent',
  hiresSteps: 15,
  mode: 'txt2img',
  denoise: 0.55,
  nsfw: false,
  contentFilter: 'sfw',
  quality: 'masterpiece, high score, great score, absurdres',
  qualityEdited: false,
  describe: '',
  promptAuto: true,
  positive: '',
  positiveAuto: true,
  extraPrompt: 'shiny eyes',
  vPrediction: false,
  studioStyle: 'off',
  installed: [{ versionId: 1337429, modelId: 1, name: 'Animagine XL 4.0', version: 'v4', type: 'Checkpoint', baseModel: 'SDXL 1.0', filename: 'animagine-xl-4.0.safetensors', hash: '1d5b43ff75', sha256: '', triggers: [], isDefault: true }],
} as GeneratorState;
const previewBody = buildSaladGenerateBody(previewState, composeGenerationPrompt(previewState), 1);
assert(previewBody.loras.length === 1 && previewBody.loras[0]?.name === 'ribbon', 'empty lora is not sent');
assert(previewBody.embeddings.length === 1 && previewBody.embeddings[0] === 'easynegative', 'empty embeddings are not sent');
assert(previewBody.model === '1337429' && previewBody.model_name === 'Animagine XL 4.0' && previewBody.scheduler === 'Euler a' && previewBody.hires_scale === null, 'create payload selects the checkpoint by id');
assert(modelCardPress().action === 'open-sheet' && modelCardPress().browse === '/(tabs)/explore' && routeLeavesCreate('/models') && !routeLeavesCreate(modelCardPress().browse), 'model card opens the sheet');
assert(baseFamily('Illustrious') === 'Illustrious' && baseFamily('Pony') === 'Pony' && baseLabel('SDXL 1.0') === 'SDXL', 'base family');
assert(defaultsForBase('Pony').clipSkip === 2 && defaultsForBase('Pony').width === 832 && defaultsForBase('SD 1.5').height === 768 && defaultsForBase('Flux.1 D').clipSkip === 1, 'base defaults');
const illustrious = familyPreset('Illustrious', 'Prefectious XL NSFW');
assert(illustrious.cfg === 5 && illustrious.steps === 28 && illustrious.sampler === 'Euler a' && illustrious.quality.includes('very aesthetic') && !illustrious.quality.includes('high score') && illustrious.negative.includes('shiny skin'), 'illustrious preset drops animagine score tags');
assert(familyPreset('Illustrious', 'Prefect XL').clipSkip === 1 && familyPreset('Illustrious', 'Prefect XL').hires && familyPreset('Illustrious', 'Prefect XL').hiresDenoise === 0.4 && familyPreset('Illustrious', 'Prefectious XL').clipSkip === 2, 'prefect clip skip and illustrious hires');
assert(settingsForCheckpoint('SDXL 1.0', 'Photo', { cfg: 4, steps: 20, sampler: 'Euler' }).cfg === 4, 'civitai recommended settings override the family');
patchGenerator({ positive: 'shiny eyes', prompt: 'girl' });
resetModelDefaults('Illustrious', 'Wai');
assert(getGenerator().positive === 'shiny eyes' && getGenerator().hires, 'positive prompt survives a model preset');
resetBuiltPrompt('Illustrious', 'Wai');
assert(getGenerator().positive === 'shiny eyes' && getGenerator().extraPrompt === '' && getGenerator().quality.includes('very aesthetic'), 'reset clears extra and keeps positive');
patchGenerator({ quality: 'custom tags', qualityEdited: true });
resetModelDefaults('Pony', 'Pony');
assert(getGenerator().quality === 'custom tags', 'edited quality tags survive a preset change');
resetQualityTags('Pony', 'Pony');
assert(getGenerator().quality.startsWith('score_9') && getGenerator().qualityEdited === false, 'quality reset uses the preset');
assert(loraStem('Momo-Koigasaki.safetensors') === 'momo-koigasaki' && loraChoices([{ versionId: 1, name: 'Animagine', type: 'Checkpoint' }, { versionId: 9, name: 'Momo', type: 'LORA' }], [{ versionId: 10, name: 'Ribbon', type: 'LORA' }]).map((item) => item.versionId).join(',') === '9,10', 'lora list is server loras plus restores');
assert(missingSelectedLoras([{ name: 'MOMO.SAFETENSORS', versionId: 9 }], [{ versionId: 9, name: 'Momo', type: 'LORA', filename: 'momo.safetensors' }]).length === 0, 'lora match ignores case and extension');
assert(friendlyLoraMessage('LoRA not found on the server: momo. Put the file in /models/loras, /loras.').includes('not on the cloud yet'), 'lora error stays friendly');
const restore = modelsToRestore({ models: [{ versionId: 5, type: 'LORA', name: 'Ribbon' }, { versionId: 1337429, type: 'Checkpoint', name: 'Animagine XL 4.0' }], lastUsedVersionId: 5 }, [1337429]);
assert(restore.length === 1 && restore[0]?.name === 'Ribbon' && modelPresence(5, [1337429], [5]) === 'restoring', 'restore skips the built-in checkpoint');
const studioState = { ...previewState, extraPrompt: '', positive: '', studioStyle: 'anime' as const, prompt: 'girl in a skirt', quality: 'masterpiece, best quality, very aesthetic, absurdres', loras: [{ name: 'a', weight: 0.8 }, { name: 'b', weight: 0.8 }, { name: 'c', weight: 0.9 }] };
const studioPrompt = composeGenerationPrompt(studioState);
assert(studioPrompt.startsWith('girl in a skirt') && studioPrompt.indexOf(studioSuffix('anime')) < studioPrompt.indexOf('absurdres') && studioPrompt.endsWith('absurdres'), 'quality tags are last');
const withPositive = composeGenerationPrompt({
  ...studioState,
  positive: 'shiny eyes',
  extraPrompt: 'wet clothes',
  studioStyle: 'anime',
  loras: [{ name: 'ribbon', weight: 0.8, triggers: ['ribbon hair'] }],
});
assert(
  withPositive.startsWith('girl in a skirt, shiny eyes, wet clothes') &&
    withPositive.indexOf('wet clothes') < withPositive.indexOf(studioSuffix('anime')) &&
    withPositive.indexOf(studioSuffix('anime')) < withPositive.indexOf('ribbon hair') &&
    withPositive.endsWith('absurdres'),
  'sent order is prompt, positive, extra, style, lora triggers, quality',
);
const selfie = describeToTags('a girl with pink hair taking a selfie in her room');
assert(selfie === '1girl, solo, pink hair, selfie, holding phone, bedroom, indoors', 'describe becomes danbooru tags');
assert(supportTags({ text: 'a girl with pink hair taking a selfie in her room', baseModel: 'SDXL 1.0', style: 'anime' }).includes('detailed eyes') && !supportTags({ text: 'a girl with pink hair taking a selfie in her room', baseModel: 'SDXL 1.0', style: 'anime' }).includes('1girl'), 'positive adds detail tags only');
const settled = settleSavedPrompts({ positive: 'shiny eyes', extraPrompt: 'old extra' });
assert(settled.positive === 'shiny eyes' && settled.extraPrompt === '' && settled.positiveAuto === false, 'saved positive stays and extra starts empty');
assert(CREATE_PROMPT_FIELDS.join('|') === 'Describe|Prompt|Positive prompt|Extra prompt|Negative prompt|Quality tags', 'create field order');
assert(scaleLoraStack(studioState.loras).every((item) => item.weight <= 0.68) && scaleLoraStack([{ name: 'a', weight: 0.8 }, { name: 'b', weight: 0.4 }])[0]?.weight === 0.8, 'three strong loras scale down');
assert(ANIME_STUDIO_CHECKPOINT.versionId === 1408658 && ANIME_STUDIO_CHECKPOINT.steps === 26 && ANIME_STUDIO_CHECKPOINT.width === 896, 'anime studio checkpoint');
assert(CAST_ROUTE === '/cast' && castRouteOpensScreen('/cast') && !castRouteOpensScreen('/(tabs)/cast'), 'cast is a real screen, not a hidden tab');
assert(meshPlan('') === 'stand-in' && meshPlan('  ') === 'stand-in' && meshPlan('https://mesh.example') === 'trellis' && PICTURE_SERVER_MESH_MESSAGE.includes('3D URL'), 'empty 3d url shows a stand-in and a message');
assert(familyPreset('Pony').quality.startsWith('score_9'), 'pony uses score tags');
assert(familyPreset('NoobAI', 'NoobAI XL v-pred').vPrediction && familyPreset('Illustrious').vPrediction === false, 'v-pred is detected from the name');
assert(sentPositiveText(previewState).includes('masterpiece') && sentPositiveText(previewState).includes('1girl') && sentPositiveText(previewState).includes('shiny eyes') && sentPositiveText(previewState).includes('<lora:ribbon:0.8>'), 'final prompt matches the request');
assert(installFailureMessage(502, 'error code: 502').retry && installFailureMessage(401, 'Civitai needs your API key').message.includes('Civitai needs your API key'), 'install 502 retries and 401 explains the token');
assert(RECONNECTING === 'Reconnecting', 'reconnect copy');
assert(downloadPercent({ state: 'downloading', bytesDone: 50, bytesTotal: 100 }) === 50, 'download percent');
assert(downloadPercent({ state: 'downloading', bytesDone: 1, bytesTotal: 0 }) === null, 'download percent waits for a total');
assert(downloadButtons('paused').resume && downloadButtons('error').retry && downloadButtons('downloading').pause && downloadButtons('cancelled').retry, 'download buttons');
assert(downloadKind({ id: 'a', versionId: 1, state: 'done', bytesDone: 1, bytesTotal: 1, type: 'LORA' }) === 'LoRA', 'lora kind');
assert(downloadKind({ id: 'a', versionId: 1, state: 'done', bytesDone: 1, bytesTotal: 1, type: 'TextualInversion' }) === 'Embedding', 'embedding kind');
assert(formatSpeed(1024 * 1024).includes('MB') && formatEta(90) === '1 min', 'speed and eta');
assert(!JSON.stringify(redactValue({ apiKey: 'salad_cloud_user_secret', note: 'token=abc' })).includes('secret'), 'client report redacts secrets');
assert(normalizeSaladKey('  salad_cloud_user_abc\r\n') === 'salad_cloud_user_abc', 'pasted key drops whitespace');
assert(normalizeSaladKey('Salad-Api-Key: salad_cloud_user_abc') === 'salad_cloud_user_abc', 'pasted key drops a header label');
const orgMiss = saladFailureMessage(404, 'https://api.salad.com/api/public/organizations');
assert(orgMiss.includes('HTTP 404') && orgMiss.includes('/organizations'), 'salad failure names the url');

async function saladKeyCheck() {
  let seen = '';
  let header = '';
  await validateSaladKey(' salad_cloud_user_abc \n', async (url, init) => {
    seen = String(url);
    header = String((init?.headers as Record<string, string>)['Salad-Api-Key']);
    return new Response('{"name":"yume-server"}', { status: 200 });
  });
  assert(seen === 'https://api.salad.com/api/public/organizations/seeyeevang707/projects/default/containers/yume-server', 'wizard checks the live group');
  assert(header === 'salad_cloud_user_abc', 'wizard sends the trimmed key');
  let failed = '';
  try {
    await saladRequest({
      apiKey: 'salad_cloud_user_secret',
      path: '/organizations',
      fetchImpl: async () => new Response('missing', { status: 404 }),
    });
  } catch (error) {
    failed = error instanceof Error ? error.message : '';
  }
  assert(failed.includes('HTTP 404') && failed.includes('https://api.salad.com/api/public/organizations') && !failed.includes('salad_cloud_user_secret'), '404 names the organizations url and hides the key');
}

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
  .then(() => saladKeyCheck())
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
