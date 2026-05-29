import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectMissingEngramData,
  type BatchSolidifyPaths,
  EngramBatchSolidifyPipeline,
} from './batch-solidify-pipeline';

vi.mock('./engram-config', () => ({
  loadEngramConfig: () => ({ enabled: true }),
  ENGRAM_CONFIG_KEY: 'aga_engram_config',
}));
import type { EngramEntity } from './entity-builder';
import type { EngramEdge } from './knowledge-edge';
import type { StateManager } from '../../core/state-manager';
import type { AIService } from '../../ai/ai-service';
import type { EngramEditor } from './engram-editor';
import type { EngramManager } from './engram-manager';

// ─── Helpers ───

const PATHS: BatchSolidifyPaths = {
  relationships: '社交.关系',
  locations: '世界.地点信息',
  engramMemory: '系统.扩展.engramMemory',
  playerName: '角色.基础信息.姓名',
  roundNumber: '元数据.回合序号',
  npcNameField: '名称',
  npcTypeField: '类型',
  npcTypeExclude: '普通',
  npcAppearanceField: '外貌描述',
  npcDescriptionField: '描述',
  locationNameField: '名称',
  locationDescriptionField: '描述',
  narrativeHistory: '元数据.叙事历史',
};

function makeEntity(name: string, overrides?: Partial<EngramEntity>): EngramEntity {
  return {
    name,
    type: 'npc',
    summary: `${name} description`,
    attributes: {},
    firstSeen: 0,
    lastSeen: 0,
    mentionCount: 1,
    is_embedded: false,
    ...overrides,
  };
}

function makeEdge(src: string, tgt: string, fact: string, overrides?: Partial<EngramEdge>): EngramEdge {
  return {
    id: `${src.toLowerCase()}|${tgt.toLowerCase()}|${fact.toLowerCase().replace(/\s+/g, '').slice(0, 40)}`,
    sourceEntity: src,
    targetEntity: tgt,
    fact,
    episodes: [],
    is_embedded: false,
    createdAtRound: 0,
    lastSeenRound: 0,
    ...overrides,
  };
}

function makeNpc(name: string, type?: string): Record<string, unknown> {
  return { 名称: name, 类型: type ?? '重点', 位置: '某地', 外貌描述: '', 关系状态: '' };
}

function makeLocation(name: string): Record<string, unknown> {
  return { 名称: name, 描述: `${name} desc`, 连接: [] };
}

function makeLocationMap(...names: string[]): Record<string, Record<string, unknown>> {
  const map: Record<string, Record<string, unknown>> = {};
  for (const name of names) map[name] = makeLocation(name);
  return map;
}

function createMockStateManager(opts: {
  relationships?: Array<Record<string, unknown>>;
  locations?: Record<string, Record<string, unknown>>;
  entities?: EngramEntity[];
  edges?: EngramEdge[];
  playerName?: string;
}): StateManager {
  const store = new Map<string, unknown>();
  store.set(PATHS.relationships, opts.relationships ?? []);
  store.set(PATHS.locations, opts.locations ?? {});
  store.set(PATHS.playerName, opts.playerName ?? '玩家');
  store.set(PATHS.engramMemory, {
    events: [],
    entities: opts.entities ?? [],
    relations: [],
    v2Edges: opts.edges ?? [],
    meta: { lastUpdated: 0, eventCount: 0, embeddedEventCount: 0, embeddedEntityCount: 0, schemaVersion: 5 },
  });

  return {
    get: vi.fn((path: string) => {
      const val = store.get(path);
      return val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined;
    }),
    set: vi.fn((path: string, value: unknown) => {
      store.set(path, JSON.parse(JSON.stringify(value)));
    }),
    toSnapshot: vi.fn(() => {
      const snapshot: Record<string, unknown> = {};
      for (const [k, v] of store) snapshot[k] = JSON.parse(JSON.stringify(v));
      return snapshot;
    }),
  } as unknown as StateManager;
}

// ═══════════════════════════════════════════════
// detectMissingEngramData
// ═══════════════════════════════════════════════

