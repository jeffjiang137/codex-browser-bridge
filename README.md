# Codex Browser Bridge

**连接 Codex、Chrome / Microsoft Edge 与 Adobe Photoshop 的本地浏览器扩展和 MCP 服务。**

通过用户授权的浏览器窗口，让 Codex 读取网页、定位元素、填写表单、管理标签页、上传下载文件、诊断页面和执行 UI 检查。也可点击网页图片上的 **ps** 按钮，将图片直接送入 Windows Photoshop。

English: A local browser extension and Model Context Protocol (MCP) server for Codex browser automation, with web image import into Adobe Photoshop through Native Messaging and Windows COM.

适用于网页操作辅助、素材收集、电商设计工作流、表单填写和页面调试。当前扩展版本为 **0.3.1**，以扩展清单为准。本项目是社区工具。

## 功能介绍

### 窗口授权与标签页管理

- 在弹窗中授权当前浏览器窗口，查看连接和授权状态。
- 列出、选择、激活、新建和关闭授权窗口内的标签页；入口标签页默认受到关闭保护。
- 页面导航、刷新、可见标签页截图。

### 页面读取与交互

- 紧凑语义快照，读取主文档及可访问 iframe，为元素生成 ref。
- 按 ref、CSS selector、文本、role、label、placeholder 查找元素。
- 检查可见性、输入值、勾选状态和 frame 信息。
- 点击、输入、发送常用键盘事件、滚动、高亮目标和等待元素。
- 批量操作逐步重新解析目标，支持跨 iframe 操作。

### 上传下载与页面诊断

- 向网页 file input 上传本地文件；先校验文件和目录范围，再临时使用 CDP 设置文件，完成后释放连接。
- 查询下载记录，按文件名、URL、下载状态筛选；等待下载完成或显式下载指定 URL。
- 按需启动、停止和清除 Console / Network 诊断，读取日志和网络记录。
- 扩展显示最近操作记录，支持清除；操作审计不记录输入正文和本地文件路径。

### UI 检查

- 对可见性、文本、输入值、勾选状态和元素数量执行断言。
- 组合动作与断言形成检查流程，返回逐步结果，失败时可附快照或截图。

### 网页图片直接置入 Photoshop

- 普通 HTTP / HTTPS 网页图片右上角显示低透明度 **ps** 按钮，悬停时蓝底白字。
- 优先使用网站的原图属性或直接图片链接，否则使用 currentSrc。
- 通过 Native Messaging 按需启动本机组件，再调用 Windows COM。
- Photoshop 已运行且有目标文档时作为智能对象置入；未运行时经确认启动，并以独立文档打开图片。
- 图片按钮无需 MCP 连接、窗口授权或额外 Photoshop CEP 插件。
- 不自动保存或关闭用户文档。
- 支持 PNG、JPEG、GIF、WebP，单张最多 20 MB。网站未提供原图地址时只能使用现有资源。
- 弹窗提供 PS 调试日志查看、刷新、清除和导出。

## 环境要求

| 用途 | 要求 |
| --- | --- |
| 浏览器扩展 | Chrome / Edge 116+，允许加载解压扩展 |
| Codex 浏览器操作 | Node.js 20+、可用的 Codex CLI / MCP 客户端、本地 MCP 服务 |
| 图片置入 PS | Windows、Node.js、支持 COM 自动化的 Adobe Photoshop、本机组件注册 |

窗口授权和工具文案主要面向 Microsoft Edge；Chrome 可以加载同一 Chromium 扩展，具体页面兼容性需实际确认。

## 安装

### 1. 获取插件

```bash
git clone https://github.com/jeffjiang137/codex-browser-bridge.git
cd codex-browser-bridge
```

也可选择 GitHub **Code → Download ZIP**，解压到固定目录。

打开 `edge://extensions` 或 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展”，加载 `apps\extension\dist`。

### 2. 配置 Codex MCP

在项目目录打开 PowerShell：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
```

脚本安装生产依赖并注册名为 `browser_bridge` 的 Codex MCP 服务。重启 Codex或重新加载 MCP 配置，在扩展弹窗点击“连接 MCP”，然后“授权当前窗口”。

已有旧路径注册时：

```powershell
.\install-windows.ps1 -ReplaceExistingMcp
```

需要指定上传目录时：

```powershell
.\install-windows.ps1 -ReplaceExistingMcp -UploadRoots 'D:\素材;D:\导出'
```

对应环境变量 `CODEX_BROWSER_BRIDGE_UPLOAD_ROOTS`，Windows 使用分号分隔目录。未设置时，上传允许范围为 MCP 进程的实际工作目录。

### 3. 配置网页图片 → Photoshop

从扩展管理页复制扩展 ID，执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ps-native.ps1 -ExtensionId 你的扩展ID
```

