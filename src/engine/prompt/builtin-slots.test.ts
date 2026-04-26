/**
 * Built-in slot discoverability tests (P2 env-tags port, 2026-04-19).
 *
 * Mirrors the plan's requirement "builtin-slots.test.ts — new slot discoverable".
 * Keeps the scope tiny: only anchor the slots that downstream features
 * (env-tags P2+) rely on. Existing slots already have implicit coverage via
 * their consumers.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_SLOTS } from '@/engine/prompt/builtin-slots';

describe('BUILTIN_SLOTS — environment_block (env-tags P2)', () => {
  it('has an environment_block slot registered', () => {
    expect(BUILTIN_SLOTS.environment_block).toBeDefined();
  });

  it('has a sensible title and category', () => {
    const slot = BUILTIN_SLOTS.environment_block;
    expect(slot.id).toBe('environment_block');
    expect(slot.title).toMatch(/环境/);
    expect(slot.category).toBe('主剧情');
  });

  it('has no defaultPromptId — block is runtime-computed', () => {
    // The env block is built by `src/engine/prompt/environment-block.ts`,
    // not loaded from a pack prompt file. A `defaultPromptId` would be
    // misleading. When a file-level template is added later this should
    // flip to the filename.
    expect(BUILTIN_SLOTS.environment_block.defaultPromptId).toBeUndefined();
  });

  it('slot id is stable (string key matches id field)', () => {
    for (const [key, slot] of Object.entries(BUILTIN_SLOTS)) {
      expect(slot.id).toBe(key);
    }
  });
});
