// App doc: docs/user-guide/pages/game-main.md §3.14.7 (专有名词偏置 / 热词)
/**
 * useSttLexicon — 组装 STT 专有名词热词(hotwords)。
 *
 * 职责(UI 层,允许游戏字段知识 —— 引擎 STT 保持题材无关):
 *   - 从当前存档**收割人名 + 地名**(经 DEFAULT_ENGINE_PATHS + `名称` 字段)。
 *   - 合并**本存档自定义词典**(per-save,localStorage,见 lexicon-store)。
 *   - 归一化(2-10 汉字/去重/≤200)+ 按强度组成 FunASR `hotwords` JSON 字符串。
 *   - 暴露自定义词典 CRUD 给设置区 / 主面板「+词」消费。
 *
 * 纯函数(归一化、组 JSON)在 engine/stt/lexicon.ts;per-save 存储在 engine/stt/lexicon-store.ts。
 * 设计文档:docs/design/stt-hotword-handoff.md · app-doc:game-main.md §3.14
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { loadSttSettings } from '@/engine/stt/stt-settings';
import { normalizeLexiconTerms, buildHotwords } from '@/engine/stt/lexicon';
import { loadCustomLexicon, addCustomTerm, removeCustomTerm } from '@/engine/stt/lexicon-store';
import { HOTWORD_WEIGHT } from '@/engine/stt/types';

export function useSttLexicon() {
  const gs = useGameState();

  /** per-save 键:profileId::slotId;未载入存档时为空(自定义词典不可用)。 */
  const saveKey = computed(() => {
    const p = gs.activeProfileId.value;
    const s = gs.activeSlotId.value;
    return p && s ? `${p}::${s}` : '';
  });
  const hasSave = computed(() => !!saveKey.value);

  /**
   * 本存档自定义词条 —— **仅供 UI 显示**(设置区 chip / 主面板)。
   * 切档自动重载;跨实例改动经 `aga:stt-lexicon-changed` 事件同步(见下),使同时挂载的
   * +词键 / 设置区 / MicInputButton 三个实例显示一致。
   * ⚠️ getHotwords 不读此 ref(可能过期),而是从 localStorage 鲜读(见 reviewer Finding 1)。
   */
  const customTerms = ref<string[]>(loadCustomLexicon(saveKey.value));
  watch(saveKey, (k) => { customTerms.value = loadCustomLexicon(k); }, { immediate: false });

  // 跨实例同步:任一实例改词典 → 广播 → 各实例重载显示(仅在组件 setup 内注册生命周期)。
  function reloadFromStore(): void { customTerms.value = loadCustomLexicon(saveKey.value); }
  if (getCurrentInstance()) {
    onMounted(() => window.addEventListener('aga:stt-lexicon-changed', reloadFromStore));
    onBeforeUnmount(() => window.removeEventListener('aga:stt-lexicon-changed', reloadFromStore));
  }
  function broadcast(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('aga:stt-lexicon-changed'));
  }

  /** 从游戏状态收割人名 + 地名(一次性,开录时调用)。 */
  function harvestAuto(): string[] {
    const terms: string[] = [];
    const npcNameKey = DEFAULT_ENGINE_PATHS.npcFieldNames.name; // 通常 '名称'

    const player = gs.get<unknown>(DEFAULT_ENGINE_PATHS.playerName);
    if (typeof player === 'string') terms.push(player);

    const rels = gs.get<unknown>(DEFAULT_ENGINE_PATHS.relationships);
    if (Array.isArray(rels)) {
      for (const r of rels) {
        const n = r && typeof r === 'object' ? (r as Record<string, unknown>)[npcNameKey] : undefined;
        if (typeof n === 'string') terms.push(n);
      }
    }

    const locs = gs.get<unknown>(DEFAULT_ENGINE_PATHS.locations);
    if (Array.isArray(locs)) {
      for (const l of locs) {
        // 地点条目无配置化 name key,沿用 UI 既有约定 `名称`(MapPanel 同)。
        const n = l && typeof l === 'object' ? (l as Record<string, unknown>)['名称'] : undefined;
        if (typeof n === 'string') terms.push(n);
      }
    }

    const explored = gs.get<unknown>(DEFAULT_ENGINE_PATHS.explorationRecord);
    if (Array.isArray(explored)) {
      for (const e of explored) if (typeof e === 'string') terms.push(e);
    }

    return terms;
  }

  /**
   * 组成 `hotwords` JSON 字符串。偏置关 → 返回 ''(调用方据此不传 = 后端关闭)。
   * 自定义词条排在前 → 归一化裁到 200 时优先保留玩家手录的词。
   */
  function getHotwords(): string {
    const s = loadSttSettings();
    if (!s.hotwordEnabled) return '';
    // 从 localStorage **鲜读**自定义词(而非可能过期的 customTerms ref)——保证刚加的词
    // 在触发它的这次录音里就生效(reviewer Finding 1)。
    const custom = loadCustomLexicon(saveKey.value);
    const merged = normalizeLexiconTerms([...custom, ...harvestAuto()]);
    return buildHotwords(merged, HOTWORD_WEIGHT[s.hotwordStrength]);
  }

  /** 追加一个自定义词条(去重/归一化);非法词(非 2-10 汉字)会被静默丢弃。 */
  function addTerm(term: string): void {
    if (!hasSave.value) return;
    customTerms.value = addCustomTerm(saveKey.value, term);
    broadcast();
  }
  /** 移除一个自定义词条。 */
  function removeTerm(term: string): void {
    if (!hasSave.value) return;
    customTerms.value = removeCustomTerm(saveKey.value, term);
    broadcast();
  }

  return { customTerms, hasSave, getHotwords, harvestAuto, addTerm, removeTerm };
}
