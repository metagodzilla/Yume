export type StyleId =
  | 'cel90s'
  | 'modern'
  | 'shonen'
  | 'shojo'
  | 'chibi'
  | 'watercolor'
  | 'dark'
  | 'mecha'
  | 'manga'
  | 'novel';

export type AspectId = 'wallpaper' | 'avatar' | 'landscape' | 'manga';

export type ModelId = 'gpt-image-1' | 'dall-e-3';

export type ProviderId = 'demo' | 'openai' | 'salad';

export type SamplerId = 'euler_a' | 'euler' | 'dpm_2m' | 'dpm_2m_karras' | 'ddim' | 'lcm';

export type LoraSpec = {
  id: string;
  name: string;
  weight: number;
  modelId?: number;
  versionId?: number;
};

export type UserStyle = {
  id: string;
  name: string;
  note: string;
  blurb: string;
  prefix: string;
  suffix: string;
  negative: string;
  steps: number;
  cfg: number;
  sampler: SamplerId;
  swatch: [string, string, string];
  builtIn: boolean;
  order: number;
};

export type Wildcard = {
  id: string;
  token: string;
  values: string[];
};

export type PromptTemplate = {
  id: string;
  name: string;
  prompt: string;
  negative: string;
};

export type Library = {
  styles: UserStyle[];
  wildcards: Wildcard[];
  templates: PromptTemplate[];
};

export type TraitKey =
  | 'hairColor'
  | 'hairStyle'
  | 'eyeColor'
  | 'outfit'
  | 'expression'
  | 'pose'
  | 'setting'
  | 'lighting';

export type Character = {
  id: string;
  name: string;
  saved: boolean;
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  outfit: string;
  expression: string;
  pose: string;
  setting: string;
  lighting: string;
  /** Latest plain-language correction. The name still stays on the phone. */
  notes?: string;
  /** Bust, waist, hip, and height stored in centimeters. */
  measurements?: import('@/src/lib/measurements').Measurements | null;
  /** Adult body-shape tags from a photo or from the measurements. */
  bodyTags?: string[];
  /** Outfit tags for this character. A non-empty value replaces the default clothes. */
  clothesPrompt?: string;
  fromImage?: boolean;
  /** Front photo. Different views and 3D use this one. */
  referenceUri?: string;
  /** Every reference photo, including the front one. At most six. */
  referenceUris?: string[];
  updatedAt: number;
};

export type Generation = {
  id: string;
  createdAt: number;
  userPrompt: string;
  enhancedPrompt: string;
  finalPrompt: string;
  negative: string;
  styleId: string;
  styleName: string;
  aspectId: AspectId;
  count: number;
  characterId: string | null;
  characterName: string | null;
  imageUris: string[];
  /** The page or photo these results were made from, kept so history can compare. */
  originalUri?: string;
  source: 'demo' | 'openai' | 'salad';
  model: string;
  provider: ProviderId;
  enhance: boolean;
  seed: number | null;
  seeds: number[];
  steps: number;
  cfg: number;
  sampler: SamplerId;
  width: number;
  height: number;
  saladModel: string;
  loras: LoraSpec[];
  warning?: string;
  durationMs?: number;
  favoriteIndexes?: number[];
  /** This picture was drawn on the phone while the cloud was not ready. */
  phoneRan?: boolean;
  /** Settings stored with a like or dislike. Stays on this phone. */
  shot?: import('@/src/lib/taste').ImageShot;
};

export type Settings = {
  provider: ProviderId;
  openaiModel: ModelId;
  saladEndpoint: string;
  meshEndpoint: string;
  enhance: boolean;
  expandSnippets: boolean;
  negative: string;
  tuneLocked: boolean;
  seedMode: 'random' | 'fixed';
  seed: number;
  steps: number;
  cfg: number;
  sampler: SamplerId;
  width: number;
  height: number;
  customSize: boolean;
  saladModel: string;
  loras: LoraSpec[];
  updateManifestUrl: string;
  hourlyRate: number;
  hourlyRateTouched: boolean;
  spendCap: number;
  autoResume: boolean;
  sourceMode: 'cloud' | 'phone' | 'auto';
  setupComplete: boolean;
  idleStopMinutes: number;
  lowPower: boolean;
  serverUpdateCheck: boolean;
  /** Move a Salad machine that stops making progress. Off until turned on. */
  autoFixStuckCloud?: boolean;
  /** The person chose the auto-fix setting. Older installs stay off. */
  autoFixStuckChosen?: boolean;
  /** Draw on the phone while Salad is still starting. On unless turned off. */
  autoPhoneWhileCloud?: boolean;
};

export type Session = {
  prompt: string;
  preview: string;
  previewDirty: boolean;
  styleId: string;
  aspectId: AspectId;
  count: number;
  selectedCharacterId: string | null;
};

export type ViewerFrame = {
  generationId: string;
  imageIndex: number;
};

export type ViewerState = {
  images: string[];
  index: number;
  prompt: string;
  title: string;
  filename: string;
  generationId?: string;
  frames?: ViewerFrame[];
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'demo',
  openaiModel: 'gpt-image-1',
  saladEndpoint: '',
  meshEndpoint: '',
  enhance: true,
  expandSnippets: true,
  negative: '',
  tuneLocked: false,
  seedMode: 'random',
  seed: 1,
  steps: 28,
  cfg: 5.5,
  sampler: 'euler_a',
  width: 832,
  height: 1216,
  customSize: false,
  saladModel: '',
  loras: [],
  updateManifestUrl: '',
  hourlyRate: 0.13,
  hourlyRateTouched: false,
  spendCap: 0,
  autoResume: true,
  sourceMode: 'auto',
  setupComplete: false,
  idleStopMinutes: 0,
  lowPower: false,
  serverUpdateCheck: true,
  autoFixStuckCloud: false,
  autoFixStuckChosen: false,
  autoPhoneWhileCloud: true,
};

export const DEFAULT_SESSION: Session = {
  prompt: '',
  preview: '',
  previewDirty: false,
  styleId: 'watercolor',
  aspectId: 'wallpaper',
  count: 1,
  selectedCharacterId: null,
};
