/**
 * ComfyUI Workflow Template System — MRJH imageTasks.ts:1488-1571
 *
 * Parses a user-provided ComfyUI workflow JSON and injects generation
 * parameters via placeholder replacement. Supports two placeholder formats:
 * - Double-underscore: `__PROMPT__`, `__WIDTH__`, `__NEGATIVE_PROMPT__`, etc.
 * - Handlebars-style: `{{prompt}}`, `{{width}}`, `{{negative_prompt}}`, etc.
 *
 * Placeholder replacement is recursive — it walks the entire JSON tree
 * and replaces both exact-match values and substring occurrences.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ FRONTEND TODO (Phase 7: Settings Tab — Backend Settings)       │
 * │                                                                 │
 * │ ComfyUI settings need a workflow JSON textarea where the user  │
 * │ pastes their workflow with placeholder variables.               │
 * │ MRJH ref: MRJH-USER-EXPERIENCE.md §K "Tab 3: Backend Settings"│
 * └─────────────────────────────────────────────────────────────────┘
 */

export interface ComfyUIWorkflowParams {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps?: number;
  cfgScale?: number;
  cfgRescale?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  smea?: boolean;
  smeaDynamic?: boolean;
}

/**
 * Parse a ComfyUI workflow JSON string.
 * MRJH 解析ComfyUI工作流 (imageTasks.ts:1488-1503)
 */
function parseWorkflowJSON(workflowText: string): Record<string, unknown> {
  const trimmed = (workflowText || '').trim();
  if (!trimmed) throw new Error('ComfyUI workflow JSON is empty — configure it in Settings');
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); }
  catch (err) { throw new Error(`ComfyUI workflow JSON parse error: ${(err as Error)?.message || 'invalid format'}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ComfyUI workflow JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Recursively replace placeholders in a JSON value tree.
 * MRJH 注入ComfyUI工作流占位符 (imageTasks.ts:1505-1527)
 */
function injectPlaceholders(value: unknown, replacements: Record<string, string | number>): unknown {
  if (typeof value === 'string') {
    // Exact match → return typed replacement (preserves number type)
    const exactMatch = Object.entries(replacements).find(([token]) => value === token);
    if (exactMatch) return exactMatch[1];
    // Substring replacements
    return Object.entries(replacements).reduce(
      (text, [token, replacement]) => text.split(token).join(String(replacement)),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => injectPlaceholders(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, injectPlaceholders(child, replacements)]),
    );
  }
  return value;
}

/** Append negative prompt inline for backends without separate negative field */
function appendInlineNegative(prompt: string, negative: string): string {
  if (!negative?.trim()) return prompt;
  return `${prompt}\n\nNegative prompt: ${negative}`;
}

/**
 * Build a ComfyUI workflow from a template + generation parameters.
 *
 * MRJH 构建ComfyUI工作流 (imageTasks.ts:1529-1571)
 *
 * Replaces all supported placeholders in the workflow JSON:
 * - `__PROMPT__` / `{{prompt}}` — positive prompt
 * - `__NEGATIVE_PROMPT__` / `{{negative_prompt}}` — negative prompt
 * - `__WIDTH__` / `{{width}}` — image width
 * - `__HEIGHT__` / `{{height}}` — image height
 * - `__SIZE__` / `{{size}}` — "WIDTHxHEIGHT"
 * - `__STEPS__` / `{{steps}}` — generation steps (default 28)
 * - `__CFG__` / `{{cfg}}` — CFG scale (default 7)
 * - `__SAMPLER__` / `{{sampler}}` — sampler name (default "euler")
 * - `__SCHEDULER__` / `{{scheduler}}` — noise scheduler (default "normal")
 * - `__SEED__` / `{{seed}}` — random seed (default 0)
 * - `__SMEA__` / `{{smea}}` — SMEA flag ("true"/"false")
 * - `__SMEA_DYN__` / `{{smea_dyn}}` — dynamic SMEA flag
 */
export function buildComfyUIWorkflow(
  workflowText: string,
  params: ComfyUIWorkflowParams,
): Record<string, unknown> {
  const hasNegPlaceholder = /(__NEGATIVE_PROMPT__|\{\{negative_prompt\}\})/.test(workflowText || '');
  const promptValue = hasNegPlaceholder
    ? params.prompt
    : appendInlineNegative(params.prompt, params.negativePrompt);

  const replacements: Record<string, string | number> = {
    '__PROMPT__': promptValue,
    '{{prompt}}': promptValue,
    '__NEGATIVE_PROMPT__': params.negativePrompt,
    '{{negative_prompt}}': params.negativePrompt,
    '__WIDTH__': params.width,
    '{{width}}': params.width,
    '__HEIGHT__': params.height,
    '{{height}}': params.height,
    '__SIZE__': `${params.width}x${params.height}`,
    '{{size}}': `${params.width}x${params.height}`,
    '__STEPS__': Math.max(1, Math.floor(params.steps ?? 28)),
    '{{steps}}': Math.max(1, Math.floor(params.steps ?? 28)),
    '__CFG__': Number.isFinite(params.cfgScale) ? params.cfgScale! : 7,
    '{{cfg}}': Number.isFinite(params.cfgScale) ? params.cfgScale! : 7,
    '__CFG_RESCALE__': Number.isFinite(params.cfgRescale) ? params.cfgRescale! : 0,
    '{{cfg_rescale}}': Number.isFinite(params.cfgRescale) ? params.cfgRescale! : 0,
    '__SAMPLER__': (params.sampler || '').trim() || 'euler',
    '{{sampler}}': (params.sampler || '').trim() || 'euler',
    '__SCHEDULER__': (params.scheduler || '').trim() || 'normal',
    '{{scheduler}}': (params.scheduler || '').trim() || 'normal',
    '__SEED__': Number.isFinite(params.seed) ? Math.max(0, Math.floor(params.seed!)) : 0,
    '{{seed}}': Number.isFinite(params.seed) ? Math.max(0, Math.floor(params.seed!)) : 0,
    '__SMEA__': params.smea === true ? 'true' : 'false',
    '{{smea}}': params.smea === true ? 'true' : 'false',
    '__SMEA_DYN__': params.smeaDynamic === true ? 'true' : 'false',
    '{{smea_dyn}}': params.smeaDynamic === true ? 'true' : 'false',
  };

  const parsed = parseWorkflowJSON(workflowText);
  return injectPlaceholders(parsed, replacements) as Record<string, unknown>;
}
