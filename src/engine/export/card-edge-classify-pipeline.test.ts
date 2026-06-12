/**
 * CardEdgeClassifyPipeline 单测 — Story 7 (P4)。
 *
 * Mock 原则（铁律 7）：只 mock AI 响应文本与 renderSingle 的模板替换；
 * 分批、解析、id 规整化、合并、失败降级、进度回调全部走真实实现。
 *
 * 覆盖：双批合并 / 坏 JSON 降级续跑 / 全失败 / id 规整化 / 非法 category 与未知 id /
 * 首答优先 / abort 取消 / 上下文白名单零密钥硬断言 / prompt 未注册 pre-flight 抛错 / 空输入。
 */
import { describe, it, expect, vi } from 'vitest';
import { CardEdgeClassifyPipeline } from './card-edge-classify-pipeline';
import type { CardEdgeClassifyResult } from './card-edge-classify-pipeline';
import type { EngramEdge } from '../memory/engram/knowledge-edge';
import type { EngramEntity } from '../memory/engram/entity-builder';
import type { AIService } from '../ai/ai-service';
import type { GenerateOptions } from '../ai/types';
import type { PromptAssembler } from '../prompt/prompt-assembler';
import type { ProgressPayload } from '../services/assistant/types';

// ─── Secret markers: present in NON-whitelisted fields, must never reach the AI ───
const ATTR_SECRET = 'sk-ATTR-SECRET-LEAK';
const EPISODE_SECRET = 'episode-SECRET-trace';

function makeEdge(i: number, overrides?: Partial<EngramEdge>): EngramEdge {
  return {
    id: `edge-${i}`,
    sourceEntity: `NPC${i % 5}`,
    targetEntity: '东城茶馆',
    fact: `NPC${i % 5} 与东城茶馆有第 ${i} 号关联`,
    episodes: [EPISODE_SECRET],
    is_embedded: false,
    createdAtRound: i,
    lastSeenRound: i,
    ...overrides,
  };
}

function makeEntity(name: string, overrides?: Partial<EngramEntity>): EngramEntity {
  return {
    name,
    type: 'npc',
    summary: `${name} 的生平简介`,
    attributes: { hidden: ATTR_SECRET },
    firstSeen: 1,
    lastSeen: 1,
    mentionCount: 1,
    is_embedded: false,
    ...overrides,
  };
}

/** Template-substituting renderSingle stand-in (mirrors the real placeholder contract). */
function makeAssembler(renderResult: 'ok' | 'missing' = 'ok'): PromptAssembler {
  return {
    renderSingle: vi.fn((id: string, vars: Record<string, string>) =>
      renderResult === 'missing'
        ? null
        : `PROMPT:${id}\nWB:${vars.WORLD_BRIEF}\nEC:${vars.ENTITY_CONTEXT}\nEL:${vars.EDGES_LIST}`,
    ),
  } as unknown as PromptAssembler;
}

type GenerateImpl = (options: GenerateOptions) => Promise<string>;

function makeAI(impl: GenerateImpl): { ai: AIService; generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn(impl);
  return { ai: { generate } as unknown as AIService, generate };
}

function classificationsJson(items: Array<{ id: string; category: string }>): string {
  return JSON.stringify({
    edge_classifications: items.map((x) => ({ edge_id: x.id, category: x.category })),
  });
}

