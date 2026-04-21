<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { ImportMode, NavLink } from '../types/nav'
import { useNavLibrary } from '../composables/useNavLibrary'
import { downloadTextFile, getHostLabel } from '../utils/format'

type AuthState = 'checking' | 'guest' | 'ready'

interface FormState {
  title: string
  url: string
  category: string
  description: string
  icon: string
  isCommon: boolean
  sortOrder: number
}

function createEmptyForm(category = ''): FormState {
  return {
    title: '',
    url: '',
    category,
    description: '',
    icon: '',
    isCommon: false,
    sortOrder: 100,
  }
}

const {
  links,
  categories,
  backendReachable,
  syncState,
  login,
  logout,
  validateSession,
  refreshLinks,
  saveLink,
  deleteLink,
  renameCategory,
  updateCategoryOrder,
  exportLinks,
  importLinks,
} = useNavLibrary()

const authState = ref<AuthState>('checking')
const password = ref('')
const loginError = ref('')
const isLoggingIn = ref(false)
const lastCategory = ref('')
const customCategory = ref(false)
const categoryMenuOpen = ref(false)
const categoryControl = ref<HTMLElement | null>(null)
const categoryInput = ref<HTMLInputElement | null>(null)
const renamingCategory = ref('')
const renameCategoryValue = ref('')
const categoryRenameInput = ref<HTMLInputElement | null>(null)
const form = reactive(createEmptyForm(lastCategory.value))
const editingId = ref<string | null>(null)
const searchQuery = ref('')
const activeCategory = ref('all')
const importText = ref('')
const importMode = ref<ImportMode>('merge')
const notice = ref<{ type: 'success' | 'error'; message: string } | null>(null)

let noticeTimer: ReturnType<typeof setTimeout> | null = null
let categorySelectTimer: ReturnType<typeof setTimeout> | null = null

const filteredLinks = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return links.value.filter((link) => {
    const categoryMatches = activeCategory.value === 'all' || link.category === activeCategory.value

    if (!categoryMatches) {
      return false
    }

    if (!query) {
      return true
    }

    return [link.title, link.url, link.category, link.description, link.icon, link.isCommon ? '常用推荐' : '']
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
})

const categoryOptions = computed(() => {
  const names = categories.value.filter((category) => category !== '常用推荐')
  return names.length ? names : ['收藏']
})

const defaultCategory = computed(() => (
  categoryOptions.value.includes(lastCategory.value)
    ? lastCategory.value
    : categoryOptions.value[0] ?? '收藏'
))

function setNotice(type: 'success' | 'error', message: string) {
  notice.value = { type, message }

  if (noticeTimer) {
    clearTimeout(noticeTimer)
  }

  noticeTimer = setTimeout(() => {
    notice.value = null
  }, 3200)
}

function resetForm() {
  Object.assign(form, createEmptyForm(defaultCategory.value))
  customCategory.value = !categoryOptions.value.includes(form.category)
  editingId.value = null
}

