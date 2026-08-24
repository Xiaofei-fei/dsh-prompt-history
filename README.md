# dsh-prompt-history

DSH Web 输入框的「类 Linux shell」提示词历史 + 终端式复制粘贴插件：**↑ / ↓** 上下翻看之前发送过的消息，**左键选中自动复制、右键直接粘贴**。

## 安装

```sh
dsh plugin --profile web add dsh-prompt-history
```

然后刷新页面即可使用。

## 用法

- **↑**：召回上一条发送过的消息（最新在前），替换当前输入；继续按 ↑ 往前翻
- **↓**：往后翻；翻到底时恢复你翻历史之前正在输入的那一行（readline 的 pending-line 行为）
- **编辑即退出**：浏览历史时一旦动手编辑，自动回到当前行，不再继续翻
- **左键选中即复制**：在输入框里用左键拖选文字，松开鼠标即自动复制（xterm 风格，双击选词/三击选行同样生效）；走输入框自身的复制处理（chips 投影一致），execCommand 被限制时回退 Clipboard API
- **鼠标右键直接粘贴**：在输入框上右键即粘贴剪贴板内容（和 Linux 终端一致，不弹菜单）；粘贴走与 Ctrl+V 完全一致的管线（图片与引用 chip 行为一致），execCommand 路径被限制时自动回退到 Clipboard API 手动插入
- **不干扰其它操作**：`/` 与 `@` 建议菜单打开时，方向键仍归菜单导航；中文输入法（IME）组合、`Shift+↑` 选区、`Ctrl+↑` 跳词等修饰键组合均不拦截；发送中/已删除会话不响应（此时右键仍走浏览器原生行为）

## 特性

- **历史来自会话自身的消息记录**：直接读取会话快照中的用户消息节点（`user` / `steering`），随消息落地实时追加——与聊天记录严格一致，随会话持久化，刷新页面后依然可用，不需要任何配置或额外存储
- **连续重复自动合并**，浏览状态跟随会话切换自动重置
- 无 UI、无设置项，bundle 仅约 7 KB；依赖全部走官方 `@deepseek-ai/*` peer 依赖

## 已知限制

- 切换会话时，只能召回当前已加载事件窗口内的旧消息（页面上新发送的都在）；不做宿主侧历史拉取
- 纯文本召回：带图片/命令 chip 的消息不参与；召回内容为纯文本

## 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsc（lib/types）+ tsdown（lib/index.js / lib/invariant.js / lib/client.js）
```

浏览器半区（`src/client/`）注册在 `conversation.input.right` 槽位，构建产物为 DSH `__ModuleLoader__` 闭包格式，外部依赖仅 `react`（其余由浏览器模块表提供）。

## 原理

插件是一个不可见的 composer 槽位条目：挂一个 document 捕获期 keydown 监听，仅在目标为 composer 输入框、无修饰键、非输入法组合、菜单未打开、会话非忙碌时接管 ↑/↓，通过 `inputActions.setDraft` 写入历史文本。历史列表由会话快照的 `user`/`steering` 节点按 seq 去重追加，浏览位置（index + 待恢复的当前行）保存在组件 ref 中。

## License

[MIT](LICENSE)
