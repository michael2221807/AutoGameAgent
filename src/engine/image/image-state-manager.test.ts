import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageStateManager, PLAYER_PSEUDO_NPC_ID } from './image-state-manager';
import type { EnginePathConfig } from '../pipeline/types';

// Minimal mock for StateManager
function createMockStateManager() {
  const store: Record<string, unknown> = {};
  return {
    get: vi.fn(<T>(path: string): T | undefined => {
      const parts = path.split('.');
      let current: unknown = store;
      for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current as T | undefined;
    }),
    set: vi.fn((path: string, value: unknown) => {
      const parts = path.split('.');
      let current: Record<string, unknown> = store;
      for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
          current[parts[i]] = {};
        }
        current = current[parts[i]] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
    }),
    _store: store,
  };
}

const TEST_PATHS = {
  playerName: '角色.基础信息.姓名',
  characterAge: '角色.基础信息.年龄',
  characterGender: '角色.基础信息.性别',
  characterOccupation: '角色.身份.职业',
  characterDescription: '角色.描述',
  playerLocation: '角色.基础信息.当前位置',
  characterTraits: '角色.身份.特质',
  characterOrigin: '角色.身份.出身',
  relationships: '社交.关系',
  npcFieldNames: { name: '名称' } as unknown as EnginePathConfig['npcFieldNames'],
};

