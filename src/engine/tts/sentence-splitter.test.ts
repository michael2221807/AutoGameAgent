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
  it('returns empty array for empty/whitespace', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n  ')).toEqual([]);
  });

  it('splits on Chinese sentence-final punctuation, keeping the punctuation', () => {
    // Each sentence ≥ MIN_SEGMENT_LEN content chars so none get merged.
    const segs = splitSentences('你好世界大家好呀。今天的天气真的很不错。我们一起出去走走看吧。');
    expect(segs.length).toBe(3);
    expect(segs[0]).toContain('。');
    expect(segs[1]).toContain('。');
    expect(segs[2]).toContain('。');
  });

  it('merges too-short fragments into a neighbour', () => {
    // "好。" is below MIN_SEGMENT_LEN → should merge, not stand alone
    const segs = splitSentences('好。这是一段足够长的正文内容用来测试合并逻辑。');
    expect(segs.every((s) => s.replace(/[。！？\s]/g, '').length >= 3)).toBe(true);
  });

  it('strips markers before splitting (no brackets/backticks in output)', () => {
    const segs = splitSentences('【环境】天黑了。`他在想`。掌柜抬起头看了看你的脸庞。');
    expect(segs.join('')).not.toContain('【');
    expect(segs.join('')).not.toContain('`');
    expect(segs.length).toBeGreaterThanOrEqual(1);
  });

  it('handles text with no terminal punctuation as one segment', () => {
    const segs = splitSentences('一段没有句号结尾的正文内容');
    expect(segs.length).toBe(1);
  });
});
