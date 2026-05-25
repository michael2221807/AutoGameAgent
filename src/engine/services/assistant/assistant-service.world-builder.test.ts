/**
 * Story 3 Phase 2 — worldBuilderMode tests
 *
 * Coverage:
 * - worldBuilderMode ON → assistantWorldBuilder prompt injected
 * - worldBuilderMode OFF → no assistantWorldBuilder prompt (regression M6)
 * - knowledge_facts extraction from AI response
 * - knowledge_facts → engramManager.processResponse on inject
 * - suggestWorldBuilderAttachments returns correct paths
 */
import { describe, it, expect, vi } from 'vitest';
import { AssistantService } from './assistant-service';
import { AttachmentBuilder } from './attachment-builder';
import { parseAssistantPayload } from './payload-parser';
import type { PayloadDraft } from './types';
import type { CommandExecutor } from '../../core/command-executor';
import type { StateManager } from '../../core/state-manager';
import type { GamePack } from '../../types';
import type { AIService } from '../../ai/ai-service';
import type { EngramManager } from '../../memory/engram/engram-manager';

class FakeStateManager {
  state: Record<string, unknown>;
  constructor(s: Record<string, unknown>) { this.state = JSON.parse(JSON.stringify(s)); }
  get<T>(p: string): T | undefined {
    const segs = p.split('.').filter(Boolean);
    let cur: unknown = this.state;
    for (const s of segs) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[s];
      else return undefined;
    }
    return cur as T;
  }
  toSnapshot() { return JSON.parse(JSON.stringify(this.state)); }
  rollbackTo(s: Record<string, unknown>) { this.state = JSON.parse(JSON.stringify(s)); }
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
    系统: { properties: { nsfwMode: { type: 'boolean' } } },
  },
};

const PACK_WITH_WORLD_BUILDER: GamePack = {
  prompts: {
    assistantJailbreak: 'JAILBREAK',
    assistantInjectionContract: 'CONTRACT',
    assistantWorldBuilder: 'WORLD_BUILDER_PROMPT',
  },
  stateSchema: SCHEMA,
} as unknown as GamePack;

const PACK_WITHOUT_WORLD_BUILDER: GamePack = {
  prompts: {
    assistantJailbreak: 'JAILBREAK',
    assistantInjectionContract: 'CONTRACT',
  },
  stateSchema: SCHEMA,
} as unknown as GamePack;

interface AICall { messages: Array<{ role: string; content: string }>; usageType?: string; stream?: boolean; }

function makeAIService(response: string) {
  const calls: AICall[] = [];
  const aiService = {
    async generate(options: { messages: unknown; usageType?: string; stream?: boolean; onStreamChunk?: (chunk: string) => void }): Promise<string> {
      calls.push({ messages: options.messages as AICall['messages'], usageType: options.usageType, stream: options.stream });
      return response;
    },
  } as unknown as AIService;
  return { aiService, calls };
}

function makeExec() {
  return { executeBatch() { return { results: [], changeLog: { changes: [], source: 'command', timestamp: 0 }, hasErrors: false }; } } as unknown as CommandExecutor;
}

// ─── worldBuilderMode prompt injection ─────────────────────

describe('worldBuilderMode — prompt injection', () => {
  it('worldBuilderMode=true → injects assistantWorldBuilder prompt between jailbreak and contract', async () => {
    const sm = new FakeStateManager({ 社交: { 关系: [{ 名称: '张三', 类型: '友人' }] }, 系统: { nsfwMode: true } });
    const { aiService, calls } = makeAIService('Hello');
    const svc = new AssistantService({
      aiService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: makeExec(),
      gamePack: PACK_WITH_WORLD_BUILDER,
      settings: { maxHistoryTurns: 5, confirmBeforeInject: true, confirmBeforeClear: true, worldBuilderMode: true },
    });

    await svc.send({ sessionId: 'default', prompt: 'test', attachments: [{ path: '社交.关系', scope: 'target' }] });

    const messages = calls[0].messages;
    const systemContents = messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: string }) => m.content);
    expect(systemContents[0]).toBe('JAILBREAK');
    expect(systemContents[1]).toBe('WORLD_BUILDER_PROMPT');
    expect(systemContents[2]).toBe('CONTRACT');
  });

  it('worldBuilderMode=false → no assistantWorldBuilder prompt (M6 regression)', async () => {
    const sm = new FakeStateManager({ 社交: { 关系: [{ 名称: '张三', 类型: '友人' }] }, 系统: { nsfwMode: true } });
    const { aiService, calls } = makeAIService('Hello');
    const svc = new AssistantService({
      aiService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: makeExec(),
      gamePack: PACK_WITH_WORLD_BUILDER,
      settings: { maxHistoryTurns: 5, confirmBeforeInject: true, confirmBeforeClear: true, worldBuilderMode: false },
    });

    await svc.send({ sessionId: 'default', prompt: 'test', attachments: [{ path: '社交.关系', scope: 'target' }] });

    const messages = calls[0].messages;
    const systemContents = messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: string }) => m.content);
    expect(systemContents).not.toContain('WORLD_BUILDER_PROMPT');
    expect(systemContents[0]).toBe('JAILBREAK');
    expect(systemContents[1]).toBe('CONTRACT');
  });

  it('worldBuilderMode=true but prompt file missing → gracefully skips', async () => {
    const sm = new FakeStateManager({ 社交: { 关系: [] }, 系统: { nsfwMode: true } });
    const { aiService, calls } = makeAIService('Hello');
    const svc = new AssistantService({
      aiService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: makeExec(),
      gamePack: PACK_WITHOUT_WORLD_BUILDER,
      settings: { maxHistoryTurns: 5, confirmBeforeInject: true, confirmBeforeClear: true, worldBuilderMode: true },
    });

    await svc.send({ sessionId: 'default', prompt: 'test', attachments: [] });

    const messages = calls[0].messages;
    const systemContents = messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: string }) => m.content);
    expect(systemContents).toEqual(['JAILBREAK']);
  });
});

