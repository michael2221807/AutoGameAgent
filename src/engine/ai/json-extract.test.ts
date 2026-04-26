import { describe, it, expect } from 'vitest';
import { stripMarkdownFences, findBalancedJsonBlocks, extractJsonObjectByKey } from '@/engine/ai/json-extract';

describe('stripMarkdownFences', () => {
  it('strips ```json fence', () => {
    expect(stripMarkdownFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips bare ``` fence', () => {
    expect(stripMarkdownFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips ```javascript fence', () => {
    expect(stripMarkdownFences('```javascript\nvar x = 1;\n```')).toBe('var x = 1;');
  });

  it('returns text as-is without fences', () => {
    expect(stripMarkdownFences('just text')).toBe('just text');
  });

  it('strips multiple fences', () => {
    const input = '```json\n{"a":1}\n```\ntext\n```json\n{"b":2}\n```';
    const result = stripMarkdownFences(input);
    expect(result).toContain('{"a":1}');
    expect(result).toContain('{"b":2}');
    expect(result).not.toContain('```');
  });
});

describe('findBalancedJsonBlocks', () => {
  it('finds single flat object', () => {
    expect(findBalancedJsonBlocks('{"a":1}')).toEqual(['{"a":1}']);
  });

  it('finds nested object', () => {
    const blocks = findBalancedJsonBlocks('{"a":{"b":1}}');
    expect(blocks).toEqual(['{"a":{"b":1}}']);
  });

  it('finds multiple top-level objects', () => {
    const blocks = findBalancedJsonBlocks('{"a":1} some text {"b":2}');
    expect(blocks).toHaveLength(2);
    expect(JSON.parse(blocks[0])).toEqual({ a: 1 });
    expect(JSON.parse(blocks[1])).toEqual({ b: 2 });
  });

  it('handles strings containing braces', () => {
    const blocks = findBalancedJsonBlocks('{"a": "x{y}z"}');
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0])).toEqual({ a: 'x{y}z' });
  });

  it('handles escaped quotes in strings', () => {
    const input = '{"a": "he said \\"hi\\""}';
    const blocks = findBalancedJsonBlocks(input);
    expect(blocks).toHaveLength(1);
  });

  it('skips unclosed braces', () => {
    const blocks = findBalancedJsonBlocks('{"a": 1');
    expect(blocks).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(findBalancedJsonBlocks('')).toEqual([]);
  });

  it('finds blocks among prose', () => {
    const blocks = findBalancedJsonBlocks('Here is: {"x":1} and also: {"y":2}');
    expect(blocks).toHaveLength(2);
  });

  it('handles deeply nested (5 levels)', () => {
    const deep = '{"a":{"b":{"c":{"d":{"e":1}}}}}';
    const blocks = findBalancedJsonBlocks(deep);
    expect(blocks).toEqual([deep]);
    expect(JSON.parse(blocks[0]).a.b.c.d.e).toBe(1);
  });
});

describe('extractJsonObjectByKey', () => {
  it('finds key at top level', () => {
    const result = extractJsonObjectByKey('{"refined": [1,2]}', 'refined');
    expect(result).toEqual({ refined: [1, 2] });
  });

  it('finds key in nested object', () => {
    const input = '{"semantic_memory": {"long_term_memories": [{"a":1}]}}';
    const result = extractJsonObjectByKey(input, 'long_term_memories');
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)['semantic_memory']).toBeDefined();
  });

  it('skips first block if key not found, returns second', () => {
    const input = '{"foo": 1} {"refined": [1]}';
    const result = extractJsonObjectByKey(input, 'refined');
    expect(result).toEqual({ refined: [1] });
  });

  it('skips invalid JSON blocks', () => {
    const input = '{invalid json} {"refined": []}';
    const result = extractJsonObjectByKey(input, 'refined');
    expect(result).toEqual({ refined: [] });
  });

  it('strips markdown fences before scanning', () => {
    const input = '```json\n{"refined": [1,2,3]}\n```';
    const result = extractJsonObjectByKey(input, 'refined');
    expect(result).toEqual({ refined: [1, 2, 3] });
  });

  it('returns null when key not found', () => {
    expect(extractJsonObjectByKey('{"a":1}', 'missing')).toBeNull();
  });

  it('returns null for empty response', () => {
    expect(extractJsonObjectByKey('', 'key')).toBeNull();
  });

  it('handles real-world AI response with thinking + fenced JSON', () => {
    const input = `
<think>Let me analyze this...</think>

Here is the result:

\`\`\`json
{
  "semantic_memory": {
    "long_term_memories": [
      {"category": "世界观", "content": "测试内容"}
    ]
  }
}
\`\`\`

That completes the analysis.
    `;
    const result = extractJsonObjectByKey(input, 'long_term_memories');
    expect(result).not.toBeNull();
  });

  // 2026-04-19: same \你 stutter bug as ResponseParser — sub-pipelines
  // (mid-term-refine / memory-summary / long-term-compact / field-repair)
  // all route through extractJsonObjectByKey. Without the sanitizer, one
  // stutter in a memory field would silently return null and skip the repair.
  it('recovers when a string field has stray \\CJK escape', () => {
    const input = '```json\n{"refined":"故事\\n\\你站起身","count":1}\n```';
    const result = extractJsonObjectByKey(input, 'refined');
    expect(result).not.toBeNull();
    expect(result!.refined).toBe('故事\n你站起身');
  });
});
