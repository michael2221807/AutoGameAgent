/**
 * Image subsystem save migration — Sprint Image-6
 *
 * When loading a save that predates the image subsystem, this helper
 * initializes the missing `系统.扩展.image` subtree with sensible defaults.
 * Called during save load (by persistence layer).
 *
 * Idempotent: if the subtree already exists, does nothing.
 */
import type { StateManager } from '../core/state-manager';

const IMAGE_ROOT_PATH = '系统.扩展.image';

const DEFAULT_IMAGE_STATE = {
  enabled: false,
  config: {
    autoSceneOnRound: false,
    autoPortraitForMajorNpcs: false,
    defaultBackend: 'novelai',
    defaultPresetId: null,
    defaultStyle: 'generic',
    defaultComposition: 'half-body',
    useTransformer: true,
    defaultNpcArtistPreset: '',
    defaultNpcPngPreset: '',
    defaultSceneArtistPreset: '',
    defaultScenePngPreset: '',
    secretForceNude: true,
    sceneHistoryLimit: 10,
    novelai: {
      customParamsEnabled: false,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      steps: 28,
      cfgScale: 5,
      smea: false,
      seed: 0,
      negativeDefault: '',
    },
    civitai: {
      allowMatureContent: false,
      scheduler: 'EulerA',
      steps: 25,
      cfgScale: 7,
      seed: -1,
      clipSkip: 2,
      outputFormat: 'png',
      additionalNetworksJson: '',
      controlNetsJson: '',
    },
    transformer: {
      independentEnabled: false,
      endpoint: '',
      apiKey: '',
      model: '',
    },
    scene: {
      independentEnabled: false,
      backend: 'novelai',
      endpoint: '',
      apiKey: '',
      model: '',
      defaultStyle: 'generic',
      composition: 'landscape',
      orientation: 'landscape',
      resolution: '',
      customResolution: '',
    },
    auto: {
      genderFilter: 'all',
      importanceFilter: 'major',
      historyLimit: 50,
    },
  },
  tasks: [],
  assets: {},
  stylePresets: [],
  artistPresets: [],
  characterAnchors: [],
  transformerPresets: [],
  modelRulesets: [],
  ruleTemplates: [],
  rules: {
    activeNpcRule: '',
    activeSceneRule: '',
    activeJudgeRule: '',
    npcEnabled: false,
    sceneEnabled: false,
    judgeEnabled: false,
  },
  playerImages: [],
  playerAnchor: null,
  sceneArchive: {
    生图历史: [],
    当前壁纸图片ID: '',
  },
};

export function migrateImageState(stateManager: StateManager): boolean {
  const existing = stateManager.get<unknown>(IMAGE_ROOT_PATH);

  if (existing === undefined || existing === null) {
    stateManager.set(IMAGE_ROOT_PATH, DEFAULT_IMAGE_STATE, 'system');
    console.debug('[ImageMigration] Initialized image subtree for pre-image save');
    return true;
  }

  let migrated = false;
  const civitaiPath = `${IMAGE_ROOT_PATH}.config.civitai`;
  if (stateManager.get<unknown>(civitaiPath) === undefined) {
    stateManager.set(civitaiPath, DEFAULT_IMAGE_STATE.config.civitai, 'system');
    console.debug('[ImageMigration] Added civitai config defaults to existing save');
    migrated = true;
  }

  return migrated;
}
