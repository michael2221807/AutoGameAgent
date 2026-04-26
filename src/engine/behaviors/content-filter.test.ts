import { describe, it, expect } from 'vitest';
import { ContentFilterModule } from '@/engine/behaviors/content-filter';
import { createMockStateManager } from '@/engine/__test-utils__';
import type { ContentFilterConfig } from '@/engine/types';

const config: ContentFilterConfig = {
  contentRatings: {
    nsfw: {
      settingPath: '系统.nsfwMode',
      promptStripTags: ['NSFW', 'R18'],
      conditionalSchemaFields: [],
    },
  },
};

describe('ContentFilterModule', () => {
  it('has correct module id', () => {
    const mod = new ContentFilterModule(config);
    expect(mod.id).toBe('content-filter');
  });

  it('strips tags when rating is disabled', () => {
    const { sm } = createMockStateManager({ 系统: { nsfwMode: false } });
    const mod = new ContentFilterModule(config);
    const vars: Record<string, string> = { TEXT: '[NSFW]secret content[/NSFW] normal text' };
    mod.onContextAssembly(sm as never, vars);
    expect(vars['TEXT']).not.toContain('secret content');
    expect(vars['TEXT']).toContain('normal text');
  });

  it('keeps tags when rating is enabled', () => {
    const { sm } = createMockStateManager({ 系统: { nsfwMode: true } });
    const mod = new ContentFilterModule(config);
    const vars: Record<string, string> = { TEXT: '[NSFW]visible[/NSFW] text' };
    mod.onContextAssembly(sm as never, vars);
    expect(vars['TEXT']).toContain('visible');
  });

  it('handles empty contentRatings', () => {
    const mod = new ContentFilterModule({ contentRatings: {} });
    const { sm } = createMockStateManager({});
    const vars: Record<string, string> = { TEXT: 'unchanged' };
    mod.onContextAssembly(sm as never, vars);
    expect(vars['TEXT']).toBe('unchanged');
  });

  it('strips R18 tag (second tag in config)', () => {
    const { sm } = createMockStateManager({ 系统: { nsfwMode: false } });
    const mod = new ContentFilterModule(config);
    const vars: Record<string, string> = { TEXT: '[R18]mature content[/R18] safe text' };
    mod.onContextAssembly(sm as never, vars);
    expect(vars['TEXT']).not.toContain('mature content');
    expect(vars['TEXT']).toContain('safe text');
  });

  it('strips multiple occurrences of same tag', () => {
    const { sm } = createMockStateManager({ 系统: { nsfwMode: false } });
    const mod = new ContentFilterModule(config);
    const vars: Record<string, string> = { TEXT: '[NSFW]A[/NSFW] middle [NSFW]B[/NSFW] end' };
    mod.onContextAssembly(sm as never, vars);
    expect(vars['TEXT']).not.toContain('A');
    expect(vars['TEXT']).not.toContain('B');
    expect(vars['TEXT']).toContain('middle');
    expect(vars['TEXT']).toContain('end');
  });

  it('strips across multiple variable keys', () => {
    const { sm } = createMockStateManager({ 系统: { nsfwMode: false } });
    const mod = new ContentFilterModule(config);
    const vars: Record<string, string> = {
      VAR1: '[NSFW]hidden1[/NSFW] visible1',
      VAR2: '[NSFW]hidden2[/NSFW] visible2',
    };
    mod.onContextAssembly(sm as never, vars);
    expect(vars['VAR1']).not.toContain('hidden1');
    expect(vars['VAR2']).not.toContain('hidden2');
  });
});
