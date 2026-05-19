/**
 * Flow prompt split tests — verify that splitting single-file prompts into
 * system (instructions) + user (task data) preserves all content and
 * eliminates the "请根据以上设定开始" placeholder.
 *
 * Test strategy:
 * 1. Register mock prompts simulating system + user split
 * 2. Assemble with flow config containing both modules
 * 3. Assert: no placeholder, correct roles, content preserved
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PromptAssembler } from '@/engine/prompt/prompt-assembler';
import { TemplateEngine } from '@/engine/prompt/template-engine';
import { createMockPromptRegistry } from '@/engine/__test-utils__';
import type { PromptFlowConfig } from '@/engine/types';
import type { AIMessage } from '@/engine/ai/types';

const PROMPTS_DIR = resolve(__dirname, '../../../public/packs/tianming/prompts');

function readPrompt(name: string): string {
  return readFileSync(resolve(PROMPTS_DIR, `${name}.md`), 'utf-8');
}

const PLACEHOLDER_TEXT = '请根据以上设定开始。';

function hasPlaceholder(messages: AIMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && m.content === PLACEHOLDER_TEXT);
}


describe('flow prompt split — no placeholder after split', () => {
  const template = new TemplateEngine();

  // ── midTermRefine ──

  describe('midTermRefine', () => {
    it('split into system + user eliminates placeholder', () => {
      const system = readPrompt('midTermRefine');
      const user = readPrompt('midTermRefineInput');
      const registry = createMockPromptRegistry([
        { id: 'midTermRefine', content: system },
        { id: 'midTermRefineInput', content: user },
      ]);
      const assembler = new PromptAssembler(registry as never, template);
      const flow: PromptFlowConfig = {
        id: 'midTermRefine',
        modules: [
          { promptId: 'midTermRefine', role: 'system', order: 0, depth: 0 },
          { promptId: 'midTermRefineInput', role: 'user', order: 1, depth: 0 },
        ],
      };
      const vars = { ENTRY_COUNT: '25', MID_TERM_TO_REFINE: '[mock entries]' };
      const result = assembler.assemble(flow, vars);

      expect(hasPlaceholder(result.messages)).toBe(false);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('[mock entries]');
    });

    it('no content lost — every original line exists in system or user file', () => {
      const system = readPrompt('midTermRefine');
      const user = readPrompt('midTermRefineInput');
      const original = readFileSync(
        resolve(PROMPTS_DIR, '../prompt-history/midTermRefine.original.md'),
        'utf-8',
      );
      const combined = system + '\n' + user;
      const originalLines = original.split('\n').map((l) => l.trim()).filter(Boolean);
      const combinedLines = new Set(combined.split('\n').map((l) => l.trim()).filter(Boolean));

      const missing = originalLines.filter((line) => !combinedLines.has(line));
      expect(missing).toEqual([]);
    });
  });

  // ── memorySummary ──

  describe('memorySummary', () => {
    it('split into system + user eliminates placeholder', () => {
      const system = readPrompt('memorySummary');
      const user = readPrompt('memorySummaryInput');
      const registry = createMockPromptRegistry([
        { id: 'memorySummary', content: system },
        { id: 'memorySummaryInput', content: user },
      ]);
      const assembler = new PromptAssembler(registry as never, template);
      const flow: PromptFlowConfig = {
        id: 'memorySummary',
        modules: [
          { promptId: 'memorySummary', role: 'system', order: 0, depth: 0 },
          { promptId: 'memorySummaryInput', role: 'user', order: 1, depth: 0 },
        ],
      };
      const vars = {
        ENTRY_COUNT: '10',
        MID_TERM_TO_REFINE: '[entries]',
        EXISTING_LONG_TERM: '[existing]',
        GAME_STATE_SUMMARY: '[state]',
      };
      const result = assembler.assemble(flow, vars);

      expect(hasPlaceholder(result.messages)).toBe(false);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
    });

    it('no content lost', () => {
      const system = readPrompt('memorySummary');
      const user = readPrompt('memorySummaryInput');
      const original = readFileSync(
        resolve(PROMPTS_DIR, '../prompt-history/memorySummary.original.md'),
        'utf-8',
      );
      const combined = system + '\n' + user;
      const originalLines = original.split('\n').map((l) => l.trim()).filter(Boolean);
      const combinedLines = new Set(combined.split('\n').map((l) => l.trim()).filter(Boolean));
      const missing = originalLines.filter((line) => !combinedLines.has(line));
      expect(missing).toEqual([]);
    });
  });

  // ── longTermCompact ──

  describe('longTermCompact', () => {
    it('split into system + user eliminates placeholder', () => {
      const system = readPrompt('longTermCompact');
      const user = readPrompt('longTermCompactInput');
      const registry = createMockPromptRegistry([
        { id: 'longTermCompact', content: system },
        { id: 'longTermCompactInput', content: user },
      ]);
      const assembler = new PromptAssembler(registry as never, template);
      const flow: PromptFlowConfig = {
        id: 'longTermCompact',
        modules: [
          { promptId: 'longTermCompact', role: 'system', order: 0, depth: 0 },
          { promptId: 'longTermCompactInput', role: 'user', order: 1, depth: 0 },
        ],
      };
      const vars = {
        ENTRY_COUNT: '5',
        LONG_TERM_TO_COMPACT: '[entries]',
        LONG_TERM_KEPT: '[kept]',
      };
      const result = assembler.assemble(flow, vars);

      expect(hasPlaceholder(result.messages)).toBe(false);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
    });

    it('no content lost', () => {
      const system = readPrompt('longTermCompact');
      const user = readPrompt('longTermCompactInput');
      const original = readFileSync(
        resolve(PROMPTS_DIR, '../prompt-history/longTermCompact.original.md'),
        'utf-8',
      );
      const combined = system + '\n' + user;
      const originalLines = original.split('\n').map((l) => l.trim()).filter(Boolean);
      const combinedLines = new Set(combined.split('\n').map((l) => l.trim()).filter(Boolean));
      const missing = originalLines.filter((line) => !combinedLines.has(line));
      expect(missing).toEqual([]);
    });
  });

  // ── worldHeartbeat ──

  describe('worldHeartbeat', () => {
    it('split into system + user eliminates placeholder', () => {
      const system = readPrompt('worldHeartbeat');
      const user = readPrompt('worldHeartbeatInput');
      const registry = createMockPromptRegistry([
        { id: 'worldHeartbeat', content: system },
        { id: 'worldHeartbeatInput', content: user },
      ]);
      const assembler = new PromptAssembler(registry as never, template);
      const flow: PromptFlowConfig = {
        id: 'worldHeartbeat',
        modules: [
          { promptId: 'worldHeartbeat', role: 'system', order: 0, depth: 0 },
          { promptId: 'worldHeartbeatInput', role: 'user', order: 1, depth: 0 },
        ],
      };
      const vars = {
        NPC_BLOCKS: '[npc data]',
        CONTEXT_BLOCK: '[context]',
        ENVIRONMENT_BLOCK: '[env]',
      };
      const result = assembler.assemble(flow, vars);

      expect(hasPlaceholder(result.messages)).toBe(false);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('[npc data]');
    });
  });

  // ── privacyRepair ──

  describe('privacyRepair', () => {
    it('privacyRepairInput renders task data for pipeline user message', () => {
      const input = readPrompt('privacyRepairInput');
      const registry = createMockPromptRegistry([
        { id: 'privacyRepairInput', content: input },
      ]);
      const assembler = new PromptAssembler(registry as never, template);
      const rendered = assembler.renderSingle('privacyRepairInput', {
        ATTEMPT_NUMBER: '2',
        GENDER_FILTER: '全部性别',
        NPC_COUNT: '3',
        NPC_LIST: '[npc data]',
      });

      expect(rendered).toContain('第 **2** 次尝试');
      expect(rendered).toContain('**全部性别**');
      expect(rendered).toContain('[npc data]');
    });
  });

  // ── worldGen (worldGeneration flow) ──

  describe('worldGeneration', () => {
    it('worldGen as user role eliminates placeholder', () => {
      const narrator = readPrompt('narratorFrame');
      const worldGen = readPrompt('worldGen');
      const registry = createMockPromptRegistry([
        { id: 'narratorFrame', content: narrator },
        { id: 'worldGen', content: worldGen },
      ]);
      const assembler = new PromptAssembler(registry as never, template);
      const flow: PromptFlowConfig = {
        id: 'worldGeneration',
        modules: [
          { promptId: 'narratorFrame', role: 'system', order: -1, depth: 0 },
          { promptId: 'worldGen', role: 'user', order: 0, depth: 0 },
        ],
      };
      const vars = { CREATION_CHOICES: '{"world": "仙侠"}' };
      const result = assembler.assemble(flow, vars);

      expect(hasPlaceholder(result.messages)).toBe(false);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('{"world": "仙侠"}');
    });
  });

  // ── openingScene ──

  describe('openingScene', () => {
    it('opening as user role eliminates placeholder', () => {
      const narrator = readPrompt('narratorFrame');
      const opening = readPrompt('opening');
      const registry = createMockPromptRegistry([
        { id: 'narratorFrame', content: narrator },
        { id: 'opening', content: opening },
      ]);
      const assembler = new PromptAssembler(registry as never, template);
      const flow: PromptFlowConfig = {
        id: 'openingScene',
        modules: [
          { promptId: 'narratorFrame', role: 'system', order: -1, depth: 0 },
          { promptId: 'opening', role: 'user', order: 0, depth: 0 },
        ],
      };
      const result = assembler.assemble(flow, {});

      expect(hasPlaceholder(result.messages)).toBe(false);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
    });
  });

  // ── openingSceneStep1 ──

  describe('openingSceneStep1', () => {
    it('opening as user role eliminates placeholder', () => {
      const narrator = readPrompt('narratorFrame');
      const opening = readPrompt('opening');
      const step1 = readPrompt('splitGenStep1');
      const registry = createMockPromptRegistry([
        { id: 'narratorFrame', content: narrator },
        { id: 'opening', content: opening },
        { id: 'splitGenStep1', content: step1 },
      ]);
      const assembler = new PromptAssembler(registry as never, template);
      const flow: PromptFlowConfig = {
        id: 'openingSceneStep1',
        modules: [
          { promptId: 'narratorFrame', role: 'system', order: -1, depth: 0 },
          { promptId: 'opening', role: 'user', order: 0, depth: 0 },
          { promptId: 'splitGenStep1', role: 'system', order: 1, depth: 0 },
        ],
      };
      const result = assembler.assemble(flow, {});

      expect(hasPlaceholder(result.messages)).toBe(false);
      expect(result.messages.some((m) => m.role === 'user')).toBe(true);
    });
  });
});
