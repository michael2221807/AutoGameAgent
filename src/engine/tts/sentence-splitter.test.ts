import { describe, it, expect } from 'vitest';
import { stripMarkersForSpeech } from '@/engine/tts/sentence-splitter';

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
