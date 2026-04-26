/**
 * ResponseRepairStage tests (2026-04-19).
 *
 * Covers:
 *   - No-op when parseOk=true
 *   - No-op when rawResponse is empty
 *   - Narrative rescue from <正文>...</正文> when present
 *   - Structure rescue via AI call (commands/memory/options restored)
 *   - Graceful degradation when both rescue paths fail
 *   - extractNarrativeFromWrapper correctness
 */
import { describe, it, expect, vi } from 'vitest';
import { ResponseRepairStage, extractNarrativeFromWrapper } from './response-repair';
import { ResponseParser } from '../../ai/response-parser';
import type { PipelineContext } from '../types';
import type { AIResponse } from '../../ai/types';

function makeAIService(rawResponse = '{"text":"","commands":[],"action_options":[]}') {
  return {
    generate: vi.fn(async () => rawResponse),
    getConfigForUsage: vi.fn(() => ({ model: 'test-repair-model' })),
  };
}

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    userInput: '',
    actionQueuePrompt: '',
    stateSnapshot: {},
    chatHistory: [],
    messages: [],
    generationId: 'test-gen',
    roundNumber: 5,
    worldEventTriggered: false,
    meta: {},
    ...overrides,
  };
}

describe('extractNarrativeFromWrapper', () => {
  it('returns null on empty / non-string', () => {
    expect(extractNarrativeFromWrapper('')).toBeNull();
    expect(extractNarrativeFromWrapper(null as unknown as string)).toBeNull();
  });

  it('extracts content between last <正文>...</正文>', () => {
    const raw = '<thinking>...</thinking>\n<正文>\n深沉的夜色。\n</正文>\n{"text":"..."}';
    expect(extractNarrativeFromWrapper(raw)).toBe('深沉的夜色。');
  });

  it('returns null when no <正文> tag present', () => {
    const raw = '{"text":"just json"}';
    expect(extractNarrativeFromWrapper(raw)).toBeNull();
  });

  it('returns null for empty <正文></正文>', () => {
    expect(extractNarrativeFromWrapper('<正文></正文>')).toBeNull();
  });

  it('handles unclosed <正文> by taking until end', () => {
    const raw = '<正文>未闭合的正文';
    expect(extractNarrativeFromWrapper(raw)).toBe('未闭合的正文');
  });

  it('skips <正文> literals inside thinking block and uses the last real one', () => {
    const raw =
      '<thinking>输出格式是 <正文>...</正文></thinking>\n' +
      '<正文>真正的叙事。</正文>';
    expect(extractNarrativeFromWrapper(raw)).toBe('真正的叙事。');
  });
});

describe('ResponseRepairStage', () => {
  const parser = new ResponseParser();

  it('no-op when parseOk=true', async () => {
    const ai = makeAIService();
    const stage = new ResponseRepairStage(ai as never, parser);
    const ctx = makeCtx({
      rawResponse: '{"text":"ok","commands":[]}',
      parsedResponse: { text: 'ok', commands: [], parseOk: true } as AIResponse,
    });
    const result = await stage.execute(ctx);
    expect(result).toBe(ctx);
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('no-op when rawResponse is empty', async () => {
    const ai = makeAIService();
    const stage = new ResponseRepairStage(ai as never, parser);
    const ctx = makeCtx({
      rawResponse: '',
      parsedResponse: { text: '', parseOk: false } as AIResponse,
    });
    const result = await stage.execute(ctx);
    expect(result).toBe(ctx);
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('narrative rescue: extracts <正文> content even when AI repair fails', async () => {
    const ai = makeAIService('not json at all'); // repair AI returns garbage
    const stage = new ResponseRepairStage(ai as never, parser);
    const raw =
      '<thinking>analysis</thinking>\n' +
      '<正文>\n真实的叙事内容。\n</正文>\n' +
      '{"text":"broken \\你 json"'; // unclosed brace beyond sanitizer reach
    const ctx = makeCtx({
      rawResponse: raw,
      parsedResponse: { text: raw, parseOk: false } as AIResponse,
    });
    const result = await stage.execute(ctx);
    expect(result.parsedResponse?.text).toBe('真实的叙事内容。');
    expect(result.meta.responseRepairApplied).toBe(true);
    expect(result.meta.responseRepairNarrativeRescued).toBe(true);
    expect(result.meta.responseRepairStructureRescued).toBe(false);
  });

  it('structure rescue: AI call recovers commands and options', async () => {
    const repairResponse = JSON.stringify({
      text: '清理后的叙事',
      commands: [{ action: 'add', path: '世界.时间.分钟', value: 30 }],
      action_options: ['选项一', '选项二'],
      mid_term_memory: null,
    });
    const ai = makeAIService(repairResponse);
    const stage = new ResponseRepairStage(ai as never, parser);
    const raw = '<正文>清理后的叙事</正文>\n{broken json';
    const ctx = makeCtx({
      rawResponse: raw,
      parsedResponse: { text: raw, parseOk: false } as AIResponse,
    });
    const result = await stage.execute(ctx);
    expect(result.parsedResponse?.parseOk).toBe(true);
    expect(result.parsedResponse?.commands).toHaveLength(1);
    expect(result.parsedResponse?.commands?.[0].key).toBe('世界.时间.分钟');
    expect(result.parsedResponse?.actionOptions).toEqual(['选项一', '选项二']);
    expect(result.meta.responseRepairStructureRescued).toBe(true);
    expect(ai.generate).toHaveBeenCalledTimes(1);
  });

  it('degrades gracefully when both rescue paths fail', async () => {
    const ai = makeAIService('nothing parseable');
    const stage = new ResponseRepairStage(ai as never, parser);
    const raw = '完全畸形的 raw 输出，没有任何结构标签也没有合法 json';
    const originalParsed: AIResponse = { text: raw, parseOk: false };
    const ctx = makeCtx({
      rawResponse: raw,
      parsedResponse: originalParsed,
    });
    const result = await stage.execute(ctx);
    // No rescue → ctx returned unchanged
    expect(result).toBe(ctx);
    expect(result.parsedResponse).toBe(originalParsed);
  });

  it('uses repaired text when <正文> missing but AI gave clean text', async () => {
    const repairResponse = JSON.stringify({
      text: '从 AI 救援得到的叙事',
      commands: [],
      action_options: ['选项'],
    });
    const ai = makeAIService(repairResponse);
    const stage = new ResponseRepairStage(ai as never, parser);
    const raw = '{broken no正文 tag';
    const ctx = makeCtx({
      rawResponse: raw,
      parsedResponse: { text: raw, parseOk: false } as AIResponse,
    });
    const result = await stage.execute(ctx);
    expect(result.parsedResponse?.text).toBe('从 AI 救援得到的叙事');
    expect(result.parsedResponse?.parseOk).toBe(true);
  });

  it('does not crash when AI service throws', async () => {
    const ai = {
      generate: vi.fn().mockRejectedValue(new Error('network error')),
      getConfigForUsage: vi.fn(),
    };
    const stage = new ResponseRepairStage(ai as never, parser);
    const raw = '<正文>backup 叙事</正文>\n{broken';
    const ctx = makeCtx({
      rawResponse: raw,
      parsedResponse: { text: raw, parseOk: false } as AIResponse,
    });
    const result = await stage.execute(ctx);
    // Narrative rescue still happened even though AI failed
    expect(result.parsedResponse?.text).toBe('backup 叙事');
    expect(result.meta.responseRepairStructureRescued).toBe(false);
  });
});
