<script setup lang="ts">
/**
 * NpcEditDialog — NPC 编辑专用对话框。
 *
 * 提供 NPC 的关键字段编辑:
 *   - name (名称)
 *   - type (类型，如 "商人"、"守卫" 等)
 *   - location (所在位置)
 *   - description (描述)
 *   - relationshipType (关系类型)
 *
 * 使用 BaseModal 作为对话框容器。
 * 新建模式 (npcData 未传入) 与编辑模式 (npcData 已传入) 自动切换。
 */
import { reactive, computed, watch } from 'vue';
import BaseModal from '@/ui/components/shared/BaseModal.vue';

/** NPC 表单数据结构 */
interface NpcFormData {
  name: string;
  type: string;
  location: string;
  description: string;
  relationshipType: string;
}

/** 可选的关系类型 */
const RELATIONSHIP_OPTIONS = [
  '友好', '中立', '敌对', '商业', '从属', '同盟', '竞争', '未知',
] as const;

/** 可选的 NPC 类型 */
const NPC_TYPE_OPTIONS = [
  '商人', '守卫', '村民', '贵族', '冒险者', '导师', '敌人', '神秘人', '其他',
] as const;

const props = withDefaults(defineProps<{
  /** 控制对话框显示/隐藏（v-model） */
  modelValue: boolean;
  /** 已有 NPC 数据（编辑模式） */
  npcData?: Record<string, unknown>;
}>(), {
  npcData: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 保存 NPC 数据 */
  save: [npc: Record<string, unknown>];
}>();

/** 是否为编辑模式 */
const isEdit = computed<boolean>(() => props.npcData !== undefined);

/** 对话框标题 */
const dialogTitle = computed<string>(() =>
  isEdit.value ? '编辑 NPC' : '新建 NPC',
);

/** 内部表单数据 */
const form = reactive<NpcFormData>(buildInitial());

function buildInitial(): NpcFormData {
  const d = props.npcData;
  return {
    name: extractString(d, 'name'),
    type: extractString(d, 'type'),
    location: extractString(d, 'location'),
    description: extractString(d, 'description'),
    relationshipType: extractString(d, 'relationshipType', '中立'),
  };
}

/** 安全提取字符串字段 */
function extractString(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback = '',
): string {
  if (!obj) return fallback;
  const val = obj[key];
  return typeof val === 'string' ? val : fallback;
}

/** npcData 变更或对话框打开时重置表单 */
watch([() => props.npcData, () => props.modelValue], ([, open]) => {
  if (open) {
    const fresh = buildInitial();
    form.name = fresh.name;
    form.type = fresh.type;
    form.location = fresh.location;
    form.description = fresh.description;
    form.relationshipType = fresh.relationshipType;
  }
}, { deep: true });

/** 表单是否可提交（name 必填） */
const canSave = computed<boolean>(() => form.name.trim().length > 0);

/** 关闭 */
function closeDialog(): void {
  emit('update:modelValue', false);
}

/** 保存 — 合并原有数据和表单修改 */
function saveNpc(): void {
  if (!canSave.value) return;

  const result: Record<string, unknown> = {
    ...(props.npcData ?? {}),
    name: form.name.trim(),
    type: form.type,
    location: form.location.trim(),
    description: form.description.trim(),
    relationshipType: form.relationshipType,
  };

  emit('save', result);
  closeDialog();
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="dialogTitle"
    max-width="520px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="npc-form" @submit.prevent="saveNpc">
      <!-- 名称 -->
      <div class="form-group">
        <label for="npc-name" class="form-label">
          名称 <span class="required-mark">*</span>
        </label>
        <input
          id="npc-name"
          v-model="form.name"
          type="text"
          class="form-input"
          placeholder="NPC 名称"
        />
      </div>

      <!-- 类型 -->
      <div class="form-group">
        <label for="npc-type" class="form-label">类型</label>
        <select id="npc-type" v-model="form.type" class="form-input form-select">
          <option value="">请选择…</option>
          <option v-for="t in NPC_TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <!-- 位置 -->
      <div class="form-group">
        <label for="npc-location" class="form-label">所在位置</label>
        <input
          id="npc-location"
          v-model="form.location"
          type="text"
          class="form-input"
          placeholder="例如: 王城北门"
        />
      </div>

      <!-- 描述 -->
      <div class="form-group">
        <label for="npc-desc" class="form-label">描述</label>
        <textarea
          id="npc-desc"
          v-model="form.description"
          class="form-input form-textarea"
          rows="4"
          placeholder="NPC 的外貌、性格、背景等"
        />
      </div>

      <!-- 关系类型 -->
      <div class="form-group">
        <label for="npc-rel" class="form-label">关系类型</label>
        <select id="npc-rel" v-model="form.relationshipType" class="form-input form-select">
          <option v-for="r in RELATIONSHIP_OPTIONS" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
    </form>

    <template #footer>
      <button class="btn btn-cancel" @click="closeDialog">取消</button>
      <button
        class="btn btn-save"
        :disabled="!canSave"
        @click="saveNpc"
      >
        保存
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.npc-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.form-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.required-mark {
  color: var(--color-danger);
}

.form-input {
  padding: 0.55rem 0.7rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.88rem;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: var(--color-sage-400);
}

.form-select {
  appearance: none;
  cursor: pointer;
}

.form-textarea {
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
}

.btn {
  padding: 0.55rem 1.25rem;
  border: none;
  border-radius: 6px;
  font-size: 0.88rem;
  cursor: pointer;
  transition: background-color 0.15s;
}

.btn-cancel {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-cancel:hover {
  background: var(--color-border);
}

.btn-save {
  background: var(--color-sage-400);
  color: var(--color-text-bone);
}

.btn-save:hover {
  background: var(--color-sage-500);
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
