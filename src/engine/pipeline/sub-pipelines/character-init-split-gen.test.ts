/**
 * Opening split-gen command-merge tests (2026-04-19 fix).
 *
 * Regression: behavioral testing found the opening scene initialized almost
 * nothing when splitGen was ON. Payload inspection showed step1's response
 * carried the full §1-§11 init commands (opening.md's contract), but
 * `generateOpeningSceneSplit` only executed step2's commands — and step2's
 * AI, seeing step1 already in history, emitted only scene-specific deltas
 * (time increment, status push, NPC memory append). Net result:
 * 地图/社交/背包/属性/环境 all at schema defaults when the player entered
 * the first main round.
 *
 * Fix: execute step1's commands AND step2's commands (step1 first). See the
 * method's JSDoc in character-init.ts for the full contract.
 *
 * Uses bracket-access on the `private generateOpeningSceneSplit` method —
 * same pattern as env-tags-wiring.test.ts. TypeScript's `private` is a
 * compile-time marker only, so runtime access is legal and avoids widening
 * the public API just for tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { CharacterInitPipeline } from './character-init';
import { ResponseParser } from '@/engine/ai/response-parser';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import type { Command } from '@/engine/types';
import type { PromptFlowConfig } from '@/engine/types/game-pack';

interface CapturingExecutor {
  executeBatch: ReturnType<typeof vi.fn>;
  executed: Command[][]; // each inner array = one batch
}

function makeCapturingExecutor(): CapturingExecutor {
  const executed: Command[][] = [];
  const executeBatch = vi.fn((cmds: Command[]) => {
    executed.push(cmds);
    return {
      results: cmds.map((c) => ({ success: true, command: c })),
      changeLog: { changes: [], source: 'command' as const, timestamp: Date.now() },
      hasErrors: false,
    };
  });
  return { executeBatch, executed };
}

function makeAiService(responses: string[]): { generate: ReturnType<typeof vi.fn> } {
  const queue = [...responses];
  return {
    generate: vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('[test] AI generate called more times than responses supplied');
      }
      return next;
    }),
  };
}

function makePromptAssembler(): { assemble: ReturnType<typeof vi.fn> } {
  return {
    assemble: vi.fn(() => ({ messages: [], messageSources: [] })),
  };
}

function makePipeline(
  commandExecutor: CapturingExecutor,
  aiService: { generate: ReturnType<typeof vi.fn> },
  promptAssembler: { assemble: ReturnType<typeof vi.fn> },
): CharacterInitPipeline {
  return new CharacterInitPipeline(
    {} as never, // stateManager
    commandExecutor as never,
    aiService as never,
    new ResponseParser(),
    promptAssembler as never,
    {} as never, // saveManager
    {} as never, // profileManager
    {} as never, // behaviorRunner
    {} as never, // gamePack
    DEFAULT_ENGINE_PATHS,
  );
}

function callSplit(
  pipe: CharacterInitPipeline,
): (vars: Record<string, string>, f1: PromptFlowConfig, f2: PromptFlowConfig) => Promise<string | null> {
  return (pipe as unknown as {
    generateOpeningSceneSplit: (
      v: Record<string, string>,
      f1: PromptFlowConfig,
      f2: PromptFlowConfig,
    ) => Promise<string | null>;
  }).generateOpeningSceneSplit.bind(pipe);
}

const STEP1_FLOW: PromptFlowConfig = { id: 'openingSceneStep1', modules: [] };
const STEP2_FLOW: PromptFlowConfig = { id: 'openingSceneStep2', modules: [] };

describe('opening split-gen command merge (2026-04-19 regression fix)', () => {
  it('executes BOTH step1 init commands and step2 scene deltas', async () => {
    // Mirror the observed payload: step1 has full init; step2 has 3 deltas.
    const step1Raw = JSON.stringify({
      text: '开局叙事正文',
      commands: [
        {
          action: 'set',
          path: '世界.时间',
          value: { 年: 2024, 月: 1, 日: 1, 小时: 20, 分钟: 0 },
        },
        { action: 'set', path: '角色.基础信息.当前位置', value: '地球·暗·浣海市·天穹俱乐部' },
        { action: 'set', path: '角色.属性.魅力', value: 17 },
        { action: 'push', path: '世界.地点信息', value: { 名称: '地球·暗', 描述: '...' } },
        { action: 'set', path: '世界.天气', value: '晴朗' },
        { action: 'set', path: '世界.环境', value: [{ 名称: '奢华晚宴', 描述: '.', 效果: '' }] },
        { action: 'push', path: '社交.关系', value: { 名称: '神秘男人' } },
      ],
    });
    const step2Raw = JSON.stringify({
      commands: [
        { action: 'set', path: '世界.时间.小时', value: 21 },
        { action: 'push', path: '角色.状态', value: { 名称: '心神不宁' } },
      ],
    });

    const exec = makeCapturingExecutor();
    const ai = makeAiService([step1Raw, step2Raw]);
    const pipe = makePipeline(exec, ai, makePromptAssembler());

    const result = await callSplit(pipe)({}, STEP1_FLOW, STEP2_FLOW);

    expect(result).toBe('开局叙事正文');
    // executeBatch called twice: once for step1 (7 init), once for step2 (2 delta)
    expect(exec.executeBatch).toHaveBeenCalledTimes(2);
    expect(exec.executed[0]).toHaveLength(7);
    expect(exec.executed[1]).toHaveLength(2);

    // Verify critical init paths appear in step1's batch. ResponseParser
    // normalizes `path` → `key` on the Command objects, so read `.key`.
    const step1Keys = exec.executed[0].map((c) => c.key);
    expect(step1Keys).toContain('世界.时间');
    expect(step1Keys).toContain('角色.基础信息.当前位置');
    expect(step1Keys).toContain('角色.属性.魅力');
    expect(step1Keys).toContain('世界.地点信息');
    expect(step1Keys).toContain('世界.天气');
    expect(step1Keys).toContain('世界.环境');
    expect(step1Keys).toContain('社交.关系');

    // Verify step2 deltas ran too
    const step2Keys = exec.executed[1].map((c) => c.key);
    expect(step2Keys).toContain('世界.时间.小时');
    expect(step2Keys).toContain('角色.状态');
  });

  it('executes step1 commands even when step2 throws', async () => {
    const step1Raw = JSON.stringify({
      text: '开局叙事',
      commands: [
        { action: 'set', path: '角色.基础信息.当前位置', value: '起始地' },
        { action: 'set', path: '世界.天气', value: '晴' },
      ],
    });

    const exec = makeCapturingExecutor();
    // step1 resolves, step2 rejects — simulates API failure on second call
    const ai = {
      generate: vi
        .fn()
        .mockResolvedValueOnce(step1Raw)
        .mockRejectedValueOnce(new Error('network timeout')),
    };
    const pipe = makePipeline(exec, ai, makePromptAssembler());

    const result = await callSplit(pipe)({}, STEP1_FLOW, STEP2_FLOW);

    // step1 text still returned (player still sees opening)
    expect(result).toBe('开局叙事');
    // Only step1 batch executed — step2 never got to its executeBatch call
    expect(exec.executeBatch).toHaveBeenCalledTimes(1);
    expect(exec.executed[0].map((c) => c.key)).toEqual([
      '角色.基础信息.当前位置',
      '世界.天气',
    ]);
  });

  it('returns null and skips all commands when step1 returns empty text', async () => {
    // Step1 returns valid JSON but `text` field is empty → opening considered failed.
    const step1Raw = JSON.stringify({
      text: '',
      commands: [{ action: 'set', path: '世界.天气', value: '晴' }],
    });

    const exec = makeCapturingExecutor();
    const ai = makeAiService([step1Raw]);
    const pipe = makePipeline(exec, ai, makePromptAssembler());

    const result = await callSplit(pipe)({}, STEP1_FLOW, STEP2_FLOW);

    expect(result).toBeNull();
    // No commands executed — abort early, don't half-init with orphan commands.
    expect(exec.executeBatch).not.toHaveBeenCalled();
    // Step2 never called
    expect(ai.generate).toHaveBeenCalledTimes(1);
  });

  it('skips step1 executeBatch when step1 returned text but no commands', async () => {
    // Step1 obeyed the "text only" rule (possible in future if prompts tighten).
    // Step2 still emits its own commands — merge should degrade gracefully.
    const step1Raw = JSON.stringify({ text: '只有正文' });
    const step2Raw = JSON.stringify({
      commands: [{ action: 'set', path: '世界.时间.小时', value: 21 }],
    });

    const exec = makeCapturingExecutor();
    const ai = makeAiService([step1Raw, step2Raw]);
    const pipe = makePipeline(exec, ai, makePromptAssembler());

    const result = await callSplit(pipe)({}, STEP1_FLOW, STEP2_FLOW);

    expect(result).toBe('只有正文');
    // Only step2's batch ran — step1 had no commands so the guard skipped it.
    expect(exec.executeBatch).toHaveBeenCalledTimes(1);
    expect(exec.executed[0].map((c) => c.key)).toEqual(['世界.时间.小时']);
  });
});