脚本生成当前电脑的启动器和 Native Messaging 清单，注册当前用户 Edge / Chrome 本机组件并绑定指定扩展 ID。重新加载扩展并刷新网页，点击图片上的 **ps** 按钮即可使用。

请先在 Photoshop 打开目标文档、关闭模态对话框。目录移动或扩展 ID 变化后重新注册；本机组件按需启动，不建立常驻服务。

## MCP 工具索引

| 类别 | 工具 |
| --- | --- |
| 状态 | `browser_bridge_status`、`browser_window_status` |
| 标签页 | `browser_tabs`、`browser_window_tabs`、`browser_use_tab`、`browser_open`、`browser_activate_tab`、`browser_close_tab` |
| 页面和 frame | `browser_frames`、`browser_navigate`、`browser_reload`、`browser_screenshot` |
| 读取定位 | `browser_snapshot`、`browser_find`、`browser_inspect` |
| 动作 | `browser_click`、`browser_type`、`browser_press`、`browser_scroll`、`browser_highlight`、`browser_action` |
| UI 检查 | `browser_assert`、`browser_test` |
| 文件 | `browser_upload`、`browser_downloads`、`browser_wait_download`、`browser_download_url` |
| 诊断 | `browser_diagnostics`、`browser_console`、`browser_network` |

示例任务：读取授权页面快照并填写表单；管理多个网页标签；下载素材并检查完成状态；开启诊断定位请求失败；执行页面按钮和表单的 UI 断言。实际工具可用性取决于 MCP 客户端是否正确加载服务。

## 工作原理

```text
Codex / MCP 客户端 → Node.js MCP 服务
  → ws://127.0.0.1:17373 → 浏览器扩展 → 用户授权窗口

网页图片 ps 按钮 → Native Messaging → Windows COM → Photoshop
```

本地 MCP 服务默认监听回环地址。上传和部分诊断使用 Chrome DevTools Protocol（CDP）；诊断可能与其他 CDP 控制器竞争。

## 权限、缓存和限制

- 扩展使用 tabs、scripting、debugger、downloads、webNavigation、nativeMessaging 等权限和 `<all_urls>` 主机权限，支持跨网站页面操作及图片按钮。
- 操作应在用户授权窗口内进行；网站登录、验证码及访问限制仍需按网站要求处理。
- 仅能读取可访问 iframe。浏览器内部页面、受限页面和复杂自定义控件可能无法操作。
- 图片按钮不支持 CSS 背景图或 canvas。身份认证、反盗链及特殊资源下载可能失败。
- 图片缓存目录为 `%LOCALAPPDATA%\CodexBrowserBridge\photoshop-images`；成功确认置入或打开后删除下载文件。
- 失败或被占用文件保留一天，在后续使用时清理；`.cache.json` 只追踪本功能拥有的 UUID 文件。历史无记录缓存和手动放入文件不自动删除。
- 本机注册脚本会重写启动器和 JSON 清单为当前电脑路径及扩展 ID，下载后必须重新注册。

## 仓库结构与开发说明

```text
apps/extension/dist/    浏览器扩展、弹窗、图片按钮
apps/mcp-server/dist/   MCP 服务及运行模块
native/                Native Messaging 本机组件
install-windows.ps1    依赖安装和 Codex MCP 注册
install-ps-native.ps1  Photoshop 本机组件注册
tests/                 已有测试和检查脚本
package.json           依赖及历史脚本配置
package-lock.json      依赖锁文件
```

**当前仓库为便携运行包，未包含完整 TypeScript 源码、tsconfig 和构建辅助脚本。** 请直接安装已提交的 dist 文件；package.json 中的历史 build / typecheck 命令不能作为本包可用构建流程。根包版本与扩展版本当前不一致，浏览器显示以扩展清单为准。

维护运行文件后，可按测试所需环境运行已有检查，例如：

```bash
node --test tests/ps-import.test.mjs tests/ps-overlay.test.mjs tests/ps-native.test.mjs
```

仓库不包含 node_modules 和本机验证 PSD 样本。尚未声明开源许可证，使用和再分发请联系维护者确认授权。

## 反馈和搜索关键词

在 [GitHub Issues](https://github.com/jeffjiang137/codex-browser-bridge/issues) 提交问题时，请附浏览器版本、扩展版本、复现步骤和脱敏错误信息。

Codex、Codex CLI、MCP、Model Context Protocol、浏览器 AI 助手、浏览器自动化、Browser Automation、Chrome Extension、Microsoft Edge Extension、Manifest V3、网页表单、iframe、DOM Snapshot、CDP、Chrome DevTools Protocol、文件上传下载、Console Network 调试、UI Testing、Adobe Photoshop、网页图片置入 PS、智能对象、Native Messaging、Windows COM、电商素材工作流。
