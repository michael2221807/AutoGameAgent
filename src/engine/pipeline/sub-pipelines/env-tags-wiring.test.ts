/**
 * Env-tags wiring smoke tests (P2 env-tags port, 2026-04-19).
 *
 * Verifies that `WorldHeartbeatPipeline` and `NpcChatPipeline` both invoke
 * `buildEnvironmentBlock` inside their private variable builders. Uses
 * bracket-access on the private methods — TypeScript's `private` is a
 * compile-time marker only, so runtime access is legal and avoids
 * widening the public API just for tests.
 *
 * Why this level of test: a full integration harness would need 7 dependency
 * mocks per pipeline (state-manager, command-executor, ai-service, parser,
 * assembler, pack, paths). The P2 wiring is a 5-line addition per pipeline;
 * building a 50-line mock per test has bad ROI. This test catches the
 * regression "someone renames DEFAULT_ENGINE_PATHS.weather and heartbeat
 * silently stops seeing weather" without the full harness.
 */
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { WorldHeartbeatPipeline } from '@/engine/pipeline/sub-pipelines/world-heartbeat';
import { NpcChatPipeline } from '@/engine/pipeline/sub-pipelines/npc-chat';

/**
 * Minimum stateManager that answers only the specific path reads we care
 * about. Unknown paths return undefined so downstream code hits fallbacks.
 */
function makeStateManager(map: Record<string, unknown>): {
  get: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn((path: string) => map[path]),
  };
}

describe('env-tags wiring — WorldHeartbeatPipeline', () => {
  it("buildHeartbeatVariables returns an ENVIRONMENT_BLOCK that reflects current state", () => {
    const sm = makeStateManager({
      [DEFAULT_ENGINE_PATHS.weather]: '暴雨',
      [DEFAULT_ENGINE_PATHS.festival]: { 名称: '元宵节', 描述: 'x', 效果: 'y' },
      [DEFAULT_ENGINE_PATHS.environmentTags]: [
        { 名称: '泥泞', 描述: '地面湿滑', 效果: '移动困难' },
      ],
      [DEFAULT_ENGINE_PATHS.gameTime]: { 年: 1, 月: 1, 日: 1, 小时: 8, 分钟: 0 },
      [DEFAULT_ENGINE_PATHS.playerLocation]: '青云镇',
    });

    const pipe = new WorldHeartbeatPipeline(
      sm as never, // stateManager
      {} as never, // commandExecutor
      {} as never, // aiService
      {} as never, // responseParser
      {} as never, // promptAssembler
      {} as never, // gamePack
      DEFAULT_ENGINE_PATHS,
    );

    // Access private method via bracket notation (runtime-legal).
    const buildVars = (pipe as unknown as {
      buildHeartbeatVariables: (npcs: Record<string, unknown>[]) => Record<string, string>;
    }).buildHeartbeatVariables.bind(pipe);

    const vars = buildVars([]);
    expect(vars.ENVIRONMENT_BLOCK).toBeDefined();
    expect(vars.ENVIRONMENT_BLOCK).toContain('暴雨');
    expect(vars.ENVIRONMENT_BLOCK).toContain('元宵节');
    expect(vars.ENVIRONMENT_BLOCK).toContain('泥泞');
  });

  it("falls back cleanly when the 3 env paths are missing from state", () => {
    const sm = makeStateManager({});
    const pipe = new WorldHeartbeatPipeline(
      sm as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      DEFAULT_ENGINE_PATHS,
    );
    const buildVars = (pipe as unknown as {
      buildHeartbeatVariables: (npcs: Record<string, unknown>[]) => Record<string, string>;
    }).buildHeartbeatVariables.bind(pipe);

    const vars = buildVars([]);
    // Defaults applied by buildEnvironmentBlock
    expect(vars.ENVIRONMENT_BLOCK).toContain('天气：晴');
    expect(vars.ENVIRONMENT_BLOCK).toContain('节日：平日');
    expect(vars.ENVIRONMENT_BLOCK).toContain('环境标签：（空）');
  });
});

describe('env-tags wiring — NpcChatPipeline', () => {
  it('buildVariables returns an ENVIRONMENT_BLOCK that reflects current state', () => {
    const sm = makeStateManager({
      [DEFAULT_ENGINE_PATHS.weather]: '大雾',
      [DEFAULT_ENGINE_PATHS.festival]: { 名称: '平日', 描述: '', 效果: '' },
      [DEFAULT_ENGINE_PATHS.environmentTags]: [
        { 名称: '妖雾弥漫', 描述: '能见度极低', 效果: '-3感知' },
      ],
      [DEFAULT_ENGINE_PATHS.playerName]: '主角',
      [DEFAULT_ENGINE_PATHS.playerLocation]: '青云镇',
      [DEFAULT_ENGINE_PATHS.worldDescription]: '',
      [DEFAULT_ENGINE_PATHS.gameTime]: { 年: 1, 月: 1, 日: 1, 小时: 8, 分钟: 0 },
      '记忆.短期': [],
    });

    const pipe = new NpcChatPipeline(
      sm as never,
      {} as never, // commandExecutor
      {} as never, // aiService
      {} as never, // responseParser
      {} as never, // promptAssembler
      {} as never, // gamePack
      DEFAULT_ENGINE_PATHS,
      // memoryManager — only needs `getShortTermEntries` for `formatShortTermMemory`
      { getShortTermEntries: () => [] } as never,
    );

    const buildVars = (pipe as unknown as {
      buildVariables: (name: string, npc: Record<string, unknown>, msg: string) => Record<string, string>;
    }).buildVariables.bind(pipe);

    const vars = buildVars('林曦', { 名称: '林曦' }, 'hello');
    expect(vars.ENVIRONMENT_BLOCK).toBeDefined();
    expect(vars.ENVIRONMENT_BLOCK).toContain('大雾');
    expect(vars.ENVIRONMENT_BLOCK).toContain('妖雾弥漫');
    // Default festival: name line present without parenthesized description
    expect(vars.ENVIRONMENT_BLOCK).toContain('节日：平日');
  });
});
