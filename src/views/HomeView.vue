<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import NavCard from '../components/NavCard.vue'
import { useListenLibrary } from '../composables/useListenLibrary'
import { useNavLibrary } from '../composables/useNavLibrary'
import type { ListenItem, ListenPlatform } from '../types/listen'
import type { NavLink } from '../types/nav'
import { formatClock, formatDateLabel } from '../utils/format'

const { links, categories, backendReachable, syncState } = useNavLibrary()
const { getRandomItem } = useListenLibrary()
const now = ref(new Date())
const searchQuery = ref('')
const selectedSearchEngine = ref('google')
const clickCounts = ref<Record<string, number>>({})
const expandedCategories = ref(new Set<string>())
const userAdjustedExpansion = ref(false)
const listenItem = ref<ListenItem | null>(null)
const listenLoading = ref(false)
const listenError = ref('')
const listenFlipped = ref(false)
const listenExpanded = ref(false)
const selectedListenPlatform = ref<ListenPlatform | 'all'>('all')
const CLICK_STORAGE_KEY = 'asmr-nav.click-counts.v1'
const COMMON_CATEGORY = '常用推荐'
const COLLECTION_CATEGORY = '收藏'
const COMMON_LIMIT = 4

const searchEngines = [
  {
    id: 'google',
    label: 'Google',
    buttonLabel: 'Google',
    placeholder: '用 Google 搜索...',
    buildUrl: (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
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

const listenPlatformFilters: { value: ListenPlatform | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'asmrone', label: 'ASMR.one' },
]

let timer: ReturnType<typeof setInterval> | null = null

const clock = computed(() => formatClock(now.value))
const dateLabel = computed(() => formatDateLabel(now.value))
const currentSearchEngine = computed(() =>
  searchEngines.find((engine) => engine.id === selectedSearchEngine.value) ?? searchEngines[0],
)

const commonLinks = computed(() => {
  return [...links.value]
    .map((link) => ({
      link,
      clickCount: getClickCount(link),
      score: getCommonScore(link),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      const scoreDiff = right.score - left.score

      if (scoreDiff !== 0) {
        return scoreDiff
      }

      const clickDiff = right.clickCount - left.clickCount

      if (clickDiff !== 0) {
        return clickDiff
      }

      const commonDiff = Number(right.link.isCommon) - Number(left.link.isCommon)

      if (commonDiff !== 0) {
        return commonDiff
      }

      const categoryDiff = getDisplayCategoryRank(left.link.category) - getDisplayCategoryRank(right.link.category)

      if (categoryDiff !== 0) {
        return categoryDiff
      }

      if (left.link.sortOrder !== right.link.sortOrder) {
        return left.link.sortOrder - right.link.sortOrder
      }

      return left.link.title.localeCompare(right.link.title, 'zh-CN')
    })
    .slice(0, COMMON_LIMIT)
    .map((item) => item.link)
})

const groupedLinks = computed(() => {
  const groups = new Map<string, NavLink[]>()

  links.value.forEach((link) => {
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

  return backendReachable.value ? 'Online' : '本地'
})

const listenToggleSubtitle = computed(() => {
  if (listenLoading.value) {
    return '正在抽取...'
  }

  if (listenItem.value) {
    return `已抽到：${listenItem.value.title}`
  }

  if (listenError.value) {
    return listenError.value
  }

  return '翻一张声音卡'
})

watch(groupedLinks, (groups) => {
  if (userAdjustedExpansion.value || groups.length === 0) {
    return
  }

  expandedCategories.value = new Set(groups.slice(0, 2).map((group) => group.category))
}, { immediate: true })

function trackById(link: NavLink) {
  return link.id
}

function isCategoryExpanded(category: string) {
  return expandedCategories.value.has(category)
}

function toggleCategory(category: string) {
  userAdjustedExpansion.value = true

  const nextCategories = new Set(expandedCategories.value)

  if (nextCategories.has(category)) {
    nextCategories.delete(category)
  } else {
    nextCategories.add(category)
  }

  expandedCategories.value = nextCategories
}

function toggleListenPicker() {
  listenExpanded.value = !listenExpanded.value
}

function selectListenPlatform(platform: ListenPlatform | 'all') {
  selectedListenPlatform.value = platform
}

function getClickCount(link: NavLink) {
  return clickCounts.value[link.id] ?? 0
}

function getCommonScore(link: NavLink) {
  return (link.isCommon ? 1 : 0) + getClickCount(link)
}

function getRegularCategory(link: NavLink) {
  return link.category || COLLECTION_CATEGORY
}

function getDisplayCategoryRank(category: string) {
  if (category === COMMON_CATEGORY) {
    return 0
  }

  const index = categories.value.indexOf(category)
  return index === -1 ? 1000 : index + 1
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
  window.open(targetUrl, '_blank', 'noopener,noreferrer')
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function formatListenTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function drawListenCard() {
  if (listenLoading.value) {
    return
  }

  listenLoading.value = true
  listenError.value = ''

  try {
    if (listenFlipped.value) {
      listenFlipped.value = false
      await wait(260)
    }

    const item = await getRandomItem(
      selectedListenPlatform.value === 'all'
        ? {}
        : { platform: selectedListenPlatform.value },
    )
    listenItem.value = item

    if (!item) {
      listenError.value = '还没有可抽取的订阅内容。'
    }

    listenFlipped.value = true
  } catch (error) {
    listenItem.value = null
    listenError.value = error instanceof Error ? error.message : '抽取失败。'
    listenFlipped.value = true
  } finally {
    listenLoading.value = false
  }
}

function openListenItem() {
  if (!listenItem.value) {
    return
  }

  window.open(listenItem.value.url, '_blank', 'noopener,noreferrer')
}

function getListenCoverStyle(cover: string) {
  const escapedCover = cover.replace(/["\\\n\r\f]/g, '\\$&')
  return {
    '--listen-cover-image': `url("${escapedCover}")`,
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
      <p>听什么比较好？</p>
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

    <section class="listen-picker" :class="{ 'is-expanded': listenExpanded }" aria-label="今天听什么">
      <button
        class="listen-picker-toggle"
        type="button"
        :aria-expanded="listenExpanded"
        aria-controls="listen-picker-panel"
        @click="toggleListenPicker"
      >
        <span class="listen-toggle-copy">
          <span class="listen-toggle-title">今天听什么呢？</span>
          <span class="listen-toggle-subtitle">{{ listenToggleSubtitle }}</span>
        </span>
        <span class="listen-toggle-meta">
          <span class="listen-platform-tabs" aria-label="选择抽取来源" @click.stop>
            <span
              v-for="filter in listenPlatformFilters"
              :key="filter.value"
              class="listen-platform-tab"
              role="button"
              tabindex="0"
              :class="{ 'is-active': selectedListenPlatform === filter.value }"
              :aria-pressed="selectedListenPlatform === filter.value"
              @click="selectListenPlatform(filter.value)"
              @keydown.enter.prevent="selectListenPlatform(filter.value)"
              @keydown.space.prevent="selectListenPlatform(filter.value)"
            >
              {{ filter.label }}
            </span>
          </span>
          <span class="listen-toggle-icon" aria-hidden="true">⌄</span>
        </span>
      </button>

      <div
        id="listen-picker-panel"
        class="listen-panel"
        :aria-hidden="!listenExpanded"
        :inert="!listenExpanded"
      >
        <div class="listen-flip" :class="{ 'is-flipped': listenFlipped }" :aria-busy="listenLoading">
        <div class="listen-card-face listen-card-front">
          <div>
            <p class="listen-kicker">pick one</p>
            <strong>从你的订阅里抽一条 ASMR</strong>
            <span>不纠结了，先翻开看看。</span>
          </div>
          <button class="listen-primary-action" type="button" :disabled="listenLoading" @click="drawListenCard">
            {{ listenLoading ? '抽取中' : '开始抽取' }}
          </button>
        </div>

        <div
          class="listen-card-face listen-card-back"
          :class="{ 'has-cover': Boolean(listenItem?.cover) }"
          :style="listenItem?.cover ? getListenCoverStyle(listenItem.cover) : undefined"
        >
          <template v-if="listenItem">
            <div class="listen-result-main">
              <div class="listen-result-copy">
                <p class="listen-kicker">{{ listenItem.platform }}</p>
                <h3>{{ listenItem.title }}</h3>
                <p class="listen-meta">
                  {{ listenItem.author || listenItem.sourceTitle }}
                  <span v-if="formatListenTime(listenItem.publishedAt)"> · {{ formatListenTime(listenItem.publishedAt) }}</span>
                </p>
                <p v-if="listenItem.tags.length" class="listen-tags">{{ listenItem.tags.join(' / ') }}</p>
                <p v-if="listenItem.summary" class="listen-summary">{{ listenItem.summary }}</p>
              </div>
              <img v-if="listenItem.cover" class="listen-cover" :src="listenItem.cover" :alt="listenItem.title">
            </div>
            <div class="listen-actions">
              <button class="listen-primary-action" type="button" @click="openListenItem">去听</button>
              <button class="listen-secondary-action" type="button" :disabled="listenLoading" @click="drawListenCard">
                换一个
              </button>
            </div>
          </template>

          <template v-else>
            <div class="listen-result-copy">
              <p class="listen-kicker">empty</p>
              <h3>{{ listenError || '还没有可抽取的内容' }}</h3>
              <p class="listen-meta">去后台添加订阅源并同步后，这里就能抽卡。</p>
            </div>
            <button class="listen-secondary-action" type="button" :disabled="listenLoading" @click="drawListenCard">
              再试一次
            </button>
          </template>
        </div>
      </div>
      </div>
    </section>

    <section v-for="group in groupedLinks" :key="group.category" class="nav-container">
      <h2
        class="nav-title"
        role="button"
        tabindex="0"
        :aria-expanded="isCategoryExpanded(group.category)"
        @click="toggleCategory(group.category)"
        @keydown.enter.prevent="toggleCategory(group.category)"
        @keydown.space.prevent="toggleCategory(group.category)"
      >
        {{ group.category }}
      </h2>
      <div v-if="isCategoryExpanded(group.category)" class="nav-grid">
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
