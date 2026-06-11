/**
 * Schema-default state-tree builder — shared engine primitive.
 *
 * Extracted verbatim from `CharacterInitPipeline.extractDefaultsFromSchema` so that
 * BOTH character creation and Story 6 card import build their base state tree the
 * SAME way (prevents create↔import default drift). Character creation consumes this
 * to seed its initial state; card import consumes it as the base before deep-merging
 * the card's sparse overlay (see `core/state-merge.ts`).
 *
 * Algorithm (unchanged from the original):
 * - Walks `schema.properties` recursively.
 * - Object fields: merge the field's own `default` (if any) with nested property
 *   defaults; an explicit PARENT default is preserved over child-derived values
 *   (the `key in target` / existing-object guards implement "parent default wins").
 * - Scalar/array fields: write `default` only when the key is not already present
 *   (again protecting a parent-supplied value).
 * - `$ref` is detected and WARNED (not silently skipped) — the current packs inline
 *   all definitions; a future `$ref` field would otherwise never get its default.
 *
 * Engine-layer rule: no game-specific content — operates purely on the schema.
 */

/**
 * Build the default state tree declared by a Game Pack `stateSchema`.
 *
 * @param stateSchema The pack's JSON-schema-like state schema (root node with `properties`).
 * @returns A fresh object tree populated with every declared default.
 */
export function buildSchemaDefaultTree(
  stateSchema: Record<string, unknown>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  populateDefaults(stateSchema, root);
  return root;
}

/**
 * Recursive worker — mutates `target` in place.
 *
 * Non-destructive across recursion: a key already present in `target` (from a
 * parent-level default) is never overwritten, guaranteeing "explicit parent
 * default > child property default".
 */
function populateDefaults(
  schema: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return;

  for (const [key, propSchema] of Object.entries(properties)) {
    // Explicit $ref detection + warning — the current packs do not use $ref, but a
    // future `{ "$ref": "#/definitions/X" }` field would be silently skipped (type
    // is not 'object' and there are no inline `properties`), so its default would
    // never be written. Warn the developer instead of dropping it silently.
    if ('$ref' in propSchema && typeof propSchema.$ref === 'string') {
      console.warn(
        `[state-defaults] buildSchemaDefaultTree: field "${key}" uses $ref=${propSchema.$ref} — ` +
        '$ref is not supported; default will not be populated. Inline the definition or implement $ref resolution.',
      );
      continue;
    }

    const hasOwnDefault = propSchema.default !== undefined;
    const isObject = propSchema.type === 'object' && !!propSchema.properties;

    if (isObject) {
      // Object field: merge own default + nested property defaults.
      //
      // If `target[key]` already holds an object (pre-filled from a parent default),
      // recurse on top of it to fill gaps; otherwise start from `default` (or {}).
      let base: Record<string, unknown>;
      const existing = target[key];
      if (
        key in target &&
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        base = existing as Record<string, unknown>;
      } else if (hasOwnDefault && propSchema.default !== null && typeof propSchema.default === 'object') {
        base = structuredClone(propSchema.default) as Record<string, unknown>;
      } else {
        base = {};
      }

      populateDefaults(propSchema, base);

      // Only write when populated or genuinely defaulted — avoid seeding empty shells.
      if (hasOwnDefault || Object.keys(base).length > 0 || key in target) {
        target[key] = base;
      }
    } else if (hasOwnDefault && !(key in target)) {
      // Scalar/array field with a default and not yet present → write it.
      // `!(key in target)` protects a parent-supplied value from being overwritten.
      target[key] = structuredClone(propSchema.default);
    }
    // Non-object without a default → skip (original behavior preserved).
  }
}
