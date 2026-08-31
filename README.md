# LCE Frontend

LCE 的前端控制台，用于管理 API Key、查看请求日志和用户排行榜。

## 技术栈

- **Next.js 16** (App Router)
- **React 19** + **TypeScript 5**
- **Tailwind CSS 4** + Radix UI 组件
- **PostgreSQL** — 持久化存储用户信息、API Key、请求日志、排行榜等业务数据，表在首次请求时自动创建
- **Redis** — 缓存 API Key 查询结果，减少高频场景下的数据库访问压力，Key 重置时自动失效缓存
- **Better Auth** + LinuxDo / GitHub OAuth 认证

## 功能

- **多方式登录与邮箱验证** — 支持 LinuxDo / GitHub 单点登录；邮箱密码注册必须完成邮箱验证后才能登录；GitHub 登录会校验账号注册年龄，拒绝过新的账号
- **API Key 管理** — 生成、查看、重置 API Key，支持一键复制
- **请求日志** — 分页查看请求记录，包含方法、状态码、耗时、IP 等详情，支持自动刷新
- **请求统计** — 展示成功/失败/总计请求数
- **每日排行榜** — 实时统计代码检索与提示词增强调用量 Top 10，不计入索引请求，支持日期切换查看历史数据
- **MCP 配置文档** — 提供 Auggie CLI 安装指引与 MCP 配置模板
- **索引失败排查** — 区分失败记录清理与云端快照删除，并提供重新建立索引的恢复流程；详见 [`docs/cloud-index-troubleshooting.md`](docs/cloud-index-troubleshooting.md)

## 项目结构

```
app/
├── page.tsx                 # 首页
├── login/page.tsx           # 登录页
├── console/page.tsx         # 控制台（Key管理/文档/日志/个人信息）
├── leaderboard/page.tsx     # 排行榜
├── api/
│   ├── auth/[...all]/       # OAuth 认证
│   ├── user/                # 用户信息
│   ├── key/                 # API Key 管理
│   ├── key/reveal/          # 查看完整 Key
│   ├── logs/                # 请求日志列表
│   ├── logs/[id]/           # 日志详情
│   └── leaderboard/         # 排行榜数据
components/                  # UI 组件
lib/
├── auth.ts                  # 认证配置
├── auth-client.ts           # 客户端认证
├── db.ts                    # 数据库操作
└── utils.ts                 # 工具函数
```

## 环境变量

复制 `.env.example` 为 `.env.local` 并填写：

```bash
cp .env.example .env.local
```

| 变量 | 说明 | 示例 |
|------|------|------|
| `BETTER_AUTH_URL` | 应用 URL | `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | Auth 加密密钥 | 随机字符串 |
| `LCE_PACKAGE_REGISTRY_URL` | 客户端版本查询使用的软件包 registry；可替换为镜像或私有 registry | `https://registry.npmjs.org` |
| `AUTH_LINUXDO_ID` | LinuxDo OAuth Client ID | 从 LinuxDo 获取 |
| `AUTH_LINUXDO_SECRET` | LinuxDo OAuth Client Secret | 从 LinuxDo 获取 |
| `AUTH_GITHUB_ID` | GitHub OAuth Client ID | 从 GitHub 获取 |
| `AUTH_GITHUB_SECRET` | GitHub OAuth Client Secret | 从 GitHub 获取 |
| `AUTH_GITHUB_MIN_ACCOUNT_AGE_DAYS` | GitHub 新注册用户最小账号年龄（天）；留空使用默认值，非法值会拒绝启动/请求，设为 `0` 关闭校验 | `365` |
| `SMTP_HOST` | 邮箱验证 SMTP 主机；未配置时关闭邮箱密码注册 | - |
| `SMTP_PORT` | SMTP 端口 | `587` |
| `SMTP_SECURE` | 是否使用隐式 TLS；通常 465 端口使用 `true` | `false` |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP 认证信息；必须同时填写或同时留空 | - |
| `SMTP_FROM` | 验证邮件发件人地址 | `noreply@example.com` |
| `POSTGRES_HOST` | PostgreSQL 主机 | `localhost` |
| `POSTGRES_PORT` | PostgreSQL 端口 | `5432` |
| `POSTGRES_USER` | PostgreSQL 用户名 | `postgres` |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 | - |
| `POSTGRES_DB` | PostgreSQL 数据库名 | `postgres` |
| `REDIS_HOST` | Redis 主机 | `localhost` |
| `REDIS_PORT` | Redis 端口 | `6379` |

## 快速开始

```bash
# 安装依赖
corepack enable
pnpm install

# 配置环境变量
cp .env.example .env.local

# 启动开发服务器
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

核心表（`user`/`session`/`account`）在首次请求时由 Better Auth 自动创建；业务表（`api_keys` 等）在服务启动时自动创建。

## OAuth 接入说明

### GitHub OAuth App
1. 到 [GitHub Developer Portal](https://github.com/settings/developers) 创建 OAuth App
2. Authorization callback URL 填 `<BETTER_AUTH_URL>/api/auth/callback/github`（例如本地 `http://localhost:3000/api/auth/callback/github`）
3. 拿到 Client ID / Secret 填入 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`
4. 如果创建的是 **GitHub App** 而非 OAuth App，额外需到 *Permissions → Account Permissions → Email Addresses* 开 **Read-Only**，否则登录会报 `email_not_found`

### 新增 / 修改 `additionalFields` 后的 schema 同步
项目在 `lib/auth.ts` 的 `user.additionalFields` 中声明了自定义列（`trustLevel`、`username`、`githubCreatedAt`）。Better Auth 只会在首次建表时按配置生成列；**对已有表新增字段**需手动同步，有两种方式：

- **方式 A（推荐）**：使用当前开发环境选定的包执行器运行 Better Auth 官方 CLI 的 `migrate -y`，由 CLI 自动比较 schema。这里不把某个临时包执行命令写成项目协议；仓库声明的贡献者包管理器是 `package.json#packageManager`。
- **方式 B**：审阅并执行等价数据库迁移。例如新增 GitHub 注册时间列时，可执行：

```sql
ALTER TABLE "user" ADD COLUMN "githubCreatedAt" TIMESTAMP;
```

## 常用命令

```bash
pnpm dev      # 启动开发服务器
pnpm build    # 生产构建
pnpm start        # 运行生产服务器
pnpm lint     # ESLint 检查
```