describe('CardEdgeClassifyPipeline.run', () => {
  it('classifies across two batches (40+10) and merges results', async () => {
    const edges = Array.from({ length: 50 }, (_, i) => makeEdge(i));
    const entities = ['NPC0', 'NPC1', 'NPC2', 'NPC3', 'NPC4', '东城茶馆'].map((n) => makeEntity(n));

    const { ai, generate } = makeAI(async (options) => {
      // Answer exactly the edges listed in this batch's prompt.
      const content = String(options.messages[0].content);
      const ids = [...content.matchAll(/\[(edge-\d+)\]/g)].map((m) => m[1]);
      const category = generate.mock.calls.length === 1 ? 'worldview' : 'plot-event';
      return classificationsJson(ids.map((id) => ({ id, category })));
    });

    const progress: ProgressPayload[] = [];
    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler());
    const result = await pipeline.run({ edges, entities, worldBrief: '一个武侠世界' }, (p) => progress.push(p));

    expect(result.totalBatches).toBe(2);
    expect(result.failedBatches).toBe(0);
    expect(result.unclassified).toEqual([]);
    expect(result.classified.size).toBe(50);
    expect(result.classified.get('edge-0')).toBe('worldview');
    expect(result.classified.get('edge-49')).toBe('plot-event');

    // Call contract: usageType + temperature + non-streaming.
    expect(generate).toHaveBeenCalledTimes(2);
    for (const call of generate.mock.calls) {
      const opts = call[0] as GenerateOptions;
      expect(opts.usageType).toBe('card_edge_classify');
      expect(opts.temperature).toBe(0.3);
      expect(opts.stream).toBe(false);
    }

    // Item-level progress: 40/50 then 50/50.
    expect(progress.map((p) => p.i18nParams)).toEqual([
      { done: 40, total: 50 },
      { done: 50, total: 50 },
    ]);
    expect(progress[0].i18nKey).toBe('save.toCard.classify.progress');
  });

  it('degrades an unparseable batch to unclassified and continues (SC-11)', async () => {
    const edges = Array.from({ length: 50 }, (_, i) => makeEdge(i));
    const { ai, generate } = makeAI(async (options) => {
      if (generate.mock.calls.length === 1) return '抱歉，我无法完成这个任务。';
      const content = String(options.messages[0].content);
      const ids = [...content.matchAll(/\[(edge-\d+)\]/g)].map((m) => m[1]);
      return classificationsJson(ids.map((id) => ({ id, category: 'worldview' })));
    });

    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler());
    const result = await pipeline.run({ edges, entities: [], worldBrief: '' });

    expect(result.failedBatches).toBe(1);
    expect(result.classified.size).toBe(10); // second batch only
    expect(result.unclassified).toHaveLength(40);
    expect(result.unclassified).toContain('edge-0');
    expect(result.unclassified).not.toContain('edge-49');
  });

  it('reports every edge unclassified when all batches fail', async () => {
    const edges = Array.from({ length: 50 }, (_, i) => makeEdge(i));
    const { ai } = makeAI(async () => {
      throw new Error('HTTP 500');
    });

    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler());
    const result = await pipeline.run({ edges, entities: [], worldBrief: '' });

    expect(result.failedBatches).toBe(2);
    expect(result.totalBatches).toBe(2);
    expect(result.classified.size).toBe(0);
    expect(result.unclassified).toHaveLength(50);
  });

  it('normalizes echoed ids: [bracket]-wrapped and case drift still match', async () => {
    const edges = [makeEdge(0), makeEdge(1)];
    const { ai } = makeAI(async () =>
      JSON.stringify({
        edge_classifications: [
          { edge_id: ' [edge-0] ', category: 'worldview' },
          { edge_id: 'EDGE-1', category: 'plot-event' },
        ],
      }),
    );

    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler());
    const result = await pipeline.run({ edges, entities: [], worldBrief: '' });

    expect(result.classified.get('edge-0')).toBe('worldview');
    expect(result.classified.get('edge-1')).toBe('plot-event');
    expect(result.unclassified).toEqual([]);
  });

  it('ignores unknown ids and illegal categories; first answer wins for duplicates', async () => {
    const edges = [makeEdge(0), makeEdge(1)];
    const { ai } = makeAI(async () =>
      JSON.stringify({
        edge_classifications: [
          { edge_id: 'edge-0', category: 'worldview' },
          { edge_id: 'edge-0', category: 'plot-event' }, // duplicate — ignored
          { edge_id: 'edge-1', category: 'banana' },     // illegal — ignored
          { edge_id: 'ghost-edge', category: 'worldview' }, // unknown — ignored
          { edge_id: 42, category: 'worldview' },        // wrong type — ignored
        ],
      }),
    );

    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler());
    const result = await pipeline.run({ edges, entities: [], worldBrief: '' });

    expect(result.classified.get('edge-0')).toBe('worldview'); // first answer kept
    expect(result.classified.has('edge-1')).toBe(false);
    expect(result.unclassified).toEqual(['edge-1']);
  });

  it('rejects with AbortError when cancelled between batches', async () => {
    const edges = Array.from({ length: 50 }, (_, i) => makeEdge(i));
    const controller = new AbortController();
    const { ai, generate } = makeAI(async (options) => {
      const content = String(options.messages[0].content);
      const ids = [...content.matchAll(/\[(edge-\d+)\]/g)].map((m) => m[1]);
      controller.abort(); // cancel right after the first batch resolves
      return classificationsJson(ids.map((id) => ({ id, category: 'worldview' })));
    });

    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler());
    await expect(
      pipeline.run({ edges, entities: [], worldBrief: '' }, undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).toHaveBeenCalledTimes(1); // second batch never dispatched
  });

  it('SC-9: only whitelisted fields reach the AI — secrets in attributes/episodes never travel', async () => {
    const edges = [makeEdge(0)];
    const entities = [makeEntity('NPC0'), makeEntity('东城茶馆', { type: 'location' })];
    const captured: string[] = [];
    const { ai } = makeAI(async (options) => {
      captured.push(JSON.stringify(options.messages));
      return classificationsJson([{ id: 'edge-0', category: 'worldview' }]);
    });

    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler());
    await pipeline.run({ edges, entities, worldBrief: '世界简介文本' });

    const allMessages = captured.join('\n');
    expect(allMessages).not.toContain(ATTR_SECRET);    // entity.attributes excluded
    expect(allMessages).not.toContain(EPISODE_SECRET); // edge.episodes excluded
    // Positive controls — whitelisted content DOES travel:
    expect(allMessages).toContain('世界简介文本');
    expect(allMessages).toContain('NPC0 的生平简介');
    expect(allMessages).toContain('edge-0');
  });

  it('SC-9 (real secret formats): API keys / tokens placed in non-whitelisted fields never reach the AI', async () => {
    // Realistic secret shapes (not synthetic markers) injected into fields the prompt must exclude.
    const REAL_API_KEY = 'sk-proj-REALKEY1234567890';
    const REAL_GH_TOKEN = 'ghp_REALGITHUBTOKEN1234567890';
    const edges = [makeEdge(0, { episodes: [REAL_GH_TOKEN] })];
    const entities = [makeEntity('NPC0', { attributes: { secretKey: REAL_API_KEY } })];
    const captured: string[] = [];
    const { ai } = makeAI(async (options) => {
      captured.push(JSON.stringify(options.messages));
      return classificationsJson([{ id: 'edge-0', category: 'worldview' }]);
    });

    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler());
    await pipeline.run({ edges, entities, worldBrief: 'a clean world brief' });

    const all = captured.join('\n');
    expect(all).not.toContain(REAL_API_KEY);  // entity.attributes excluded
    expect(all).not.toContain(REAL_GH_TOKEN); // edge.episodes excluded
    expect(all).not.toMatch(/sk-proj-/);
    expect(all).not.toMatch(/ghp_/);
  });

  it('throws loudly (pre-flight) when the pack prompt is not registered — no AI call, no silent degrade', async () => {
    const edges = [makeEdge(0)];
    const { ai, generate } = makeAI(async () => classificationsJson([]));

    const pipeline = new CardEdgeClassifyPipeline(ai, makeAssembler('missing'));
    await expect(pipeline.run({ edges, entities: [], worldBrief: '' })).rejects.toThrow(/not registered/);
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns an empty result for zero edges without touching the AI or the prompt registry', async () => {
    const { ai, generate } = makeAI(async () => classificationsJson([]));
    const assembler = makeAssembler();

    const pipeline = new CardEdgeClassifyPipeline(ai, assembler);
    const result: CardEdgeClassifyResult = await pipeline.run({ edges: [], entities: [], worldBrief: '' });

    expect(result.classified.size).toBe(0);
    expect(result.unclassified).toEqual([]);
    expect(result.totalBatches).toBe(0);
    expect(generate).not.toHaveBeenCalled();
    expect((assembler.renderSingle as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
