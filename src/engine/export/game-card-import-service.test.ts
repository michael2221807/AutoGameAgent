/**
 * GameCardImportService — Stage 1 (decode/validate/merge) 单元测试 — Story 6 P2
 *
 * 信封用与导出器完全相同的方式构造（真实 gzipCompress + sha256String over
 * JSON.stringify(bundle)），保证 checksum 往返保真（SC-14）；畸形/篡改路径手搓信封。
 *
 * 覆盖 SC-2(checksum) / SC-3(shape) / SC-5(packId D6) / SC-14(往返) / SC-UI-B(blank 零持久化)
 * / OD-I(版本漂移信号)。实际持久化的 happy path 归 P5。
 */
import { describe, it, expect } from 'vitest';
import { gzipCompress, sha256String } from '../sync/chunked-bundle-packer';
import { CARD_FORMAT_VERSION } from './game-card-bundle.types';
import { decodeAndValidateCard, GameCardImportService } from './game-card-import-service';
import type { GamePack } from '../types/game-pack';

// ─── fixtures ────────────────────────────────────────────────────

const mockPack = {
  manifest: { id: 'tianming', version: '1.0.0' },
  stateSchema: {
    properties: {
      世界: {
        type: 'object',
        properties: {
          天气: { type: 'string', default: '晴' },
          节日: { type: 'string', default: '无' },
        },
      },
      角色: {
        type: 'object',
        properties: {
          属性: {
            type: 'object',
            properties: {
              体质: { type: 'number', default: 5 },
              法力: { type: 'number', default: 50 },
            },
          },
        },
      },
    },
  },
} as unknown as GamePack;

function validBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bundleType: 'card',
    version: 1,
    exportedAt: '2026-06-03T00:00:00.000Z',
    engineVersion: '0.1.0',
    cardMeta: {
      formatVersion: 1,
      cardId: 'card_abc',
      title: '测试卡',
      description: '',
      author: 'tester',
      tags: [],
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
      packId: 'tianming',
      packVersion: '1.0.0',
    },
    protagonist: { mode: 'fixed', data: { 属性: { 体质: 7 } } },
    stateTree: { 世界: { 天气: '雨' }, 角色: { 属性: { 体质: 7 } } },
    engram: { entities: [], knowledgeEdges: [] },
    ...overrides,
  };
}

/** Build a .aga-card blob exactly the way GameCardExportService does. */
async function makeCardBlob(
  bundle: Record<string, unknown>,
  opts: { format?: string; formatVersion?: number; checksum?: string } = {},
): Promise<Blob> {
  const checksum = opts.checksum ?? (await sha256String(JSON.stringify(bundle)));
  const envelope = JSON.stringify({
    format: opts.format ?? 'aga-card',
    formatVersion: opts.formatVersion ?? CARD_FORMAT_VERSION,
    checksum,
    bundle,
  });
  return gzipCompress(envelope);
}

// ─── decode + validate (happy + merge) ───────────────────────────

describe('decodeAndValidateCard — 成功 + 稀疏合并 (U4)', () => {
  it('有效卡通过校验，mergedTree = schema 默认底 深合并 卡 stateTree（缺键保底）', async () => {
    const blob = await makeCardBlob(validBundle());
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // 天气 被卡覆盖为 '雨'；节日 卡里没有 → 保留 schema 默认 '无'
    // 体质 被卡覆盖为 7；法力 卡里没有 → 保留 schema 默认 50
    expect(out.mergedTree).toEqual({
      世界: { 天气: '雨', 节日: '无' },
      角色: { 属性: { 体质: 7, 法力: 50 } },
    });
  });

  it('返回已 null 守卫的 pack 供 Stage 2 使用', async () => {
    const blob = await makeCardBlob(validBundle());
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pack.manifest.id).toBe('tianming');
  });
});

// ─── SC-14 checksum 往返 ─────────────────────────────────────────

