/**
 * ConversationStore + FIFO trim 单元测试
 *
 * 核心覆盖：
 * - load() 自动 create empty session
 * - save / clear 行为
 * - appendMessageWithFifoTrim：按 turn 数（不是消息数）裁剪
 * - system 消息不计入 turn 上限
 * - 边界：maxTurns ≤ 0 时不裁剪
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryConversationStore,
  appendMessageWithFifoTrim,
  trimToFifoLimit,
} from './conversation-store';
import type { AssistantMessage, AssistantSession } from './types';
import { generateAssistantMessageId } from './types';

function makeMsg(role: AssistantMessage['role'], content = ''): AssistantMessage {
  return {
    id: generateAssistantMessageId(),
    role,
    content,
    timestamp: Date.now(),
  };
}

describe('InMemoryConversationStore', () => {
  let store: InMemoryConversationStore;
  beforeEach(() => {
    store = new InMemoryConversationStore();
  });

  it('load() creates empty session if not exists', async () => {
    const s = await store.load('default');
    expect(s.sessionId).toBe('default');
    expect(s.messages).toEqual([]);
    expect(typeof s.createdAt).toBe('number');
  });

  it('load() returns same sessionId on subsequent calls', async () => {
    const a = await store.load('s1');
    const b = await store.load('s1');
    expect(a.createdAt).toBe(b.createdAt);
  });

  it('load() returns deep clone (mutation does not pollute store)', async () => {
    const a = await store.load('s1');
    a.messages.push(makeMsg('user', 'X'));
    const b = await store.load('s1');
    expect(b.messages).toHaveLength(0); // store 内部不受 a 的 mutation 影响
  });

  it('save() round-trip preserves messages', async () => {
    const s = await store.load('s1');
    s.messages.push(makeMsg('user', 'hello'));
    s.messages.push(makeMsg('assistant', 'hi'));
    await store.save(s);
    const loaded = await store.load('s1');
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe('hello');
  });

  it('save() throws on missing sessionId', async () => {
    const bad = { sessionId: '', createdAt: Date.now(), messages: [] };
    await expect(store.save(bad)).rejects.toThrow(/sessionId/);
  });

  it('clear() empties messages but keeps session metadata', async () => {
    const s = await store.load('s1');
    s.messages.push(makeMsg('user'));
    await store.save(s);
    await store.clear('s1');
    const after = await store.load('s1');
    expect(after.messages).toHaveLength(0);
    expect(after.createdAt).toBe(s.createdAt); // 元数据保留
  });

  it('clear() on unknown session is no-op', async () => {
    await expect(store.clear('never-existed')).resolves.toBeUndefined();
  });

  it('list() enumerates known sessions', async () => {
    await store.load('s1');
    await store.load('s2');
    const list = await store.list!();
    const ids = list.map((s) => s.sessionId).sort();
    expect(ids).toEqual(['s1', 's2']);
  });
});

describe('trimToFifoLimit — 按 turn 数裁剪', () => {
  function makeSession(messages: AssistantMessage[]): AssistantSession {
    return { sessionId: 'test', createdAt: 0, messages: [...messages] };
  }

  it('保留所有消息当 user 消息 ≤ maxTurns', () => {
    const session = makeSession([
      makeMsg('user', 'u1'),
      makeMsg('assistant', 'a1'),
      makeMsg('user', 'u2'),
      makeMsg('assistant', 'a2'),
    ]);
    trimToFifoLimit(session, 5);
    expect(session.messages).toHaveLength(4);
  });

  it('裁剪到尾部 maxTurns 个 user 消息', () => {
    const msgs: AssistantMessage[] = [];
    for (let i = 1; i <= 7; i++) {
      msgs.push(makeMsg('user', `u${i}`));
      msgs.push(makeMsg('assistant', `a${i}`));
    }
    const session = makeSession(msgs);
    trimToFifoLimit(session, 3); // 保留尾部 3 个 turn
    // 期待保留 u5/a5/u6/a6/u7/a7
    const userContents = session.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual(['u5', 'u6', 'u7']);
  });

  it('system 消息不计入 turn，但被相对位置裁剪', () => {
    const session = makeSession([
      makeMsg('user', 'u1'),       // ← 会被裁掉（在 cutoff 之前）
      makeMsg('assistant', 'a1'),  // ← 会被裁掉
      makeMsg('system', 'sys-old'),// ← 会被裁掉（在 cutoff 之前）
      makeMsg('user', 'u2'),       // ← 保留（在 maxTurns=2 内）
      makeMsg('assistant', 'a2'),
      makeMsg('system', 'sys-recent'), // ← 保留
      makeMsg('user', 'u3'),
      makeMsg('assistant', 'a3'),
    ]);
    trimToFifoLimit(session, 2);
    const contents = session.messages.map((m) => m.content);
    expect(contents).toEqual(['u2', 'a2', 'sys-recent', 'u3', 'a3']);
  });

  it('maxTurns ≤ 0 → 不裁剪（防误清光）', () => {
    const session = makeSession([
      makeMsg('user'), makeMsg('assistant'), makeMsg('user'), makeMsg('assistant'),
    ]);
    trimToFifoLimit(session, 0);
    expect(session.messages).toHaveLength(4);
    trimToFifoLimit(session, -1);
    expect(session.messages).toHaveLength(4);
    trimToFifoLimit(session, NaN);
    expect(session.messages).toHaveLength(4);
  });

  it('空 messages → no-op', () => {
    const session = makeSession([]);
    trimToFifoLimit(session, 5);
    expect(session.messages).toHaveLength(0);
  });

  it('单个 turn 不被裁', () => {
    const session = makeSession([makeMsg('user'), makeMsg('assistant')]);
    trimToFifoLimit(session, 1);
    expect(session.messages).toHaveLength(2);
  });
});

describe('appendMessageWithFifoTrim', () => {
  it('append + trim 一次完成', () => {
    const session = { sessionId: 's', createdAt: 0, messages: [] as AssistantMessage[] };
    for (let i = 1; i <= 6; i++) {
      appendMessageWithFifoTrim(session, makeMsg('user', `u${i}`), 3);
      appendMessageWithFifoTrim(session, makeMsg('assistant', `a${i}`), 3);
    }
    const userContents = session.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual(['u4', 'u5', 'u6']);
  });
});