// ─── knowledge_facts extraction ────────────────────────────

describe('parseAssistantPayload — knowledge_facts', () => {
  it('extracts knowledge_facts when present', () => {
    const aiOutput = `Here's the data:
\`\`\`json
{
  "summary": "Created NPCs",
  "patches": [{"target": "$.社交.关系", "op": "append-item", "value": {"名称": "李四"}}],
  "knowledge_facts": [
    {"sourceEntity": "张三", "targetEntity": "李四", "fact": "张三是李四的师兄", "confidence": 1.0}
  ]
}
\`\`\``;
    const result = parseAssistantPayload(aiOutput);
    expect(result).not.toBeNull();
    expect(result!.knowledgeFacts).toHaveLength(1);
    expect(result!.knowledgeFacts![0]).toEqual({
      sourceEntity: '张三',
      targetEntity: '李四',
      fact: '张三是李四的师兄',
      confidence: 1.0,
    });
  });

  it('returns no knowledgeFacts when field absent', () => {
    const aiOutput = `\`\`\`json
{"summary": "OK", "patches": [{"target": "$.社交.关系", "op": "append-item", "value": {"名称": "王五"}}]}
\`\`\``;
    const result = parseAssistantPayload(aiOutput);
    expect(result).not.toBeNull();
    expect(result!.knowledgeFacts).toBeUndefined();
  });

  it('skips malformed knowledge_facts entries', () => {
    const aiOutput = `\`\`\`json
{
  "summary": "test",
  "patches": [{"target": "$.社交.关系", "op": "append-item", "value": {"名称": "A"}}],
  "knowledge_facts": [
    {"sourceEntity": "A", "targetEntity": "B", "fact": "good", "confidence": 1.0},
    {"sourceEntity": "", "targetEntity": "B", "fact": "bad empty source"},
    {"noFields": true},
    {"sourceEntity": "A", "targetEntity": "B", "fact": "also good"}
  ]
}
\`\`\``;
    const result = parseAssistantPayload(aiOutput);
    expect(result!.knowledgeFacts).toHaveLength(2);
    expect(result!.knowledgeFacts![0].fact).toBe('good');
    expect(result!.knowledgeFacts![1].fact).toBe('also good');
  });

  it('defaults confidence to 1.0 when missing', () => {
    const aiOutput = `\`\`\`json
{
  "summary": "x",
  "patches": [{"target": "$.社交.关系", "op": "append-item", "value": {"名称": "A"}}],
  "knowledge_facts": [
    {"sourceEntity": "A", "targetEntity": "B", "fact": "relation"}
  ]
}
\`\`\``;
    const result = parseAssistantPayload(aiOutput);
    expect(result!.knowledgeFacts![0].confidence).toBe(1.0);
  });
});

// ─── knowledge_facts → engramManager ───────────────────────

