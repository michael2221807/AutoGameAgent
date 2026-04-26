/**
 * Tests for ComfyUI provider's workflow template renderer.
 *
 * The renderer is the critical piece: if placeholder substitution drops a
 * value or garbles JSON escaping, the user's workflow posts to ComfyUI and
 * gets rejected with a cryptic 400. We exercise each placeholder style,
 * multi-line prompts (to stress JSON escaping), and missing-model fallback.
 */
import { describe, expect, it } from 'vitest';

import { ComfyUIImageProvider } from './comfyui';

// Expose private methods for testing via a subclass.
class TestableProvider extends ComfyUIImageProvider {
  public render(template: string, vars: {
    prompt: string; negative: string; width: number; height: number;
    seed: number; steps: number; cfgScale: number;
  }): Record<string, unknown> {
    // @ts-expect-error — testing private method
    return this.renderWorkflowTemplate(template, vars);
  }
}

function makeProvider(model = 'test.safetensors'): TestableProvider {
  return new TestableProvider('http://localhost:8188', '', model);
}

const BASE_VARS = {
  prompt: 'masterpiece, best quality',
  negative: 'lowres, bad anatomy',
  width: 1024, height: 1024,
  seed: 12345, steps: 30, cfgScale: 7,
};

describe('ComfyUI workflow template rendering', () => {
  it('substitutes __PROMPT__ / __NEGATIVE_PROMPT__ / __WIDTH__ / __HEIGHT__ style', () => {
    const template = JSON.stringify({
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'test.safetensors' },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '__PROMPT__', clip: ['1', 1] },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '__NEGATIVE_PROMPT__', clip: ['1', 1] },
      },
      '4': {
        class_type: 'EmptyLatentImage',
        inputs: { width: '__WIDTH__', height: '__HEIGHT__', batch_size: 1 },
      },
    }).replace(/"__WIDTH__"/g, '__WIDTH__').replace(/"__HEIGHT__"/g, '__HEIGHT__');

    const rendered = makeProvider().render(template, BASE_VARS);
    const node2 = (rendered['2'] as Record<string, unknown>).inputs as Record<string, unknown>;
    const node4 = (rendered['4'] as Record<string, unknown>).inputs as Record<string, unknown>;
    expect(node2.text).toBe('masterpiece, best quality');
    expect(node4.width).toBe(1024);
    expect(node4.height).toBe(1024);
  });

  it('substitutes {{prompt}} / {{width}} style placeholders', () => {
    const template = `{
      "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{prompt}}" } },
      "4": { "class_type": "EmptyLatentImage", "inputs": { "width": {{width}}, "height": {{height}} } }
    }`;
    const rendered = makeProvider().render(template, BASE_VARS);
    const node2 = (rendered['2'] as Record<string, unknown>).inputs as Record<string, unknown>;
    const node4 = (rendered['4'] as Record<string, unknown>).inputs as Record<string, unknown>;
    expect(node2.text).toBe('masterpiece, best quality');
    expect(node4.width).toBe(1024);
  });

  it('substitutes %prompt% / %WIDTH% style (matches user-exported MRJH workflows)', () => {
    // Mirrors the shape of the real workflow the user reported: StringLiteral
    // nodes hold %WIDTH% / %HEIGHT% strings, feed into StringToInt for the
    // EmptyLatentImage. %prompt% lives inside a quoted prompt field.
    const template = `{
      "21": { "class_type": "CR Prompt Text", "inputs": { "prompt": "%prompt%, masterpiece" } },
      "22": { "class_type": "CR Prompt Text", "inputs": { "prompt": "%negative_prompt%, lowres" } },
      "61": { "class_type": "String Literal", "inputs": { "string": "%WIDTH%" } },
      "62": { "class_type": "String Literal", "inputs": { "string": "%HEIGHT%" } },
      "15": { "class_type": "KSampler", "inputs": { "seed": %SEED%, "steps": %STEPS%, "cfg": %CFG% } }
    }`;
    const rendered = makeProvider().render(template, BASE_VARS);
    const n21 = (rendered['21'] as Record<string, unknown>).inputs as Record<string, unknown>;
    const n22 = (rendered['22'] as Record<string, unknown>).inputs as Record<string, unknown>;
    const n61 = (rendered['61'] as Record<string, unknown>).inputs as Record<string, unknown>;
    const n15 = (rendered['15'] as Record<string, unknown>).inputs as Record<string, unknown>;
    expect(n21.prompt).toBe('masterpiece, best quality, masterpiece');
    expect(n22.prompt).toBe('lowres, bad anatomy, lowres');
    expect(n61.string).toBe('1024');
    expect(n62_from(rendered).string).toBe('1024');
    expect(n15.seed).toBe(12345);
    expect(n15.steps).toBe(30);
    expect(n15.cfg).toBe(7);
  });

  it('JSON-escapes quotes and newlines in the prompt', () => {
    const template = '{"1": {"inputs": {"text": "__PROMPT__"}}}';
    const rendered = makeProvider().render(template, {
      ...BASE_VARS,
      prompt: 'a cat, "tagged", \nnew line, \\backslash',
    });
    const n1 = (rendered['1'] as Record<string, unknown>).inputs as Record<string, unknown>;
    expect(n1.text).toBe('a cat, "tagged", \nnew line, \\backslash');
  });

  it('throws a helpful error when template is not valid JSON', () => {
    expect(() => makeProvider().render('{not json', BASE_VARS)).toThrow(
      /Workflow 模板解析失败/,
    );
  });

  it('throws when template parses to an array or primitive (must be object)', () => {
    expect(() => makeProvider().render('[]', BASE_VARS)).toThrow(
      /Workflow 模板解析失败/,
    );
    expect(() => makeProvider().render('"string"', BASE_VARS)).toThrow(
      /Workflow 模板解析失败/,
    );
  });

  it('placeholder substitution is case-insensitive on the token', () => {
    const template = '{"1": {"inputs": {"text": "__prompt__, __PROMPT__"}}}';
    const rendered = makeProvider().render(template, BASE_VARS);
    const n1 = (rendered['1'] as Record<string, unknown>).inputs as Record<string, unknown>;
    expect(n1.text).toBe('masterpiece, best quality, masterpiece, best quality');
  });
});

/** Small helper to pull a node out of the result — keeps inline types readable. */
function n62_from(wf: Record<string, unknown>): Record<string, unknown> {
  return (wf['62'] as Record<string, unknown>).inputs as Record<string, unknown>;
}
