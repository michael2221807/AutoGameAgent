/**
 * 启动时 Game Pack 引用 — 供 router 等非组件代码判断包是否已加载
 * （inject 仅在组件树内可用）
 */
import type { GamePack } from './types';

let activePack: GamePack | null = null;

export function setBootstrapGamePack(pack: GamePack | null): void {
  activePack = pack;
}

export function getBootstrapGamePack(): GamePack | null {
  return activePack;
}
