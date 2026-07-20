import { describe, it, expect } from 'vitest';
import { stripMarkersForSpeech, splitSentences } from '@/engine/tts/sentence-splitter';

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
