<div align="center">

# ⌨️ dsh-prompt-history

**DSH Web 输入框的「类 Linux shell」提示词历史 + 终端式复制粘贴插件。**

*像在终端里一样按 ↑ —— 历史、引用、粘贴，一个插件搞定。*

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#)
[![npm version](https://img.shields.io/npm/v/dsh-prompt-history)](https://www.npmjs.com/package/dsh-prompt-history)
[![npm downloads](https://img.shields.io/npm/dm/dsh-prompt-history)](https://www.npmjs.com/package/dsh-prompt-history)

[English](README.en.md) · **简体中文** · [Español](README.es.md) · [Português](README.pt.md)

</div>

---

## 兼容性

| 表面 | 状态 |
|---|---|
| 平台 | 仅 Web GUI（客户端插件；状态存于浏览器本地；无网络请求、无原生代码） |
| Node | `>=20` |
| 模型 | 任意（不发起模型请求 —— 纯 UI 行为） |
| 界面语言 | 中文 / English（跟随 DSH 应用语言，设置页可切换） |

## 你能得到什么

`dsh-prompt-history` 把终端的输入历史搬进 DeepSeek Harness Web 输入框：

1. **类 shell 的方向键召回** — 空输入时 **↑** 召回上一条发送过的消息（最新在前）；**输入前缀后按 ↑** 跳到最近一条以该前缀开头的消息（bash 的 `history-search-backward` 行为），继续按 ↑ 往前翻匹配；**↓** 向后翻（含前缀匹配的前向），翻到底时**恢复你翻历史之前正在输入的那一行**（readline 的 pending-line 行为）。
2. **编辑即退出** — 浏览历史时一旦动手编辑，自动回到当前行，不再继续翻。
3. **Ctrl+R 反向搜索** — 增量搜索历史，输入时实时匹配最近条目（浮层显示 `(reverse-i-search)`查询`），再按 Ctrl+R 看更早匹配；Enter 采用、Esc 取消并恢复原输入。
4. **复制 + 引用（两种模式，设置里切换）** — 页面里任何非空选区——输入框、聊天消息、代码块等——按所选模式处理：
   - **工具栏**（默认）：选区上方出现「复制」「引用」按钮——复制点击才写剪贴板（不刷屏 Win+V）；**引用**把选中文本的**完整内容**以简约的 `>` 引用块插入输入框（标准 markdown 引用，发送时渲染为引用块）。
   - **选中即自动复制**：终端风格，选中直接写系统剪贴板。
5. **鼠标右键直接粘贴** — 在输入框上右键即粘贴剪贴板内容（和 Linux 终端一致，不弹菜单）；粘贴走与 Ctrl+V 完全一致的管线（图片与引用 chip 行为一致），execCommand 路径被限制时自动回退到 Clipboard API 手动插入。
6. **跨会话历史记忆**（设置里可开关，默认关）— 开启后 ↑/↓ 历史在会话间保持，存于浏览器本地（上限 200 条），刷新/切换会话不丢失。
7. **会话目录（Chat TOC）** — 聊天内容多时，对话左侧边缘有一个半透明、可拖动的把手（悬停变亮），点击展开按时间顺序列出你发送过的所有消息，点击任意一条即可跳转到对应位置；条目多时可在目录内滚动查看全部；点击外部或按 Esc 关闭。可在设置里**一键开关**。

纯 UI 行为：不产生会话事件、不改变 agent 循环、不发起模型请求。召回/引用的文本只会进入输入框草稿，只有**你**按 Enter 才会到达模型。

## 快速开始

```sh
# 1. 把插件装进你的 profile
dsh plugin --profile web add dsh-prompt-history

# 2. 刷新页面即可使用（无需重启服务）
```

## 安装与卸载

- **npm 渠道**（已发布版本）：`dsh plugin --profile web add dsh-prompt-history`
- **源码渠道**（本地开发，最新 `main`）：`dsh plugin --profile web add "github:Xiaofei-fei/dsh-prompt-history#main"`（源码检出需先 `pnpm run build` —— 未构建的 bundle 会拒绝启动）
- **卸载**：`dsh plugin --profile web remove dsh-prompt-history`

## 配置

打开 **设置 → `>_ 终端式输入`**（存于浏览器本地，修改立即生效）：

| 选项 | 默认 | 说明 |
|---|---|---|
| 复制方式（选中文字时） | `工具栏复制` | `工具栏`（推荐，点击才写剪贴板）/ `选中即自动复制`（终端风格） |
| 跨会话历史记忆 | 关 | ↑/↓ 历史在会话间保持，存于浏览器本地，上限 200 条 |
| 会话目录（Chat TOC） | 开 | 对话左侧显示可拖动的目录把手，可关闭 |
| 右键直接粘贴 | 开 | 关闭后右键恢复浏览器原生菜单 |

↑/↓ 历史始终开启，不随以上开关变化。

## 特性

- **历史来自会话自身的消息记录**：直接读取会话快照中的用户消息节点（`user` / `steering`），随消息落地实时追加——与聊天记录严格一致，随会话持久化，刷新页面后依然可用，不需要任何配置或额外存储。
- **连续重复自动合并**，浏览状态跟随会话切换自动重置。
- **界面国际化**：全部文案（设置、工具栏、提示 pill、会话目录、搜索浮层）跟随 DSH 应用语言（中文 / English）。
- client bundle 压缩后约 12 KB；依赖全部走官方 `@deepseek-ai/*` peer 依赖。

## 已知限制

- **Ctrl+R**：输入框聚焦时 Ctrl+R 被用作反向搜索，**不再触发浏览器刷新**（想刷新先点一下输入框外面）。
- 切换会话时，只能召回当前已加载事件窗口内的旧消息（页面上新发送的都在）；不做宿主侧历史拉取。
- 纯文本召回：带图片/命令 chip 的消息不参与；召回内容为纯文本。

## 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsc（lib/types）+ tsdown（lib/index.js / lib/invariant.js / lib/client.js）
```

浏览器半区（`src/client/`）注册在 `conversation.input.right` 槽位，构建产物为 DSH `__ModuleLoader__` 闭包格式，外部依赖仅 `react`（其余由浏览器模块表提供）。文案字典在 `src/client/locales.ts`（`zh` 为准、`en` 键位对齐），通过 `ctx.locale.register` 注册。

## 原理

插件是一个不可见的 composer 槽位条目：挂一个 document 捕获期 keydown 监听，仅在目标为 composer 输入框、无修饰键、非输入法组合、菜单未打开、会话非忙碌时接管 ↑/↓，通过 `inputActions.setDraft` 写入历史文本。历史列表由会话快照的 `user`/`steering` 节点按 seq 去重追加，浏览位置（index + 待恢复的当前行）保存在组件 ref 中。

## License

[MIT](LICENSE)
