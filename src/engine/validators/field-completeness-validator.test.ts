/**
 * Tests for FieldCompletenessValidator — drives the generic repair pipeline.
 *
 * Covers: NPC / player separation, nsfw gating, placeholder rejection,
 * empty-array rejection, name-keyed path-prefix construction, formatting.
 */
import { describe, expect, it } from 'vitest';

import {
  findIncompleteFields,
  formatMissingFieldsSummary,
  readRequiredFieldsConfig,
  type RequiredFieldsConfig,
} from './field-completeness-validator';
import type { StateManager } from '../core/state-manager';
import type { EnginePathConfig } from '../pipeline/types';
import { DEFAULT_ENGINE_PATHS } from '../pipeline/types';

/** Minimal StateManager stub — only implements what the validator uses. */
function makeFakeStateManager(tree: Record<string, unknown>): StateManager {
  return {
    get<T>(path: string): T | undefined {
      const parts = path.split('.');
      let cursor: unknown = tree;
      for (const p of parts) {
        if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
        cursor = (cursor as Record<string, unknown>)[p];
      }
      return cursor as T | undefined;
    },
    getTree(): Record<string, unknown> { return tree; },
  } as unknown as StateManager;
}

const PATHS: EnginePathConfig = DEFAULT_ENGINE_PATHS;

const BASE_CONFIG: RequiredFieldsConfig = {
  npc: {
    always: ['名称', '描述', '外貌描述', '身材描写', '衣着风格'],
    nsfw: ['私密信息'],
  },
  player: {
    always: [],
    nsfw: ['角色.身体'],
  },
};

describe('findIncompleteFields — NPC scope', () => {
  it('returns empty report when every required field is populated', () => {
    const sm = makeFakeStateManager({
      社交: {
        关系: [{
          名称: '李明阳',
          描述: '神色沉静的镖师',
          外貌描述: '剑眉星目，身量高挑……',
          身材描写: '身高一米八五，精瘦如松',
          衣着风格: '玄色劲装，束腰系刀',
          私密信息: { 是否为处女: true, 身体部位: [{}] },
        }],
      },
      角色: { 身体: { 身高: 170 } },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: true });
    expect(report.total).toBe(0);
    expect(report.entities).toEqual([]);
  });

  it('flags a single missing field on a specific NPC', () => {
    const sm = makeFakeStateManager({
      社交: {
        关系: [{
          名称: '李明阳',
          描述: '镖师',
          外貌描述: '剑眉星目',
          身材描写: '', // missing
          衣着风格: '玄色劲装',
        }],
      },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: false });
    expect(report.total).toBe(1);
    expect(report.entities[0].entityName).toBe('李明阳');
    expect(report.entities[0].missingFields).toEqual(['身材描写']);
    expect(report.entities[0].pathPrefix).toBe('社交.关系[名称=李明阳]');
    expect(report.entities[0].entityType).toBe('npc');
  });

  it('flags multiple missing fields on the same NPC', () => {
    const sm = makeFakeStateManager({
      社交: {
        关系: [{
          名称: '苏青',
          描述: '茶馆老板',
          外貌描述: '',
          身材描写: '',
          衣着风格: '',
        }],
      },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: false });
    expect(report.entities[0].missingFields).toEqual(['外貌描述', '身材描写', '衣着风格']);
  });

  it('treats placeholder strings as missing', () => {
    const sm = makeFakeStateManager({
      社交: {
        关系: [{
          名称: '陌生人',
          描述: '待生成',
          外貌描述: '暂无',
          身材描写: '未知',
          衣着风格: 'TBD',
        }],
      },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: false });
    expect(report.entities[0].missingFields).toEqual(['描述', '外貌描述', '身材描写', '衣着风格']);
  });

  it('skips NPCs without a 名称 (can\'t be repaired)', () => {
    const sm = makeFakeStateManager({
      社交: {
        关系: [
          { 名称: '', 外貌描述: '' }, // anonymous, skipped
          { 名称: '王管事', 外貌描述: '', 描述: 'x', 身材描写: 'y', 衣着风格: 'z' },
        ],
      },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: false });
    expect(report.entities).toHaveLength(1);
    expect(report.entities[0].entityName).toBe('王管事');
  });

  it('does not look at NSFW fields when nsfwMode=false', () => {
    const sm = makeFakeStateManager({
      社交: {
        关系: [{
          名称: '李明阳',
          描述: 'x', 外貌描述: 'x', 身材描写: 'x', 衣着风格: 'x',
          // 私密信息 absent — but nsfwMode off, so not required
        }],
      },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: false });
    expect(report.total).toBe(0);
  });

  it('flags missing 私密信息 when nsfwMode=true', () => {
    const sm = makeFakeStateManager({
      社交: {
        关系: [{
          名称: '李明阳',
          描述: 'x', 外貌描述: 'x', 身材描写: 'x', 衣着风格: 'x',
          // no 私密信息
        }],
      },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: true });
    expect(report.entities[0].missingFields).toEqual(['私密信息']);
  });
});

