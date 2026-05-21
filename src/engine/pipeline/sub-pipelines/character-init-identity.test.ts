/**
 * Diagnostic test: verify that buildInitialState produces nested {名称, 描述} objects
 * for origin, trait, and talents when descriptionField is set.
 */
import { describe, it, expect } from 'vitest';
import { set as _set, get as _get, cloneDeep } from 'lodash-es';

function extractStoredValue(
  step: { type: string; valueField?: string; descriptionField?: string },
  value: unknown,
): unknown {
  const field = step.valueField;
  if (!field) return value;
  const descField = step.descriptionField;

  if (step.type === 'select-one') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      const name = rec[field];
      if (descField) {
        const desc = typeof rec[descField] === 'string' ? rec[descField] : '';
        return { '名称': name ?? '', '描述': desc };
      }
      return name ?? value;
    }
    return value;
  }

  if (step.type === 'select-many') {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
        .map((item) => {
          const name = item[field];
          if (descField) {
            const desc = typeof item[descField] === 'string' ? item[descField] : '';
            return { '名称': name ?? '', '描述': desc };
          }
          return name;
        })
        .filter((v): v is NonNullable<typeof v> => v !== undefined && v !== null);
    }
    return value;
  }

  return value;
}

interface SchemaNode {
  type?: string;
  default?: unknown;
  properties?: Record<string, SchemaNode>;
}

function extractDefaultsFromSchema(schema: SchemaNode, target: Record<string, unknown>): void {
  const properties = schema.properties;
  if (!properties) return;
  for (const [key, propSchema] of Object.entries(properties)) {
    const hasOwnDefault = propSchema.default !== undefined;
    const isObject = propSchema.type === 'object' && !!propSchema.properties;
    if (isObject) {
      let base: Record<string, unknown>;
      const existing = target[key];
      if (key in target && existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
        base = existing as Record<string, unknown>;
      } else if (hasOwnDefault && propSchema.default !== null && typeof propSchema.default === 'object') {
        base = cloneDeep(propSchema.default) as Record<string, unknown>;
      } else {
        base = {};
      }
      extractDefaultsFromSchema(propSchema, base);
      if (hasOwnDefault || Object.keys(base).length > 0 || key in target) {
        target[key] = base;
      }
    } else if (hasOwnDefault && !(key in target)) {
      target[key] = cloneDeep(propSchema.default);
    }
  }
}

const STEPS = [
  { id: 'world', type: 'select-one', label: '世界' },
  { id: 'talentTier', type: 'select-one', statePath: '角色.身份.天赋档次', valueField: 'name' },
  { id: 'origin', type: 'select-one', statePath: '角色.身份.出身', valueField: 'name', descriptionField: 'description' },
  { id: 'trait', type: 'select-one', statePath: '角色.基础信息.特质', valueField: 'name', descriptionField: 'description' },
  { id: 'talents', type: 'select-many', statePath: '角色.身份.天赋', valueField: 'name', descriptionField: 'description' },
  { id: 'attributes', type: 'attribute-allocation', statePath: '角色.身份.先天六维' },
  { id: 'identity', type: 'form' },
];

const STATE_SCHEMA: SchemaNode = {
  type: 'object',
  properties: {
    角色: {
      type: 'object',
      properties: {
        基础信息: {
          type: 'object',
          properties: {
            姓名: { type: 'string', default: '' },
            特质: { type: 'object', default: {}, properties: { 名称: { type: 'string', default: '' }, 描述: { type: 'string', default: '' } } },
          },
        },
        身份: {
          type: 'object',
          properties: {
            出身: { type: 'object', default: {}, properties: { 名称: { type: 'string', default: '' }, 描述: { type: 'string', default: '' } } },
            天赋档次: { type: 'string', default: '' },
            天赋: { type: 'array', default: [] },
          },
        },
        属性: { type: 'object', properties: { 体质: { type: 'number', default: 5 } } },
      },
    },
  },
};

function buildInitialState(choices: {
  selections: Record<string, unknown>;
  attributes?: Record<string, number>;
  formValues?: Record<string, unknown>;
}): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  extractDefaultsFromSchema(STATE_SCHEMA, state);
  const stepsById = new Map(STEPS.map((s) => [s.id, s]));
  for (const [stepId, value] of Object.entries(choices.selections)) {
    const step = stepsById.get(stepId);
    if (!step || !('statePath' in step) || !step.statePath) {
      if (stepId.includes('.')) _set(state, stepId, value);
      else (state as Record<string, unknown>)[stepId] = value;
      continue;
    }
    _set(state, step.statePath as string, extractStoredValue(step, value));
  }
  if (choices.attributes) {
    const attrStep = STEPS.find((s) => s.type === 'attribute-allocation');
    const baselinePath = attrStep && 'statePath' in attrStep ? attrStep.statePath as string : null;
    for (const [attr, val] of Object.entries(choices.attributes)) {
      if (baselinePath) _set(state, `${baselinePath}.${attr}`, val);
      _set(state, `角色.属性.${attr}`, val);
    }
  }
  if (choices.formValues) {
    for (const [key, value] of Object.entries(choices.formValues)) {
      if (key.includes('.')) _set(state, key, value);
      else (state as Record<string, unknown>)[key] = value;
    }
  }
  return state;
}

describe('buildInitialState — nested identity objects', () => {
  const choices = {
    selections: {
      world: { name: '九霄界', description: '一个修仙世界' },
      talentTier: { name: '甲等', total_points: 40 },
      origin: { name: '将门遗孤', description: '出身将门', talent_cost: 5 },
      trait: { name: '过目不忘', description: '记忆力超群', talent_cost: 3 },
      talents: [
        { name: '天眼通', description: '可以看到灵气', talent_cost: 8 },
        { name: '灵根', description: '天生灵根', talent_cost: 10 },
      ],
    },
    attributes: { 体质: 7 },
    formValues: { '角色.基础信息.姓名': '戊非春' },
  };

  const state = buildInitialState(choices);

  it('writes origin as {名称, 描述} object', () => {
    expect(_get(state, '角色.身份.出身')).toEqual({ '名称': '将门遗孤', '描述': '出身将门' });
  });

  it('writes trait as {名称, 描述} object', () => {
    expect(_get(state, '角色.基础信息.特质')).toEqual({ '名称': '过目不忘', '描述': '记忆力超群' });
  });

  it('writes talents as [{名称, 描述}, ...]', () => {
    expect(_get(state, '角色.身份.天赋')).toEqual([
      { '名称': '天眼通', '描述': '可以看到灵气' },
      { '名称': '灵根', '描述': '天生灵根' },
    ]);
  });

  it('talentTier remains plain string (no descriptionField)', () => {
    expect(_get(state, '角色.身份.天赋档次')).toBe('甲等');
  });

  it('attributes and form values still work', () => {
    expect(_get(state, '角色.属性.体质')).toBe(7);
    expect(_get(state, '角色.基础信息.姓名')).toBe('戊非春');
  });
});
