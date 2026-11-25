<div align="center">

# OpenTune

**开源、轻量、原生体验的 YouTube Music 跨平台客户端**

直连官方 `https://music.youtube.com` 网页接口，完整保留 **YouTube Premium** 会员权益，为 **macOS (`.dmg`)** 与 **Android (`.apk`)** 补齐真正的桌面与移动端原生能力。

[![Latest Release](https://img.shields.io/github/v/release/lyzpyb/opentune?display_name=tag&style=flat-square&color=FF0033&label=Release)](https://github.com/lyzpyb/opentune/releases/latest)
[![GitHub Downloads](https://img.shields.io/github/downloads/lyzpyb/opentune/total?style=flat-square&color=18181B&label=Downloads)](https://github.com/lyzpyb/opentune/releases/latest)
[![Build Status](https://img.shields.io/github/actions/workflow/status/lyzpyb/opentune/build-clients.yml?style=flat-square&label=CI%20Build)](https://github.com/lyzpyb/opentune/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](./LICENSE)
[![Platforms](https://img.shields.io/badge/Platform-macOS%20%7C%20Android-27272A?style=flat-square)](#%E5%BF%AB%E9%80%9F%E4%B8%8B%E8%BD%BD%E4%B8%8E%E5%AE%89%E8%A3%85)

[下载最新版 (.dmg / .apk)](https://github.com/lyzpyb/opentune/releases/latest) · [项目下载主页](https://lyzpyb.github.io/opentune/) · [云端构建状态](https://github.com/lyzpyb/opentune/actions) · [提交反馈](https://github.com/lyzpyb/opentune/issues)

</div>

---

## 为什么选择 OpenTune？

浏览器自带的「安装为网页应用 (PWA)」虽然能打开 YouTube Music，但往往缺少菜单栏迷你控台、系统级后台保活、返回导航与登录防拦截。**OpenTune** 不依赖任何第三方破解接口，直接封装官方网页端并深度增强原生交互：

- **100% 保留 YouTube Premium 会员权益**：官方账号直登，无广告、256kbps 高音质、歌单与推荐算法实时同步；内置登录态 UA 兼容与浏览器 Cookie 一键同步兜底，解决内嵌浏览器登录风控拦截。
- **macOS 顶部状态栏迷你控台**：点击菜单栏图标即弹出磨砂深色迷你播放器，实时展示**专辑封面、可跳转进度条、上一首 / 播放暂停 / 下一首、静音与音量滑块**。
- **原生返回导航与防迷路拦截**：窗口左上角常驻**返回 / 前进 / 刷新 / 首页**原生导航条，支持 macOS 触控板双指滑动与 `⌘[` / `⌘]` 快捷键；帮助页与外部链接自动转交系统浏览器打开，永不被困在未知页面。
- **播放稳定性与后台防断流**：关闭 macOS App Nap 与后台计时器节流、放行受保护媒体流（DRM）权限、自动消除「您还在收听吗？」弹窗并在流异常时自动恢复。
- **Android 息屏保活与锁屏媒体控制**：原生 `MediaPlaybackService` 前台服务 + `MediaSessionCompat`，支持息屏后台播放、锁屏通知栏切歌与蓝牙耳机按键控制。

---

## 与浏览器 PWA 体验对比

| 核心能力 | 浏览器「安装网页应用 (PWA)」 | OpenTune (macOS / Android) |
| :--- | :--- | :--- |
| YouTube Premium 会员权益与歌单同步 | 支持 | **完整保留（官方网页直连）** |
| macOS 顶部菜单栏封面 / 进度 / 音量控台 | 不支持 | **原生弹出式迷你播放器** |
| 原生返回 / 前进 / 一键回首页 & 外链隔离 | 易陷入未知页 | **常驻原生导航条 + 外链系统浏览器打开** |
| 后台长时间播放防中断 & 防休眠 | 易被浏览器节流暂停 | **PowerSaveBlocker + DRM 放行 + 自动恢复** |
| Android 息屏后台播放 & 锁屏切歌 | 切后台易被系统杀掉 | **Foreground Service + WakeLock 保活** |
| 硬件媒体键 / 蓝牙耳机控制 | 依赖浏览器焦点 | **全局原生媒体键监听** |

---

## 快速下载与安装

前往 [GitHub Releases](https://github.com/lyzpyb/opentune/releases/latest) 或访问 [下载主页](https://lyzpyb.github.io/opentune/) 获取最新预编译安装包：

### macOS (`.dmg`)
1. 下载 `opentune-1.1.0-universal.dmg`（同时支持 Apple Silicon M 系列与 Intel Mac）。
2. 双击打开 `.dmg`，将 **OpenTune** 拖入 `Applications`（应用程序）文件夹。
3. **首次打开提示「已损坏」或「无法验证开发者」时**（开源自签包未购买 Apple 开发者证书属正常现象），在终端执行一次解除隔离属性即可：
   ```bash
   xattr -cr "/Applications/OpenTune.app"
   ```
4. 登录 Google 账号：若账号开启极严格风控，可在顶部菜单栏点击 **账号 → 从剪贴板导入浏览器 Cookie 登录（备用）** 一键同步。

### Android (`.apk`)
1. 在 Releases 页面下载 `app-release.apk` 并传输至手机安装（允许「安装未知来源应用」）。
2. 首次启动请授予**通知权限**，以启用锁屏媒体卡片与息屏后台保活服务。

---

## 启用仓库专属下载主页（GitHub Pages）

本仓库已内置零依赖的静态下载官网 `docs/index.html`，自动拉取当前仓库的最新 Releases 资产链接：

1. 打开仓库的 **Settings → Pages**。
2. 在 **Build and deployment → Source** 选择 **Deploy from a branch**。
3. 分支选择 `main`，目录选择 `/docs`，点击 **Save**。
4. 等待约 1 分钟即可访问你的公开下载主页：`https://lyzpyb.github.io/opentune/`。

---

## 仓库目录结构

```text
.
├── macos-electron/                # macOS 桌面客户端 (Electron + electron-builder -> .dmg)
│   ├── src/
│   │   ├── main.js                # 主进程：防断流、状态栏弹窗、导航守卫、登录兼容
│   │   ├── preload.js             # 原生导航条注入、封面/音量同步、播放异常自动恢复
│   │   ├── tray.html              # macOS 顶部状态栏迷你播放器 UI
│   │   ├── tray-preload.js        # 迷你播放器安全 IPC 桥接
│   │   └── inject.css             # 窗口标题栏融合与界面净化样式
│   └── electron-builder.yml       # Universal / arm64 / x64 DMG 打包配置
├── android-webview/               # Android 客户端 (Kotlin + WebView + MediaSession -> .apk)
│   └── app/src/main/java/.../
│       ├── MainActivity.kt        # DRM 放行、外链隔离、返回悬浮条与 Cookie 同步
│       ├── MediaPlaybackService.kt# 前台媒体服务、锁屏通知栏与蓝牙耳机控制
│       └── WebAppInterface.kt     # 网页到 Android 原生播放状态桥接
├── docs/
│   └── index.html                 # 开源项目官网 & 自动同步 Releases 的下载落地页
├── .github/workflows/
│   └── build-clients.yml          # GitHub Actions 云端自动编译并发布 .dmg + .apk
└── LICENSE                        # MIT 开源许可证
```

---

## 本地开发与自行编译

### macOS 本机构建 (.dmg)
```bash
cd macos-electron
npm install
npm run dist:mac
# 产物输出路径: macos-electron/dist/*.dmg
```

### Android 本机构建 (.apk)
```bash
cd android-webview
gradle assembleRelease
# 产物输出路径: android-webview/app/build/outputs/apk/release/app-release.apk
```

---

## 开源协议与免责声明

- 本项目基于 [MIT License](./LICENSE) 开源，欢迎提交 Issue 与 Pull Request。
- **免责声明**：OpenTune 为社区开源的第三方网页封装客户端，与 Google LLC、YouTube 或 YouTube Music 无任何官方关联。所有音频流与会员权益均直接由官方 `music.youtube.com` 提供，本项目不包含任何去广告破解或绕过付费逻辑。
