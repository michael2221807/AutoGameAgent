import { describe, it, expect } from 'vitest';
import {
  validateLoraAir,
  resolveLoraScope,
  collectActiveLorasForScope,
  buildTriggerInjection,
  mergeAdditionalNetworks,
  prepareCivitaiLora,
  validateShelfForGeneration,
} from './civitai-lora';
import type { CivitaiLoraShelfItem } from './types';

function makeLora(overrides: Partial<CivitaiLoraShelfItem> = {}): CivitaiLoraShelfItem {
  return {
    id: 'test-lora',
    name: 'Test LoRA',
    air: 'urn:air:sdxl:lora:civitai:123@456',
    enabled: true,
    strength: 1.0,
    scopes: ['player', 'character'],
    triggers: [],
    autoInjectTriggers: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('validateLoraAir', () => {
  it('accepts valid LoRA AIR', () => {
    expect(validateLoraAir('urn:air:sdxl:lora:civitai:82098@87153').valid).toBe(true);
  });

  it('accepts LyCORIS AIR', () => {
    expect(validateLoraAir('urn:air:sdxl:lycoris:civitai:100@200').valid).toBe(true);
  });

  it('accepts LoCon AIR', () => {
    expect(validateLoraAir('urn:air:sdxl:locon:civitai:100@200').valid).toBe(true);
  });

  it('rejects empty string', () => {
    const r = validateLoraAir('');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('不能为空');
  });

  it('rejects missing urn:air: prefix', () => {
    const r = validateLoraAir('sdxl:lora:civitai:123@456');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('urn:air:');
  });

  it('rejects missing civitai marker', () => {
    const r = validateLoraAir('urn:air:sdxl:lora:other:123@456');
    expect(r.valid).toBe(false);
    expect(r.error).toContain(':civitai:');
  });

  it('rejects checkpoint AIR (not lora type)', () => {
    const r = validateLoraAir('urn:air:sdxl:checkpoint:civitai:101055@128078');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('不是 LoRA');
  });

  it('rejects AIR without version ID', () => {
    const r = validateLoraAir('urn:air:sdxl:lora:civitai:123');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('modelId@versionId');
  });

  it('rejects AIR with missing model ID before @', () => {
    const r = validateLoraAir('urn:air:sdxl:lora:civitai:@100');
    expect(r.valid).toBe(false);
  });

  it('rejects AIR with non-numeric model ID', () => {
    const r = validateLoraAir('urn:air:sdxl:lora:civitai:abc@100');
    expect(r.valid).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    const r = validateLoraAir('   ');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('不能为空');
  });
});

describe('resolveLoraScope', () => {
  it('maps scene subject to scene scope', () => {
    expect(resolveLoraScope('scene')).toBe('scene');
  });

  it('maps secret_part subject to secret_part scope', () => {
    expect(resolveLoraScope('secret_part')).toBe('secret_part');
  });

  it('maps character + __player__ to player scope', () => {
    expect(resolveLoraScope('character', '__player__')).toBe('player');
  });

  it('maps character + NPC name to character scope', () => {
    expect(resolveLoraScope('character', '林月如')).toBe('character');
  });

  it('maps character without target to character scope', () => {
    expect(resolveLoraScope('character')).toBe('character');
  });
});

describe('collectActiveLorasForScope', () => {
  it('returns enabled LoRAs matching scope', () => {
    const shelf = [
      makeLora({ id: 'a', scopes: ['player', 'character'] }),
      makeLora({ id: 'b', scopes: ['scene'] }),
      makeLora({ id: 'c', scopes: ['player'], enabled: false }),
    ];
    const result = collectActiveLorasForScope(shelf, 'player');
    expect(result.map((l) => l.id)).toEqual(['a']);
  });

  it('returns empty when no LoRAs match', () => {
    const shelf = [makeLora({ scopes: ['scene'] })];
    expect(collectActiveLorasForScope(shelf, 'player')).toEqual([]);
  });

  it('returns empty for empty shelf', () => {
    expect(collectActiveLorasForScope([], 'character')).toEqual([]);
  });
});

describe('buildTriggerInjection', () => {
  it('collects enabled triggers from active LoRAs', () => {
    const loras = [makeLora({
      triggers: [
        { id: 't1', text: 'moonlit robe', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
        { id: 't2', text: 'silver thread', enabled: true, source: 'metadata', createdAt: 0, updatedAt: 0 },
      ],
    })];
    expect(buildTriggerInjection(loras, 'masterpiece')).toEqual(['moonlit robe', 'silver thread']);
  });

  it('skips disabled triggers', () => {
    const loras = [makeLora({
      triggers: [
        { id: 't1', text: 'active', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
        { id: 't2', text: 'disabled', enabled: false, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];
    expect(buildTriggerInjection(loras, '')).toEqual(['active']);
  });

  it('dedupes against existing prompt (case-insensitive)', () => {
    const loras = [makeLora({
      triggers: [
        { id: 't1', text: 'Masterpiece', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
        { id: 't2', text: 'new tag', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];
    expect(buildTriggerInjection(loras, 'masterpiece, best quality')).toEqual(['new tag']);
  });

  it('dedupes across multiple LoRAs', () => {
    const loras = [
      makeLora({ id: 'a', triggers: [{ id: 't1', text: 'shared', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 }] }),
      makeLora({ id: 'b', triggers: [{ id: 't2', text: 'shared', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 }] }),
    ];
    expect(buildTriggerInjection(loras, '')).toEqual(['shared']);
  });

  it('rejects <lora:...> syntax triggers', () => {
    const loras = [makeLora({
      triggers: [
        { id: 't1', text: '<lora:mymodel:1.0>', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
        { id: 't2', text: 'normal tag', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];
    expect(buildTriggerInjection(loras, '')).toEqual(['normal tag']);
  });

  it('skips LoRAs with autoInjectTriggers=false', () => {
    const loras = [makeLora({
      autoInjectTriggers: false,
      triggers: [{ id: 't1', text: 'should not appear', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 }],
    })];
    expect(buildTriggerInjection(loras, '')).toEqual([]);
  });

  it('dedupes multi-phrase trigger text against existing prompt', () => {
    const loras = [makeLora({
      triggers: [
        { id: 't1', text: 'open mouth, tongue out', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
        { id: 't2', text: 'new tag', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];
    const result = buildTriggerInjection(loras, 'masterpiece, open mouth, tongue out');
    expect(result).toEqual(['new tag']);
  });

  it('injects multi-phrase trigger when not all sub-tokens exist', () => {
    const loras = [makeLora({
      triggers: [
        { id: 't1', text: 'open mouth, tongue out', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];
    const result = buildTriggerInjection(loras, 'masterpiece, open mouth');
    expect(result).toEqual(['open mouth, tongue out']);
  });

  it('skips blank trigger text', () => {
    const loras = [makeLora({
      triggers: [
        { id: 't1', text: '  ', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
        { id: 't2', text: '', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];
    expect(buildTriggerInjection(loras, '')).toEqual([]);
  });
});

describe('mergeAdditionalNetworks', () => {
  it('merges shelf LoRAs with raw JSON', () => {
    const loras = [makeLora({ air: 'urn:air:sdxl:lora:civitai:111@222', strength: 0.8 })];
    const rawJson = '{"urn:air:sdxl:vae:civitai:777@888": {"strength": 1}}';
    const result = mergeAdditionalNetworks(loras, rawJson);

    expect(result.merged['urn:air:sdxl:lora:civitai:111@222']).toEqual({ strength: 0.8 });
    expect(result.merged['urn:air:sdxl:vae:civitai:777@888']).toEqual({ strength: 1 });
    expect(result.conflicts).toEqual([]);
  });

  it('handles empty raw JSON', () => {
    const loras = [makeLora({ air: 'urn:air:sdxl:lora:civitai:1@2', strength: 1.0 })];
    const result = mergeAdditionalNetworks(loras, '');
    expect(Object.keys(result.merged)).toEqual(['urn:air:sdxl:lora:civitai:1@2']);
  });

  it('throws on invalid raw JSON', () => {
    const loras = [makeLora({ air: 'urn:air:sdxl:lora:civitai:1@2', strength: 0.5 })];
    expect(() => mergeAdditionalNetworks(loras, '{not valid')).toThrow('附加网络 JSON 格式错误');
  });

  it('shelf wins on AIR conflict and records it', () => {
    const conflictAir = 'urn:air:sdxl:lora:civitai:100@200';
    const loras = [makeLora({ air: conflictAir, strength: 1.5 })];
    const rawJson = `{"${conflictAir}": {"strength": 0.3, "type": "Lora"}}`;
    const result = mergeAdditionalNetworks(loras, rawJson);

    expect(result.merged[conflictAir]).toEqual({ strength: 1.5 });
    expect(result.conflicts).toEqual([conflictAir]);
  });

  it('ignores raw JSON that is an array (not object)', () => {
    const loras = [makeLora({ air: 'urn:air:sdxl:lora:civitai:1@2', strength: 1.0 })];
    const result = mergeAdditionalNetworks(loras, '["urn:air:sdxl:lora:civitai:1@2"]');
    expect(Object.keys(result.merged)).toEqual(['urn:air:sdxl:lora:civitai:1@2']);
    expect(result.conflicts).toEqual([]);
  });

  it('handles undefined rawJsonString', () => {
    const loras = [makeLora({ air: 'urn:air:sdxl:lora:civitai:1@2', strength: 0.5 })];
    const result = mergeAdditionalNetworks(loras, undefined);
    expect(result.merged['urn:air:sdxl:lora:civitai:1@2']).toEqual({ strength: 0.5 });
  });

  it('returns empty mergedJson for no networks', () => {
    const result = mergeAdditionalNetworks([], '');
    expect(result.mergedJson).toBe('');
  });
});

describe('prepareCivitaiLora', () => {
  it('injects triggers and merges networks for active LoRAs', () => {
    const shelf = [makeLora({
      scopes: ['character'],
      strength: 0.8,
      triggers: [
        { id: 't1', text: 'moonlit robe', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];

    const result = prepareCivitaiLora({
      shelf,
      scope: 'character',
      positivePrompt: 'masterpiece, best quality',
      rawAdditionalNetworksJson: '',
    });

    expect(result.modifiedPositive).toBe('masterpiece, best quality, moonlit robe');
    expect(result.snapshot.loras).toHaveLength(1);
    expect(result.snapshot.loras[0].injectedTriggers).toEqual(['moonlit robe']);
    expect(result.mergedAdditionalNetworksJson).toContain('civitai:123@456');
  });

  it('passes through unchanged when no active LoRAs for scope', () => {
    const shelf = [makeLora({ scopes: ['scene'] })];

    const result = prepareCivitaiLora({
      shelf,
      scope: 'character',
      positivePrompt: 'original prompt',
      rawAdditionalNetworksJson: '',
    });

    expect(result.modifiedPositive).toBe('original prompt');
    expect(result.snapshot.loras).toHaveLength(0);
    expect(result.mergedAdditionalNetworksJson).toBe('');
  });

  it('warns when >5 LoRAs are active', () => {
    const shelf = Array.from({ length: 6 }, (_, i) =>
      makeLora({ id: `lora-${i}`, scopes: ['character'] }),
    );

    const result = prepareCivitaiLora({
      shelf, scope: 'character', positivePrompt: '', rawAdditionalNetworksJson: '',
    });

    expect(result.warnings.some((w) => w.type === 'too_many_active')).toBe(true);
  });

  it('warns for mature LoRA', () => {
    const shelf = [makeLora({ mature: true, scopes: ['character'] })];

    const result = prepareCivitaiLora({
      shelf, scope: 'character', positivePrompt: '', rawAdditionalNetworksJson: '',
    });

    expect(result.warnings.some((w) => w.type === 'mature_mismatch')).toBe(true);
  });

  it('snapshot injectedTriggers only lists actually-injected triggers', () => {
    const shelf = [makeLora({
      scopes: ['character'],
      triggers: [
        { id: 't1', text: 'masterpiece', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
        { id: 't2', text: 'new tag', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];

    const result = prepareCivitaiLora({
      shelf, scope: 'character',
      positivePrompt: 'masterpiece, best quality',
      rawAdditionalNetworksJson: '',
    });

    expect(result.snapshot.loras[0].injectedTriggers).toEqual(['new tag']);
    expect(result.modifiedPositive).toBe('masterpiece, best quality, new tag');
  });

  it('emits air_conflict warning when shelf and raw JSON overlap', () => {
    const air = 'urn:air:sdxl:lora:civitai:123@456';
    const shelf = [makeLora({ air, scopes: ['character'] })];
    const rawJson = `{"${air}": {"strength": 0.3}}`;

    const result = prepareCivitaiLora({
      shelf, scope: 'character', positivePrompt: '', rawAdditionalNetworksJson: rawJson,
    });

    expect(result.warnings.some((w) => w.type === 'air_conflict')).toBe(true);
  });

  it('warns for strong effect (|strength| > 1.5)', () => {
    const shelf = [makeLora({ strength: -1.8, scopes: ['character'] })];

    const result = prepareCivitaiLora({
      shelf, scope: 'character', positivePrompt: '', rawAdditionalNetworksJson: '',
    });

    expect(result.warnings.some((w) => w.type === 'strong_effect')).toBe(true);
  });

  it('active LoRA with empty triggers: network included, prompt unchanged', () => {
    const shelf = [makeLora({ scopes: ['character'], triggers: [], autoInjectTriggers: true })];

    const result = prepareCivitaiLora({
      shelf, scope: 'character', positivePrompt: 'original', rawAdditionalNetworksJson: '',
    });

    expect(result.modifiedPositive).toBe('original');
    expect(result.mergedAdditionalNetworksJson).toContain('civitai:123@456');
    expect(result.snapshot.loras).toHaveLength(1);
    expect(result.snapshot.loras[0].injectedTriggers).toEqual([]);
  });

  it('mixed active/inactive LoRAs: only active included', () => {
    const shelf = [
      makeLora({ id: 'active', scopes: ['character'], enabled: true, air: 'urn:air:sdxl:lora:civitai:1@1' }),
      makeLora({ id: 'disabled', scopes: ['character'], enabled: false, air: 'urn:air:sdxl:lora:civitai:2@2' }),
      makeLora({ id: 'wrong-scope', scopes: ['scene'], enabled: true, air: 'urn:air:sdxl:lora:civitai:3@3' }),
    ];

    const result = prepareCivitaiLora({
      shelf, scope: 'character', positivePrompt: '', rawAdditionalNetworksJson: '',
    });

    expect(result.snapshot.loras).toHaveLength(1);
    expect(result.snapshot.loras[0].id).toBe('active');
    expect(result.mergedAdditionalNetworksJson).toContain('1@1');
    expect(result.mergedAdditionalNetworksJson).not.toContain('2@2');
    expect(result.mergedAdditionalNetworksJson).not.toContain('3@3');
  });

  it('emits lora_trigger_syntax warning for <lora:> triggers', () => {
    const shelf = [makeLora({
      scopes: ['character'],
      triggers: [
        { id: 't1', text: '<lora:mymodel:1.0>', enabled: true, source: 'manual', createdAt: 0, updatedAt: 0 },
      ],
    })];

    const result = prepareCivitaiLora({
      shelf, scope: 'character', positivePrompt: '', rawAdditionalNetworksJson: '',
    });

    expect(result.warnings.some((w) => w.type === 'lora_trigger_syntax')).toBe(true);
    expect(result.modifiedPositive).toBe('');
  });
});

describe('validateShelfForGeneration', () => {
  it('returns valid when no issues', () => {
    const shelf = [makeLora({ scopes: ['character'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('blocks on invalid AIR', () => {
    const shelf = [makeLora({ air: 'not-a-valid-air', scopes: ['character'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('blocks on zero strength', () => {
    const shelf = [makeLora({ strength: 0, scopes: ['character'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('strength'))).toBe(true);
  });

  it('blocks on near-zero strength (0.02)', () => {
    const shelf = [makeLora({ strength: 0.02, scopes: ['character'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(false);
  });

  it('blocks on negative near-zero strength (-0.02)', () => {
    const shelf = [makeLora({ strength: -0.02, scopes: ['character'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(false);
  });

  it('warns on mature LoRA in preflight', () => {
    const shelf = [makeLora({ mature: true, scopes: ['character'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('Mature'))).toBe(true);
  });

  it('warns on >5 active LoRAs', () => {
    const shelf = Array.from({ length: 6 }, (_, i) =>
      makeLora({ id: `l${i}`, scopes: ['scene'] }),
    );
    const result = validateShelfForGeneration(shelf, 'scene');
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('6 个'))).toBe(true);
  });

  it('warns on strong effect', () => {
    const shelf = [makeLora({ strength: 1.8, scopes: ['character'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('1.8'))).toBe(true);
  });

  it('ignores disabled LoRAs', () => {
    const shelf = [makeLora({ air: 'invalid', enabled: false, scopes: ['character'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid for empty shelf', () => {
    const result = validateShelfForGeneration([], 'character');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('ignores LoRAs not matching scope', () => {
    const shelf = [makeLora({ air: 'invalid', scopes: ['scene'] })];
    const result = validateShelfForGeneration(shelf, 'character');
    expect(result.valid).toBe(true);
  });
});
