/**
 * AssistantService.send 集成测试 —— Phase 4
 *
 * 覆盖：
 * - send 流程走通 user message → AI call → assistant message
 * - Mode A（无 attachment）→ assistantMessage 无 payloadDraft
 * - Mode B（含 target）→ payload 解析 + validator 校验 → payloadDraft 填充
 * - 流式 chunk 回调被触发
 * - AI 失败时抛 AssistantSendError + 插入 ai-error 系统消息
 * - usageType 强制 'assistant'
 * - history FIFO trim 真的生效
 */
import { describe, it, expect } from 'vitest';
import { AssistantService, AssistantSendError } from './assistant-service';
import { InMemoryConversationStore } from './conversation-store';
import type { CommandExecutor } from '../../core/command-executor';
import type { StateManager } from '../../core/state-manager';
import type { GamePack } from '../../types';
import type { AIService } from '../../ai/ai-service';

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
          'x-assistant-label': '社交关系',
          items: { type: 'object', properties: { 名称: { type: 'string' }, 类型: { type: 'string' } } },
        },
      },
    },
    系统: { properties: { nsfwMode: { type: 'boolean' } } },
  },
};

const PACK: GamePack = {
  prompts: {
    assistantJailbreak: 'JAILBREAK',
    assistantInjectionContract: 'CONTRACT',
  },
  stateSchema: SCHEMA,
} as unknown as GamePack;

interface AICall { messages: unknown; usageType?: string; stream?: boolean; }

function makeAIService(response: string, opts: { delay?: number; throw?: boolean; chunks?: string[] } = {}) {
  const calls: AICall[] = [];
  const aiService = {
    async generate(options: { messages: unknown; usageType?: string; stream?: boolean; onStreamChunk?: (chunk: string) => void }): Promise<string> {
      calls.push({ messages: options.messages, usageType: options.usageType, stream: options.stream });
      if (opts.throw) throw new Error('mock AI failure');
      if (options.onStreamChunk && opts.chunks) {
        for (const c of opts.chunks) options.onStreamChunk(c);
      }
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      return response;
    },
  } as unknown as AIService;
  return { aiService, calls };
}

function makeService(
  aiResponse: string,
  initialState: Record<string, unknown> | undefined = { 社交: { 关系: [] }, 系统: { nsfwMode: true } },
  aiOpts: Parameters<typeof makeAIService>[1] = {},
) {
  initialState = initialState ?? { 社交: { 关系: [] }, 系统: { nsfwMode: true } };
  const sm = new FakeStateManager(initialState);
  const exec = { executeBatch() { return { results: [], changeLog: { changes: [], source: 'command', timestamp: 0 }, hasErrors: false }; } } as unknown as CommandExecutor;
  const { aiService, calls } = makeAIService(aiResponse, aiOpts);
  const svc = new AssistantService({
    aiService,
    stateManager: sm as unknown as StateManager,
    commandExecutor: exec,
    gamePack: PACK,
    conversationStore: new InMemoryConversationStore(),
  });
  return { svc, sm, calls };
}

// ─── Mode A：纯聊天 ─────────────────────────────────────

describe('send — Mode A（无 attachment）', () => {
  it('返回 user + assistant message 且无 payloadDraft', async () => {
    const { svc } = makeService('好的，我帮你想几个名字：李白、苏墨、楚云');
    const result = await svc.send({ sessionId: 'default', prompt: '帮我想 NPC 名字', attachments: [] });
    expect(result.userMessage.role).toBe('user');
    expect(result.userMessage.content).toBe('帮我想 NPC 名字');
    expect(result.assistantMessage.role).toBe('assistant');
    expect(result.assistantMessage.content).toContain('李白');
    expect(result.assistantMessage.payloadDraft).toBeUndefined(); // Mode A 无 draft
  });

  it('双方都进 conversation', async () => {
    const { svc } = makeService('回复');
    await svc.send({ sessionId: 'default', prompt: '问', attachments: [] });
    const session = await svc.getSession('default');
    expect(session.messages).toHaveLength(2);
  });

  it('usageType 强制 "assistant"', async () => {
    const { svc, calls } = makeService('回复');
    await svc.send({ sessionId: 'default', prompt: 'X', attachments: [] });
    expect(calls[0].usageType).toBe('assistant');
    expect(calls[0].stream).toBe(true);
  });

  it('流式 chunks 触发 onStreamChunk', async () => {
    const chunks: string[] = [];
    const accumulated: string[] = [];
    const { svc } = makeService('完整', undefined, { chunks: ['第', '一', '段'] });
    await svc.send({
      sessionId: 'default', prompt: 'X', attachments: [],
      onStreamChunk: (c, acc) => { chunks.push(c); accumulated.push(acc); },
    });
    expect(chunks).toEqual(['第', '一', '段']);
    expect(accumulated[2]).toBe('第一段');
  });
});

