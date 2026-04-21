# ASMR Nav

一个按 `asmrscj.com` 形态做的轻量 ASMR 导航站：前台显示时间、百度搜索和分类链接；后台用密码登录后维护网址；部署目标是 Cloudflare Workers + D1。

## 功能

- `/`：导航首页，包含时间、日期、百度搜索、分类链接卡片。
- `/admin`：后台管理，进入前必须输入密码。
- Worker API：公开读取链接，后台登录后可新增、编辑、删除、导入、导出。
- D1：链接持久化存储，首次访问会自动写入示例数据。

## 本地开发

安装依赖：

```bash
npm install
```

前台开发：

```bash
npm run dev
```

完整 Worker 预览：

```bash
copy .dev.vars.example .dev.vars
npm run cf:dev
```

`.dev.vars` 里至少要配置：

```text
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=一串足够长的随机字符
```

## Cloudflare 部署

1. 登录 Wrangler：

```bash
npx wrangler login
```

2. 创建 D1：

```bash
npm run d1:create
```

把命令输出里的 `database_id` 填到 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

3. 应用 D1 migration：

```bash
npm run d1:migrate:remote
```

4. 设置后台密码和会话密钥：

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

5. 部署：

```bash
npm run cf:deploy
```

部署后访问：

```text
https://你的-worker地址/
https://你的-worker地址/admin
https://你的-worker地址/api/health
```

后台密码只在 Worker 里校验；前端拿到的是有过期时间的签名 session token。
