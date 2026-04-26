/**
 * NPC 记忆条目格式化 — back-compat shim (Sprint Social-1)
 *
 * 用于将 NPC `记忆` 数组中的单个条目渲染为字符串。
 * 兼容两种 schema 形态：
 *
 * - **旧形态**：`string` —— 裸文本（例：`"初次在茶馆相遇"`）
 * - **新形态（Social-1 引入）**：`{ 内容: string, 时间?: string }`
 *   对象形态（例：`{ 内容: "初次在茶馆相遇", 时间: "1-01-15 09:30" }`）
 *
 * schema 侧用 `oneOf` 同时允许这两种形态（见
 * `public/packs/tianming/schemas/state-schema.json` §社交.关系.items.记忆），
 * 以便存量存档（纯字符串数组）无需迁移即可继续加载，而新写入的
 * 条目可以带上时间戳。
 *
 * 渲染规则：
 * - `string` → 原样返回
 * - `{ 内容, 时间 }` 且时间非空 → `"[时间] 内容"`
 * - `{ 内容 }` 无时间 → `"内容"`
 * - 英文兼容字段 `{ content, time }` → 同样处理（避免未来其他 pack
 *   用英文键名时需要改动）
 * - null/undefined → `""`
 * - 其他异常值 → `String(raw)` 兜底（不抛错，避免污染主渲染流程）
 *
 * 设计约束：
 * - **纯函数**，不依赖 StateManager / paths / Vue / DOM
 * - 两端共用：`src/engine/pipeline/sub-pipelines/npc-chat.ts` 在 prompt
 *   拼装时调用；`src/ui/components/panels/RelationshipPanel.vue` 在
 *   UI 渲染时调用。两处必须一致，避免用户在 UI 看到的记忆与 AI 读到的不同
 * - 不做格式化之外的逻辑（不 trim 输入、不去重）——让调用方决定
 *
 * 未来：当所有写入点都迁移到对象形态后（Social-2 起），此 shim 仍保留
 * 作为防御式降级，处理任何历史污染数据。
 */

/** 单个 NPC 记忆条目的内部解析结果 */
interface ParsedMemoryEntry {
  content: string;
  time: string;
}

/**
 * 将未知形态的单条 NPC 记忆解析为 { content, time } 结构
 *
 * 返回值的 `content` 是字符串（可能为空），`time` 是字符串（可能为空）。
 * 调用方可以根据需要做后续组合或单独使用。
 *
 * 导出此函数以便在只需结构化数据而不需要字符串渲染的场景（如未来 UI 的
 * 时间轴组件）中使用。
 */
export function parseMemoryEntry(raw: unknown): ParsedMemoryEntry {
  if (raw === null || raw === undefined) return { content: '', time: '' };
  if (typeof raw === 'string') return { content: raw, time: '' };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    const contentRaw = rec['内容'] ?? rec['content'];
    const timeRaw = rec['时间'] ?? rec['time'];
    const content = typeof contentRaw === 'string' ? contentRaw : '';
    const time = typeof timeRaw === 'string' ? timeRaw : '';
    return { content, time };
  }
  // 兜底：布尔 / 数字 / 数组等异常形态 —— String 化避免崩渲染
  return { content: String(raw), time: '' };
}

/**
 * 将单条 NPC 记忆渲染为字符串
 *
 * 见文件顶部 JSDoc 的渲染规则。
 */
export function formatMemoryEntry(raw: unknown): string {
  const { content, time } = parseMemoryEntry(raw);
  const t = time.trim();
  const c = content;
  if (c && t) return `[${t}] ${c}`;
  return c;
}
