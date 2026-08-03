// App doc: docs/user-guide/pages/game-main.md §3.14 (语音输入 · STT)
/**
 * 自定义专有名词词典持久化 — **按存档分开**(per-save)。
 *
 * localStorage `aga_stt_custom_lexicon` = `{ [saveKey]: string[] }`,saveKey 由 UI 传入
 * (`${profileId}::${slotId}`,引擎视作不透明字符串)。此 key 以 `aga_` 开头 →
 * collectLocalStorageSettings 自动进**全量备份/云同步**(同一用户多设备)。
 * **不进游戏卡导出白名单**:per-save 键对导入者无意义,且避免泄漏他档词条(见
 * settings-export-whitelist.ts 闭集语义)。
 *
 * 引擎铁律:不碰游戏字段名、不 import vue-i18n。词条清洗(2-10 汉字等)由 lexicon.ts
 * 的 normalizeLexiconTerms 负责;此处只管「按档增删查存」。
 */
import { normalizeLexiconTerms } from './lexicon';

export const CUSTOM_LEXICON_STORAGE_KEY = 'aga_stt_custom_lexicon';

type LexiconMap = Record<string, string[]>;

function readMap(): LexiconMap {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(CUSTOM_LEXICON_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as LexiconMap;
  } catch {
    return {};
  }
}

function writeMap(map: LexiconMap): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CUSTOM_LEXICON_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

function sanitizeList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return normalizeLexiconTerms(v.filter((x): x is string => typeof x === 'string'));
}

/** 读某存档的自定义词条(已归一化)。saveKey 为空 → 空表。 */
export function loadCustomLexicon(saveKey: string): string[] {
  if (!saveKey) return [];
  return sanitizeList(readMap()[saveKey]);
}

/** 覆盖写某存档的自定义词条。 */
export function saveCustomLexicon(saveKey: string, terms: readonly string[]): void {
  if (!saveKey) return;
  const map = readMap();
  map[saveKey] = normalizeLexiconTerms(terms);
  writeMap(map);
}

/** 向某存档追加一个词条(去重 + 归一化);返回追加后的完整列表。非法词条则原样返回。 */
export function addCustomTerm(saveKey: string, term: string): string[] {
  if (!saveKey) return [];
  const current = loadCustomLexicon(saveKey);
  const next = normalizeLexiconTerms([...current, term]);
  saveCustomLexicon(saveKey, next);
  return next;
}

/** 从某存档移除一个词条;返回移除后的列表。 */
export function removeCustomTerm(saveKey: string, term: string): string[] {
  if (!saveKey) return [];
  const next = loadCustomLexicon(saveKey).filter((t) => t !== term);
  saveCustomLexicon(saveKey, next);
  return next;
}