function fillForm(link: NavLink) {
  editingId.value = link.id
  form.title = link.title
  form.url = link.url
  form.category = link.category
  form.description = link.description
  form.icon = link.icon
  form.isCommon = link.isCommon
  form.sortOrder = link.sortOrder
  customCategory.value = !categoryOptions.value.includes(link.category)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function toggleCategoryMenu() {
  categoryMenuOpen.value = !categoryMenuOpen.value
}

function selectCategory(category: string) {
  customCategory.value = false
  categoryMenuOpen.value = false
  renamingCategory.value = ''
  form.category = category
}

function queueSelectCategory(category: string) {
  if (categorySelectTimer) {
    clearTimeout(categorySelectTimer)
  }

  categorySelectTimer = setTimeout(() => {
    selectCategory(category)
    categorySelectTimer = null
  }, 260)
}

function startNewCategory() {
  customCategory.value = true
  categoryMenuOpen.value = false
  renamingCategory.value = ''
  form.category = ''
  void nextTick(() => categoryInput.value?.focus())
}

function cancelNewCategory(force = false) {
  if (!force && form.category.trim()) {
    return
  }

  customCategory.value = false
  form.category = defaultCategory.value
}

function startCategoryRename(category: string) {
  if (categorySelectTimer) {
    clearTimeout(categorySelectTimer)
    categorySelectTimer = null
  }

  renamingCategory.value = category
  renameCategoryValue.value = category
  categoryMenuOpen.value = true
  void nextTick(() => categoryRenameInput.value?.select())
}

function cancelCategoryRename() {
  renamingCategory.value = ''
  renameCategoryValue.value = ''
}

async function submitCategoryRename() {
  const from = renamingCategory.value.trim()
  const to = renameCategoryValue.value.trim()

  if (!from || !to) {
    setNotice('error', '请填写分类名称。')
    return
  }

  try {
    const count = await renameCategory(from, to)

    if (form.category === from) {
      form.category = to
    }

    if (lastCategory.value === from) {
      lastCategory.value = to
    }

    if (activeCategory.value === from) {
      activeCategory.value = to
    }

    cancelCategoryRename()
    categoryMenuOpen.value = false
    setNotice('success', `已改名：${from} -> ${to}，更新 ${count} 条。`)
  } catch (error) {
    setNotice('error', error instanceof Error ? error.message : '分类改名失败。')
  }
}

async function moveCategory(category: string, direction: -1 | 1) {
  const nextCategories = [...categoryOptions.value]
  const index = nextCategories.indexOf(category)
  const targetIndex = index + direction

  if (index === -1 || targetIndex < 0 || targetIndex >= nextCategories.length) {
    return
  }

  const [current] = nextCategories.splice(index, 1)
  nextCategories.splice(targetIndex, 0, current)

  try {
    await updateCategoryOrder(nextCategories)
    setNotice('success', '分类排序已更新。')
  } catch (error) {
    setNotice('error', error instanceof Error ? error.message : '分类排序保存失败。')
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target

  if (!(target instanceof Node) || categoryControl.value?.contains(target)) {
    return
  }

  categoryMenuOpen.value = false
  cancelCategoryRename()
  cancelNewCategory()
}

async function submitLogin() {
  loginError.value = ''

  if (!password.value.trim()) {
    loginError.value = '请输入后台密码。'
    return
  }

  isLoggingIn.value = true

  try {
    await login(password.value)
    password.value = ''
    authState.value = 'ready'
    setNotice('success', '已进入后台。')
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : '登录失败。'
  } finally {
    isLoggingIn.value = false
  }
}

function handleLogout() {
  logout()
  authState.value = 'guest'
  resetForm()
}

async function submitForm() {
  try {
    const saved = await saveLink({
      id: editingId.value ?? undefined,
      title: form.title,
      url: form.url,
      category: form.category,
      description: form.description,
      icon: form.icon,
      isCommon: form.isCommon,
      sortOrder: form.sortOrder,
    })

    setNotice('success', editingId.value ? `已更新：${saved.title}` : `已新增：${saved.title}`)
    lastCategory.value = saved.category
    resetForm()
  } catch (error) {
    setNotice('error', error instanceof Error ? error.message : '保存失败。')
  }
}

async function handleDelete(link: NavLink) {
  if (!window.confirm(`确定删除「${link.title}」吗？`)) {
    return
  }

  try {
    await deleteLink(link.id)
    setNotice('success', `已删除：${link.title}`)

    if (editingId.value === link.id) {
      resetForm()
    }
  } catch (error) {
    setNotice('error', error instanceof Error ? error.message : '删除失败。')
  }
}

function handleExport() {
  const filename = `asmr-nav-${new Date().toISOString().slice(0, 10)}.json`
  downloadTextFile(filename, exportLinks())
  setNotice('success', '已导出 JSON。')
}

async function handleImport() {
  if (!importText.value.trim()) {
    setNotice('error', '请先粘贴 JSON。')
    return
  }

  try {
    const count = await importLinks(importText.value, importMode.value)
    importText.value = ''
    setNotice('success', `导入成功：${count} 条。`)
  } catch (error) {
    setNotice('error', error instanceof Error ? error.message : '导入失败。')
  }
}

async function handleRefresh() {
  await refreshLinks({ force: true })
  setNotice(backendReachable.value ? 'success' : 'error', backendReachable.value ? '已同步最新数据。' : '没有连上 Worker。')
}

onMounted(async () => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  authState.value = await validateSession() ? 'ready' : 'guest'
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)

  if (categorySelectTimer) {
    clearTimeout(categorySelectTimer)
  }

  if (noticeTimer) {
    clearTimeout(noticeTimer)
  }
})
</script>

