import { describe, it, expect } from 'vitest';
import { get as _get } from 'lodash-es';
import { createBackfillIdentityDescriptionsMigration } from './backfill-identity-descriptions';

const ORIGINS = [
  { name: '山野遗孤', description: '自幼在山野中长大' },
  { name: '书香门第', description: '出身于官宦世家' },
];
const TRAITS = [
  { name: '坚毅', description: '性格果决、坚韧不拔' },
];
const TALENTS = [
  { name: '天命主角', description: '气运惊人' },
  { name: '剑术精通', description: '对剑类兵器有天生悟性' },
];

const migration = createBackfillIdentityDescriptionsMigration(ORIGINS, TRAITS, TALENTS);

describe('backfill-identity-descriptions migration (nested objects)', () => {
  it('has correct version range', () => {
    expect(migration.fromVersion).toBe('0');
    expect(migration.toVersion).toBe('0.5.0');
  });

  it('converts origin string to {名称, 描述}', () => {
    const data = { 角色: { 身份: { 出身: '山野遗孤' } } };
    const result = migration.migrate(data);
    expect(_get(result, '角色.身份.出身')).toEqual({ '名称': '山野遗孤', '描述': '自幼在山野中长大' });
  });

  it('converts trait string to {名称, 描述}', () => {
    const data = { 角色: { 基础信息: { 特质: '坚毅' } } };
    const result = migration.migrate(data);
    expect(_get(result, '角色.基础信息.特质')).toEqual({ '名称': '坚毅', '描述': '性格果决、坚韧不拔' });
  });

  it('converts talents string[] to [{名称, 描述}, ...]', () => {
    const data = { 角色: { 身份: { 天赋: ['天命主角', '剑术精通'] } } };
    const result = migration.migrate(data);
    expect(_get(result, '角色.身份.天赋')).toEqual([
      { '名称': '天命主角', '描述': '气运惊人' },
      { '名称': '剑术精通', '描述': '对剑类兵器有天生悟性' },
    ]);
  });

  it('uses empty desc for custom presets not in lookup', () => {
    const data = { 角色: { 身份: { 出身: '自定义出身', 天赋: ['自定义天赋'] }, 基础信息: { 特质: '自定义特质' } } };
    const result = migration.migrate(data);
    expect(_get(result, '角色.身份.出身')).toEqual({ '名称': '自定义出身', '描述': '' });
    expect(_get(result, '角色.基础信息.特质')).toEqual({ '名称': '自定义特质', '描述': '' });
    expect(_get(result, '角色.身份.天赋')).toEqual([{ '名称': '自定义天赋', '描述': '' }]);
  });

  it('sets empty object for missing/empty origin', () => {
    const data = { 角色: { 身份: {} } };
    const result = migration.migrate(data);
    expect(_get(result, '角色.身份.出身')).toEqual({ '名称': '', '描述': '' });
  });

  it('skips already-migrated talent objects', () => {
    const data = { 角色: { 身份: { 天赋: [{ '名称': '天命主角', '描述': '已有' }] } } };
    const result = migration.migrate(data);
    expect(_get(result, '角色.身份.天赋')).toEqual([{ '名称': '天命主角', '描述': '已有' }]);
  });

  it('★空名天赋对象不被 stringify 成 "[object Object]"（FIX#6：导入 \'0\' 戳重跑迁移）', () => {
    const data = { 角色: { 身份: { 天赋: [{ '名称': '御剑', '描述': 'kept' }, { '名称': '', '描述': '' }] } } };
    const result = migration.migrate(data);
    expect(_get(result, '角色.身份.天赋')).toEqual([
      { '名称': '御剑', '描述': 'kept' },
      { '名称': '', '描述': '' }, // 归一化，绝不出现 '[object Object]'
    ]);
  });

  it('cleans up old parallel description fields', () => {
    const data = {
      角色: {
        身份: { 出身: '山野遗孤', 出身描述: '旧平行字段', 天赋: ['天命主角'], 天赋描述: ['旧'] },
        基础信息: { 特质: '坚毅', 特质描述: '旧平行字段' },
      },
    };
    const result = migration.migrate(data);
    const identity = _get(result, '角色.身份') as Record<string, unknown>;
    const baseInfo = _get(result, '角色.基础信息') as Record<string, unknown>;
    expect(identity['出身描述']).toBeUndefined();
    expect(identity['天赋描述']).toBeUndefined();
    expect(baseInfo['特质描述']).toBeUndefined();
  });
});
