/**
 * Location entry fixtures for dedup tests.
 */
interface LocEntry {
  名称: string;
  描述?: string;
  上级?: string;
  NPC?: string[];
}

/** Two trees: "S市" (short) and "中国·S市" (long) — should be merged */
export const SUFFIX_DUPLICATE_LOCS: LocEntry[] = [
  { 名称: 'S市', 描述: '沿海大都市。' },
  { 名称: 'S市·云顶区', 描述: '中央商务区。', 上级: 'S市' },
  { 名称: 'S市·云顶区·天际一号', 描述: '摩天住宅楼。', 上级: 'S市·云顶区' },
  { 名称: '中国', 描述: '东亚国家。' },
  { 名称: '中国·S市', 描述: '经济中心。', 上级: '中国' },
  { 名称: '中国·S市·云顶区', 描述: '摩天大楼林立。', 上级: '中国·S市' },
];

/** All unique — no merging needed */
export const UNIQUE_LOCS: LocEntry[] = [
  { 名称: '中国', 描述: '国家。' },
  { 名称: '中国·北京', 描述: '首都。', 上级: '中国' },
  { 名称: '中国·上海', 描述: '经济中心。', 上级: '中国' },
];

/** Merge with NPC union */
export const NPC_MERGE_LOCS: LocEntry[] = [
  { 名称: 'A市', NPC: ['张三'] },
  { 名称: 'B国·A市', 描述: '城市。', 上级: 'B国', NPC: ['李四'] },
  { 名称: 'B国', 描述: '国家。' },
];

/** Empty + single — edge cases */
export const EMPTY_LOCS: LocEntry[] = [];
export const SINGLE_LOC: LocEntry[] = [{ 名称: '某地' }];
