import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateImageState } from './save-migration';

function createMockStateManager() {
  const store: Record<string, unknown> = {};
  return {
    get: vi.fn(<T>(path: string): T | undefined => {
      const parts = path.split('.');
      let current: unknown = store;
      for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current as T | undefined;
    }),
    set: vi.fn((path: string, value: unknown, _source?: string) => {
      const parts = path.split('.');
      let current: Record<string, unknown> = store;
      for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
          current[parts[i]] = {};
        }
        current = current[parts[i]] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
    }),
    _store: store,
  };
}

describe('migrateImageState', () => {
  let sm: ReturnType<typeof createMockStateManager>;

  beforeEach(() => { sm = createMockStateManager(); });

  it('initializes full image subtree for pre-image save', () => {
    const result = migrateImageState(sm as unknown as import('../core/state-manager').StateManager);
    expect(result).toBe(true);
    expect(sm.set).toHaveBeenCalled();
    const imageRoot = sm.get('系统.扩展.image');
    expect(imageRoot).toBeDefined();
    expect((imageRoot as Record<string, unknown>).enabled).toBe(false);
  });

  it('adds civitai config to existing save without it', () => {
    sm.set('系统.扩展.image', { enabled: true, config: { novelai: { sampler: 'k_euler' } } }, 'system');
    sm.set.mockClear();

    const result = migrateImageState(sm as unknown as import('../core/state-manager').StateManager);
    expect(result).toBe(true);

    const civitai = sm.get('系统.扩展.image.config.civitai') as Record<string, unknown> | undefined;
    expect(civitai).toBeDefined();
    expect(civitai?.scheduler).toBe('EulerA');
    expect(civitai?.allowMatureContent).toBe(false);
    expect(civitai?.steps).toBe(25);
    expect(civitai?.cfgScale).toBe(7);
    expect(civitai?.seed).toBe(-1);
    expect(civitai?.clipSkip).toBe(2);
  });

  it('does not overwrite existing civitai config', () => {
    sm.set('系统.扩展.image', {
      enabled: true,
      config: {
        civitai: { allowMatureContent: true, scheduler: 'DDIM', steps: 30, cfgScale: 5, seed: 42, clipSkip: 1, outputFormat: 'jpeg', additionalNetworksJson: '{}', controlNetsJson: '' },
      },
    }, 'system');
    sm.set.mockClear();

    const result = migrateImageState(sm as unknown as import('../core/state-manager').StateManager);
    expect(result).toBe(false);

    const civitai = sm.get('系统.扩展.image.config.civitai') as Record<string, unknown> | undefined;
    expect(civitai?.allowMatureContent).toBe(true);
    expect(civitai?.scheduler).toBe('DDIM');
    expect(civitai?.steps).toBe(30);
  });

  it('does not affect other provider configs', () => {
    sm.set('系统.扩展.image', {
      enabled: true,
      config: { novelai: { sampler: 'k_euler_ancestral', steps: 28 } },
    }, 'system');

    migrateImageState(sm as unknown as import('../core/state-manager').StateManager);

    const novelai = sm.get('系统.扩展.image.config.novelai') as Record<string, unknown> | undefined;
    expect(novelai?.sampler).toBe('k_euler_ancestral');
    expect(novelai?.steps).toBe(28);
  });

  it('does not run full init when image root already exists', () => {
    sm.set('系统.扩展.image', { enabled: false, config: { civitai: { scheduler: 'Euler' } } }, 'system');
    sm.set.mockClear();

    const result = migrateImageState(sm as unknown as import('../core/state-manager').StateManager);
    expect(result).toBe(false);
    expect(sm.set).not.toHaveBeenCalled();
  });
});
