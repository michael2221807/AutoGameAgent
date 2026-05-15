import { describe, it, expect, vi } from 'vitest';
import { WorldHeartbeatPipeline } from './world-heartbeat';
import { createMockStateManager } from '../../__test-utils__/state-manager.mock';

vi.mock('../../core/prompt-debug', () => ({
  emitPromptAssemblyDebug: vi.fn(),
  emitPromptResponseDebug: vi.fn(),
  extractThinkingFromRaw: vi.fn(() => ''),
}));

vi.mock('../../audit/audit-append', () => ({
  appendChangesToLastNarrative: vi.fn(),
}));

vi.mock('../../prompt/environment-block', () => ({
  buildEnvironmentBlock: vi.fn(() => ''),
}));

function createPipeline(stateData: Record<string, unknown>) {
  const { sm } = createMockStateManager(stateData);

  const paths = {
    npcList: 'NPC列表',
    playerLocation: '角色.当前位置',
    gameTime: '世界.时间',
    roundNumber: '回合数',
    heartbeatHistory: '心跳历史',
    weather: '世界.天气',
    festival: '世界.节日',
    environmentTags: '世界.环境',
    npcFieldNames: {
      name: '名称',
      location: '当前位置',
      type: '类型',
      appearance: '外貌',
      description: '描述',
      bodyDescription: '身材描写',
      outfitStyle: '衣着风格',
      innerThought: '内心想法',
      currentActivity: '在做事项',
      personalityTraits: '性格特征',
    },
  };

  const aiService = { generate: vi.fn().mockResolvedValue('{}') };
  const responseParser = { parse: vi.fn().mockReturnValue({ commands: [] }) };
  const promptAssembler = {
    assemble: vi.fn().mockReturnValue({ messages: [], messageSources: [] }),
  };
  const commandExecutor = {
    executeBatch: vi.fn().mockReturnValue({
      hasErrors: false,
      changeLog: { changes: [] },
    }),
  };
  const gamePack = {
    promptFlows: { worldHeartbeat: { id: 'worldHeartbeat', steps: [] } },
  };

  const pipeline = new WorldHeartbeatPipeline(
    sm as never,
    commandExecutor as never,
    aiService as never,
    responseParser as never,
    promptAssembler as never,
    gamePack as never,
    paths as never,
  );

  return { pipeline, sm, aiService, responseParser, promptAssembler, commandExecutor };
}

describe('WorldHeartbeatPipeline', () => {
  describe('NPC candidate selection', () => {
    it('excludes NPCs at player location', async () => {
      const { pipeline, promptAssembler } = createPipeline({
        角色: { 当前位置: '集市' },
        NPC列表: [
          { 名称: '张三', 当前位置: '集市', 类型: '商人' },
          { 名称: '李四', 当前位置: '酒馆', 类型: '路人' },
        ],
        回合数: 1,
        心跳历史: [],
      });

      await pipeline.execute();

      const callArgs = promptAssembler.assemble.mock.calls[0];
      const variables = callArgs[1] as Record<string, string>;
      expect(variables['NPC_BLOCKS']).toContain('李四');
      expect(variables['NPC_BLOCKS']).not.toContain('张三');
    });

    it('excludes dead NPCs', async () => {
      const { pipeline, promptAssembler } = createPipeline({
        角色: { 当前位置: '集市' },
        NPC列表: [
          { 名称: '死者', 当前位置: '酒馆', 已死亡: true },
          { 名称: '活人', 当前位置: '酒馆' },
        ],
        回合数: 1,
        心跳历史: [],
      });

      await pipeline.execute();

      const callArgs = promptAssembler.assemble.mock.calls[0];
      const variables = callArgs[1] as Record<string, string>;
      expect(variables['NPC_BLOCKS']).toContain('活人');
      expect(variables['NPC_BLOCKS']).not.toContain('死者');
    });

    it('excludes heartbeat-locked NPCs', async () => {
      const { pipeline, promptAssembler } = createPipeline({
        角色: { 当前位置: '集市' },
        NPC列表: [
          { 名称: '锁定者', 当前位置: '酒馆', 心跳锁定: true },
          { 名称: '普通人', 当前位置: '酒馆' },
        ],
        回合数: 1,
        心跳历史: [],
      });

      await pipeline.execute();

      const callArgs = promptAssembler.assemble.mock.calls[0];
      const variables = callArgs[1] as Record<string, string>;
      expect(variables['NPC_BLOCKS']).toContain('普通人');
      expect(variables['NPC_BLOCKS']).not.toContain('锁定者');
    });

    it('returns false when no candidates', async () => {
      const { pipeline } = createPipeline({
        角色: { 当前位置: '集市' },
        NPC列表: [
          { 名称: '张三', 当前位置: '集市' },
        ],
        回合数: 1,
        心跳历史: [],
      });

      const result = await pipeline.execute();
      expect(result).toBe(false);
    });

    it('limits candidates to MAX_NPCS_PER_HEARTBEAT (5)', async () => {
      const npcs = Array.from({ length: 10 }, (_, i) => ({
        名称: `NPC_${i}`,
        当前位置: '远方',
        类型: '路人',
      }));
      const { pipeline, promptAssembler } = createPipeline({
        角色: { 当前位置: '集市' },
        NPC列表: npcs,
        回合数: 1,
        心跳历史: [],
      });

      await pipeline.execute();

      const callArgs = promptAssembler.assemble.mock.calls[0];
      const variables = callArgs[1] as Record<string, string>;
      const npcBlocks = variables['NPC_BLOCKS'].split('### ').filter(Boolean);
      expect(npcBlocks.length).toBeLessThanOrEqual(5);
    });

    it('supports English field names (isDead, currentLocation)', async () => {
      const { pipeline, promptAssembler } = createPipeline({
        角色: { 当前位置: '集市' },
        NPC列表: [
          { 名称: 'Alice', currentLocation: '酒馆', isDead: false },
          { 名称: 'Bob', currentLocation: '酒馆', isDead: true },
        ],
        回合数: 1,
        心跳历史: [],
      });

      await pipeline.execute();

      const callArgs = promptAssembler.assemble.mock.calls[0];
      const variables = callArgs[1] as Record<string, string>;
      expect(variables['NPC_BLOCKS']).toContain('Alice');
      expect(variables['NPC_BLOCKS']).not.toContain('Bob');
    });
  });

  describe('missing prompt flow', () => {
    it('returns false when worldHeartbeat flow is missing', async () => {
      const { sm } = createMockStateManager({});
      const pipeline = new WorldHeartbeatPipeline(
        sm as never,
        null as never,
        null as never,
        null as never,
        null as never,
        { promptFlows: {} } as never,
        {} as never,
      );
      const result = await pipeline.execute();
      expect(result).toBe(false);
    });
  });
});
