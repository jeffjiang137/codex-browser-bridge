# Codex Browser Bridge 便携安装包

## 网页图片置入 Photoshop（0.3.0）

图片右上角 ps 按钮默认 20% 不透明度，悬停蓝底白字。按钮无需窗口授权、Codex MCP 服务或鑫洋助理桥接。浏览器通过 Native Messaging 按需启动本机组件，再用 Windows COM 将图片作为智能对象置入当前文档，不自动保存。

首次安装：重新加载扩展，在 PowerShell 运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-ps-native.ps1 -ExtensionId 扩展ID`。安装只注册当前用户 Edge/Chrome 的 Native Messaging 项，绑定指定扩展 ID。需要 Node.js 与 Windows Photoshop。目录移动或扩展 ID 变化后重新注册；不建立常驻服务。

PS 已运行时请先打开目标文档并关闭模态对话框。PS 未运行时点击确认后启动并以独立文档打开图片。重载扩展并刷新网页即可使用，MCP 状态不影响图片按钮。插件弹窗的 PS 调试日志支持查看、清除、导出。

优先读取 data-original/data-origin/data-full/data-zoom-image/data-large 或直接图片链接，否则使用 currentSrc。网站未提供高清原图地址时只能读取当前图片资源。支持 PNG/JPEG/GIF/WebP，单张最多 20MB；CSS 背景图、canvas 和浏览器内部页面不支持。图片临时保存在 %LOCALAPPDATA%\CodexBrowserBridge\photoshop-images。PS 确认成功置入或打开后立即删除下载文件；失败文件及被占用的缓存保留一天，在下次使用时清理。归属记录使用 .cache.json，仅清理本功能记录的 UUID 文件；升级前没有记录的历史缓存、用户手动放入的文件不会自动删除。启动 PS 后会等待 COM 确认图片打开，再删除原图。不会保存或关闭用户文档。

此包仅含运行文件，重新构建需保留新增的图片按钮、本机通信及 COM 模块。验证：`node --test tests/ps-import.test.mjs tests/ps-overlay.test.mjs tests/ps-native.test.mjs`。

这是可复制到其他 Windows 电脑使用的运行包，包含：

- `apps\\extension\\dist`：Chrome / Edge 浏览器插件
- `apps\\mcp-server\\dist`：本地 MCP 服务运行文件
- `install-windows.ps1`：安装 MCP 服务注册和生产依赖

## 安装要求

- Windows
- Node.js 20 或更高版本
- Chrome 或 Edge 116 或更高版本
- 已安装并可使用的 Codex CLI 或 Codex IDE 扩展

## 安装

1. 将整个 `codex-browser-bridge` 文件夹复制到目标电脑。
2. 在 PowerShell 中进入该文件夹，执行：

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\\install-windows.ps1
   ```

3. 打开 `edge://extensions` 或 `chrome://extensions`。
4. 开启“开发者模式”，选择“加载已解压的扩展”，目录选择：

   ```text
   apps\\extension\\dist
   ```

5. 重启 Codex，打开插件弹窗并授权当前浏览器窗口。

如果目标电脑已经注册过旧版 `browser_bridge`，可执行：

```powershell
.\\install-windows.ps1 -ReplaceExistingMcp
```
