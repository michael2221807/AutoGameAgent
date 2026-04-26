// Standalone test for snapshot-sanitizer — run with `node scripts/test-sanitizer.mjs`
// Re-implements the same logic for quick smoke test without TS imports.

const NSFW_STRIP_PATHS = ['社交.关系.*.私密信息', '角色.身体'];
const PROMPT_ALWAYS_STRIP_PATHS = [
  '元数据.叙事历史',
  '元数据.上次对话前快照',
  '记忆.短期',
  '记忆.中期',
  '记忆.长期',
  '记忆.隐式中期',
  '系统.扩展.engramMemory',
];

function pathMatchesStripRule(path, rule) {
  const p = path.split('.');
  const r = rule.split('.');
  if (p.length !== r.length) return false;
  for (let i = 0; i < r.length; i++) {
    if (r[i] === '*') continue;
    if (r[i] !== p[i]) return false;
  }
  return true;
}

function shouldStripAtPath(path, nsfwMode) {
  for (const rule of PROMPT_ALWAYS_STRIP_PATHS) if (pathMatchesStripRule(path, rule)) return true;
  if (!nsfwMode) for (const rule of NSFW_STRIP_PATHS) if (pathMatchesStripRule(path, rule)) return true;
  return false;
}

function sanitizeDeep(value, path, nsfwMode) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const r = [];
    for (let i = 0; i < value.length; i++) {
      const cp = `${path}.${i}`;
      if (shouldStripAtPath(cp, nsfwMode)) continue;
      r.push(sanitizeDeep(value[i], cp, nsfwMode));
    }
    return r;
  }
  const r = {};
  for (const k of Object.keys(value)) {
    const cp = path ? `${path}.${k}` : k;
    if (shouldStripAtPath(cp, nsfwMode)) continue;
    r[k] = sanitizeDeep(value[k], cp, nsfwMode);
  }
  return r;
}

function stringifySnapshotForPrompt(snapshot, nsfwMode, indent = 0) {
  const cleaned = sanitizeDeep(snapshot, '', nsfwMode);
  return indent > 0 ? JSON.stringify(cleaned, null, indent) : JSON.stringify(cleaned);
}

// Realistic test snapshot — mimics a mid-game state
const snap = {
  元数据: {
    游戏包名称: '天命',
    回合序号: 42,
    叙事历史: Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `回合${i}的叙事内容`.repeat(20),
    })),
    上次对话前快照: {
      元数据: { 回合序号: 41 },
      角色: { 基础信息: { 姓名: '测试' }, 属性: { 体质: 10 } },
      记忆: { 短期: [{ round: 1, summary: '很长的记忆内容'.repeat(50) }] },
    },
  },
  角色: {
    基础信息: { 姓名: '小明', 性别: '男', 年龄: 18 },
    身份: { 出身: '平民', 天赋档次: '凡品', 天赋: ['坚韧'], 先天六维: { 体质: 5 } },
    属性: { 体质: 10, 直觉: 8, 悟性: 9, 气运: 7, 魅力: 6, 心性: 8 },
    可变属性: { 体力: { 当前: 80, 上限: 100 }, 精力: { 当前: 60, 上限: 100 } },
    背包: { 物品: {}, 金钱: { 铜: 50 } },
    身体: { 身高: 170, 三围: { 胸围: 90 } },
  },
  记忆: {
    短期: Array.from({ length: 8 }, (_, i) => ({ round: i, summary: `短期记忆${i}`.repeat(30) })),
    中期: Array.from({ length: 20 }, (_, i) => `中期条目${i}`.repeat(20)),
    长期: [{ category: '主线', content: '长期主线内容'.repeat(30) }],
    隐式中期: Array.from({ length: 10 }, (_, i) => `隐式${i}`.repeat(15)),
    语义: { triples: [{ subject: 'a', predicate: 'b', object: 'c' }] },
  },
  系统: {
    扩展: {
      engramMemory: {
        events: Array.from({ length: 100 }, (_, i) => ({
          id: `evt_${i}`,
          text: '事件详情'.repeat(50),
          timestamp: Date.now(),
          embedding: new Array(128).fill(0.1),
        })),
        entities: [],
        relations: [],
      },
    },
    nsfwMode: false,
  },
  社交: {
    关系: [
      { 名称: 'NPC1', 好感度: 50, 私密信息: { 敏感: 'data' } },
    ],
  },
};

// Baseline: unstripped (indent 2, like the OLD behavior)
const baseline = JSON.stringify(snap, null, 2);
console.log(`Baseline (old behavior, indent=2, no strip): ${baseline.length.toLocaleString()} chars`);

// New: stripped + compact
const compact = stringifySnapshotForPrompt(snap, false, 0);
console.log(`New (stripped + compact indent=0):            ${compact.length.toLocaleString()} chars`);

const savedPct = ((1 - compact.length / baseline.length) * 100).toFixed(1);
console.log(`\n=== SAVINGS: ${savedPct}% ===\n`);

// Verification checks
const checks = [
  ['叙事历史 removed', !compact.includes('叙事历史')],
  ['上次对话前快照 removed', !compact.includes('上次对话前快照')],
  ['engramMemory removed', !compact.includes('engramMemory')],
  ['记忆.短期 removed', !compact.includes('"短期"')],
  ['记忆.中期 removed', !compact.includes('"中期"')],
  ['记忆.长期 removed', !compact.includes('"长期"')],
  ['记忆.隐式中期 removed', !compact.includes('"隐式中期"')],
  ['记忆.语义 KEPT', compact.includes('"语义"')],
  ['私密信息 removed (nsfw off)', !compact.includes('私密信息')],
  ['角色.身体 removed (nsfw off)', !compact.includes('"身体"')],
  ['角色.属性 KEPT', compact.includes('"属性"')],
  ['社交.关系 KEPT', compact.includes('"关系"')],
  ['角色.身份 KEPT', compact.includes('"身份"')],
];

let pass = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${checks.length} checks passed`);

// nsfwMode=true check
const compactNsfw = stringifySnapshotForPrompt(snap, true, 0);
console.log(`\nNSFW on: ${compactNsfw.length.toLocaleString()} chars`);
console.log(`Has 私密信息 (should be TRUE): ${compactNsfw.includes('私密信息')}`);
console.log(`Has 角色.身体 (should be TRUE): ${compactNsfw.includes('"身体"')}`);
console.log(`Has 叙事历史 (should still be FALSE): ${compactNsfw.includes('叙事历史')}`);
