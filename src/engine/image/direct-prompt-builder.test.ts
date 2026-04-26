import { describe, it, expect } from 'vitest';
import { buildDirectCharacterPrompt } from '@/engine/image/direct-prompt-builder';

describe('buildDirectCharacterPrompt', () => {
  const femaleNpc = JSON.stringify({
    姓名: '林清霜',
    性别: '女',
    年龄: 18,
    身份: '内门弟子',
    境界: '练气三层',
    简介: '天赋异禀的少女',
    性格: '温柔内敛',
    外貌: '容貌清丽，眉目如画',
    身材: '身姿纤细',
    衣着: '白色道袍，系着青色腰带',
  });

  const maleNpc = JSON.stringify({
    姓名: '萧无痕',
    性别: '男',
    年龄: 25,
    身份: '外门长老',
    外貌: '面容刚毅',
  });

  // ── NovelAI output ──

  it('builds NovelAI prompt with 1girl tag for female NPC', () => {
    const result = buildDirectCharacterPrompt(femaleNpc, { isNovelAI: true });
    expect(result.prompt).toContain('1girl');
    expect(result.prompt).toContain('portrait');
    expect(result.prompt).toContain('face focus');
  });

  it('builds NovelAI prompt with 1man tag for male NPC', () => {
    const result = buildDirectCharacterPrompt(maleNpc, { isNovelAI: true });
    expect(result.prompt).toContain('1man');
  });

  it('uses English comma separator for NovelAI', () => {
    const result = buildDirectCharacterPrompt(femaleNpc, { isNovelAI: true });
    expect(result.prompt).toContain(', ');
    // Fields are joined by English comma; internal field values may have Chinese commas
    // Verify the first separator between "女" and "18岁" is English comma
    expect(result.prompt).toMatch(/女, 18岁/);
  });

  it('adds full body keywords for full-length composition (NovelAI)', () => {
    const result = buildDirectCharacterPrompt(femaleNpc, {
      isNovelAI: true,
      composition: 'full-length',
    });
    expect(result.prompt).toContain('full body');
    expect(result.prompt).toContain('standing');
    expect(result.prompt).toContain('character focus');
    expect(result.prompt).not.toContain('portrait');
  });

  it('includes all visual fields in order', () => {
    const result = buildDirectCharacterPrompt(femaleNpc, { isNovelAI: true });
    expect(result.prompt).toContain('内门弟子');
    expect(result.prompt).toContain('温柔内敛');
    expect(result.prompt).toContain('容貌清丽');
    expect(result.prompt).toContain('白色道袍');
  });

  // ── Non-NovelAI output ──

  it('uses Chinese comma separator for non-NovelAI', () => {
    const result = buildDirectCharacterPrompt(femaleNpc);
    expect(result.prompt).toContain('，');
  });

  it('adds Chinese composition keywords for full-length (non-NovelAI)', () => {
    const result = buildDirectCharacterPrompt(femaleNpc, { composition: 'full-length' });
    expect(result.prompt).toContain('全身角色');
    expect(result.prompt).toContain('站姿');
  });

  it('does not add composition keywords for portrait (non-NovelAI)', () => {
    const result = buildDirectCharacterPrompt(femaleNpc, { composition: 'portrait' });
    expect(result.prompt).not.toContain('全身角色');
  });

  // ── Extra requirements ──

  it('includes extra requirements at the end', () => {
    const result = buildDirectCharacterPrompt(femaleNpc, {
      extraRequirements: '月光下的场景',
    });
    expect(result.prompt).toContain('月光下的场景');
  });

  // ── Complex fields ──

  it('extracts equipment object fields', () => {
    const npc = JSON.stringify({
      性别: '女',
      当前装备: { 武器: '青锋剑', 防具: '灵纹护甲' },
    });
    const result = buildDirectCharacterPrompt(npc);
    expect(result.prompt).toContain('装备：');
    expect(result.prompt).toContain('青锋剑');
  });

  it('extracts inventory array', () => {
    const npc = JSON.stringify({
      性别: '男',
      背包: ['灵石', '丹药'],
    });
    const result = buildDirectCharacterPrompt(npc);
    expect(result.prompt).toContain('随身物品：');
    expect(result.prompt).toContain('灵石');
  });

  // ── Edge cases ──

  it('handles empty JSON gracefully', () => {
    const result = buildDirectCharacterPrompt('{}');
    expect(result.prompt).toBe('');
    expect(result.rawDescription).toBe('{}');
  });

  it('handles invalid JSON gracefully', () => {
    const result = buildDirectCharacterPrompt('not json');
    expect(result.prompt).toBe('');
  });

  it('returns rawDescription as pretty JSON', () => {
    const result = buildDirectCharacterPrompt(femaleNpc);
    expect(result.rawDescription).toContain('林清霜');
    expect(result.rawDescription).toContain('\n'); // pretty-printed
  });

  // ── NAI weight normalization ──

  it('applies NAI weight normalization for NovelAI', () => {
    const npc = JSON.stringify({
      性别: '女',
      外貌: '(blue eyes:1.2), long hair',
    });
    const result = buildDirectCharacterPrompt(npc, { isNovelAI: true });
    expect(result.prompt).toContain('1.2::blue eyes::');
  });

  it('gender fallback: solo for unknown gender', () => {
    const npc = JSON.stringify({ 外貌: 'mysterious figure' });
    const result = buildDirectCharacterPrompt(npc, { isNovelAI: true });
    expect(result.prompt).toContain('solo');
  });
});
