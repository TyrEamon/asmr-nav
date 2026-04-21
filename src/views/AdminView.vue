<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
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
  sortOrder: number
}

function createEmptyForm(): FormState {
  return {
    title: '',
    url: '',
    category: '收藏',
    description: '',
    icon: '',
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
  exportLinks,
  importLinks,
} = useNavLibrary()

const authState = ref<AuthState>('checking')
const password = ref('')
const loginError = ref('')
const isLoggingIn = ref(false)
const form = reactive(createEmptyForm())
const editingId = ref<string | null>(null)
const searchQuery = ref('')
const activeCategory = ref('all')
const importText = ref('')
const importMode = ref<ImportMode>('merge')
const notice = ref<{ type: 'success' | 'error'; message: string } | null>(null)

let noticeTimer: ReturnType<typeof setTimeout> | null = null

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

    return [link.title, link.url, link.category, link.description, link.icon]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
})

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
  Object.assign(form, createEmptyForm())
  editingId.value = null
}

function fillForm(link: NavLink) {
  editingId.value = link.id
  form.title = link.title
  form.url = link.url
  form.category = link.category
  form.description = link.description
  form.icon = link.icon
  form.sortOrder = link.sortOrder
  window.scrollTo({ top: 0, behavior: 'smooth' })
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
      sortOrder: form.sortOrder,
    })

    setNotice('success', editingId.value ? `已更新：${saved.title}` : `已新增：${saved.title}`)
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
  authState.value = await validateSession() ? 'ready' : 'guest'
})

onBeforeUnmount(() => {
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
      <header class="admin-header">
        <div>
          <p class="login-kicker">admin</p>
          <h1>链接管理</h1>
        </div>
        <div class="admin-actions">
          <span class="sync-pill" :class="{ 'is-remote': backendReachable }">
            {{ backendReachable ? 'Worker / D1' : '本地缓存' }}
          </span>
          <button class="btn btn-muted" type="button" @click="handleRefresh">同步</button>
          <button class="btn btn-muted" type="button" @click="handleLogout">退出</button>
        </div>
      </header>

      <Transition name="notice">
        <div v-if="notice" class="notice" :class="notice.type === 'error' ? 'notice-error' : 'notice-success'">
          {{ notice.message }}
        </div>
      </Transition>

      <section class="admin-layout">
        <aside class="admin-panel">
          <div class="panel-title">
            <h2>{{ editingId ? '编辑链接' : '新增链接' }}</h2>
            <button v-if="editingId" class="btn btn-muted btn-small" type="button" @click="resetForm">
              取消
            </button>
          </div>

          <form class="admin-form" @submit.prevent="submitForm">
            <label class="field-group">
              <span class="field-label">标题</span>
              <input v-model.trim="form.title" class="field" type="text" placeholder="例如：猫耳FM" required>
            </label>

            <label class="field-group">
              <span class="field-label">网址</span>
              <input v-model.trim="form.url" class="field" type="text" placeholder="https://example.com" required>
            </label>

            <div class="form-row">
              <label class="field-group">
                <span class="field-label">分类</span>
                <input
                  v-model.trim="form.category"
                  class="field"
                  type="text"
                  list="category-options"
                  placeholder="常用推荐"
                  required
                >
              </label>

              <label class="field-group">
                <span class="field-label">图标字</span>
                <input v-model.trim="form.icon" class="field" type="text" maxlength="3" placeholder="AS">
              </label>
            </div>

            <label class="field-group">
              <span class="field-label">描述</span>
              <input v-model.trim="form.description" class="field" type="text" placeholder="显示在卡片第二行">
            </label>

            <label class="field-group">
              <span class="field-label">排序</span>
              <input v-model.number="form.sortOrder" class="field" type="number" min="0" step="1">
            </label>

            <button class="btn btn-primary" type="submit" :disabled="syncState === 'saving'">
              {{ editingId ? '保存修改' : '新增链接' }}
            </button>
          </form>

          <datalist id="category-options">
            <option v-for="category in categories" :key="category" :value="category" />
          </datalist>
        </aside>

        <section class="admin-content">
          <div class="admin-tools">
            <label class="field-group">
              <span class="field-label">搜索</span>
              <input v-model.trim="searchQuery" class="field" type="search" placeholder="标题、分类、网址">
            </label>

            <label class="field-group">
              <span class="field-label">分类</span>
              <select v-model="activeCategory" class="field">
                <option value="all">全部分类</option>
                <option v-for="category in categories" :key="category" :value="category">
                  {{ category }}
                </option>
              </select>
            </label>

            <button class="btn btn-muted" type="button" @click="handleExport">导出</button>
          </div>

          <section class="import-box">
            <div class="import-controls">
              <select v-model="importMode" class="field">
                <option value="merge">合并导入</option>
                <option value="replace">整库替换</option>
              </select>
              <button class="btn btn-muted" type="button" @click="handleImport">导入 JSON</button>
            </div>
            <textarea v-model.trim="importText" class="textarea" placeholder='粘贴 [{ "title": "...", "url": "...", "category": "收藏" }]'></textarea>
          </section>

          <div class="table-card">
            <table class="link-table">
              <thead>
                <tr>
                  <th>链接</th>
                  <th>分类</th>
                  <th>排序</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="link in filteredLinks" :key="link.id">
                  <td data-label="链接">
                    <strong>{{ link.title }}</strong>
                    <span>{{ link.description || getHostLabel(link.url) }}</span>
                    <a :href="link.url" target="_blank" rel="noreferrer">{{ getHostLabel(link.url) }}</a>
                  </td>
                  <td data-label="分类">{{ link.category }}</td>
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
      </section>
    </template>
  </main>
</template>
