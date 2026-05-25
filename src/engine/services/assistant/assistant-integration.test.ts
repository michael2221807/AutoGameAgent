/**
 * Story 3 Phase 6 — Integration tests
 *
 * Cross-cutting tests that verify the full worldBuilder flow:
 * - Inject NPC patches → state tree mutation → knowledge_facts → engramManager
 * - Batch 50+ patches → inject → rollback restores state
 * - compressWorldContext performance with large datasets
 * - WorldBuilderService → parseAssistantPayload → PayloadValidator → conversation integration
 */
import { describe, it, expect, vi } from 'vitest';
import { AssistantService } from './assistant-service';
import { InMemoryConversationStore } from './conversation-store';
import { PayloadValidator } from './payload-validator';
import { WorldBuilderService, compressWorldContext } from '../world-builder/world-builder-service';
import type { WorldBuilderPaths } from '../world-builder/world-builder-service';
import type { CommandExecutor } from '../../core/command-executor';
import type { StateManager } from '../../core/state-manager';
import type { GamePack } from '../../types';
import type { AIService } from '../../ai/ai-service';
import type { EngramManager } from '../../memory/engram/engram-manager';
import type { PayloadDraft, ValidatedPatch } from './types';

class MockStateManager {
  state: Record<string, unknown>;
  constructor(initial: Record<string, unknown> = {}) { this.state = JSON.parse(JSON.stringify(initial)); }
  get<T>(path: string): T | undefined {
    const segs = path.split('.').filter(Boolean);
    let cur: unknown = this.state;
    for (const s of segs) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[s];
      else return undefined;
    }
    return cur as T;
  }
  toSnapshot(): Record<string, unknown> { return JSON.parse(JSON.stringify(this.state)); }
  rollbackTo(snapshot: Record<string, unknown>): void {
    this.state = JSON.parse(JSON.stringify(snapshot));
  }
}

class MockCommandExecutor {
  callCount = 0;
  constructor(private sm: MockStateManager) {}
  executeBatch(commands: Array<{ action: string; key: string; value?: unknown }>) {
    this.callCount++;
    for (const cmd of commands) {
      const segs = cmd.key.split('.');
      let cur: Record<string, unknown> = this.sm.state;
      for (let i = 0; i < segs.length - 1; i++) {
        const s = segs[i];
        if (!cur[s] || typeof cur[s] !== 'object') cur[s] = {};
        cur = cur[s] as Record<string, unknown>;
      }
      const last = segs[segs.length - 1];
      if (cmd.action === 'set') cur[last] = cmd.value;
      else if (cmd.action === 'push') {
        if (!Array.isArray(cur[last])) cur[last] = [];
        (cur[last] as unknown[]).push(cmd.value);
      }
    }
    return {
      results: commands.map(c => ({ success: true, command: c })),
      changeLog: { changes: [], source: 'command', timestamp: 0 },
      hasErrors: false,
    };
  }
}

const SCHEMA = {
  properties: {
    社交: {
      properties: {
        关系: {
          type: 'array',
          'x-assistant-editable': true,
          items: { type: 'object', properties: { 名称: { type: 'string' }, 类型: { type: 'string' } } },
        },
      },
    },
    世界: {
      properties: {
        地点信息: {
          type: 'array',
          'x-assistant-editable': true,
          items: { type: 'object', properties: { 名称: { type: 'string' } } },
        },
        描述: { type: 'string' },
      },
    },
    背包: {
      'x-assistant-editable': true,
      properties: {
        物品: { type: 'object', additionalProperties: { type: 'object', properties: { 名称: { type: 'string' } } } },
      },
    },
    系统: { properties: { nsfwMode: { type: 'boolean' } } },
  },
};

const PACK: GamePack = {
  prompts: {
    assistantJailbreak: 'JAILBREAK',
    assistantInjectionContract: 'CONTRACT',
    assistantWorldBuilder: 'WORLD_BUILDER',
    worldBuilderBatchRegion: 'REGION {EXISTING_WORLD_CONTEXT} {USER_INSTRUCTION}',
    worldBuilderBatchNpcs: 'NPCS {NPC_COUNT} {EXISTING_WORLD_CONTEXT} {USER_INSTRUCTION}',
    worldBuilderFromDescription: 'DESC {EXISTING_WORLD_CONTEXT} {USER_INSTRUCTION}',
  },
  stateSchema: SCHEMA,
} as unknown as GamePack;

