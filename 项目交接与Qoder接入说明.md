# 录音棚档期匹配平台：项目交接与 Qoder 接入说明

> 更新日期：2026-09-22

> 本文不包含任何账号密码、数据库密钥或会话密钥。

## 1. 项目是什么

这是一个供后台管理员、录音棚和发音人供应商共同使用的排期匹配平台。

主要能力：

- 录音棚维护营业时间、特殊开放规则和不可用档期。
- 供应商按项目和发音人选择录音档期，系统按 P0/P1/P2 规则推荐录音棚。
- 预约成功后自动锁定档期。
- 供应商和录音棚均可申请取消预约，由后台审核。
- 后台可调整业务记录，并向相关账号发送站内通知。
- 后台可发送全站公告和账号私信。
- 三种角色可将各自权限范围内的数据导出为本地 Excel。

## 2. 当前线上环境

- GitHub 仓库：https://github.com/MUYANG564/studio-scheduling
- 正式网站：https://studio-scheduling.onrender.com
- 部署方式：GitHub `main` 分支更新后，Render 自动构建并部署。
- 正式数据库：Supabase。
- Supabase 项目 ref：`duoavxavydlwkplpoidr`。

重要：正式环境的密钥只应保存在 Render 环境变量中，不得写进代码、文档、聊天记录或前端。

## 3. 技术结构

- 前端：React 19、TypeScript、Vite、Tailwind CSS。
- 后端：Node.js HTTP 服务。
- 数据库：线上使用 Supabase PostgreSQL；本地开发可使用内存演示数据。
- 登录与权限：由服务端处理，浏览器不直接连接数据库。
- Node.js 要求：20.19+、22.12+ 或更高版本。

主要目录：

- `src/`：三种角色的前端页面。
- `functions/`：业务接口、鉴权、匹配规则、Excel 导出。
- `server/`：自托管 Node 服务、Supabase 连接和数据库迁移。
- `dev/`：本地内存服务和演示数据，不参与线上部署。
- `dist/`：构建生成的前端文件。

重点文件：

- `src/pages/Vendor.tsx`：供应商主页、预约和匹配界面。
- `src/pages/Studio.tsx`：录音棚主页与档期管理。
- `src/pages/Admin.tsx`：后台管理界面。
- `functions/handler.mjs`：主要接口和权限入口。
- `functions/matching.mjs`：P0/P1/P2 匹配规则。
- `functions/backup.mjs`：角色隔离的 Excel 导出数据。
- `server/schema.sql`：完整数据库结构。
- `server/migration-*.sql`：现有数据库的增量迁移。

## 4. 同事如何用自己的 Qoder 接手

### 第一步：取得 GitHub 权限

仓库所有者在 GitHub 中把同事添加为 Collaborator。建议只给仓库协作权限，暂时不要分享 Render 和 Supabase 的生产管理权限。

### 第二步：克隆并打开项目

```sh
git clone https://github.com/MUYANG564/studio-scheduling.git
cd studio-scheduling
npm ci
```

然后用 Qoder 打开整个 `studio-scheduling` 文件夹，不要只打开某一个文件。

### 第三步：让 Qoder 先同步上下文

可把下面这段话直接发给同事的 Qoder：

```text
请先完整阅读《项目交接与Qoder接入说明.md》、README.md、package.json 和 .env.example。
这是已经在线运行的 React + Node + Supabase 平台。修改前先检查 git status，创建独立功能分支；禁止直接修改或推送 main，禁止连接或修改生产数据库，禁止读取、展示或提交任何密钥。先使用本地内存服务完成开发，运行构建、自动化测试和浏览器验证，然后把改动和验证结果提交 Pull Request，等待仓库所有者审核后再上线。
```

Qoder 可以通过这份文档理解项目和操作边界，但仍应以当前代码、Git 历史和实际配置为准。

## 5. 安全开发流程

每次修改都按下面顺序进行：

1. 拉取最新代码：
   ```sh
   git switch main
   git pull --ff-only
   ```
2. 创建独立分支，不直接在 `main` 开发：
   ```sh
   git switch -c feature/简短功能名称
   ```
3. 修改前运行 `git status`，确认没有覆盖别人的未提交工作。
4. 使用本地演示环境开发，不连接生产 Supabase。
5. 完成后运行构建和测试。
6. 在浏览器中验证受影响的真实操作流程。
7. 只提交本次相关文件，推送功能分支。
8. 创建 Pull Request，由仓库所有者审核。
9. 审核通过后才能合并到 `main`；合并会触发 Render 自动部署。
10. 部署后再用测试账号验证正式网站。

## 6. 本地运行与验证