// ─── Mode B：数据助手 ──────────────────────────────────

describe('send — Mode B（含 target attachment）', () => {
  const aiResponse = `根据你的描述：

\`\`\`json
{
  "summary": "新增 NPC「苏墨」",
  "patches": [
    { "target": "$.社交.关系", "op": "append-item", "value": { "名称": "苏墨", "类型": "朋友" } }
  ]
}
\`\`\``;

  it('payloadDraft 填充并 status=pending', async () => {
    const { svc } = makeService(aiResponse);
    const result = await svc.send({
      sessionId: 'default',
      prompt: '加 NPC',
      attachments: [{ path: '社交.关系', scope: 'target' }],
    });
    expect(result.assistantMessage.payloadDraft).toBeDefined();
    expect(result.assistantMessage.payloadDraft?.status).toBe('pending');
    expect(result.assistantMessage.payloadDraft?.raw.summary).toBe('新增 NPC「苏墨」');
    expect(result.assistantMessage.payloadDraft?.validated).toHaveLength(1);
    expect(result.assistantMessage.payloadDraft?.validated[0].status).toBe('ok');
  });

  it('系统 prompt 包含 jailbreak + contract', async () => {
    const { svc, calls } = makeService(aiResponse);
    await svc.send({
      sessionId: 'default', prompt: 'X',
      attachments: [{ path: '社交.关系', scope: 'target' }],
    });
    const messages = calls[0].messages as Array<{ role: string; content: string }>;
    const systemContents = messages.filter((m) => m.role === 'system').map((m) => m.content);
    expect(systemContents.some((c) => c.includes('JAILBREAK'))).toBe(true);
    expect(systemContents.some((c) => c.includes('CONTRACT'))).toBe(true);
  });

  it('Mode A → 不含 contract（仅 jailbreak）', async () => {
    const { svc, calls } = makeService('仅文本');
    await svc.send({ sessionId: 'default', prompt: 'X', attachments: [] });
    const messages = calls[0].messages as Array<{ role: string; content: string }>;
    const systemContents = messages.filter((m) => m.role === 'system').map((m) => m.content);
    expect(systemContents.some((c) => c.includes('CONTRACT'))).toBe(false);
  });

  it('AI 没输出 JSON 时 payloadDraft undefined', async () => {
    const { svc } = makeService('我没办法生成数据');
    const result = await svc.send({
      sessionId: 'default', prompt: 'X',
      attachments: [{ path: '社交.关系', scope: 'target' }],
    });
    expect(result.assistantMessage.payloadDraft).toBeUndefined();
  });

  it('AI 输出非法 op 的 patch → validator 标 error 但仍生成 draft', async () => {
    const badResponse = '\n```json\n{"summary":"x","patches":[{"target":"元数据.foo","op":"set-field","value":"y"}]}\n```';
    const { svc } = makeService(badResponse);
    const result = await svc.send({
      sessionId: 'default', prompt: 'X',
      attachments: [{ path: '社交.关系', scope: 'target' }],
    });
    const draft = result.assistantMessage.payloadDraft;
    expect(draft).toBeDefined();
    expect(draft?.validated[0].status).toBe('error');
    expect(draft?.validated[0].issues.some((m) => m.includes('黑名单'))).toBe(true);
  });
});

// ─── 失败路径 ───────────────────────────────────────────

describe('send — AI 失败', () => {
  it('throws AssistantSendError + 插入 ai-error system 消息', async () => {
    const { svc } = makeService('', undefined, { throw: true });
    await expect(
      svc.send({ sessionId: 'default', prompt: 'X', attachments: [] }),
    ).rejects.toThrow(AssistantSendError);

    const session = await svc.getSession('default');
    // user message + ai-error system message 都被持久化
    const lastSys = session.messages.find((m) => m.systemKind === 'ai-error');
    expect(lastSys).toBeDefined();
    expect(lastSys?.content).toContain('AI 调用失败');
  });
});

// ─── FIFO trim 集成 ────────────────────────────────────

describe('send — FIFO trim 联动', () => {
  it('maxHistoryTurns=2 时保留最后 2 个 turn', async () => {
    const { svc } = makeService('X');
    svc.updateSettings({ maxHistoryTurns: 2 });
    for (let i = 1; i <= 5; i++) {
      await svc.send({ sessionId: 'default', prompt: `Q${i}`, attachments: [] });
    }
    const session = await svc.getSession('default');
    const userPrompts = session.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userPrompts).toEqual(['Q4', 'Q5']);
  });
});
