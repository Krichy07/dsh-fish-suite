# dsh-fish-suite

把鱼记忆（`dsh-fish-memory`）和心情（`dsh-yu-mood`）合并成 DSH 桌面端左侧主导航里的一个页面。装好后在左侧「鱼记忆 / 心情」里选择会话、启用工作区，就能查看和记忆、心情。

## 安装

DSH 桌面端 → 插件 → 安装：

```text
dsh-fish-suite
```

或命令行：

```bash
dsh plugin --profile desktop add dsh-fish-suite
```

## 功能

- 左侧主导航独立页面，不占用对话区。
- 会话下拉框显示：`工作区 · 对话标题 · 短 id`。
- 只对当前选中的会话挂载 `remember`、注入心情/记忆段落；其他会话和其他工作区保持关闭。
- 每个工作区独立启用开关，状态持久化。
- 页面有「返回对话」，会打开插件里选中的那个会话。
- 记忆区始终显示；没有条目时显示空状态。

## 状态

- 当前查看的会话：`focusSession`
- 工作区启用：`workspaces`

两者只由页面操作修改，聊天、DSH 当前会话切换、页面轮询都不会自动改。

默认位置：

```text
$DSH_HOME/fish-suite/fish-suite.json
```

也支持在 `$DSH_HOME/fish-suite-local.json` 中设置本地数据目录：

```json
{ "dataDir": "D:\\path\\to\\data" }
```

## 兼容性

- DSH 0.2.1-rc.3 桌面端。
- `dsh-fish-memory` 1.2.6 和 `dsh-yu-mood` 2.0.0 以未修改的 vendor 形式随包分发；它们的许可证在 `vendor/*/LICENSE`。
- `remember` 的扁平参数声明在 Host 侧归一化为合法 JSON Schema，不改依赖源码。
- 页面使用 `sidebar.panellist` + `main` 注册主导航，使用 `ctx.uiWorkspace.openSession` 返回正确会话。

## 开发

```bash
pnpm pack
```

发布前在本地 DSH profile 用 tgz 安装验证，再发布 npm/GitHub Release。

## License

MIT。`vendor/` 下依赖的许可证随各自目录保留。