describe('applyPayload — knowledge_facts processing', () => {
  it('calls engramManager.processResponse with synthetic response after successful inject', async () => {
    const sm = new FakeStateManager({ 社交: { 关系: [{ 名称: 'X', 类型: 'npc' }] }, 系统: { nsfwMode: true } });
    const processResponseMock = vi.fn().mockResolvedValue({ entities: [], edges: [], events: [] });
    const mockEngramManager = {
      processResponse: processResponseMock,
      isEnabled: () => true,
    } as unknown as EngramManager;

    const { aiService } = makeAIService('');
    const svc = new AssistantService({
      aiService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: makeExec(),
      gamePack: PACK_WITH_WORLD_BUILDER,
      engramManager: mockEngramManager,
      settings: { maxHistoryTurns: 5, confirmBeforeInject: true, confirmBeforeClear: true, worldBuilderMode: true },
    });

    const draft: PayloadDraft = {
      raw: {
        summary: 'test',
        patches: [{ target: '$.社交.关系', op: 'append-item' as const, value: { 名称: 'Y', 类型: 'npc' } }],
        knowledgeFacts: [
          { sourceEntity: 'X', targetEntity: 'Y', fact: 'X mentors Y', confidence: 1.0 },
        ],
      },
      validated: [{ target: '$.社交.关系', op: 'append-item' as const, value: { 名称: 'Y', 类型: 'npc' }, status: 'ok' as const, issues: [] }],
      status: 'pending' as const,
    };

    const result = await svc.applyPayload('default', 'msg1', draft);
    expect(result.ok).toBe(true);
    expect(processResponseMock).toHaveBeenCalledTimes(1);
    const call = processResponseMock.mock.calls[0];
    expect(call[0].knowledgeFacts).toEqual([{ fact: 'X mentors Y', sourceEntity: 'X', targetEntity: 'Y' }]);
    expect(call[2]).toEqual({ defaultEdgeCore: true, defaultEdgeSource: 'ai', includeAllNpcTypes: true });
    expect(draft.knowledgeFactsProcessed).toBe(true);
  });

  it('skips engramManager when no knowledgeFacts present', async () => {
    const sm = new FakeStateManager({ 社交: { 关系: [] }, 系统: { nsfwMode: true } });
    const processResponseMock = vi.fn().mockResolvedValue(null);
    const mockEngramManager = { processResponse: processResponseMock, isEnabled: () => true } as unknown as EngramManager;

    const { aiService } = makeAIService('');
    const svc = new AssistantService({
      aiService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: makeExec(),
      gamePack: PACK_WITH_WORLD_BUILDER,
      engramManager: mockEngramManager,
    });

    const draft = {
      raw: { summary: 'test', patches: [{ target: '$.社交.关系', op: 'append-item' as const, value: { 名称: 'A' } }] },
      validated: [{ target: '$.社交.关系', op: 'append-item' as const, value: { 名称: 'A' }, status: 'ok' as const, issues: [] }],
      status: 'pending' as const,
    };

    await svc.applyPayload('default', 'msg2', draft);
    expect(processResponseMock).not.toHaveBeenCalled();
  });

  it('engramManager.processResponse throws → inject still succeeds, knowledgeFactsProcessed stays undefined', async () => {
    const sm = new FakeStateManager({ 社交: { 关系: [] }, 系统: { nsfwMode: true } });
    const processResponseMock = vi.fn().mockRejectedValue(new Error('engram failure'));
    const mockEngramManager = {
      processResponse: processResponseMock,
      isEnabled: () => true,
    } as unknown as EngramManager;

    const { aiService } = makeAIService('');
    const svc = new AssistantService({
      aiService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: makeExec(),
      gamePack: PACK_WITH_WORLD_BUILDER,
      engramManager: mockEngramManager,
    });

    const draft: PayloadDraft = {
      raw: {
        summary: 'test',
        patches: [{ target: '$.社交.关系', op: 'append-item' as const, value: { 名称: 'Z' } }],
        knowledgeFacts: [{ sourceEntity: 'A', targetEntity: 'B', fact: 'test', confidence: 1.0 }],
      },
      validated: [{ target: '$.社交.关系', op: 'append-item' as const, value: { 名称: 'Z' }, status: 'ok' as const, issues: [] }],
      status: 'pending' as const,
    };

    const result = await svc.applyPayload('default', 'msg-err', draft);
    expect(result.ok).toBe(true);
    expect(processResponseMock).toHaveBeenCalledTimes(1);
    expect(draft.knowledgeFactsProcessed).toBeUndefined();
  });

  it('skips engramManager when engramManager not provided', async () => {
    const sm = new FakeStateManager({ 社交: { 关系: [] }, 系统: { nsfwMode: true } });
    const { aiService } = makeAIService('');
    const svc = new AssistantService({
      aiService,
      stateManager: sm as unknown as StateManager,
      commandExecutor: makeExec(),
      gamePack: PACK_WITH_WORLD_BUILDER,
    });

    const draft = {
      raw: {
        summary: 'test',
        patches: [{ target: '$.社交.关系', op: 'append-item' as const, value: { 名称: 'B' } }],
        knowledgeFacts: [{ sourceEntity: 'A', targetEntity: 'B', fact: 'test', confidence: 1.0 }],
      },
      validated: [{ target: '$.社交.关系', op: 'append-item' as const, value: { 名称: 'B' }, status: 'ok' as const, issues: [] }],
      status: 'pending' as const,
    };

    // Should not throw even with knowledgeFacts but no engramManager
    const result = await svc.applyPayload('default', 'msg3', draft);
    expect(result.ok).toBe(true);
  });
});

// ─── suggestWorldBuilderAttachments ────────────────────────

describe('AttachmentBuilder — suggestWorldBuilderAttachments', () => {
  it('returns the 3 recommended context paths from engine paths config', () => {
    const sm = new FakeStateManager({ 社交: { 关系: [] }, 世界: { 地点信息: [], 描述: '' } });
    const builder = new AttachmentBuilder({
      stateManager: sm as unknown as StateManager,
      gamePack: PACK_WITH_WORLD_BUILDER,
    });

    const paths = { relationships: '社交.关系', locations: '世界.地点信息', worldDescription: '世界.描述' };
    const suggestions = builder.suggestWorldBuilderAttachments(paths);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]).toEqual({ path: '社交.关系', scope: 'context' });
    expect(suggestions[1]).toEqual({ path: '世界.地点信息', scope: 'context' });
    expect(suggestions[2]).toEqual({ path: '世界.描述', scope: 'context' });
  });
});