describe('detectMissingEngramData', () => {
  it('detects missing NPC entities', () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三'), makeNpc('李四'), makeNpc('王五')],
      entities: [makeEntity('张三')],
    });

    const report = detectMissingEngramData(sm, PATHS);

    expect(report.missingNpcEntities).toEqual(['李四', '王五']);
    expect(report.hasMissing).toBe(true);
    expect(report.existingEntityCount).toBe(1);
  });

  it('detects NPCs with entity but no edges', () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三'), makeNpc('李四')],
      entities: [makeEntity('张三'), makeEntity('李四')],
      edges: [makeEdge('张三', '玩家', '张三是玩家的朋友，两人关系十分密切')],
    });

    const report = detectMissingEngramData(sm, PATHS);

    expect(report.missingNpcEntities).toEqual([]);
    expect(report.npcsWithoutEdges).toEqual(['李四']);
    expect(report.hasMissing).toBe(true);
  });

  it('skips 普通 type NPCs (consistent with EntityBuilder)', () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三', '重点'), makeNpc('路人甲', '普通'), makeNpc('路人乙', '普通')],
      entities: [makeEntity('张三')],
      edges: [makeEdge('张三', '玩家', '张三是玩家的朋友，两人相识多年建立了深厚友谊')],
    });

    const report = detectMissingEngramData(sm, PATHS);

    expect(report.missingNpcEntities).toEqual([]);
    expect(report.npcsWithoutEdges).toEqual([]);
    expect(report.hasMissing).toBe(false);
  });

  it('detects missing location entities', () => {
    const sm = createMockStateManager({
      locations: makeLocationMap('天剑门', '落日镇'),
      entities: [makeEntity('天剑门', { type: 'location' })],
    });

    const report = detectMissingEngramData(sm, PATHS);

    expect(report.missingLocationEntities).toEqual(['落日镇']);
    expect(report.hasMissing).toBe(true);
  });

  it('returns hasMissing=false when all covered', () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三')],
      locations: makeLocationMap('天剑门'),
      entities: [makeEntity('张三'), makeEntity('天剑门', { type: 'location' })],
      edges: [
        makeEdge('张三', '天剑门', '张三是天剑门的弟子，长期在门派修行'),
      ],
    });

    const report = detectMissingEngramData(sm, PATHS);

    expect(report.hasMissing).toBe(false);
    expect(report.missingNpcEntities).toEqual([]);
    expect(report.npcsWithoutEdges).toEqual([]);
    expect(report.missingLocationEntities).toEqual([]);
    expect(report.locationsWithoutEdges).toEqual([]);
  });

  it('treats stub entities (_pendingEnrichment) as missing', () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三')],
      entities: [makeEntity('张三', { _pendingEnrichment: true, summary: '' })],
    });

    const report = detectMissingEngramData(sm, PATHS);

    expect(report.missingNpcEntities).toEqual(['张三']);
    expect(report.existingEntityCount).toBe(0);
  });

  it('handles empty state tree gracefully', () => {
    const sm = createMockStateManager({});

    const report = detectMissingEngramData(sm, PATHS);

    expect(report.hasMissing).toBe(false);
    expect(report.existingEdgeCount).toBe(0);
    expect(report.existingEntityCount).toBe(0);
  });

  it('builds existing edge summary', () => {
    const sm = createMockStateManager({
      edges: [
        makeEdge('张三', '李四', '张三是李四的师兄，两人在天剑门共同修行'),
        makeEdge('张三', '天剑门', '张三是天剑门的弟子，长期在门派修行'),
      ],
    });

    const report = detectMissingEngramData(sm, PATHS);

    expect(report.existingEdgeSummary).toContain('张三 → 李四');
    expect(report.existingEdgeSummary).toContain('张三 → 天剑门');
    expect(report.existingEdgeCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════
// EngramBatchSolidifyPipeline
// ═══════════════════════════════════════════════

describe('EngramBatchSolidifyPipeline', () => {
  let mockAiService: AIService;
  let mockEngramEditor: EngramEditor;
  let mockEngramManager: EngramManager;

  beforeEach(() => {
    mockAiService = {
      generate: vi.fn(),
    } as unknown as AIService;

    mockEngramEditor = {
      bulkCreateEdges: vi.fn(async () => ({
        created: [],
        skipped: [],
      })),
      bulkCreateEntities: vi.fn(async () => ({
        created: [],
        skipped: [],
      })),
      updateEntity: vi.fn(async () => ({})),
    } as unknown as EngramEditor;

    mockEngramManager = {
      processResponse: vi.fn(async () => null),
      withWriteLock: vi.fn(async (fn: () => unknown) => fn()),
      vectorizePending: vi.fn(async () => ({ vectorized: 0 })),
    } as unknown as EngramManager;
  });

  it('returns alreadyComplete when nothing is missing', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三')],
      entities: [makeEntity('张三')],
      edges: [makeEdge('张三', '玩家', '张三是玩家的好友，两人相识多年建立了深厚友谊')],
    });

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const result = await pipeline.run();

    expect(result.alreadyComplete).toBe(true);
    expect(result.created).toBe(0);
    expect(mockAiService.generate).not.toHaveBeenCalled();
  });

  it('calls AI and injects edges when missing data found', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三'), makeNpc('李四')],
      entities: [],
      edges: [],
    });

    (mockAiService.generate as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        knowledge_facts: [
          { source_entity: '张三', target_entity: '李四', fact: '张三和李四是同门师兄弟，两人在天剑门共同修行多年' },
          { source_entity: '张三', target_entity: '玩家', fact: '张三对玩家态度友好，愿意在修行上给予指导帮助' },
        ],
      }),
    );

    (mockEngramEditor.bulkCreateEdges as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: [{}, {}],
      skipped: [],
    });

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const phases: string[] = [];
    const result = await pipeline.run((p) => phases.push(p));

    expect(result.created).toBe(2);
    expect(result.alreadyComplete).toBe(false);
    expect(phases).toEqual(['scanning', 'generating', 'applying', 'done']);

    // Verify bulkCreateEdges called with correct options
    expect(mockEngramEditor.bulkCreateEdges).toHaveBeenCalledWith(
      expect.any(Array),
      { defaultCore: false, defaultSource: 'batch-sync' },
    );

    // processResponse is NOT called — it would prune location↔location edges
    expect(mockEngramManager.processResponse).not.toHaveBeenCalled();
  });

  it('skips facts with unknown endpoints', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三')],
      entities: [],
      edges: [],
    });

    (mockAiService.generate as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        knowledge_facts: [
          { source_entity: '张三', target_entity: '玩家', fact: '张三对玩家非常友好，两人互相尊重彼此的修行' },
          { source_entity: '不存在的NPC', target_entity: '另一个不存在的NPC', fact: '两个不存在的实体之间的虚假关系事实' },
        ],
      }),
    );

    (mockEngramEditor.bulkCreateEdges as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: [{}],
      skipped: [],
    });

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const result = await pipeline.run();

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skippedDetails[0]).toEqual(
      expect.objectContaining({ reason: 'both_endpoints_unknown' }),
    );
  });

  // M-4 (2026-05-28): a single-endpoint edge — one real entity + one AI-hallucinated
  // name absent from the post-backfill world set — must be rejected at validation, so
  // bulkCreateEdges never auto-stubs a permanent vectorized phantom entity for it.
  it('skips single-endpoint edges (one real + one hallucinated) — no phantom reaches bulkCreateEdges', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三'), makeNpc('李四')],
      entities: [],
      edges: [],
    });

    (mockAiService.generate as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        knowledge_facts: [
          // valid: both endpoints are real state-tree NPCs
          { source_entity: '张三', target_entity: '李四', fact: '张三和李四是同门师兄弟，自幼一起在山门习武修行' },
          // single-endpoint hallucination: 张三 is real, 幻影宗 exists nowhere in the world data
          { source_entity: '张三', target_entity: '幻影宗', fact: '张三年少时曾被神秘的幻影宗收为记名弟子' },
        ],
      }),
    );

    // Echo back exactly the validated edges passed in, so we can inspect the filter.
    let receivedEdges: Array<{ sourceEntity: string; targetEntity: string }> = [];
    (mockEngramEditor.bulkCreateEdges as ReturnType<typeof vi.fn>).mockImplementation(
      async (edges: Array<{ sourceEntity: string; targetEntity: string }>) => {
        receivedEdges = edges;
        return { created: edges, skipped: [] };
      },
    );

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const result = await pipeline.run();

    // Only the both-endpoints-known edge survives validation → reaches bulkCreateEdges.
    expect(receivedEdges).toHaveLength(1);
    expect(receivedEdges[0]).toEqual(
      expect.objectContaining({ sourceEntity: '张三', targetEntity: '李四' }),
    );
    // The single-endpoint hallucination never reaches bulkCreateEdges → no auto-stub phantom.
    expect(receivedEdges.some((e) => e.targetEntity === '幻影宗')).toBe(false);
    expect(result.created).toBe(1);

    // Recorded as a validation skip with the precise single-endpoint reason.
    expect(result.skippedDetails).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'endpoint_unknown' })]),
    );
  });

  it('skips facts that are too short', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三')],
      entities: [],
      edges: [],
    });

    (mockAiService.generate as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        knowledge_facts: [
          { source_entity: '张三', target_entity: '玩家', fact: '短' },
          { source_entity: '张三', target_entity: '玩家', fact: '张三对玩家非常友好，两人互相尊重彼此的修行' },
        ],
      }),
    );

    (mockEngramEditor.bulkCreateEdges as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: [{}],
      skipped: [],
    });

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const result = await pipeline.run();

    expect(result.created).toBe(1);
    expect(result.skippedDetails.some(s => s.reason === 'fact_too_short')).toBe(true);
  });

  it('handles AI returning empty knowledge_facts', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三')],
      entities: [],
      edges: [],
    });

    (mockAiService.generate as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ knowledge_facts: [] }),
    );

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const result = await pipeline.run();

    expect(result.created).toBe(0);
    expect(result.alreadyComplete).toBe(false);
    expect(mockEngramEditor.bulkCreateEdges).not.toHaveBeenCalled();
  });

  it('handles AI network error gracefully', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三')],
      entities: [],
      edges: [],
    });

    (mockAiService.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network timeout'),
    );

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const phases: string[] = [];
    await expect(pipeline.run((p) => phases.push(p))).rejects.toThrow('Network timeout');
    expect(phases).toContain('error');
  });

  it('handles malformed AI JSON response', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三')],
      entities: [],
      edges: [],
    });

    (mockAiService.generate as ReturnType<typeof vi.fn>).mockResolvedValue(
      'This is not valid JSON at all',
    );

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const result = await pipeline.run();

    expect(result.created).toBe(0);
    expect(mockEngramEditor.bulkCreateEdges).not.toHaveBeenCalled();
  });

  it('coexists with source=opening edges', async () => {
    const sm = createMockStateManager({
      relationships: [makeNpc('张三'), makeNpc('李四')],
      entities: [makeEntity('张三')],
      edges: [
        makeEdge('张三', '玩家', '张三在开局时与玩家相识，建立了初步的友好关系', { source: 'opening' }),
      ],
    });

    (mockAiService.generate as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        knowledge_facts: [
          { source_entity: '李四', target_entity: '玩家', fact: '李四是玩家在天剑门认识的新朋友，性格豪爽' },
        ],
      }),
    );

    (mockEngramEditor.bulkCreateEdges as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: [{}],
      skipped: [],
    });

    const pipeline = new EngramBatchSolidifyPipeline({
      aiService: mockAiService,
      stateManager: sm,
      engramEditor: mockEngramEditor,
      engramManager: mockEngramManager,
      paths: PATHS,
    });

    const result = await pipeline.run();

    expect(result.created).toBe(1);
    // Opening edge should be in the task message (last user message) as "already existing"
    const aiCall = (mockAiService.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const lastMsg = aiCall.messages[aiCall.messages.length - 1];
    expect(lastMsg.content).toContain('张三 → 玩家');
  });
});
