/**
 * namespacedAssetId 单元测试 — Story 6 P1 共享原语
 *
 * 锁定导入图片 id 命名空间化语义（OD-K 防撞库）：前缀化 + 幂等 + 命名空间隔离。
 * 纯函数，无需 IDB（class 的 indexedDB 仅在方法内触达，import 模块本身安全）。
 */
import { describe, it, expect } from 'vitest';
import { namespacedAssetId } from './asset-cache';

describe('namespacedAssetId', () => {
  it('在原 id 前加 "<namespace>::" 前缀', () => {
    expect(namespacedAssetId('profile_7', 'img_abc')).toBe('profile_7::img_abc');
  });

  it('幂等：对已命名空间化（同 namespace）的 id 再调一次是 no-op', () => {
    const once = namespacedAssetId('profile_7', 'img_abc');
    const twice = namespacedAssetId('profile_7', once);
    expect(twice).toBe(once);
    expect(twice).toBe('profile_7::img_abc');
  });

  it('不同 namespace 产生不同结果（防跨导入撞库）', () => {
    expect(namespacedAssetId('p1', 'img_x')).not.toBe(namespacedAssetId('p2', 'img_x'));
  });

  it('不同 namespace 包裹同一已命名 id → 仍叠加（非同 namespace 不视为已命名）', () => {
    const inner = namespacedAssetId('p1', 'img_x'); // p1::img_x
    const outer = namespacedAssetId('p2', inner); // p2::p1::img_x
    expect(outer).toBe('p2::p1::img_x');
  });

  it('原 id 含 "::" 也能正确前缀（前缀语义不依赖原 id 无分隔符）', () => {
    expect(namespacedAssetId('ns', 'a::b')).toBe('ns::a::b');
  });

  it('确定性：相同入参恒等输出（可用于一致重写树内引用）', () => {
    expect(namespacedAssetId('ns', 'img_1')).toBe(namespacedAssetId('ns', 'img_1'));
  });
});