const TEST_PATHS: WorldBuilderPaths = {
  relationships: '社交.关系',
  locations: '世界.地点信息',
  worldDescription: '世界.描述',
  inventory: '背包.物品',
  npcSummaryFields: ['名称', '类型'],
  locationSummaryFields: ['名称', '类型'],
  itemNameField: '名称',
};

function okPatch(p: { target: string; op: string; value?: unknown }): ValidatedPatch {
  return { ...p, op: p.op as ValidatedPatch['op'], status: 'ok', issues: [] };
}

// ─── Cross-Story Integration: inject NPC + knowledge_facts ──

describe('Integration — inject NPC + knowledge_facts → engramManager', () => {
  it('inject appends NPC to state tree AND calls engramManager.processResponse', async () => {
    const sm = new MockStateManager({ 社交: { 关系: [] }, 系统: { nsfwMode: true } });
    const exec = new MockCommandExecutor(sm);
    const processResponseMock = vi.fn().mockResolvedValue({ entities: [], edges: [], events: [] });
    const mockEngramManager = {
      processResponse: processResponseMock,
      isEnabled: () => true,
    } as unknown as EngramManager;

    const store = new InMemoryConversationStore();
    const svc = new AssistantService({
      aiService: { async generate() { return ''; } } as unknown as AIService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: exec as unknown as CommandExecutor,
      gamePack: PACK,
      conversationStore: store,
      engramManager: mockEngramManager,
      settings: { maxHistoryTurns: 5, confirmBeforeInject: true, confirmBeforeClear: true, worldBuilderMode: true },
    });

    const draft: PayloadDraft = {
      raw: {
        summary: 'Created market district NPCs',
        patches: [
          { target: '$.社交.关系', op: 'append-item', value: { 名称: '张铁匠', 类型: '商人', 好感度: 55 } },
          { target: '$.社交.关系', op: 'append-item', value: { 名称: '李掌柜', 类型: '商人', 好感度: 60 } },
        ],
        knowledgeFacts: [
          { sourceEntity: '张铁匠', targetEntity: '李掌柜', fact: '张铁匠和李掌柜是老邻居，互相照应生意', confidence: 1.0 },
        ],
      },
      validated: [
        okPatch({ target: '$.社交.关系', op: 'append-item', value: { 名称: '张铁匠', 类型: '商人', 好感度: 55 } }),
        okPatch({ target: '$.社交.关系', op: 'append-item', value: { 名称: '李掌柜', 类型: '商人', 好感度: 60 } }),
      ],
      status: 'pending',
    };

    const result = await svc.applyPayload('default', 'msg-1', draft);

    expect(result.ok).toBe(true);
    expect(result.patchCount).toBe(2);

    // State tree updated
    const npcs = sm.get<Array<Record<string, unknown>>>('社交.关系') ?? [];
    expect(npcs).toHaveLength(2);
    expect(npcs[0]['名称']).toBe('张铁匠');
    expect(npcs[1]['名称']).toBe('李掌柜');

    // EngramManager called with knowledge_facts
    expect(processResponseMock).toHaveBeenCalledTimes(1);
    const engramCall = processResponseMock.mock.calls[0];
    expect(engramCall[0].knowledgeFacts).toEqual([
      { fact: '张铁匠和李掌柜是老邻居，互相照应生意', sourceEntity: '张铁匠', targetEntity: '李掌柜' },
    ]);
    expect(engramCall[2]).toEqual({ defaultEdgeCore: true, defaultEdgeSource: 'ai', includeAllNpcTypes: true });
    expect(draft.knowledgeFactsProcessed).toBe(true);
    expect(draft.status).toBe('injected');
  });
});

// ─── Batch 50+ patches: inject then rollback ──────────────

