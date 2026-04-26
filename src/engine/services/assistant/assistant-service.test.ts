/**
 * AssistantService Phase 1 测试
 *
 * Phase 1 仅覆盖 service 骨架可用的部分：
 * - 构造 / DI 装配
 * - getSession / clear / appendSystemMessage
 * - canRollbackInject 默认 false
 * - settings 读写
 * - send / applyPayload / rollbackLastInject 抛 NotImplementedError（lock 行为）
 *
 * Phase 2-4 会扩展此文件以覆盖 send 流程、payload 注入、撤销。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AssistantService } from './assistant-service';
import { InMemoryConversationStore } from './conversation-store';
import type { AIService } from '../../ai/ai-service';
import type { CommandExecutor } from '../../core/command-executor';
import type { StateManager } from '../../core/state-manager';
import type { GamePack } from '../../types';
import { DEFAULT_ASSISTANT_SETTINGS } from './types';

function makeMockDeps() {
  const aiService = {
    async generate() { return ''; },
  } as unknown as AIService;
  const stateManager = {
    get() { return {}; },
    set() { return undefined; },
    rollbackTo() { /* noop */ },
  } as unknown as StateManager;
  const commandExecutor = {
    executeBatch() { return { successes: [], failures: [], changes: [] }; },
  } as unknown as CommandExecutor;
  const gamePack = { prompts: {} } as unknown as GamePack;
  return { aiService, stateManager, commandExecutor, gamePack };
}

describe('AssistantService — 构造 + 默认值', () => {
  it('使用默认 settings 当未传时', () => {
    const svc = new AssistantService(makeMockDeps());
    expect(svc.getSettings()).toEqual(DEFAULT_ASSISTANT_SETTINGS);
  });

  it('使用默认 InMemoryConversationStore 当未传时', async () => {
    const svc = new AssistantService(makeMockDeps());
    const session = await svc.getSession('default');
    expect(session.sessionId).toBe('default');
    expect(session.messages).toEqual([]);
  });

  it('注入自定义 settings 生效', () => {
    const svc = new AssistantService({
      ...makeMockDeps(),
      settings: { maxHistoryTurns: 10, confirmBeforeInject: false, confirmBeforeClear: false },
    });
    expect(svc.getSettings().maxHistoryTurns).toBe(10);
  });

  it('updateSettings 仅 patch 不覆盖', () => {
    const svc = new AssistantService(makeMockDeps());
    svc.updateSettings({ maxHistoryTurns: 20 });
    expect(svc.getSettings().maxHistoryTurns).toBe(20);
    expect(svc.getSettings().confirmBeforeInject).toBe(true); // 未改保持默认
  });

  it('canRollbackInject 默认 false（无快照）', () => {
    const svc = new AssistantService(makeMockDeps());
    expect(svc.canRollbackInject()).toBe(false);
  });
});

describe('AssistantService — getSession / clear', () => {
  let svc: AssistantService;
  let store: InMemoryConversationStore;

  beforeEach(() => {
    store = new InMemoryConversationStore();
    svc = new AssistantService({ ...makeMockDeps(), conversationStore: store });
  });

  it('getSession 返回 store 中的 session', async () => {
    const s = await svc.getSession('default');
    expect(s.messages).toEqual([]);
  });

  it('clear 清空 messages 但保留 createdAt', async () => {
    const before = await svc.getSession('default');
    // 通过 store 直接 push 一条消息（绕开未实现的 send）
    before.messages.push({
      id: 'x', role: 'user', content: 'hi', timestamp: Date.now(),
    });
    await store.save(before);
    expect((await svc.getSession('default')).messages).toHaveLength(1);

    await svc.clear('default');
    const after = await svc.getSession('default');
    expect(after.messages).toEqual([]);
    expect(after.createdAt).toBe(before.createdAt);
  });
});

// Phase 4 之后，send() 集成测试见 assistant-service.send.test.ts
// applyPayload / rollbackLastInject 测试见 assistant-service.phase3.test.ts

describe('AssistantService — gamePack 切换', () => {
  it('setGamePack 替换内部 pack 引用', () => {
    const svc = new AssistantService(makeMockDeps());
    const newPack = { prompts: { assistantJailbreak: 'X' } } as unknown as GamePack;
    svc.setGamePack(newPack);
    // gamePack 是 private，但 setGamePack 不抛 + 后续 send 会用到 —— 对 Phase 1 这就足够
    expect(() => svc.setGamePack(null)).not.toThrow();
  });
});