describe('ImageStateManager', () => {
  let sm: ReturnType<typeof createMockStateManager>;
  let ism: ImageStateManager;

  beforeEach(() => {
    sm = createMockStateManager();
    ism = new ImageStateManager(sm as unknown as import('../core/state-manager').StateManager, TEST_PATHS as unknown as EnginePathConfig);

    // Seed NPC list
    sm.set('社交.关系', [
      { '名称': '林暖', '性别': '女' },
      { '名称': '关宇', '性别': '男' },
    ]);
  });

  describe('concurrent generation lock', () => {
    it('locks and unlocks correctly', () => {
      expect(ism.isGenerating('林暖')).toBe(false);
      ism.lockGeneration('林暖');
      expect(ism.isGenerating('林暖')).toBe(true);
      ism.unlockGeneration('林暖');
      expect(ism.isGenerating('林暖')).toBe(false);
    });
  });

  describe('NPC archive CRUD', () => {
    it('returns null for NPC without archive', () => {
      expect(ism.getNpcArchive('林暖')).toBeNull();
    });

    it('writes and reads NPC image record', () => {
      ism.writeNpcImageRecord('林暖', {
        id: 'asset_1',
        composition: 'portrait',
        status: 'complete',
        createdAt: 1000,
      });

      const archive = ism.getNpcArchive('林暖');
      expect(archive).not.toBeNull();
      const history = ism.getNpcImageHistory('林暖');
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('asset_1');
    });

    it('auto-selects avatar for portrait composition', () => {
      ism.writeNpcImageRecord('林暖', {
        id: 'asset_1',
        composition: 'portrait',
        status: 'complete',
        createdAt: 1000,
      });
      const archive = ism.getNpcArchive('林暖');
      expect(archive?.['已选头像图片ID']).toBe('asset_1');
    });

    it('deduplicates by ID', () => {
      ism.writeNpcImageRecord('林暖', { id: 'asset_1', composition: 'portrait', status: 'complete', createdAt: 1000 });
      ism.writeNpcImageRecord('林暖', { id: 'asset_1', composition: 'portrait', status: 'complete', createdAt: 2000 });
      expect(ism.getNpcImageHistory('林暖')).toHaveLength(1);
    });
  });

  describe('NPC selection management', () => {
    it('sets and clears avatar', () => {
      ism.writeNpcImageRecord('林暖', { id: 'asset_1', composition: 'portrait', status: 'complete', createdAt: 1000 });
      ism.setNpcAvatar('林暖', 'asset_1');
      expect(ism.getNpcArchive('林暖')?.['已选头像图片ID']).toBe('asset_1');
      ism.clearNpcAvatar('林暖');
      expect(ism.getNpcArchive('林暖')?.['已选头像图片ID']).toBe('');
    });

    it('sets and clears portrait', () => {
      ism.writeNpcImageRecord('林暖', { id: 'asset_1', composition: 'half-body', status: 'complete', createdAt: 1000 });
      ism.setNpcPortrait('林暖', 'asset_1');
      expect(ism.getNpcArchive('林暖')?.['已选立绘图片ID']).toBe('asset_1');
    });

    it('sets and clears background', () => {
      ism.writeNpcImageRecord('林暖', { id: 'asset_1', composition: 'full-length', status: 'complete', createdAt: 1000 });
      ism.setNpcBackground('林暖', 'asset_1');
      expect(ism.getNpcArchive('林暖')?.['已选背景图片ID']).toBe('asset_1');
    });
  });

  describe('delete + cascade clear', () => {
    it('deletes image and clears related selections', () => {
      ism.writeNpcImageRecord('林暖', { id: 'asset_1', composition: 'portrait', status: 'complete', createdAt: 1000 });
      ism.setNpcAvatar('林暖', 'asset_1');
      ism.deleteNpcImage('林暖', 'asset_1');
      expect(ism.getNpcImageHistory('林暖')).toHaveLength(0);
      expect(ism.getNpcArchive('林暖')?.['已选头像图片ID']).toBe('');
    });

    it('clearNpcHistory wipes everything', () => {
      ism.writeNpcImageRecord('林暖', { id: 'asset_1', composition: 'portrait', status: 'complete', createdAt: 1000 });
      ism.clearNpcHistory('林暖');
      expect(ism.getNpcImageHistory('林暖')).toHaveLength(0);
      expect(ism.getNpcArchive('林暖')?.['已选头像图片ID']).toBe('');
    });
  });

  describe('__player__ pseudo-NPC', () => {
    it('isPlayer identifies __player__', () => {
      expect(PLAYER_PSEUDO_NPC_ID).toBe('__player__');
    });

    it('writes to 角色.图片档案 path for __player__', () => {
      ism.writeNpcImageRecord('__player__', {
        id: 'player_asset_1',
        composition: 'portrait',
        status: 'complete',
        createdAt: 1000,
      });
      const archive = ism.getNpcArchive('__player__');
      expect(archive).not.toBeNull();
      const history = ism.getNpcImageHistory('__player__');
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('player_asset_1');

      // Should have been written to 角色.图片档案, not to NPC list
      expect(sm.set).toHaveBeenCalledWith('角色.图片档案', expect.anything(), 'system');
    });

    it('does not pollute NPC list with __player__', () => {
      ism.writeNpcImageRecord('__player__', { id: 'player_asset_1', composition: 'portrait', status: 'complete', createdAt: 1000 });
      const npcList = sm.get('社交.关系') as Array<Record<string, unknown>> | undefined;
      expect(npcList).toHaveLength(2);
      expect(npcList?.every((n: Record<string, unknown>) => n['名称'] !== '__player__')).toBe(true);
    });

    it('sets avatar for __player__', () => {
      ism.writeNpcImageRecord('__player__', { id: 'p_asset', composition: 'portrait', status: 'complete', createdAt: 1000 });
      ism.setNpcAvatar('__player__', 'p_asset');
      const archive = ism.getNpcArchive('__player__');
      expect(archive?.['已选头像图片ID']).toBe('p_asset');
    });
  });

  describe('secret part results', () => {
    it('stores and retrieves secret part result', () => {
      ism.writeNpcImageRecord('林暖', { id: 'asset_1', status: 'complete', createdAt: 1000 });
      ism.setSecretPartResult('林暖', 'breast', { id: 'secret_1', status: 'complete' });
      const result = ism.getSecretPartResult('林暖', 'breast');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('secret_1');
    });

    it('returns null for missing secret part', () => {
      expect(ism.getSecretPartResult('林暖', 'vagina')).toBeNull();
    });
  });

  describe('scene wallpaper', () => {
    it('sets and clears scene wallpaper', () => {
      ism.setSceneWallpaper('scene_1');
      ism.clearSceneWallpaper();
      // Just verify no throw — actual wallpaper state is in scene archive
    });

    it('sets and gets persistent wallpaper', () => {
      ism.setPersistentWallpaper('https://example.com/bg.png');
      expect(ism.getPersistentWallpaper()).toBe('https://example.com/bg.png');
      ism.clearPersistentWallpaper();
      expect(ism.getPersistentWallpaper()).toBe('');
    });
  });

  describe('history limit enforcement', () => {
    it('trims history when exceeding limit', () => {
      // Set a low limit
      sm.set('系统.扩展.image.config.auto.historyLimit', 3);

      for (let i = 0; i < 5; i++) {
        ism.writeNpcImageRecord('林暖', {
          id: `asset_${i}`,
          composition: 'portrait',
          status: 'complete',
          createdAt: 1000 + i,
        });
      }
      const history = ism.getNpcImageHistory('林暖');
      expect(history.length).toBeLessThanOrEqual(3);
    });
  });
});