<template>
  <main class="admin-page">
    <RouterLink class="back-entry" to="/">返回首页</RouterLink>

    <section v-if="authState !== 'ready'" class="admin-login">
      <form class="login-card" @submit.prevent="submitLogin">
        <p class="login-kicker">ASMR收藏夹</p>
        <h1>后台管理</h1>
        <p class="login-copy">
          {{ authState === 'checking' ? '正在检查登录状态。' : '输入密码后才能维护导航链接。' }}
        </p>

        <label class="field-group">
          <span class="field-label">Password</span>
          <input
            v-model="password"
            class="field"
            type="password"
            autocomplete="current-password"
            placeholder="后台密码"
            :disabled="authState === 'checking' || isLoggingIn"
          >
        </label>

        <p v-if="loginError" class="form-error">{{ loginError }}</p>

        <button class="btn btn-primary" type="submit" :disabled="authState === 'checking' || isLoggingIn">
          {{ isLoggingIn ? '验证中' : '进入后台' }}
        </button>
      </form>
    </section>

    <template v-else>
      <section class="admin-workspace">
        <header class="admin-topbar">
          <div>
            <p class="login-kicker">admin</p>
            <h1>ASMR 导航后台</h1>
          </div>
          <div class="admin-actions">
            <span class="sync-pill" :class="{ 'is-remote': backendReachable }">
              {{ backendReachable ? 'Worker / D1' : '本地缓存' }}
            </span>
            <span class="sync-pill">{{ links.length }} 条链接</span>
            <button class="btn btn-muted" type="button" @click="handleRefresh">同步</button>
            <button class="btn btn-muted" type="button" @click="handleLogout">退出</button>
          </div>
        </header>

        <Transition name="notice">
          <div v-if="notice" class="notice" :class="notice.type === 'error' ? 'notice-error' : 'notice-success'">
            {{ notice.message }}
          </div>
        </Transition>

        <section class="admin-command-panel">
          <div class="command-heading">
            <p class="login-kicker">{{ editingId ? 'editing card' : 'new card' }}</p>
            <h2>{{ editingId ? '编辑当前导航卡片' : '管理网站导航卡片' }}</h2>
          </div>

          <form class="quick-form" @submit.prevent="submitForm">
            <div ref="categoryControl" class="category-control" :class="{ 'is-custom': customCategory }">
              <span class="sr-only">分类</span>
              <input
                v-if="customCategory"
                ref="categoryInput"
                v-model.trim="form.category"
                class="field quick-field"
                type="text"
                placeholder="输入新分类"
                required
                @keydown.escape.prevent="cancelNewCategory(true)"
              >
              <div v-else class="category-picker">
                <button
                  class="field quick-field category-select-button"
                  type="button"
                  aria-haspopup="listbox"
                  :aria-expanded="categoryMenuOpen"
                  @click="toggleCategoryMenu"
                  @keydown.escape.prevent="categoryMenuOpen = false"
                >
                  <span>{{ form.category }}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                <div v-if="categoryMenuOpen" class="category-menu" role="listbox">
                  <div v-for="(category, index) in categoryOptions" :key="category" class="category-menu-row">
                    <div
                      v-if="renamingCategory === category"
                      class="category-rename-row"
                    >
                      <input
                        ref="categoryRenameInput"
                        v-model.trim="renameCategoryValue"
                        class="category-rename-input"
                        type="text"
                        @keydown.enter.stop.prevent="submitCategoryRename"
                        @keydown.escape.stop.prevent="cancelCategoryRename"
                      >
                      <button
                        class="category-rename-action"
                        type="button"
                        aria-label="保存分类名"
                        @click="submitCategoryRename"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </button>
                      <button
                        class="category-rename-action"
                        type="button"
                        aria-label="取消改名"
                        @click="cancelCategoryRename"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <button
                      v-else
                      class="category-menu-item category-menu-name"
                      type="button"
                      role="option"
                      :aria-selected="form.category === category"
                      title="双击改名"
                      @click="queueSelectCategory(category)"
                      @dblclick.stop.prevent="startCategoryRename(category)"
                    >
                      {{ category }}
                    </button>
                    <div v-if="renamingCategory !== category" class="category-order-actions">
                      <button
                        class="category-order-button"
                        type="button"
                        :disabled="index === 0"
                        aria-label="分类上移"
                        @click.stop="moveCategory(category, -1)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m6 15 6-6 6 6" />
                        </svg>
                      </button>
                      <button
                        class="category-order-button"
                        type="button"
                        :disabled="index === categoryOptions.length - 1"
                        aria-label="分类下移"
                        @click.stop="moveCategory(category, 1)"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <button
                    class="category-menu-item category-menu-add"
                    type="button"
                    aria-label="新增分类"
                    @click="startNewCategory"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <label>
              <span class="sr-only">标题</span>
              <input v-model.trim="form.title" class="field quick-field" type="text" placeholder="卡片标题" required>
            </label>

            <label>
              <span class="sr-only">链接</span>
              <input v-model.trim="form.url" class="field quick-field" type="text" placeholder="卡片链接" required>
            </label>

            <label>
              <span class="sr-only">图标字</span>
              <input v-model.trim="form.icon" class="field quick-field" type="text" maxlength="3" placeholder="图标字">
            </label>

            <label>
              <span class="sr-only">描述</span>
              <input v-model.trim="form.description" class="field quick-field" type="text" placeholder="描述（可选）">
            </label>

            <label>
              <span class="sr-only">排序</span>
              <input v-model.number="form.sortOrder" class="field quick-field sort-field" type="number" min="0" step="1" placeholder="排序">
            </label>

            <label class="common-toggle">
              <input v-model="form.isCommon" type="checkbox">
              <span>常用</span>
            </label>

            <button class="btn btn-primary quick-submit" type="submit" :disabled="syncState === 'saving'">
              {{ editingId ? '保存修改' : '+ 添加卡片' }}
            </button>
            <button v-if="editingId" class="btn btn-muted quick-cancel" type="button" @click="resetForm">
              取消
            </button>
          </form>

        </section>

        <section class="admin-control-row">
          <label class="field-group filter-search">
            <span class="field-label">搜索</span>
            <input v-model.trim="searchQuery" class="field" type="search" placeholder="标题、分类、网址">
          </label>

          <label class="field-group filter-category">
            <span class="field-label">分类</span>
            <select v-model="activeCategory" class="field">
              <option value="all">全部分类</option>
              <option v-for="category in categories" :key="category" :value="category">
                {{ category }}
              </option>
            </select>
          </label>

          <button class="btn btn-muted" type="button" @click="handleExport">导出 JSON</button>
        </section>

        <details class="import-box">
          <summary>导入 JSON</summary>
          <div class="import-body">
            <div class="import-controls">
              <select v-model="importMode" class="field">
                <option value="merge">合并导入</option>
                <option value="replace">整库替换</option>
              </select>
              <button class="btn btn-muted" type="button" @click="handleImport">执行导入</button>
            </div>
            <textarea
              v-model.trim="importText"
              class="textarea"
              placeholder='粘贴 [{ "title": "...", "url": "...", "category": "收藏" }]'
            ></textarea>
          </div>
        </details>

        <div class="table-card">
          <table class="link-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>网址</th>
                <th>图标</th>
                <th>描述</th>
                <th>分类</th>
                <th>常用</th>
                <th>排序</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="link in filteredLinks" :key="link.id">
                <td data-label="标题">
                  <strong>{{ link.title }}</strong>
                </td>
                <td data-label="网址">
                  <a :href="link.url" target="_blank" rel="noreferrer">{{ getHostLabel(link.url) }}</a>
                </td>
                <td data-label="图标">{{ link.icon || '自动' }}</td>
                <td data-label="描述">
                  <span>{{ link.description || '暂无描述' }}</span>
                </td>
                <td data-label="分类">{{ link.category }}</td>
                <td data-label="常用">
                  <span class="common-state" :class="{ 'is-on': link.isCommon }">
                    {{ link.isCommon ? '是' : '否' }}
                  </span>
                </td>
                <td data-label="排序">{{ link.sortOrder }}</td>
                <td data-label="操作">
                  <div class="table-actions">
                    <button class="btn btn-muted btn-small" type="button" @click="fillForm(link)">编辑</button>
                    <button class="btn btn-danger btn-small" type="button" @click="handleDelete(link)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>