打开两个终端。

终端一，启动本地后端：

```sh
npm run dev:local
```

终端二，启动前端：

```sh
npm run dev
```

本地演示账号定义在 `dev/seed.mjs`，仅用于本机测试，不能作为生产账号使用。

提交 Pull Request 前至少执行：

```sh
npm run build
npm test
```

涉及界面修改时，还必须在浏览器中检查：

- 目标功能的正常流程。
- 空数据、错误提示和弹窗关闭。
- 管理员、录音棚、供应商之间的数据隔离。
- 浏览器控制台没有新增报错。

## 7. 必须遵守的红线

- 不得把生产密钥写入代码、`.env`、文档、截图、聊天或提交记录。
- 不得把 `SUPABASE_SERVICE_ROLE_KEY` 放入任何前端变量。
- 不得直接向 `main` 推送未经审核的代码。
- 不得在生产 Supabase SQL Editor 中试验 SQL。
- 不得删除、重建或批量修改生产数据来验证功能。
- 不得跳过测试、Git hooks 或权限校验。
- 不得在不了解影响时修改 `functions/handler.mjs` 中的角色鉴权。
- 不得在数据库迁移完成前发布依赖新字段或新函数的代码。
- 不得把本地演示账号和生产账号混用。

## 8. 数据库改动规则

数据库改动是风险最高的部分，应采用“先兼容、后发布”的方式：

1. 在 `server/` 中新增独立的 `migration-功能名称.sql`，不要直接依赖手工修改。
2. 迁移应尽量兼容现有线上数据，避免直接删除字段或表。
3. 先在测试 Supabase 项目执行并验证。
4. Pull Request 中明确列出迁移内容、影响表和回滚方式。
5. 经仓库所有者确认并备份后，才可在生产 Supabase 执行。
6. 生产迁移成功后，再合并和部署依赖该迁移的代码。

当前已执行过的主要迁移：

- `server/migration-city-matching.sql`
- `server/migration-booking-appeals.sql`
- `server/migration-admin-record-adjustments.sql`

不要因为文件存在而重复执行；应先确认生产数据库当前状态。

## 9. 建议的权限配置

为了避免误操作，建议仓库所有者完成以下设置：

- GitHub 为 `main` 开启 Branch protection。
- 要求通过 Pull Request 才能合并。
- 要求至少一次审核和测试通过。
- 禁止 force push 和删除 `main`。
- 同事默认只获得 GitHub 仓库协作权限。
- Render 和生产 Supabase 权限仅在确有上线职责时单独授予。
- 另建一个测试 Supabase 项目供开发和迁移验证。

只要遵守这些规则，即使功能分支中的代码有问题，也不会自动影响正式网站。

## 10. 当前交接状态

截至 2026-09-22：

- GitHub `main` 最新功能提交为 `aa86ce5`：优化供应商预约记录的项目分组展示。
- Render 已确认该提交为 Live，正式站已加载以下功能：
  - 按“项目/发音人 → 录音棚 → 预约批次”分组展示供应商预约。
  - 支持“录音棚优先”和“时间优先”。
  - 单批取消仍绑定原始 booking，不会误取消整个项目。
- 本次功能不涉及数据库迁移。
- 发布前已通过前端构建、27 项自动化测试和浏览器操作验证。

接手前必须先运行：

```sh
git status
git log -5 --oneline
```

不要仅依赖本节描述判断当前版本；GitHub、Git 历史和代码是最终事实来源。

## 11. 双方协作与原维护入口

交接后不需要移除原维护者的入口：

- 原维护者继续保留 GitHub 仓库所有权、Render 服务和 Supabase 项目的管理权。
- 新同事通过自己的 GitHub 账号和 Qoder，在独立功能分支中开发。
- 双方均从同一个 GitHub 仓库同步代码，不互相复制覆盖本地文件。
- 所有改动通过 Pull Request 合并，可清楚看到谁改了什么，并可在出现问题时回退。
- 生产密钥仍只保存在 Render，不需要在两个人之间传递。

建议把 `main` 设置为受保护分支。这样原维护者和同事都可以继续修改，但任何一方的未完成代码都不会自动上线。

## 12. 上线责任边界

普通功能开发不需要生产密钥，也不应操作正式环境。

只有仓库所有者明确授权本次上线后，负责人才能：

- 合并 Pull Request 到 `main`。
- 执行已经审核的生产数据库迁移。
- 查看 Render 部署状态。
- 使用测试账号验证正式网站。

任何“推送 main、执行生产 SQL、修改环境变量、删除数据”的操作，都应在执行前再次确认目标和影响范围。
