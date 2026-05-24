/**
 * Cross-panel cascade integration tests — Story 2 §6.3.
 *
 * Verifies that editor composable mutations cascade correctly across
 * data boundaries (NPC ↔ Location, Inventory standalone, Engram events).
 * These tests use real composable code with a shared mock state tree,
 * NOT component-level rendering.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockGameState, type MockGameState } from './mock-game-state';

let mockState: MockGameState;

vi.mock('@/ui/composables/useGameState', () => ({
  useGameState: () => mockState,
}));
vi.mock('@/engine/core/event-bus', () => ({
  eventBus: { emit: vi.fn(), on: () => () => {} },
}));
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return { ...actual, inject: () => null };
});

const { useNpcEditor } = await import('../useNpcEditor');
const { useLocationEditor } = await import('../useLocationEditor');
const { useInventoryEditor } = await import('../useInventoryEditor');
const { eventBus } = await import('@/engine/core/event-bus');

function buildSharedState() {
  return createMockGameState({
    角色: {
      基础信息: { 姓名: '主角', 当前位置: '京城' },
      背包: {
        物品: {
          weapon_001: { 名称: '倚天剑', 类型: '武器', 数量: 1, 已装备: true, 可装备: true },
          potion_002: { 名称: '金创药', 类型: '消耗品', 数量: 5 },
        },
        金钱: { 现金: 500, 铜: 200, 银: 15, 金: 3 },
      },
    },
    社交: {
      关系: [
        { 名称: '赵敏', 类型: '关键', 好感度: 80, 位置: '京城', 关系网变量: [{ 对象: '周芷若', 关系: '情敌', 备注: '' }] },
        { 名称: '周芷若', 类型: '关键', 好感度: 60, 位置: '峨眉', 关系网变量: [{ 对象: '赵敏', 关系: '情敌', 备注: '' }] },
        { 名称: '杨逍', 类型: '同伴', 好感度: 50, 位置: '光明顶' },
      ],
    },
    世界: {
      地点信息: [
        { 名称: '京城', 描述: '天子脚下', 类型: '城市', NPC: ['赵敏'], 连接: ['峨眉', '光明顶'] },
        { 名称: '峨眉', 描述: '峨眉派总坛', 类型: '山', NPC: ['周芷若'], 连接: ['京城'], 上级: '中原' },
        { 名称: '光明顶', 描述: '明教总坛', 类型: '山峰', NPC: ['杨逍'], 连接: ['京城'] },
        { 名称: '中原', 描述: '中原大陆', 类型: '大陆' },
      ],
    },
    系统: { 扩展: { engramMemory: { entities: [{ name: '赵敏' }, { name: '周芷若' }] } } },
  });
}

// ─── §6.3 Scenario 1: Edit NPC name → location responds ──────────────
describe('NPC rename → Location NPC list cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = buildSharedState();
    mockState = mock;
  });

  it('renames NPC in location NPC arrays', () => {
    const npcEditor = useNpcEditor();
    const result = npcEditor.save(0, { 名称: '赵敏公主', 类型: '关键' });
    expect(result.ok).toBe(true);

    const locations = mockState.get<Array<{ 名称: string; NPC?: string[] }>>('世界.地点信息');
    const beijing = locations!.find(l => l.名称 === '京城');
    expect(beijing!.NPC).toContain('赵敏公主');
    expect(beijing!.NPC).not.toContain('赵敏');
  });

  it('updates relationship network variable references on rename', () => {
    const npcEditor = useNpcEditor();
    npcEditor.save(0, { 名称: '赵敏公主', 类型: '关键' });

    const npcs = mockState.get<Array<Record<string, unknown>>>('社交.关系');
    const zhouzhiruo = npcs!.find((n) => n.名称 === '周芷若');
    const network = zhouzhiruo!.关系网变量 as Array<{ 对象: string }>;
    expect(network[0].对象).toBe('赵敏公主');
  });

  it('emits editor:npc-renamed event for Engram coordination', () => {
    const npcEditor = useNpcEditor();
    npcEditor.save(0, { 名称: '赵敏公主', 类型: '关键' });

    expect(eventBus.emit).toHaveBeenCalledWith('editor:npc-renamed', {
      oldName: '赵敏',
      newName: '赵敏公主',
    });
  });

  it('does NOT cascade when name is unchanged', () => {
    const npcEditor = useNpcEditor();
    npcEditor.save(0, { 名称: '赵敏', 类型: '中立' });

    expect(eventBus.emit).not.toHaveBeenCalledWith(
      'editor:npc-renamed',
      expect.anything(),
    );
  });
});

// ─── §6.3 Scenario 2: Delete location → NPC position cleared ──────────
describe('Location delete → NPC position cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = buildSharedState();
    mockState = mock;
  });

  it('clears NPC position when their location is deleted', () => {
    const locEditor = useLocationEditor();
    const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const idx = locations.findIndex(l => l.名称 === '京城');
    const result = locEditor.delete(idx);
    expect(result.ok).toBe(true);

    const npcs = mockState.get<Array<Record<string, unknown>>>('社交.关系');
    const zhaomin = npcs!.find(n => n.名称 === '赵敏');
    expect(zhaomin!.位置).toBe('');
  });

  it('clears child location parent on delete', () => {
    const locEditor = useLocationEditor();
    const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const idx = locations.findIndex(l => l.名称 === '中原');
    locEditor.delete(idx);

    const updatedLocations = mockState.get<Array<{ 名称: string; 上级?: string }>>('世界.地点信息');
    const emei = updatedLocations!.find(l => l.名称 === '峨眉');
    expect(emei!.上级).toBeUndefined();
  });

  it('removes connection references from other locations', () => {
    const locEditor = useLocationEditor();
    const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const idx = locations.findIndex(l => l.名称 === '京城');
    locEditor.delete(idx);

    const updatedLocations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
    const emei = updatedLocations!.find(l => l.名称 === '峨眉');
    expect(emei!.连接).not.toContain('京城');
    const gmt = updatedLocations!.find(l => l.名称 === '光明顶');
    expect(gmt!.连接).not.toContain('京城');
  });

  it('analyzeDeleteImpact reports all affected data correctly', () => {
    const locEditor = useLocationEditor();
    const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const idx = locations.findIndex(l => l.名称 === '京城');
    const impact = locEditor.analyzeDeleteImpact(idx);

    expect(impact.locationName).toBe('京城');
    expect(impact.npcRefs).toContain('赵敏');
    expect(impact.connectionRefs).toContain('峨眉');
    expect(impact.connectionRefs).toContain('光明顶');
  });
});

// ─── §6.3 Scenario 3: NPC delete → location + Engram cascade ────────
describe('NPC delete → cross-panel cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = buildSharedState();
    mockState = mock;
  });

  it('removes NPC from location NPC lists on delete', () => {
    const npcEditor = useNpcEditor();
    const result = npcEditor.delete(0); // 赵敏
    expect(result.ok).toBe(true);

    const locations = mockState.get<Array<{ 名称: string; NPC?: string[] }>>('世界.地点信息');
    const beijing = locations!.find(l => l.名称 === '京城');
    expect(beijing!.NPC).not.toContain('赵敏');
  });

  it('emits editor:npc-deleted event', () => {
    const npcEditor = useNpcEditor();
    npcEditor.delete(0);

    expect(eventBus.emit).toHaveBeenCalledWith('editor:npc-deleted', {
      name: '赵敏',
    });
  });

  it('analyzeDeleteImpact reports Engram entity presence', () => {
    const npcEditor = useNpcEditor();
    const impact = npcEditor.analyzeDeleteImpact(0);
    expect(impact.npcName).toBe('赵敏');
    expect(impact.hasEngramEntity).toBe(true);
    expect(impact.locationRefs).toContain('京城');
  });
});

// ─── §6.3 Scenario 4: New item → InventoryPanel list updates ────────
describe('Inventory CRUD → state tree integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = buildSharedState();
    mockState = mock;
  });

  it('creates a new item visible in the items Record', () => {
    const invEditor = useInventoryEditor();
    const result = invEditor.create({ 名称: '屠龙刀', 类型: '武器', 数量: 1 });
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBeDefined();

    const items = mockState.get<Record<string, { 名称: string }>>('角色.背包.物品');
    const newItem = Object.values(items!).find(i => i.名称 === '屠龙刀');
    expect(newItem).toBeDefined();
  });

  it('deletes an item without affecting other items', () => {
    const invEditor = useInventoryEditor();
    const result = invEditor.delete('weapon_001');
    expect(result.ok).toBe(true);

    const items = mockState.get<Record<string, { 名称: string }>>('角色.背包.物品');
    expect(items!['weapon_001']).toBeUndefined();
    expect(items!['potion_002']).toBeDefined();
    expect(items!['potion_002'].名称).toBe('金创药');
  });

  it('updates currency without affecting items', () => {
    const invEditor = useInventoryEditor();
    const result = invEditor.updateCurrency({ 现金: 1000, 铜: 0, 银: 50, 金: 10 });
    expect(result.ok).toBe(true);

    const currency = mockState.get<{ 现金: number; 金: number }>('角色.背包.金钱');
    expect(currency!.现金).toBe(1000);
    expect(currency!.金).toBe(10);

    const items = mockState.get<Record<string, unknown>>('角色.背包.物品');
    expect(Object.keys(items!)).toHaveLength(2);
  });
});

// ─── §6.3 Scenario 5: Location rename → NPC + connection cascade ────
describe('Location rename → full cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = buildSharedState();
    mockState = mock;
  });

  it('updates NPC position when location is renamed', () => {
    const locEditor = useLocationEditor();
    const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const idx = locations.findIndex(l => l.名称 === '京城');
    const result = locEditor.update(idx, {
      名称: '大都',
      描述: '元大都',
      类型: '城市',
      NPC: ['赵敏'],
      连接: ['峨眉', '光明顶'],
    });
    expect(result.ok).toBe(true);

    const npcs = mockState.get<Array<Record<string, unknown>>>('社交.关系');
    const zhaomin = npcs!.find(n => n.名称 === '赵敏');
    expect(zhaomin!.位置).toBe('大都');
  });

  it('updates connection references in other locations on rename', () => {
    const locEditor = useLocationEditor();
    const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const idx = locations.findIndex(l => l.名称 === '京城');
    locEditor.update(idx, {
      名称: '大都',
      描述: '元大都',
      类型: '城市',
      连接: ['峨眉', '光明顶'],
    });

    const updatedLocations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
    const emei = updatedLocations!.find(l => l.名称 === '峨眉');
    expect(emei!.连接).toContain('大都');
    expect(emei!.连接).not.toContain('京城');
  });

  it('updates child location parent reference on rename', () => {
    const locEditor = useLocationEditor();
    const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const idx = locations.findIndex(l => l.名称 === '中原');
    locEditor.update(idx, { 名称: '华夏大陆', 类型: '大陆' });

    const updatedLocations = mockState.get<Array<{ 名称: string; 上级?: string }>>('世界.地点信息');
    const emei = updatedLocations!.find(l => l.名称 === '峨眉');
    expect(emei!.上级).toBe('华夏大陆');
  });
});

// ─── §6.3 Scenario 6: Bidirectional connection consistency ───────────
describe('Bidirectional connection maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = buildSharedState();
    mockState = mock;
  });

  it('adds reverse connection when creating location with connections', () => {
    const locEditor = useLocationEditor();
    locEditor.create({
      名称: '武当山',
      描述: '武当派',
      类型: '山',
      连接: ['京城'],
    });

    const locations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
    const beijing = locations!.find(l => l.名称 === '京城');
    expect(beijing!.连接).toContain('武当山');

    const wudang = locations!.find(l => l.名称 === '武当山');
    expect(wudang!.连接).toContain('京城');
  });

  it('removes reverse connection when editing connections away', () => {
    const locEditor = useLocationEditor();
    const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const idx = locations.findIndex(l => l.名称 === '京城');
    locEditor.update(idx, {
      名称: '京城',
      连接: ['光明顶'], // removed 峨眉
    });

    const updatedLocations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
    const emei = updatedLocations!.find(l => l.名称 === '峨眉');
    expect(emei!.连接).not.toContain('京城');

    const gmt = updatedLocations!.find(l => l.名称 === '光明顶');
    expect(gmt!.连接).toContain('京城');
  });
});

// ─── §6.3 Scenario 7: Multi-step cascade chain ──────────────────────
describe('Multi-step scenario: create → rename → delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = buildSharedState();
    mockState = mock;
  });

  it('full lifecycle: create location → place NPC → rename NPC → delete location', () => {
    const locEditor = useLocationEditor();
    const npcEditor = useNpcEditor();

    // Step 1: Create a new location with NPC
    locEditor.create({
      名称: '少林寺',
      描述: '少林派',
      类型: '寺庙',
      NPC: ['杨逍'],
      连接: ['光明顶'],
    });

    let locations = mockState.get<Array<{ 名称: string; NPC?: string[] }>>('世界.地点信息');
    const shaolin = locations!.find(l => l.名称 === '少林寺');
    expect(shaolin).toBeDefined();
    expect(shaolin!.NPC).toContain('杨逍');

    // Step 2: Rename NPC 杨逍 → 杨左使
    const npcs = mockState.get<Array<{ 名称: string }>>('社交.关系')!;
    const yangIdx = npcs.findIndex(n => n.名称 === '杨逍');
    npcEditor.save(yangIdx, { 名称: '杨左使', 类型: '同伴' });

    locations = mockState.get<Array<{ 名称: string; NPC?: string[] }>>('世界.地点信息');
    const shaolinAfterRename = locations!.find(l => l.名称 === '少林寺');
    expect(shaolinAfterRename!.NPC).toContain('杨左使');
    expect(shaolinAfterRename!.NPC).not.toContain('杨逍');

    const gmtAfterRename = locations!.find(l => l.名称 === '光明顶');
    expect(gmtAfterRename!.NPC).toContain('杨左使');
    expect(gmtAfterRename!.NPC).not.toContain('杨逍');

    // Step 3: Delete 少林寺 → connections cleaned, NPC position remains (NPC was at 光明顶)
    const preDeleteLocs = mockState.get<Array<{ 名称: string }>>('世界.地点信息')!;
    const shaolinIdx = preDeleteLocs.findIndex(l => l.名称 === '少林寺');
    locEditor.delete(shaolinIdx);

    const finalLocations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
    expect(finalLocations!.find(l => l.名称 === '少林寺')).toBeUndefined();

    const gmtFinal = finalLocations!.find(l => l.名称 === '光明顶');
    expect(gmtFinal!.连接).not.toContain('少林寺');
  });
});