describe('decodeAndValidateCard — SC-14 checksum 往返保真', () => {
  it('导出器同款 stringify 重算的校验和匹配 → 通过（不报 checksum-mismatch）', async () => {
    const blob = await makeCardBlob(validBundle());
    const out = await decodeAndValidateCard(blob, mockPack);
    // 若往返计算不一致，这里会是 checksum-mismatch
    expect(out.ok).toBe(true);
  });

  it('整数键 map 也往返保真（V8 键序重排在两端一致）', async () => {
    // stateTree 含整数字符串键的 map —— V8 在 stringify 时把整数键排前，
    // 导出与导入两端确定性一致 → checksum 仍匹配。
    // 注：此断言证明的是「同一 V8 内」往返一致（当前导出/导入都在浏览器 V8）；
    // 跨引擎（未来服务端生成卡）需 canonical 序列化，超出本期范围。
    const bundle = validBundle({
      stateTree: { 关系: { '2': { v: 'b' }, '0': { v: 'a' }, '10': { v: 'c' } }, 世界: { 天气: '阴' } },
    });
    const blob = await makeCardBlob(bundle);
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(true);
  });

  it('SC-2 篡改/损坏 → checksum-mismatch', async () => {
    const blob = await makeCardBlob(validBundle(), { checksum: 'deadbeefdeadbeef' });
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'checksum-mismatch' });
  });

  it('SC-2 bundle 内容被改但 checksum 未更新 → checksum-mismatch', async () => {
    // 用原始 bundle 的 checksum，但实际塞入被改过的 bundle
    const original = validBundle();
    const staleChecksum = await sha256String(JSON.stringify(original));
    const tampered = validBundle({ cardMeta: { ...(original.cardMeta as object), title: '被篡改' } });
    const blob = await makeCardBlob(tampered, { checksum: staleChecksum });
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'checksum-mismatch' });
  });
});

// ─── 信封解码失败 (U1) ───────────────────────────────────────────

describe('decodeAndValidateCard — 解码/格式失败 (U1)', () => {
  it('非 gzip blob → decode-failed', async () => {
    const blob = new Blob(['this is not gzip']);
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'decode-failed' });
  });

  it('gzip 内是非法 JSON → decode-failed', async () => {
    const blob = await gzipCompress('not valid json {{{');
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'decode-failed' });
  });

  it('format !== aga-card → bad-format', async () => {
    const blob = await makeCardBlob(validBundle(), { format: 'not-aga-card' });
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'bad-format' });
  });

  it('formatVersion 高于支持上限 → bad-format', async () => {
    const blob = await makeCardBlob(validBundle(), { formatVersion: CARD_FORMAT_VERSION + 99 });
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'bad-format' });
  });

  it('formatVersion < 1 或非整数 → bad-format', async () => {
    const zero = await decodeAndValidateCard(await makeCardBlob(validBundle(), { formatVersion: 0 }), mockPack);
    expect(zero).toMatchObject({ ok: false, code: 'bad-format' });
    const frac = await decodeAndValidateCard(await makeCardBlob(validBundle(), { formatVersion: 0.5 }), mockPack);
    expect(frac).toMatchObject({ ok: false, code: 'bad-format' });
  });

  it('envelope 顶层非对象（gzip 内是裸数组）→ bad-format', async () => {
    const blob = await gzipCompress(JSON.stringify([1, 2, 3]));
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'bad-format' });
  });

  it('envelope 顶层是裸字符串/数字（JSON 基本类型）→ bad-format', async () => {
    const str = await decodeAndValidateCard(await gzipCompress(JSON.stringify('hello')), mockPack);
    expect(str).toMatchObject({ ok: false, code: 'bad-format' });
    const num = await decodeAndValidateCard(await gzipCompress(JSON.stringify(42)), mockPack);
    expect(num).toMatchObject({ ok: false, code: 'bad-format' });
  });
});

// ─── SC-3 结构校验 ───────────────────────────────────────────────

describe('decodeAndValidateCard — SC-3 结构校验', () => {
  it('bundle 缺 bundleType（checksum 自洽但 shape 失败）→ invalid-shape', async () => {
    const malformed = validBundle();
    delete (malformed as Record<string, unknown>).bundleType;
    const blob = await makeCardBlob(malformed); // checksum 覆盖 malformed → 过 checksum 到 shape
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'invalid-shape' });
  });

  it('engram.entities 非数组 → invalid-shape', async () => {
    const malformed = validBundle({ engram: { entities: 'nope', knowledgeEdges: [] } });
    const blob = await makeCardBlob(malformed);
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'invalid-shape' });
  });

  it('bundle 缺失或 checksum 非字符串 → invalid-shape', async () => {
    // 手搓一个 bundle 不是对象的信封
    const envelope = JSON.stringify({ format: 'aga-card', formatVersion: 1, checksum: 'x', bundle: 42 });
    const blob = await gzipCompress(envelope);
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'invalid-shape' });
  });
});

// ─── SC-5 D6 packId 闸门 (U2) ────────────────────────────────────

describe('decodeAndValidateCard — SC-5 D6 packId 严绑 (U2)', () => {
  it('无 pack 加载 → no-pack', async () => {
    const blob = await makeCardBlob(validBundle());
    const out = await decodeAndValidateCard(blob, null);
    expect(out).toMatchObject({ ok: false, code: 'no-pack' });
  });

  it('packId 不匹配装机包 → pack-mismatch', async () => {
    const blob = await makeCardBlob(
      validBundle({ cardMeta: { ...(validBundle().cardMeta as object), packId: 'wasteland' } }),
    );
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'pack-mismatch' });
  });
});

