import { describe, it, expect, vi } from 'vitest';
import { NpcContextRenderer } from './npc-context-renderer';
import { NpcPresenceService, type NpcRecord } from './npc-presence';
import { DEFAULT_ENGINE_PATHS } from '../pipeline/types';

function makeNpc(name: string, present: boolean, extra: Record<string, unknown> = {}): NpcRecord {
  return { 名称: name, 是否在场: present, 位置: `${name}的位置`, ...extra };
}

function makeRenderer(npcs: NpcRecord[]) {
  const store: Record<string, unknown> = {
    [DEFAULT_ENGINE_PATHS.relationships]: npcs,
  };
  const stateManager = {
    get: vi.fn(<T>(path: string): T | undefined => store[path] as T | undefined),
    set: vi.fn(),
  };
  const presenceSvc = new NpcPresenceService(stateManager as never, DEFAULT_ENGINE_PATHS);
  return new NpcContextRenderer(presenceSvc, DEFAULT_ENGINE_PATHS);
}

describe('NpcContextRenderer.renderTiered', () => {
  const npcs = [
    makeNpc('张三', true, { 描述: '铁匠', 背景: '世代打铁' }),
    makeNpc('李四', true),
    makeNpc('王五', false, { 关系状态: '朋友' }),
    makeNpc('赵六', false),
  ];

  it('splits NPCs into 4 tiers based on relevance + presence', () => {
    const renderer = makeRenderer(npcs);
    const relevant = new Set(['张三', '王五']);
    const result = renderer.renderTiered(relevant);

    expect(result.stats.tier1Count).toBe(1);          // 张三: present + relevant
    expect(result.stats.tier2PresentCount).toBe(1);    // 李四: present + !relevant
    expect(result.stats.tier2AbsentCount).toBe(1);     // 王五: absent + relevant
    expect(result.stats.tier3Count).toBe(1);           // 赵六: absent + !relevant
  });

  it('returns correct tier names', () => {
    const renderer = makeRenderer(npcs);
    const relevant = new Set(['张三', '王五']);
    const result = renderer.renderTiered(relevant);

    expect(result.tierNames.tier1).toEqual(['张三']);
    expect(result.tierNames.tier2Present).toEqual(['李四']);
    expect(result.tierNames.tier2Absent).toEqual(['王五']);
    expect(result.tierNames.tier3).toEqual(['赵六']);
  });

  it('tier 1 uses detailed rendering (contains field labels)', () => {
    const renderer = makeRenderer(npcs);
    const relevant = new Set(['张三']);
    const result = renderer.renderTiered(relevant);

    expect(result.presentBlock).toContain('### 张三');
    expect(result.presentBlock).toContain('**描述**');
  });

  it('tier 2 present appears under "其他在场人物（简要）" section', () => {
    const renderer = makeRenderer(npcs);
    const relevant = new Set(['张三']); // 李四 is present but not relevant
    const result = renderer.renderTiered(relevant);

    expect(result.presentBlock).toContain('其他在场人物（简要）');
    expect(result.presentBlock).toContain('**李四**');
  });

  it('tier 2 absent uses lean rendering', () => {
    const renderer = makeRenderer(npcs);
    const relevant = new Set(['王五']);
    const result = renderer.renderTiered(relevant);

    expect(result.absentBlock).toContain('**王五**');
    expect(result.absentBlock).toContain('朋友');
  });

  it('tier 3 uses ultra-lean rendering (name + location only)', () => {
    const renderer = makeRenderer(npcs);
    const result = renderer.renderTiered(new Set(['张三'])); // only 张三 relevant
    // 赵六 is absent + not relevant → tier 3

    expect(result.absentBlock).toContain('其他离场人物');
    expect(result.absentBlock).toContain('赵六(赵六的位置)');
  });

  it('tier 3 items joined by Chinese comma', () => {
    const manyNpcs = [
      makeNpc('A', true),
      makeNpc('B', false),
      makeNpc('C', false),
      makeNpc('D', false),
    ];
    const renderer = makeRenderer(manyNpcs);
    const result = renderer.renderTiered(new Set(['A']));

    // B, C, D are all tier 3 (absent + not relevant)
    expect(result.absentBlock).toContain('B(B的位置)、C(C的位置)、D(D的位置)');
  });

  it('all present + all relevant → no tier 2 present section', () => {
    const allPresent = [makeNpc('A', true), makeNpc('B', true)];
    const renderer = makeRenderer(allPresent);
    const result = renderer.renderTiered(new Set(['A', 'B']));

    expect(result.presentBlock).not.toContain('其他在场人物');
    expect(result.stats.tier1Count).toBe(2);
    expect(result.stats.tier2PresentCount).toBe(0);
  });

  it('no NPCs present → shows placeholder', () => {
    const allAbsent = [makeNpc('A', false), makeNpc('B', false)];
    const renderer = makeRenderer(allAbsent);
    const result = renderer.renderTiered(new Set(['A']));

    expect(result.presentBlock).toContain('当前场景没有 NPC 在场');
  });

  it('totalSaved calculation', () => {
    const renderer = makeRenderer(npcs);
    const relevant = new Set(['张三', '王五']);
    const result = renderer.renderTiered(relevant);

    // tier2Present=1 → saved (2000-150)=1850
    // tier3=1 → saved (150-20)=130
    expect(result.stats.totalSaved).toBe(1850 + 130);
  });

  it('empty NPC list → no crash', () => {
    const renderer = makeRenderer([]);
    const result = renderer.renderTiered(new Set());

    expect(result.presentBlock).toContain('当前场景没有 NPC 在场');
    expect(result.absentBlock).toBe('');
    expect(result.stats.tier1Count).toBe(0);
  });
});

describe('NpcContextRenderer.renderUltraLeanNpc (via renderTiered)', () => {
  it('formats as name(location) when location exists', () => {
    const renderer = makeRenderer([makeNpc('张三', false, { 位置: '城北' })]);
    const result = renderer.renderTiered(new Set());

    expect(result.absentBlock).toContain('张三(城北)');
  });

  it('formats as name only when location is empty', () => {
    const npc = makeNpc('张三', false);
    delete (npc as Record<string, unknown>)['位置'];
    const renderer = makeRenderer([npc]);
    const result = renderer.renderTiered(new Set());

    expect(result.absentBlock).toContain('张三');
    expect(result.absentBlock).not.toContain('张三(');
  });
});
