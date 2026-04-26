import { describe, it, expect } from 'vitest';
import { TemplateEngine } from '@/engine/prompt/template-engine';

describe('TemplateEngine', () => {
  const engine = new TemplateEngine();

  it('replaces a single variable', () => {
    expect(engine.render('Hello {{NAME}}!', { NAME: 'Alice' })).toBe('Hello Alice!');
  });

  it('replaces multiple variables', () => {
    const result = engine.render('{{A}} and {{B}} and {{C}}', { A: '1', B: '2', C: '3' });
    expect(result).toBe('1 and 2 and 3');
  });

  it('preserves unknown variables', () => {
    expect(engine.render('{{KNOWN}} {{UNKNOWN}}', { KNOWN: 'yes' })).toBe('yes {{UNKNOWN}}');
  });

  it('replaces with empty string', () => {
    expect(engine.render('before{{VAR}}after', { VAR: '' })).toBe('beforeafter');
  });

  it('returns plain text unchanged', () => {
    expect(engine.render('no placeholders here', {})).toBe('no placeholders here');
  });

  it('returns empty string for empty template', () => {
    expect(engine.render('', { A: 'val' })).toBe('');
  });

  it('handles adjacent placeholders', () => {
    expect(engine.render('{{A}}{{B}}', { A: 'x', B: 'y' })).toBe('xy');
  });

  it('matches variable names with underscores and digits', () => {
    expect(engine.render('{{MY_VAR_2}}', { MY_VAR_2: 'ok' })).toBe('ok');
  });

  it('does NOT match names with hyphens', () => {
    expect(engine.render('{{my-var}}', { 'my-var': 'nope' })).toBe('{{my-var}}');
  });

  it('preserves Chinese characters in template body', () => {
    expect(engine.render('你好 {{NAME}} 世界', { NAME: '玩家' })).toBe('你好 玩家 世界');
  });

  it('handles variables with Chinese values', () => {
    expect(engine.render('角色: {{ROLE}}', { ROLE: '修仙者' })).toBe('角色: 修仙者');
  });

  it('does NOT double-substitute a value containing {{KEY}} syntax', () => {
    const result = engine.render('{{A}}', { A: '{{B}}', B: 'nope' });
    expect(result).toBe('{{B}}'); // value is literal, not re-processed
  });
});
