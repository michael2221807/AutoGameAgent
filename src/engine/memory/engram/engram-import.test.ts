/**
 * buildImportedEngramState 单元测试 — Story 6 P3
 *
 * 锁定卡导入 engram 块构建：source 改打 'card-import' / is_embedded=false / events:[] 守卫
 * （SC-8 核心：避开 loadEngram 整图静默丢弃陷阱）/ schemaVersion 单一来源。
 */
import { describe, it, expect } from 'vitest';
import { buildImportedEngramState } from './engram-import';
import { ENGRAM_SCHEMA_VERSION } from './engram-types';
import type { EngramEntity } from './entity-builder';
import type { EngramEdge } from './knowledge-edge';

function makeEntity(over: Partial<EngramEntity> = {}): EngramEntity {
  return {
    name: '张三',
    type: 'npc',
    attributes: {},
    firstSeen: 1,
    lastSeen: 3,
    mentionCount: 2,
    summary: '一个剑客',
    is_embedded: true, // 卡里可能是 true；导入必须重置为 false
    source: 'user', // 原始来源；导入必须改 'card-import'
    ...over,
  };
}

function makeEdge(over: Partial<EngramEdge> = {}): EngramEdge {
  return {
    id: 'zhang|player|friend',
    sourceEntity: '张三',
    targetEntity: '玩家',
    fact: '张三与玩家相识',
    episodes: ['ep1'],
    is_embedded: true,
    createdAtRound: 1,
    lastSeenRound: 3,
    source: 'opening',
    ...over,
  };
}

/** 复刻 EngramManager.loadEngram (engram-manager.ts:675) 的载入守卫——SC-8 真值预言机。 */
function wouldLoadEngram(raw: unknown): boolean {
  return !!(raw && typeof raw === 'object' && Array.isArray((raw as { events?: unknown }).events));
}

describe('buildImportedEngramState — 结构 + 来源戳记', () => {
  it('entities 改打 source=card-import 且 is_embedded=false，其余字段保留', () => {
    const block = buildImportedEngramState({
      entities: [makeEntity({ name: '李四', summary: '铁匠' })],
      knowledgeEdges: [],
    });
    expect(block.entities).toHaveLength(1);
    expect(block.entities[0].source).toBe('card-import');
    expect(block.entities[0].is_embedded).toBe(false);
    expect(block.entities[0].name).toBe('李四');
    expect(block.entities[0].summary).toBe('铁匠');
  });

  it('knowledgeEdges → v2Edges，改打 source=card-import 且 is_embedded=false', () => {
    const block = buildImportedEngramState({
      entities: [],
      knowledgeEdges: [makeEdge({ fact: '李四是张三的师父' })],
    });
    expect(block.v2Edges).toHaveLength(1);
    expect(block.v2Edges[0].source).toBe('card-import');
    expect(block.v2Edges[0].is_embedded).toBe(false);
    expect(block.v2Edges[0].fact).toBe('李四是张三的师父');
  });

  it('不修改入参（纯函数）', () => {
    const ent = makeEntity();
    const edge = makeEdge();
    buildImportedEngramState({ entities: [ent], knowledgeEdges: [edge] });
    expect(ent.source).toBe('user'); // 原对象未被改
    expect(ent.is_embedded).toBe(true);
    expect(edge.source).toBe('opening');
  });

  it('meta.schemaVersion 用单一来源常量；counts 归零', () => {
    const block = buildImportedEngramState({ entities: [makeEntity()], knowledgeEdges: [makeEdge()] });
    expect(block.meta.schemaVersion).toBe(ENGRAM_SCHEMA_VERSION);
    expect(block.meta).toMatchObject({
      eventCount: 0,
      embeddedEventCount: 0,
      embeddedEntityCount: 0,
    });
  });

  it('relations 始终为空数组', () => {
    const block = buildImportedEngramState({ entities: [], knowledgeEdges: [] });
    expect(block.relations).toEqual([]);
  });

  it('防御性：payload 字段非数组 → 视为空', () => {
    const block = buildImportedEngramState({
      entities: undefined as unknown as EngramEntity[],
      knowledgeEdges: 'nope' as unknown as EngramEdge[],
    });
    expect(block.entities).toEqual([]);
    expect(block.v2Edges).toEqual([]);
    expect(Array.isArray(block.events)).toBe(true);
  });
});

describe('buildImportedEngramState — SC-8 events:[] 守卫（避开整图丢弃陷阱）', () => {
  it('events 是数组（空）→ loadEngram 守卫通过，不返回 createEmpty', () => {
    const block = buildImportedEngramState({
      entities: [makeEntity()],
      knowledgeEdges: [makeEdge()],
    });
    expect(Array.isArray(block.events)).toBe(true);
    expect(block.events).toHaveLength(0);
    // 真值预言机：本块会被 loadEngram 正常载入（而非丢弃）
    expect(wouldLoadEngram(block)).toBe(true);
  });

  it('陷阱演示：同样的 entities/edges 但缺 events → loadEngram 会整图丢弃', () => {
    const block = buildImportedEngramState({
      entities: [makeEntity()],
      knowledgeEdges: [makeEdge()],
    });
    // 构造一个「漏写 events」的坏块：实体/边都在，但没有 events 数组
    const badBlock = { entities: block.entities, v2Edges: block.v2Edges, relations: [], meta: block.meta };
    expect(wouldLoadEngram(badBlock)).toBe(false); // ← 会被 createEmpty 吞掉，整图丢失
    // 而正确的块即使携带相同的实体/边也能存活，证明 events:[] 是关键守卫
    expect(wouldLoadEngram(block)).toBe(true);
    expect(block.entities).toHaveLength(1);
    expect(block.v2Edges).toHaveLength(1);
  });
});
