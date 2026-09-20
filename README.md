# 录音棚 × 发音人 排期匹配系统

一个可自托管的排期匹配工具：录音棚维护自己的空闲档期，发音人（或其供应商）录入需要录音的档期后自动匹配合适的录音棚，选择后自动锁定档期并通知录音棚；录音棚可对“更新空闲前就被预约”的档期发起申诉，管理员审批后自动释放并通知发音人重新选择。三种角色（管理员 / 录音棚 / 发音人）各有独立界面。

- 前端：React 19 + Vite + Tailwind（构建为纯静态文件）
- 后端：一个零依赖的 Node 服务，鉴权与业务规则全部在服务端执行
- 存储：单个 JSON 文件（无需单独安装数据库）
- 账号：系统自带用户名/密码登录（录音棚、供应商都是外部人员，无需任何第三方账号）

> 数据保存在一个 JSON 文件里，适合中小规模使用、内部试运行和自托管。数据量很大或需要多实例时，建议再迁移到正式数据库。

## 功能概览

- 录音棚：以半小时为最小粒度维护每天的空闲档期；录音棚信息一次录入长期保留。
- 发音人 / 供应商：录入项目名称、艺名/姓名和需要的档期，系统自动匹配可用录音棚（显示名称与地点），可按距离/地点挑选；选定后自动锁定对应档期。
- 优先推荐能覆盖全部档期的方案（含组合方案）；被拒绝时可先选单个录音棚，剩余档期继续单独安排。
- 申诉：录音棚可对某个预约发起申诉；管理员审批通过后释放该档期，并通知发音人**无需重新录入日程**即可重新选择。
- 管理员：查看所有排期，新增/删除录音棚与发音人账号，添加仅管理员可见的备注。
- 通知：站内通知（登录后可见）。

## 快速开始（本地运行）

需要 Node 20.19+ 或 22.12+。

```sh
# 1. 安装依赖
npm ci

# 2. 构建前端静态文件
npm run build

# 3. 创建第一个管理员账号（密码至少 8 位）
npm run create-admin -- admin 你的强密码 管理员 admin@example.com

# 4. 启动服务
APP_SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") npm start
```

浏览器打开 `http://127.0.0.1:8000` 即可，用刚才创建的管理员账号登录。登录后，在管理员界面新增录音棚账号和发音人账号，把账号密码分发给对应的人使用。

## 环境变量

复制 `.env.example` 了解全部说明。关键项：

| 变量 | 作用 | 建议 |
| --- | --- | --- |
| `APP_SESSION_SECRET` | 登录令牌签名密钥 | **正式环境必须设置**为一段随机长字符串，泄露会导致别人可伪造登录 |
| `SUPABASE_URL` | Supabase 项目地址 | 设置后数据存到 Supabase 在线数据库（推荐用于上线部署） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端密钥 | 与 `SUPABASE_URL` 一起设置；**服务端专用密钥，切勿放进前端或代码仓库** |
| `DATA_FILE` | 本地数据文件路径 | 仅在**未**配置 Supabase 时使用；默认 `./data/store.json` |
| `PORT` | 监听端口 | 多数平台会自动注入；本地默认 8000 |
| `HOST` | 监听地址 | 默认 `0.0.0.0`（对外开放） |

数据存储会自动选择：**同时设置了 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 就用 Supabase 在线数据库**，否则回退到本地 JSON 文件。

服务本身不读取 `.env` 文件，请通过部署平台的环境变量设置，或在启动命令前用 `KEY=值` 传入。

## 部署上线（免费方案：Render 免费托管 + Supabase 免费数据库）

这样可以完全免费上线，且数据长期保留。

**第一步：准备在线数据库（Supabase）**

1. 注册 [supabase.com](https://supabase.com) 并新建一个免费项目（记住数据库区域，选离你近的）。
2. 打开项目的 **SQL Editor**，把本仓库 `server/schema.sql` 的内容整段粘贴运行，创建数据表。
3. 在 **Project Settings → API** 里记下两项：
   - `Project URL`（即 `SUPABASE_URL`）
   - `service_role` 密钥（即 `SUPABASE_SERVICE_ROLE_KEY`，**保密，只用于服务端**）

> Supabase 免费项目在连续约 7 天无访问后会自动暂停，届时在控制台点一下恢复即可；正常使用不受影响。

**第二步：部署网页服务（Render）**

1. 把本项目推送到你的 GitHub 仓库。
2. 在 [render.com](https://render.com) 新建一个 **Web Service**，连接该仓库。
3. 构建命令：`npm ci && npm run build`
4. 启动命令：`npm start`
5. 环境变量里填入：
   - `APP_SESSION_SECRET`：一段随机长字符串
   - `SUPABASE_URL`：上一步的 Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`：上一步的 service_role 密钥
6. 部署成功后，创建管理员账号（用接口一次性初始化，仅在还没有管理员时有效）：
   ```sh
   curl -X POST "https://你的域名/functions/v1/app?action=bootstrap" \
     -H "content-type: application/json" \
     -d '{"username":"admin","password":"你的强密码","display_name":"管理员"}'
   ```
7. 打开 Render 分配的网址，用管理员账号登录，开始录入录音棚与发音人。

> 想要更稳定（免暂停、不休眠）可改用付费实例，方法相同，只是套餐不同。

## 目录结构

```
src/            前端界面（三种角色）
functions/      业务与鉴权核心：handler.mjs / authlib.mjs / matching.mjs
server/         自托管服务：index.mjs（HTTP 服务） db.mjs（数据源选择）
                store.mjs（文件存储） create-admin.mjs schema.sql（建表脚本）
dev/            本地开发用的内存服务与演示数据（不参与部署）
dist/           构建产物（npm run build 生成）
```

## 安全说明

- 所有权限校验都在服务端（`functions/handler.mjs`）完成，浏览器不会直接接触存储。
- 密码使用 PBKDF2-SHA256 加盐哈希保存；登录令牌用 HMAC-SHA256 签名。
- 请务必设置强随机的 `APP_SESSION_SECRET`，且不要提交到代码仓库。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
