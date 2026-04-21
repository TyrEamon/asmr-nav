<script setup lang="ts">
import type { NavLink } from '../types/nav'
import { getHostLabel, getLinkIcon } from '../utils/format'

defineProps<{
  link: NavLink
}>()

const emit = defineEmits<{
  open: [link: NavLink]
}>()
</script>

<template>
  <a class="nav-item" :href="link.url" target="_blank" rel="noreferrer" @click="emit('open', link)">
    <span class="nav-icon" aria-hidden="true">{{ getLinkIcon(link) }}</span>
    <span class="nav-text">
      <span class="nav-title-text">{{ link.title }}</span>
      <span class="nav-desc">{{ link.description || getHostLabel(link.url) }}</span>
    </span>
  </a>
</template>
