import { describe, it, expect } from 'vitest';
import { stripMarkersForSpeech, splitSentences, groupSentencesBySize } from '@/engine/tts/sentence-splitter';

describe('stripMarkersForSpeech', () => {
  it('returns empty for empty input', () => {
    expect(stripMarkersForSpeech('')).toBe('');
  });

  it('strips inline backticks (内心独白) but keeps content', () => {
    expect(stripMarkersForSpeech('他想着`这声音似曾相识`然后停住')).toContain('这声音似曾相识');
    expect(stripMarkersForSpeech('`内心`')).not.toContain('`');
  });

  it('removes 【环境】/〖判定〗 category brackets but keeps content', () => {
    const out = stripMarkersForSpeech('【环境】暮色四合');
    expect(out).not.toContain('【');
    expect(out).not.toContain('】');
    expect(out).toContain('暮色四合');
    expect(out).toContain('环境');
  });

  it('strips markdown emphasis and headings', () => {
    expect(stripMarkersForSpeech('# 标题\n**加粗**文字')).toBe('标题\n加粗文字');
  });

  it('collapses markdown table pipes into pauses', () => {
    const out = stripMarkersForSpeech('| 名称 | 数值 |\n|---|---|\n| 力量 | 10 |');
    expect(out).not.toContain('|');
    expect(out).not.toContain('---');
  });

  it('removes code fences entirely', () => {
    expect(stripMarkersForSpeech('前```code```后').replace(/\s/g, '')).toBe('前后');
  });

  it('unwraps markdown links to their text', () => {
    expect(stripMarkersForSpeech('看[这里](http://x)吧')).toContain('这里');
    expect(stripMarkersForSpeech('看[这里](http://x)吧')).not.toContain('http');
  });
});

describe('splitSentences', () => {
  it('returns [] for empty / whitespace-only input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n  ')).toEqual([]);
  });

  it('splits on sentence-ending punctuation, keeping the punctuation', () => {
    const out = splitSentences('第一句话。第二句话！第三句话？');
    expect(out).toEqual(['第一句话。', '第二句话！', '第三句话？']);
  });

  it('treats newlines as sentence boundaries without emitting them', () => {
    const out = splitSentences('上一行\n下一行');
    expect(out).toEqual(['上一行', '下一行']);
  });

  it('merges too-short fragments into the previous segment', () => {
    // "好。" (2 chars, < MIN 4) should not stand alone.
    const out = splitSentences('这是完整的一句话。好。');
    expect(out.length).toBe(1);
    expect(out[0]).toContain('好');
  });

  it('folds trailing pure-punctuation into the previous segment', () => {
    const out = splitSentences('一段正文……');
    expect(out.length).toBe(1);
    expect(out[0]).toContain('正文');
  });

  it('secondary-splits an over-long sentence on soft breaks', () => {
    const long = '甲'.repeat(60) + '，' + '乙'.repeat(60) + '，' + '丙'.repeat(20) + '。';
    const out = splitSentences(long);
    // Each emitted segment must be bounded (no single 140-char blob).
    expect(out.length).toBeGreaterThan(1);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(100);
  });

  it('keeps a single short sentence as one segment', () => {
    expect(splitSentences('你好世界。')).toEqual(['你好世界。']);
  });
});

describe('groupSentencesBySize', () => {
  // 用固定长度的假句子直观验证算法(不依赖真实分句)。
  const sent = (len: number, tag = '甲') => tag.repeat(len);

  it('returns [] for empty input', () => {
    expect(groupSentencesBySize([], 120, 6)).toEqual([]);
  });

  it('用户例A：短句不足字数 → 继续攒句直到达标', () => {
    // 5 句各 40 字,目标 200 字 / 最多 6 句 → 攒到 200(5 句)成一段。
    const s = [sent(40, '甲'), sent(40, '乙'), sent(40, '丙'), sent(40, '丁'), sent(40, '戊')];
    const out = groupSentencesBySize(s, 200, 6);
    expect(out.length).toBe(1);
    expect(out[0].length).toBe(200);
  });

  it('用户例B：两长句就超字数 → 就断在两句(平衡断点保留)', () => {
    // 两句各 125 字,目标 200:250 比 125 更接近 200 → 保留 2 句成段。
    const s = [sent(125, '甲'), sent(125, '乙')];
    const out = groupSentencesBySize(s, 200, 6);
    expect(out.length).toBe(1);
    expect(out[0].length).toBe(250);
  });

  it('平衡断点：跨界句过长时,在其之前断,避免暴冲', () => {
    // 已攒 190(接近 200),下一句 150 → 含它=340 超 140,不含=190 差 10 → 断在之前。
    const s = [sent(100, '甲'), sent(90, '乙'), sent(150, '丙')];
    const out = groupSentencesBySize(s, 200, 6);
    // 第一段 = 甲+乙 = 190;丙 单独成段(150,自身不足一半? 150 >= 100 → 自成段)。
    expect(out[0].length).toBe(190);
    expect(out[1].length).toBe(150);
  });

  it('最多句数为硬上限：句数到顶即断,即使字数没到', () => {
    // 6 句各 10 字,目标 200 / 最多 3 句 → 每 3 句一段(30 字),共 2 段。
    const s = Array.from({ length: 6 }, (_, i) => sent(10, String(i)));
    const out = groupSentencesBySize(s, 200, 3);
    expect(out.length).toBe(2);
    expect(out.every((g) => g.length === 30)).toBe(true);
  });

  it('短尾合并：末尾残段过短 → 并进上一段', () => {
    // 目标 100:甲100 成段;乙5(残尾,<50)→ 并入上一段。
    const s = [sent(100, '甲'), sent(5, '乙')];
    const out = groupSentencesBySize(s, 100, 6);
    expect(out.length).toBe(1);
    expect(out[0].length).toBe(105);
  });

  it('短尾合并受最多句数约束：并入会超上限则残段自成一段', () => {
    // 目标 100 / 最多 2 句:甲60+乙60=120 成段(2 句到顶);丙5 残尾,
    // 但上一段已 2 句(=上限),并入会超 → 丙 自成一段。
    const s = [sent(60, '甲'), sent(60, '乙'), sent(5, '丙')];
    const out = groupSentencesBySize(s, 100, 2);
    expect(out.length).toBe(2);
    expect(out[1].length).toBe(5);
  });

  it('clamps out-of-range params defensively', () => {
    // maxSentences 0 → 夹到 1;targetChars 巨大 → 夹到上限但输入短 → 一段。
    const s = [sent(10, '甲'), sent(10, '乙')];
    const out = groupSentencesBySize(s, 5, 0);
    // maxSentences=1 → 每句一段。
    expect(out.length).toBe(2);
  });
});
