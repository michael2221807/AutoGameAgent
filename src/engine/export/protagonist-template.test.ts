/**
 * protagonist-template 单元测试 — Story 5 (P9)
 *
 * 纯函数。验证 editableFields 黑/灰/白名单分区 + 派生 target 交集硬拒绝，
 * 以及 fixed 空姓名 / blank 非空开场的导出前校验错误码（handover §4A pitfalls）。
 */
import { describe, it, expect } from 'vitest';
import { validateEditableFields, validateProtagonistForExport } from './protagonist-template';
import { buildDefaultProtagonistPolicy } from './card-export-paths';

const POLICY = buildDefaultProtagonistPolicy();

describe('validateEditableFields', () => {
  it('routes whitelist paths to allowed (relative + absolute both normalize)', () => {
    const r = validateEditableFields(['基础信息.姓名', '角色.基础信息.年龄', '背包'], POLICY);
    expect(r.allowed).toEqual(['基础信息.姓名', '角色.基础信息.年龄', '背包']);
    expect(r.downgraded).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it('hard-rejects every blacklist prefix (derived/gameplay artifacts)', () => {
    const r = validateEditableFields(
      ['属性.体质', '可变属性.声望', '效果', '图片档案.已选头像图片ID', '身体.私密'],
      POLICY,
    );
    expect(r.rejected).toEqual(['属性.体质', '可变属性.声望', '效果', '图片档案.已选头像图片ID', '身体.私密']);
    expect(r.allowed).toEqual([]);
  });

  it('downgrades gray prefixes (derivation-warning fields)', () => {
    const r = validateEditableFields(['身份.先天六维', '身份.出身', '身份.天赋'], POLICY);
    expect(r.downgraded).toEqual(['身份.先天六维', '身份.出身', '身份.天赋']);
    expect(r.allowed).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it('conservatively rejects unknown paths not in any list', () => {
    const r = validateEditableFields(['完全未知.字段'], POLICY);
    expect(r.rejected).toEqual(['完全未知.字段']);
  });

  it('rejects an otherwise-whitelisted field when it is a pack-declared derived target', () => {
    // 基础信息.年龄 is whitelisted, but if the pack declares it a derivation target it must NOT be editable.
    const r = validateEditableFields(['基础信息.年龄', '基础信息.姓名'], POLICY, ['角色.基础信息.年龄']);
    expect(r.rejected).toContain('基础信息.年龄');
    expect(r.allowed).toEqual(['基础信息.姓名']);
  });
});

describe('validateProtagonistForExport', () => {
  const treeWithName = (name: string): Record<string, unknown> => ({
    角色: { 基础信息: { 姓名: name } },
  });

  it('fixed mode with empty name → blocking error', () => {
    const r = validateProtagonistForExport('fixed', treeWithName('  '), POLICY);
    expect(r.errors).toEqual(['protagonist.fixed.emptyName']);
  });

  it('fixed mode with a real name → no error', () => {
    const r = validateProtagonistForExport('fixed', treeWithName('赵子龙'), POLICY);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('blank mode with a non-generic firstRoundSetup → advisory warning', () => {
    const r = validateProtagonistForExport('blank', {}, POLICY, { firstRoundSetup: '你是赵子龙，七进七出' });
    expect(r.warnings).toEqual(['protagonist.blank.setupShouldBeGeneric']);
    expect(r.errors).toEqual([]);
  });

  it('blank mode with an empty setup → no warning', () => {
    const r = validateProtagonistForExport('blank', {}, POLICY, { firstRoundSetup: '   ' });
    expect(r.warnings).toEqual([]);
  });

  it('template mode → no errors or warnings', () => {
    const r = validateProtagonistForExport('template', treeWithName('赵子龙'), POLICY);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