describe('Integration — batch 50+ patches rollback', () => {
  it('inject 50 NPC patches then rollback restores empty array', async () => {
    const sm = new MockStateManager({ 社交: { 关系: [] }, 系统: { nsfwMode: true } });
    const exec = new MockCommandExecutor(sm);
    const store = new InMemoryConversationStore();

    const svc = new AssistantService({
      aiService: { async generate() { return ''; } } as unknown as AIService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: exec as unknown as CommandExecutor,
      gamePack: PACK,
      conversationStore: store,
    });

    const patchCount = 50;
    const patches = Array.from({ length: patchCount }, (_, i) => ({
      target: '$.社交.关系',
      op: 'append-item' as const,
      value: { 名称: `NPC_${i}`, 类型: '路人', 好感度: 50 },
    }));

    const draft: PayloadDraft = {
      raw: { summary: `批量注入 ${patchCount} 个 NPC`, patches },
      validated: patches.map(p => okPatch(p)),
      status: 'pending',
    };

    // Inject
    const injectResult = await svc.applyPayload('default', 'msg-batch', draft);
    expect(injectResult.ok).toBe(true);
    expect(injectResult.patchCount).toBe(patchCount);

    // Verify state has 50 NPCs
    const npcsAfterInject = sm.get<unknown[]>('社交.关系') ?? [];
    expect(npcsAfterInject).toHaveLength(patchCount);
    expect((npcsAfterInject[0] as Record<string, unknown>)['名称']).toBe('NPC_0');
    expect((npcsAfterInject[49] as Record<string, unknown>)['名称']).toBe('NPC_49');

    // Rollback
    const rollbackResult = await svc.rollbackLastInject('default');
    expect(rollbackResult.ok).toBe(true);

    // State restored to empty
    const npcsAfterRollback = sm.get<unknown[]>('社交.关系') ?? [];
    expect(npcsAfterRollback).toHaveLength(0);
  });

  it('inject 50 patches with knowledge_facts: engram + state both processed', async () => {
    const sm = new MockStateManager({ 社交: { 关系: [] }, 系统: { nsfwMode: true } });
    const exec = new MockCommandExecutor(sm);
    const processResponseMock = vi.fn().mockResolvedValue(null);
    const store = new InMemoryConversationStore();

    const svc = new AssistantService({
      aiService: { async generate() { return ''; } } as unknown as AIService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: exec as unknown as CommandExecutor,
      gamePack: PACK,
      conversationStore: store,
      engramManager: { processResponse: processResponseMock, isEnabled: () => true } as unknown as EngramManager,
    });

    const patchCount = 50;
    const patches = Array.from({ length: patchCount }, (_, i) => ({
      target: '$.社交.关系',
      op: 'append-item' as const,
      value: { 名称: `NPC_${i}`, 类型: '路人' },
    }));
    const facts = Array.from({ length: 20 }, (_, i) => ({
      sourceEntity: `NPC_${i}`,
      targetEntity: `NPC_${i + 1}`,
      fact: `NPC_${i} knows NPC_${i + 1}`,
      confidence: 1.0,
    }));

    const draft: PayloadDraft = {
      raw: { summary: 'batch with facts', patches, knowledgeFacts: facts },
      validated: patches.map(p => okPatch(p)),
      status: 'pending',
    };

    const result = await svc.applyPayload('default', 'msg-facts', draft);
    expect(result.ok).toBe(true);
    expect(processResponseMock).toHaveBeenCalledTimes(1);
    expect(processResponseMock.mock.calls[0][0].knowledgeFacts).toHaveLength(20);
  });
});

// ─── Context compression performance ──────────────────────