describe('findIncompleteFields — player scope', () => {
  it('flags missing 角色.身体 when nsfwMode=true', () => {
    const sm = makeFakeStateManager({
      角色: { 基础信息: { 姓名: '方云' } },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: true });
    const player = report.entities.find((e) => e.entityType === 'player');
    expect(player?.missingFields).toContain('角色.身体');
  });

  it('skips player scope entirely when nsfwMode=false and always=[]', () => {
    const sm = makeFakeStateManager({
      角色: { 基础信息: { 姓名: '方云' } },
    });
    const report = findIncompleteFields(sm, PATHS, BASE_CONFIG, { nsfwMode: false });
    expect(report.entities.some((e) => e.entityType === 'player')).toBe(false);
  });
});

describe('readRequiredFieldsConfig', () => {
  it('returns empty object when rules are missing', () => {
    expect(readRequiredFieldsConfig(undefined)).toEqual({});
    expect(readRequiredFieldsConfig({})).toEqual({});
  });

  it('returns the requiredFields entry when present', () => {
    const rules = { requiredFields: BASE_CONFIG };
    expect(readRequiredFieldsConfig(rules)).toEqual(BASE_CONFIG);
  });

  it('ignores non-object values gracefully', () => {
    expect(readRequiredFieldsConfig({ requiredFields: 'not-an-object' })).toEqual({});
  });
});

describe('formatMissingFieldsSummary', () => {
  it('returns a placeholder when the report is empty', () => {
    expect(formatMissingFieldsSummary({ entities: [], get total() { return 0; } }))
      .toBe('（无缺失字段）');
  });

  it('groups NPC entries under a header with backtick-quoted field names', () => {
    const report = {
      entities: [
        { entityType: 'npc' as const, entityName: '李明阳', pathPrefix: '社交.关系[名称=李明阳]', missingFields: ['外貌描述', '身材描写'] },
      ],
      get total() { return 1; },
    };
    const out = formatMissingFieldsSummary(report);
    expect(out).toContain('NPC 缺失字段');
    expect(out).toContain('李明阳');
    expect(out).toContain('`外貌描述`');
    expect(out).toContain('`身材描写`');
  });

  it('separates player entries into their own section', () => {
    const report = {
      entities: [
        { entityType: 'npc' as const, entityName: '李明阳', pathPrefix: '社交.关系[名称=李明阳]', missingFields: ['身材描写'] },
        { entityType: 'player' as const, entityName: '玩家', pathPrefix: '', missingFields: ['角色.身体'] },
      ],
      get total() { return 2; },
    };
    const out = formatMissingFieldsSummary(report);
    expect(out).toContain('NPC 缺失字段');
    expect(out).toContain('玩家实体缺失字段');
    expect(out).toContain('`角色.身体`');
  });
});
