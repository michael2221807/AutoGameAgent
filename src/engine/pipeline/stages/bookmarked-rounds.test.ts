// Tests for the 收藏楼层 (bookmarked rounds) one-shot injection block + its
// sanitizer strip. Covers: buildBookmarkedRoundsBlock (pending filter, naming,
// truncation, custom header) and that 元数据.收藏楼层 is stripped from the
// prompt JSON so injected content is never duplicated.
import { describe, it, expect } from 'vitest';
import { buildBookmarkedRoundsBlock } from './context-assembly';
import { stringifySnapshotForPrompt } from '../../memory/snapshot-sanitizer';
import type { BookmarkedRound } from '../types';

function bm(partial: Partial<BookmarkedRound>): BookmarkedRound {
  return {
    id: partial.id ?? 'bm_1_1000',
    round: partial.round ?? 1,
    createdAt: partial.createdAt ?? 1000,
    name: partial.name ?? '默认名',
    content: partial.content ?? '正文',
    pending: partial.pending ?? false,
    ...partial,
  };
}

describe('buildBookmarkedRoundsBlock', () => {
  it('returns empty string when there are no bookmarks', () => {
    expect(buildBookmarkedRoundsBlock([])).toBe('');
  });

  it('returns empty string when nothing is selected (default: not injected)', () => {
    const list = [bm({ round: 1, pending: false }), bm({ round: 2, pending: false })];
    expect(buildBookmarkedRoundsBlock(list)).toBe('');
  });

  it('includes only pending entries, labelled by name + round', () => {
    const list = [
      bm({ id: 'a', round: 3, name: '血誓之夜', content: '立下血誓的那夜', pending: true }),
      bm({ id: 'b', round: 5, name: '不该出现', content: '未选中', pending: false }),
    ];
    const block = buildBookmarkedRoundsBlock(list);
    expect(block).toContain('血誓之夜');
    expect(block).toContain('第3回合');
    expect(block).toContain('立下血誓的那夜');
    expect(block).not.toContain('不该出现');
    expect(block).not.toContain('未选中');
  });

  it('falls back to a round label when the name is blank', () => {
    const block = buildBookmarkedRoundsBlock([bm({ round: 7, name: '   ', content: 'x', pending: true })]);
    expect(block).toContain('第7回合');
  });

  it('truncates very long content and appends an ellipsis', () => {
    const long = '甲'.repeat(1000);
    const block = buildBookmarkedRoundsBlock([bm({ round: 1, content: long, pending: true })]);
    expect(block).toContain('…');
    // 600-char cap + ellipsis, far below the original 1000
    expect(block.length).toBeLessThan(900);
  });

  it('honours a custom header template with {entries} placeholder', () => {
    const block = buildBookmarkedRoundsBlock(
      [bm({ round: 1, name: 'N', content: 'C', pending: true })],
      '=HEADER=\n{entries}',
    );
    expect(block.startsWith('=HEADER=')).toBe(true);
    expect(block).toContain('C');
  });

  it('honours a custom per-entry format (pack override, no hardcoded label)', () => {
    const block = buildBookmarkedRoundsBlock(
      [bm({ round: 4, name: '夜宴', content: '正文Z', pending: true })],
      '{entries}',
      '[{name}|R{round}] {content}',
    );
    expect(block).toBe('[夜宴|R4] 正文Z');
  });
});

describe('元数据.收藏楼层 is stripped from the prompt JSON', () => {
  it('never leaks bookmark content into GAME_STATE_JSON', () => {
    const snapshot = {
      元数据: {
        回合序号: 3,
        收藏楼层: [bm({ round: 1, content: 'SECRET_SNAPSHOT_TEXT', pending: true })],
      },
      角色: { 基础信息: { 姓名: '张三' } },
    };
    const json = stringifySnapshotForPrompt(snapshot, false, 0);
    expect(json).not.toContain('SECRET_SNAPSHOT_TEXT');
    expect(json).not.toContain('收藏楼层');
    // Sibling fields under 元数据 still survive.
    expect(json).toContain('回合序号');
    expect(json).toContain('张三');
  });
});