// ─── U12 blank 拒绝 (SC-UI-B 零持久化) ───────────────────────────

describe('decodeAndValidateCard — U12 blank 拒绝', () => {
  it('blank 主角模式 → blank-unsupported（纯函数本就零写）', async () => {
    const blob = await makeCardBlob(validBundle({ protagonist: { mode: 'blank' } }));
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out).toMatchObject({ ok: false, code: 'blank-unsupported' });
  });
});

// ─── OD-I 版本漂移信号 (U3) ──────────────────────────────────────

describe('decodeAndValidateCard — OD-I/U3 版本漂移', () => {
  it('卡版本 = 装机版 → 无漂移信号', async () => {
    const blob = await makeCardBlob(validBundle()); // packVersion '1.0.0' == installed
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packVersionDrift).toBeUndefined();
  });

  it('卡版本更新 → 漂移 comparison=1（UI 据此弹琥珀 banner）', async () => {
    const blob = await makeCardBlob(
      validBundle({ cardMeta: { ...(validBundle().cardMeta as object), packVersion: '2.0.0' } }),
    );
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packVersionDrift).toEqual({ cardVersion: '2.0.0', installedVersion: '1.0.0', comparison: 1 });
  });

  it('卡版本更旧 → 漂移 comparison=-1（迁移交 on-load）', async () => {
    const blob = await makeCardBlob(
      validBundle({ cardMeta: { ...(validBundle().cardMeta as object), packVersion: '0.9.0' } }),
    );
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packVersionDrift?.comparison).toBe(-1);
  });

  it('卡版本缺失 → 视为更旧（comparison=-1, cardVersion=""）', async () => {
    const base = validBundle();
    const meta = { ...(base.cardMeta as Record<string, unknown>) };
    delete meta.packVersion;
    const blob = await makeCardBlob(validBundle({ cardMeta: meta }));
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.packVersionDrift).toEqual({ cardVersion: '', installedVersion: '1.0.0', comparison: -1 });
  });
});

// ─── TOTAL 契约：恶意 packVersion 不抛（FIX#5） ───────────────────

describe('decodeAndValidateCard — packVersion 非字符串不抛（TOTAL 契约）', () => {
  it('cardMeta.packVersion = 123（数字）→ 返回 code 不抛', async () => {
    const meta = { ...(validBundle().cardMeta as Record<string, unknown>), packVersion: 123 };
    const blob = await makeCardBlob(validBundle({ cardMeta: meta }));
    // 不应抛 TypeError；shape 守卫先拦 → invalid-shape
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('invalid-shape');
  });

  it('cardMeta.packVersion = []（数组）→ 返回 code 不抛', async () => {
    const meta = { ...(validBundle().cardMeta as Record<string, unknown>), packVersion: [] };
    const blob = await makeCardBlob(validBundle({ cardMeta: meta }));
    const out = await decodeAndValidateCard(blob, mockPack);
    expect(out.ok).toBe(false);
  });
});

// ─── importCard 编排（Stage 1 → Stage 2 交接） ──────────────────

describe('GameCardImportService.importCard — Stage 1/2 编排', () => {
  const optsFixed = { optInGlobals: new Set<never>(), enableNsfw: false };

  it('校验失败 → importCard 原样回传失败 code（零持久化）', async () => {
    const svc = new GameCardImportService(() => mockPack);
    const blob = await makeCardBlob(validBundle({ protagonist: { mode: 'blank' } }));
    const res = await svc.importCard(blob, optsFixed);
    expect(res).toMatchObject({ ok: false, code: 'blank-unsupported' });
  });

  it('无 pack → no-pack', async () => {
    const svc = new GameCardImportService(() => null);
    const blob = await makeCardBlob(validBundle());
    const res = await svc.importCard(blob, optsFixed);
    expect(res).toMatchObject({ ok: false, code: 'no-pack' });
  });

  it('有效卡 → Stage 1 通过并交接 Stage 2（无 deps 构造 → write-failed，证明 Stage 1 全过）', async () => {
    // Stage 1 全过（否则会是 checksum/shape/pack 等 code），控制权交到 assembleAndPersist；
    // 此处故意不注入 deps → Stage 2 报 write-failed。完整 happy path 在 P5 测试覆盖。
    const svc = new GameCardImportService(() => mockPack);
    const blob = await makeCardBlob(validBundle());
    const res = await svc.importCard(blob, optsFixed);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('write-failed');
    expect(res.detail).toContain('dependencies not wired');
  });
});
