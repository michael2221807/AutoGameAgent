/**
 * Tests for PrivacyProfileValidator — contract enforcement for NPC 私密信息.
 *
 * Covers the sprint extensions: required 4 body-part names (嘴/胸部/小穴/屁穴)
 * and the conditional 初夜* trio required when NPC is non-virgin.
 */
import { describe, expect, it } from 'vitest';

import { isPrivacyProfileComplete } from './privacy-profile-validator';

/** Minimal valid profile — virgin + 4 required body parts populated. */
function makeVirginProfile() {
  return {
    '是否为处女/处男': true,
    身体部位: [
      { 部位名称: '嘴',   敏感度: 40, 开发度: 10, 特征描述: '唇形饱满，微微上翘' },
      { 部位名称: '胸部', 敏感度: 60, 开发度: 20, 特征描述: '丰满圆润，弹性极佳' },
      { 部位名称: '小穴', 敏感度: 50, 开发度: 0,  特征描述: '粉嫩紧致，未经人事' },
      { 部位名称: '屁穴', 敏感度: 30, 开发度: 0,  特征描述: '娇小紧缩，禁区之地' },
    ],
    性格倾向: '温顺',
    性取向: '异性恋',
    性癖好: ['被温柔对待'],
    性渴望程度: 40,
    性交总次数: 0,
    性伴侣名单: [],
  };
}

describe('isPrivacyProfileComplete — baseline', () => {
  it('accepts a minimal virgin profile with the 4 required body parts', () => {
    expect(isPrivacyProfileComplete(makeVirginProfile())).toBe(true);
  });

  it('rejects null/undefined/non-object input', () => {
    expect(isPrivacyProfileComplete(null)).toBe(false);
    expect(isPrivacyProfileComplete(undefined)).toBe(false);
    expect(isPrivacyProfileComplete('string')).toBe(false);
    expect(isPrivacyProfileComplete([])).toBe(false);
  });

  it('rejects placeholder strings in required text fields', () => {
    const p = makeVirginProfile() as Record<string, unknown>;
    p['性格倾向'] = '待生成';
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });
});

describe('isPrivacyProfileComplete — required body parts', () => {
  it('rejects when 身体部位 is missing entirely', () => {
    const p = makeVirginProfile() as Record<string, unknown>;
    delete p['身体部位'];
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });

  it('rejects when 身体部位 is not an array', () => {
    const p = makeVirginProfile() as Record<string, unknown>;
    p['身体部位'] = { 嘴: '...' };
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });

  it('rejects when one of the 4 required parts is absent', () => {
    const p = makeVirginProfile();
    p.身体部位 = p.身体部位.filter((x) => x.部位名称 !== '屁穴');
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });

  it('rejects when a required part has an empty 特征描述', () => {
    const p = makeVirginProfile();
    p.身体部位 = p.身体部位.map((x) =>
      x.部位名称 === '胸部' ? { ...x, 特征描述: '' } : x,
    );
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });

  it('rejects when a required part has a placeholder 特征描述', () => {
    const p = makeVirginProfile();
    p.身体部位 = p.身体部位.map((x) =>
      x.部位名称 === '小穴' ? { ...x, 特征描述: '待生成' } : x,
    );
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });

  it('accepts when AI appends extra body parts beyond the 4 required', () => {
    const p = makeVirginProfile();
    p.身体部位.push({ 部位名称: '乳首', 敏感度: 70, 开发度: 0, 特征描述: '樱桃色，挺立' });
    p.身体部位.push({ 部位名称: '臀部', 敏感度: 50, 开发度: 30, 特征描述: '挺翘饱满' });
    expect(isPrivacyProfileComplete(p)).toBe(true);
  });
});

describe('isPrivacyProfileComplete — 初夜 conditional fields', () => {
  /** Non-virgin profile base — needs the 3 初夜 fields */
  function makeNonVirginBase(): Record<string, unknown> {
    const p: Record<string, unknown> = makeVirginProfile();
    p['是否为处女/处男'] = false;
    p['性交总次数'] = 3;
    p['性伴侣名单'] = ['周承砚'];
    return p;
  }

  it('rejects non-virgin profile missing all 3 初夜 fields', () => {
    expect(isPrivacyProfileComplete(makeNonVirginBase())).toBe(false);
  });

  it('rejects when 初夜夺取者 is present but 初夜时间 is missing', () => {
    const p = makeNonVirginBase();
    p['初夜夺取者'] = '周承砚';
    p['初夜描述'] = '雪夜客栈，醉酒后的相拥';
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });

  it('rejects when any 初夜 field is an empty string', () => {
    const p = makeNonVirginBase();
    p['初夜夺取者'] = '周承砚';
    p['初夜时间'] = '';
    p['初夜描述'] = '雪夜客栈';
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });

  it('rejects when any 初夜 field is a placeholder', () => {
    const p = makeNonVirginBase();
    p['初夜夺取者'] = '未知'; // this is a legitimate value per prompt, but tests the code path
    p['初夜时间'] = '待生成';
    p['初夜描述'] = '雪夜客栈';
    expect(isPrivacyProfileComplete(p)).toBe(false);
  });

  it('accepts non-virgin profile with all 3 初夜 fields populated', () => {
    const p = makeNonVirginBase();
    p['初夜夺取者'] = '周承砚';
    p['初夜时间'] = '14 岁冬';
    p['初夜描述'] = '雪夜客栈，他以长辈身份借宿，借酒意夺走她的第一次。她既惊恐又隐隐期待，清晨醒来时房梁落下一层薄雪。';
    expect(isPrivacyProfileComplete(p)).toBe(true);
  });

  it('does not require 初夜 fields when profile is virgin', () => {
    // Baseline virgin already passes — proves conditional is actually conditional.
    const p = makeVirginProfile();
    expect(isPrivacyProfileComplete(p)).toBe(true);
  });
});
