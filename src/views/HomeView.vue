<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import NavCard from '../components/NavCard.vue'
import { useNavLibrary } from '../composables/useNavLibrary'
import type { NavLink } from '../types/nav'
import { formatClock, formatDateLabel } from '../utils/format'

const { links, backendReachable, syncState } = useNavLibrary()
const now = ref(new Date())
const searchQuery = ref('')
const selectedSearchEngine = ref('baidu')
const clickCounts = ref<Record<string, number>>({})
const CLICK_STORAGE_KEY = 'asmr-nav.click-counts.v1'
const COMMON_CATEGORY = '常用推荐'
const COLLECTION_CATEGORY = '收藏'
const COMMON_LIMIT = 4

const searchEngines = [
  {
    id: 'baidu',
    label: '百度',
    buttonLabel: '百度一下',
    placeholder: '输入关键字，百度一下...',
    buildUrl: (query: string) => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
  },
  {
    id: 'bilibili',
    label: 'B站',
    buttonLabel: '搜B站',
    placeholder: '在 B 站搜索 ASMR...',
    buildUrl: (query: string) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`,
  },
  {
    id: 'google',
    label: 'Google',
    buttonLabel: 'Google',
    placeholder: '用 Google 搜索...',
    buildUrl: (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: 'missevan',
    label: '猫耳',
    buttonLabel: '搜猫耳',
    placeholder: '搜索猫耳 FM 内容...',
    buildUrl: (query: string) => `https://www.baidu.com/s?wd=${encodeURIComponent(`site:missevan.com ${query}`)}`,
  },
  {
    id: 'youtube',
    label: 'YouTube',
    buttonLabel: 'YouTube',
    placeholder: '在 YouTube 搜索...',
    buildUrl: (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  },
]

let timer: ReturnType<typeof setInterval> | null = null

const clock = computed(() => formatClock(now.value))
const dateLabel = computed(() => formatDateLabel(now.value))
const currentSearchEngine = computed(() =>
  searchEngines.find((engine) => engine.id === selectedSearchEngine.value) ?? searchEngines[0],
)

const commonLinks = computed(() => {
  const selected = new Map<string, NavLink>()
  const clickedLinks = [...links.value]
    .filter((link) => getClickCount(link) > 0)
    .sort((left, right) => {
      const clickDiff = getClickCount(right) - getClickCount(left)

      if (clickDiff !== 0) {
        return clickDiff
      }

      return left.title.localeCompare(right.title, 'zh-CN')
    })

  clickedLinks.forEach((link) => {
    if (selected.size < COMMON_LIMIT) {
      selected.set(link.id, link)
    }
  })

  links.value
    .filter((link) => link.category === COMMON_CATEGORY)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .forEach((link) => {
      if (selected.size < COMMON_LIMIT) {
        selected.set(link.id, link)
      }
    })

  return Array.from(selected.values()).slice(0, COMMON_LIMIT)
})

const groupedLinks = computed(() => {
  const commonIds = new Set(commonLinks.value.map((link) => link.id))
  const groups = new Map<string, NavLink[]>()

  links.value.forEach((link) => {
    if (commonIds.has(link.id)) {
      return
    }

    const category = getRegularCategory(link)
    groups.set(category, [...(groups.get(category) ?? []), link])
  })

  const regularGroups = Array.from(groups.entries())
    .map(([category, items]) => ({
      category,
      items,
    }))
    .sort((left, right) => {
      const rankDiff = getDisplayCategoryRank(left.category) - getDisplayCategoryRank(right.category)
      return rankDiff || left.category.localeCompare(right.category, 'zh-CN')
    })

  return commonLinks.value.length
    ? [{ category: COMMON_CATEGORY, items: commonLinks.value }, ...regularGroups]
    : regularGroups
})

const statusText = computed(() => {
  if (syncState.value === 'loading') {
    return '同步中'
  }

  return backendReachable.value ? 'Worker' : '本地'
})

function trackById(link: NavLink) {
  return link.id
}

function getClickCount(link: NavLink) {
  return clickCounts.value[link.id] ?? 0
}

function getRegularCategory(link: NavLink) {
  if (link.category === COMMON_CATEGORY || link.category === '推荐') {
    return COLLECTION_CATEGORY
  }

  return link.category || COLLECTION_CATEGORY
}

function getDisplayCategoryRank(category: string) {
  if (category === COMMON_CATEGORY) {
    return 0
  }

  if (category === COLLECTION_CATEGORY) {
    return 1
  }

  return 10
}

function loadClickCounts() {
  try {
    const raw = localStorage.getItem(CLICK_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      clickCounts.value = {}
      return
    }

    const nextCounts: Record<string, number> = {}

    Object.entries(parsed).forEach(([id, value]) => {
      const count = Number(value)

      if (Number.isFinite(count) && count > 0) {
        nextCounts[id] = count
      }
    })

    clickCounts.value = nextCounts
  } catch {
    clickCounts.value = {}
  }
}

function recordLinkClick(link: NavLink) {
  const nextCounts = {
    ...clickCounts.value,
    [link.id]: getClickCount(link) + 1,
  }

  clickCounts.value = nextCounts
  localStorage.setItem(CLICK_STORAGE_KEY, JSON.stringify(nextCounts))
}

function handleSearch() {
  const query = searchQuery.value.trim()

  if (!query) {
    return
  }

  const targetUrl = currentSearchEngine.value.buildUrl(query)
  const opened = window.open(targetUrl, '_blank', 'noopener,noreferrer')

  if (!opened) {
    window.location.href = targetUrl
  }
}

onMounted(() => {
  loadClickCounts()

  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
  }
})
</script>

<template>
  <main class="home-page">
    <RouterLink class="admin-entry" to="/admin">后台</RouterLink>

    <header class="page-header">
      <h1>ASMR收藏夹</h1>
      <p>有你想要的吗？</p>
    </header>

    <section class="top-widget" aria-label="当前时间">
      <div class="time">{{ clock }}</div>
      <div class="date-weather">
        <span>{{ dateLabel }}</span>
        <span class="status-dot" :class="{ 'is-remote': backendReachable }">{{ statusText }}</span>
      </div>
    </section>

    <section class="search-container" aria-label="搜索">
      <form class="search-form" @submit.prevent="handleSearch">
        <select
          v-model="selectedSearchEngine"
          class="search-engine-select"
          aria-label="选择搜索站点"
        >
          <option v-for="engine in searchEngines" :key="engine.id" :value="engine.id">
            {{ engine.label }}
          </option>
        </select>
        <input
          v-model.trim="searchQuery"
          class="search-input"
          type="search"
          :placeholder="currentSearchEngine.placeholder"
          autocomplete="off"
          autofocus
          required
        >
        <button class="search-btn" type="submit">{{ currentSearchEngine.buttonLabel }}</button>
      </form>
    </section>

    <section v-for="group in groupedLinks" :key="group.category" class="nav-container">
      <h2 class="nav-title">{{ group.category }}</h2>
      <div class="nav-grid">
        <NavCard
          v-for="link in group.items"
          :key="trackById(link)"
          :link="link"
          @open="recordLinkClick"
        />
      </div>
    </section>
  </main>
</template>
