/**
 * PayloadParser 单元测试
 *
 * 覆盖：
 * - 裸 JSON 解析
 * - markdown 围栏剥离
 * - <thinking> 标签剥离（CR P1-2 同范式）
 * - 多 block 选择（按 patches 字段命中得分 + 同分取最末）
 * - 找不到合法 payload 时返回 null
 * - sanitizePatch：非法 op / 缺 target / 缺必填字段
 */
import { describe, it, expect } from 'vitest';
import { parseAssistantPayload } from './payload-parser';

describe('parseAssistantPayload — 基本解析', () => {
  it('解析裸 JSON', () => {
    const raw = '{"summary":"添加 NPC","patches":[{"target":"$.社交.关系","op":"append-item","value":{"名称":"苏墨"}}]}';
    const result = parseAssistantPayload(raw);
    expect(result?.summary).toBe('添加 NPC');
    expect(result?.patches).toHaveLength(1);
    expect(result?.patches[0].op).toBe('append-item');
  });

  it('剥离 ```json ... ``` 围栏', () => {
    const raw = `好的，我准备这样改：

\`\`\`json
{"summary":"X","patches":[{"target":"a","op":"set-field","value":"V"}]}
\`\`\``;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].value).toBe('V');
  });

  it('剥离 <thinking> 后选最终答案', () => {
    const raw = `<thinking>
{"summary":"草稿","patches":[{"target":"a","op":"set-field","value":"draft"}]}
</thinking>
{"summary":"最终","patches":[{"target":"a","op":"set-field","value":"final"}]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.summary).toBe('最终');
    expect(result?.patches[0].value).toBe('final');
  });

  it('多 block 时取最末（同分约定）', () => {
    const raw = `{"summary":"A","patches":[{"target":"x","op":"set-field","value":1}]}

{"summary":"B","patches":[{"target":"x","op":"set-field","value":2}]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.summary).toBe('B');
  });

  it('返回 null 当无合法 payload（纯文本 chat）', () => {
    expect(parseAssistantPayload('我没有数据要返回')).toBeNull();
  });

  it('返回 null 当 JSON 没有 patches 字段', () => {
    expect(parseAssistantPayload('{"foo":"bar"}')).toBeNull();
  });

  it('返回 null 当输入空 / 非字符串', () => {
    expect(parseAssistantPayload('')).toBeNull();
    expect(parseAssistantPayload('   ')).toBeNull();
    // @ts-expect-error
    expect(parseAssistantPayload(null)).toBeNull();
  });
});

describe('parseAssistantPayload — sanitizePatch', () => {
  it('过滤非法 op 的 patch', () => {
    const raw = `{"summary":"X","patches":[
      {"target":"a","op":"set-field","value":"keep"},
      {"target":"b","op":"INVALID","value":"drop"},
      {"target":"c","op":"append-item","value":{}}
    ]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches).toHaveLength(2);
    expect(result?.patches.map((p) => p.target)).toEqual(['a', 'c']);
  });

  it('过滤缺 target 的 patch', () => {
    const raw = `{"summary":"X","patches":[
      {"op":"set-field","value":"orphan"},
      {"target":"b","op":"set-field","value":"good"}
    ]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches).toHaveLength(1);
    expect(result?.patches[0].target).toBe('b');
  });

  it('保留 rationale + match 字段', () => {
    const raw = `{"summary":"","patches":[{
      "target":"$.社交.关系",
      "op":"replace-item",
      "match":{"by":"名称","value":"王五"},
      "value":{"名称":"王五","好感度":80},
      "rationale":"提升王五好感度"
    }]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].rationale).toBe('提升王五好感度');
    expect(result?.patches[0].match).toEqual({ by: '名称', value: '王五' });
  });

  it('summary 缺失时用空字符串', () => {
    const raw = '{"patches":[{"target":"a","op":"set-field","value":1}]}';
    const result = parseAssistantPayload(raw);
    expect(result?.summary).toBe('');
  });

  it('match.by 类型不对时丢弃 match 但保留 patch', () => {
    const raw = `{"patches":[{
      "target":"a","op":"replace-item",
      "match":{"by":123,"value":"x"},
      "value":"v"
    }]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].match).toBeUndefined();
  });
});

describe('parseAssistantPayload — insert-item 解析', () => {
  it('解析 insert-item + position.at=start', () => {
    const raw = `{"patches":[{
      "target":"$.社交.关系",
      "op":"insert-item",
      "position":{"at":"start"},
      "value":{"名称":"X","类型":"朋友"}
    }]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].op).toBe('insert-item');
    expect(result?.patches[0].position).toEqual({ at: 'start' });
  });

  it('解析 insert-item + position.before', () => {
    const raw = `{"patches":[{
      "target":"$.社交.关系",
      "op":"insert-item",
      "position":{"before":{"by":"名称","value":"王五"}},
      "value":{"名称":"苏墨"}
    }]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].position).toEqual({
      before: { by: '名称', value: '王五' },
    });
  });

  it('解析 insert-item + position.after', () => {
    const raw = `{"patches":[{
      "target":"a","op":"insert-item",
      "position":{"after":{"by":"id","value":"x"}},
      "value":{}
    }]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].position).toEqual({
      after: { by: 'id', value: 'x' },
    });
  });

  it('非法 position.at 值 → position 丢弃（但 patch 保留）', () => {
    const raw = `{"patches":[{
      "target":"a","op":"insert-item",
      "position":{"at":"middle"},
      "value":{}
    }]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].op).toBe('insert-item');
    expect(result?.patches[0].position).toBeUndefined(); // 由 validator 报 error
  });

  it('before.by 非字符串 → position 丢弃', () => {
    const raw = `{"patches":[{
      "target":"a","op":"insert-item",
      "position":{"before":{"by":123,"value":"x"}},
      "value":{}
    }]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].position).toBeUndefined();
  });

  it('同时提供 before + at → 只取 at（sanitizer 优先策略）', () => {
    // sanitizePosition 的优先级：at > before > after
    const raw = `{"patches":[{
      "target":"a","op":"insert-item",
      "position":{"at":"end","before":{"by":"名称","value":"X"}},
      "value":{}
    }]}`;
    const result = parseAssistantPayload(raw);
    expect(result?.patches[0].position).toEqual({ at: 'end' });
  });
});

describe('parseAssistantPayload — 真实场景', () => {
  it('AI 先文本后 JSON 的典型 Mode B 输出', () => {
    const raw = `根据你提供的世界观，我新建了 NPC「苏墨」加入你的社交关系：

- 性格：清冷、寡言
- 与玩家关系：朋友
- 好感度：65（中等偏上）

\`\`\`json
{
  "summary": "新增 NPC「苏墨」加入社交关系",
  "patches": [
    {
      "target": "$.社交.关系",
      "op": "append-item",
      "value": {
        "名称": "苏墨",
        "类型": "朋友",
        "好感度": 65,
        "性别": "男"
      },
      "rationale": "根据你的描述构造的清冷寡言型 NPC"
    }
  ]
}
\`\`\``;
    const result = parseAssistantPayload(raw);
    expect(result?.patches).toHaveLength(1);
    const patch = result!.patches[0];
    expect(patch.op).toBe('append-item');
    expect((patch.value as Record<string, unknown>)['名称']).toBe('苏墨');
  });
});
