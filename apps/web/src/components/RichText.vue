<script setup lang="ts">
import { computed } from 'vue';
import { safeImageUrl } from '../features/practice/content';
const props = defineProps<{ text: string }>();
// Deliberately small Markdown subset. All user text remains Vue text nodes.
const blocks = computed(() =>
  props.text
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((text) => {
      if (/^#{1,3} /.test(text)) return { tag: 'h3', text: text.replace(/^#{1,3} /, '') };
      if (text.startsWith('> ')) return { tag: 'blockquote', text: text.replace(/^> /gm, '') };
      return { tag: 'p', text };
    }),
);
function inline(text: string): { tag: string; text: string; src?: string }[] {
  return text.split(/(!\[[^\]\n]*\]\([^\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g).map((part) => {
    const match = /^!\[([^\]\n]*)\]\(([^\s]+)\)$/.exec(part);
    if (match) {
      const src = safeImageUrl(match[2]!);
      if (src) return { tag: 'img', text: match[1] || '题目配图', src };
    }
    if (part.startsWith('**') && part.endsWith('**')) return { tag: 'strong', text: part.slice(2, -2) };
    if (part.startsWith('`') && part.endsWith('`')) return { tag: 'code', text: part.slice(1, -1) };
    if (part.startsWith('*') && part.endsWith('*')) return { tag: 'em', text: part.slice(1, -1) };
    return { tag: 'span', text: part };
  });
}
</script>
<template>
  <div class="rich-text">
    <component :is="block.tag" v-for="(block, index) in blocks" :key="index">
      <template v-for="(part, i) in inline(block.text)" :key="i">
        <img
          v-if="part.tag === 'img'"
          :src="part.src"
          :alt="part.text"
          loading="lazy"
          referrerpolicy="no-referrer"
        />
        <component :is="part.tag" v-else>{{ part.text }}</component>
      </template>
    </component>
  </div>
</template>
<style scoped>
.rich-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.85;
}
.rich-text > :not(:last-child) {
  margin-bottom: 1em;
}
blockquote {
  border-left: 3px solid var(--primary, #176e60);
  padding-left: 1em;
}
code {
  background: #eef1eb;
  padding: 2px 5px;
  border-radius: 3px;
  font-family: monospace;
}
img {
  display: inline-block;
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}
</style>
