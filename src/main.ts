import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import './style.css'
import App from './App.vue'
import HomeView from './views/HomeView.vue'
import AdminView from './views/AdminView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { title: 'ASMR收藏夹 - 有你想要的吗？' },
    },
    {
      path: '/admin',
      name: 'admin',
      component: AdminView,
      meta: { title: '后台管理 - ASMR收藏夹' },
    },
  ],
})

router.afterEach((to) => {
  document.title = typeof to.meta.title === 'string' ? to.meta.title : 'ASMR收藏夹'
})

createApp(App).use(router).mount('#app')