describe('Integration — compressWorldContext performance', () => {
  it('compresses 50 NPCs + 20 locations in < 50ms', () => {
    const npcs = Array.from({ length: 50 }, (_, i) => ({
      名称: `NPC_${i}_${'A'.repeat(20)}`,
      类型: `type_${i}`,
      位置: `地点_${i % 20}`,
      核心性格特征: `trait_${i}_${'B'.repeat(30)}`,
      是否主要角色: i < 3,
      好感度: 50 + i,
      描述: 'X'.repeat(200),
      记忆: Array.from({ length: 5 }, (_, j) => `memory_${j}`),
      私聊历史: Array.from({ length: 3 }, (_, j) => ({ role: 'user', content: `chat_${j}` })),
    }));
    const locations = Array.from({ length: 20 }, (_, i) => ({
      名称: `地点_${i}`,
      类型: `区域`,
      上级: i > 0 ? `地点_${i - 1}` : null,
      连接: [`地点_${(i + 1) % 20}`],
      描述: 'Y'.repeat(200),
    }));
    const items: Record<string, { 名称: string }> = {};
    for (let i = 0; i < 10; i++) items[`item_${i}`] = { 名称: `物品_${i}` };

    const sm = new MockStateManager({
      社交: { 关系: npcs },
      世界: { 地点信息: locations, 描述: 'Z'.repeat(500) },
      背包: { 物品: items },
    });

    const start = performance.now();
    const result = compressWorldContext(sm as unknown as StateManager, TEST_PATHS);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);

    const parsed = JSON.parse(result);
    expect(parsed.existingNPCs).toHaveLength(50);
    expect(parsed.existingLocations).toHaveLength(20);
    expect(parsed.existingItems).toHaveLength(10);

    // Verify compression: memory/private chat history/descriptions NOT in output
    const npcStr = JSON.stringify(parsed.existingNPCs);
    expect(npcStr).not.toContain('memory_');
    expect(npcStr).not.toContain('chat_');
    expect(npcStr).not.toContain('XXXX');

    // Only summary fields kept
    expect(Object.keys(parsed.existingNPCs[0])).toEqual(['名称', '类型']);

    // Token estimate: output should be < 10KB (reasonable for AI context)
    expect(result.length).toBeLessThan(10000);
  });
});

// ─── WorldBuilderService full flow ────────────────────────

describe('Integration — WorldBuilderService execute → conversation', () => {
  it('region task: AI response → parsed → validated → draft in conversation', async () => {
    const sm = new MockStateManager({
      社交: { 关系: [{ 名称: '老王', 类型: '友人' }] },
      世界: { 地点信息: [{ 名称: '城中', 类型: '城镇' }], 描述: '一座古城' },
      背包: { 物品: {} },
    });
    const store = new InMemoryConversationStore();
    const validator = new PayloadValidator({ stateManager: sm as unknown as StateManager, gamePack: PACK });

    const aiResponse = JSON.stringify({
      summary: '创建了北门市集',
      patches: [
        { target: '$.世界.地点信息', op: 'append-item', value: { 名称: '北门市集', 类型: '市场' } },
        { target: '$.社交.关系', op: 'append-item', value: { 名称: '赵掌柜', 类型: '商人', 好感度: 50 } },
      ],
      knowledge_facts: [
        { sourceEntity: '赵掌柜', targetEntity: '北门市集', fact: '赵掌柜是北门市集的老板', confidence: 1.0 },
      ],
    });

    const aiService = { async generate() { return aiResponse; } } as unknown as AIService;

    const wbService = new WorldBuilderService({
      aiService,
      stateManager: sm as unknown as StateManager,
      gamePack: PACK,
      payloadValidator: validator,
      conversationStore: store,
    });

    const result = await wbService.execute('default', {
      type: 'region',
      userInstruction: '在城北创建一个市集区域',
    }, TEST_PATHS);

    // Result has payloadDraft with correct patches
    expect(result.assistantMessage.payloadDraft).toBeDefined();
    expect(result.assistantMessage.payloadDraft!.raw.patches).toHaveLength(2);
    expect(result.assistantMessage.payloadDraft!.status).toBe('pending');

    // Knowledge facts extracted
    expect(result.knowledgeFacts).toHaveLength(1);
    expect(result.knowledgeFacts![0].fact).toBe('赵掌柜是北门市集的老板');

    // Conversation has both user + assistant messages
    const session = await store.load('default');
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].content).toContain('[World Builder]');
    expect(session.messages[1].payloadDraft).toBeDefined();

    // User message records the instruction
    expect(session.messages[0].content).toContain('在城北创建一个市集区域');
  });
});
