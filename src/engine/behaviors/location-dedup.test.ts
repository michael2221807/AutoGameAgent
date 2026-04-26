import { describe, it, expect } from 'vitest';
import { deduplicateLocations } from '@/engine/behaviors/location-dedup';
import { createMockStateManager } from '@/engine/__test-utils__';
import { SUFFIX_DUPLICATE_LOCS, UNIQUE_LOCS, NPC_MERGE_LOCS, EMPTY_LOCS, SINGLE_LOC } from '@/engine/__test-utils__/fixtures';

const LOCS_PATH = '世界.地点信息';
const EXPL_PATH = '系统.探索记录';
const PLAYER_PATH = '角色.基础信息.当前位置';

function setup(locs: unknown[], exploration: string[] = [], playerLoc = '') {
  return createMockStateManager({
    世界: { 地点信息: JSON.parse(JSON.stringify(locs)) },
    系统: { 探索记录: [...exploration] },
    角色: { 基础信息: { 当前位置: playerLoc } },
  });
}

describe('deduplicateLocations', () => {
  it('returns 0 for unique locations', () => {
    const { sm } = setup(UNIQUE_LOCS);
    expect(deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    const { sm } = setup(EMPTY_LOCS);
    expect(deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH)).toBe(0);
  });

  it('returns 0 for single location', () => {
    const { sm } = setup(SINGLE_LOC);
    expect(deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH)).toBe(0);
  });

  it('merges suffix duplicate pair', () => {
    const { sm } = setup(SUFFIX_DUPLICATE_LOCS);
    const count = deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);
    expect(count).toBeGreaterThan(0);

    const locs = sm.get<Array<{ 名称: string }>>(LOCS_PATH)!;
    const names = locs.map((l) => l.名称);
    expect(names).toContain('中国·S市');
    expect(names).toContain('中国·S市·云顶区');
    expect(names).not.toContain('S市'); // short path removed
    expect(names.filter((n) => n === '中国·S市·云顶区')).toHaveLength(1); // no duplicates
  });

  it('renames descendants', () => {
    const { sm } = setup(SUFFIX_DUPLICATE_LOCS);
    deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);

    const locs = sm.get<Array<{ 名称: string }>>(LOCS_PATH)!;
    const names = locs.map((l) => l.名称);
    expect(names).toContain('中国·S市·云顶区·天际一号');
    expect(names).not.toContain('S市·云顶区·天际一号');
  });

  it('infers parent from name path', () => {
    const { sm } = setup(SUFFIX_DUPLICATE_LOCS);
    deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);

    const locs = sm.get<Array<{ 名称: string; 上级?: string }>>(LOCS_PATH)!;
    const sCity = locs.find((l) => l.名称 === '中国·S市');
    expect(sCity?.上级).toBe('中国');
  });

  it('merges NPC lists as union', () => {
    const { sm } = setup(NPC_MERGE_LOCS);
    deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);

    const locs = sm.get<Array<{ 名称: string; NPC?: string[] }>>(LOCS_PATH)!;
    const merged = locs.find((l) => l.名称 === 'B国·A市');
    expect(merged?.NPC).toEqual(expect.arrayContaining(['张三', '李四']));
  });

  it('updates exploration record', () => {
    const { sm } = setup(SUFFIX_DUPLICATE_LOCS, ['S市·云顶区']);
    deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);

    const expl = sm.get<string[]>(EXPL_PATH)!;
    expect(expl).toContain('中国·S市·云顶区');
    expect(expl).not.toContain('S市·云顶区');
  });

  it('updates player location', () => {
    const { sm } = setup(SUFFIX_DUPLICATE_LOCS, [], 'S市·云顶区');
    deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);

    expect(sm.get<string>(PLAYER_PATH)).toBe('中国·S市·云顶区');
  });

  it('preserves longer description on merge', () => {
    const { sm } = setup([
      { 名称: 'X', 描述: 'short' },
      { 名称: 'Y·X', 描述: 'a much longer description here', 上级: 'Y' },
      { 名称: 'Y' },
    ]);
    deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);

    const locs = sm.get<Array<{ 名称: string; 描述?: string }>>(LOCS_PATH)!;
    const x = locs.find((l) => l.名称 === 'Y·X');
    expect(x?.描述).toBe('a much longer description here');
  });

  it('is idempotent — running twice produces same result', () => {
    const { sm } = setup(SUFFIX_DUPLICATE_LOCS);
    deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);
    const after1 = JSON.stringify(sm.get(LOCS_PATH));
    const count2 = deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);
    const after2 = JSON.stringify(sm.get(LOCS_PATH));
    expect(count2).toBe(0); // no further merges
    expect(after2).toBe(after1);
  });

  it('handles three-way duplicate (city + district + sub all duplicated)', () => {
    const locs = [
      { 名称: 'A', 描述: 'root short' },
      { 名称: 'A·B', 上级: 'A' },
      { 名称: 'A·B·C', 上级: 'A·B' },
      { 名称: 'X·A', 描述: 'root long', 上级: 'X' },
      { 名称: 'X·A·B', 上级: 'X·A' },
      { 名称: 'X', 描述: 'country' },
    ];
    const { sm } = setup(locs);
    deduplicateLocations(sm as never, LOCS_PATH, EXPL_PATH, PLAYER_PATH);
    const names = sm.get<Array<{ 名称: string }>>(LOCS_PATH)!.map((l) => l.名称);
    // All merged under X·A tree
    expect(names).toContain('X·A');
    expect(names).toContain('X·A·B');
    expect(names).toContain('X·A·B·C');
    expect(names).not.toContain('A'); // short root removed
    expect(names).not.toContain('A·B'); // renamed
  });
});
