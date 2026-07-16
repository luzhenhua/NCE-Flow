# EchoFlow

**点读跟读练习工具 · 导入你自己的 mp3+lrc，点句即读、连续播放**

[![GitHub stars](https://img.shields.io/github/stars/luzhenhua/NCE-Flow?style=social)](https://github.com/luzhenhua/NCE-Flow)
[![GitHub forks](https://img.shields.io/github/forks/luzhenhua/NCE-Flow?style=social)](https://github.com/luzhenhua/NCE-Flow)
[![GitHub release](https://img.shields.io/github/release/luzhenhua/NCE-Flow)](https://github.com/luzhenhua/NCE-Flow/releases)
[![License](https://img.shields.io/github/license/luzhenhua/NCE-Flow)](LICENSE)

**在线体验**: https://nce.zhenhua.lu

> ⚠️ **本工具不提供任何教材音频或课文内容。** 音频（mp3）与字幕（lrc）需由你自行导入合法拥有的资源，导入的文件仅保存在你本机浏览器（IndexedDB），不会上传服务器。

## 核心功能

- **自带资源导入**：支持文件夹批量 / 多选文件 / zip 包三种方式导入你自己的 mp3+lrc
- **句子级点读**：点击任意句子开始播放，自动高亮跟随
- **多语言视图**：EN / EN+CN / CN 三种显示模式
- **播放控制**：倍速调节、连读/点读切换、循环模式、断点续播
- **全局快捷键**：空格播放/暂停、方向键导航、音量控制
- **学习管理**：课程收藏、学习记录、进度追踪
- **现代界面**：Apple 风格、深浅色主题、响应式设计
- **零依赖**：纯静态文件，解压即用

## 快速开始

### 方式一：Docker 一键部署（最简单）

只需一条命令，无需下载代码：

```bash
docker run -d -p 8080:80 --name nce-flow --restart unless-stopped luzhenhua/nce-flow:latest
```

然后访问 `http://localhost:8080` 即可！

**自定义端口：**
```bash
docker run -d -p 3000:80 --name nce-flow --restart unless-stopped luzhenhua/nce-flow:latest
```

详细的 Docker 部署说明请查看 [DOCKER.md](DOCKER.md)

### 方式二：Docker Compose 部署

适合需要自定义配置的场景：

```bash
# 克隆项目
git clone https://github.com/luzhenhua/NCE-Flow.git
cd NCE-Flow

# 启动服务
docker-compose up -d

# 访问 http://localhost:8080
```

### 方式三：本地开发服务器

1. **下载源码**：`git clone https://github.com/luzhenhua/NCE-Flow.git`（或从仓库页面下载 zip）
2. 启动本地服务器：

   **方法一：使用Python**
   ```bash
   # 在解压后的文件夹中打开终端，运行：
   python -m http.server 8000
   # 然后访问：http://localhost:8000
   ```
   注：部分 Python 版本自带的 `http.server` 不支持 HTTP Range 请求，可能导致“点击句子跳转会从头播放”；建议优先使用下面的 Node/Docker/NGINX 等方式。

   **方法二：使用Node.js**
   ```bash
   # 在解压后的文件夹中运行：
   npx serve .
   # 然后访问显示的本地地址
   ```

   **方法三：使用VSCode的Live Server插件**
   - 安装Live Server插件
   - 右键点击 `index.html`，选择"Open with Live Server"

3. 在浏览器中打开显示的本地地址，开始学习！

**注意**：不能直接双击 `index.html` 文件，会因为浏览器安全策略导致无法加载数据文件。

## 项目结构

```
NCE-Flow/            # 仓库名沿用旧名，站点品牌为 EchoFlow
├── assets/          # 样式与脚本（含资源导入与 IndexedDB 存储）
├── index.html       # 首页（课程库 + 资源导入）
├── lesson.html      # 点读页
└── README.md        # 说明文档
```

## 版本历史

查看完整更新日志：[Releases](https://github.com/luzhenhua/NCE-Flow/releases)

### 最新版本

- **v1.7.9** (2026-02-06)：移除移动端“播完后”区域下方重复显示的四个圆点，避免设置项混淆
- **v1.7.5** (2026-01-10)：自动续集新增自动关闭（连续 N 课后停止）
- **v1.7.4** (2025-12-24)：移动端浏览器使用时自动隐藏页面顶部/底部导航栏，提升沉浸式体验
- **v1.7.2** (2025-12-24)：修复 iOS 自动下一课不自动播放（提示一键继续播放）
- **v1.7.1** (2025-12-22)：清单页面体验优化（顶部导航、移动端设置、空状态提示）
- **v1.7.0** (2025-12-22)：新增清单功能（收藏句子、清单朗读与设置）
- **v1.6.2** (2025-12-20)：阅读模式中的选项显示效果
- **v1.6.0** (2025-12-19)：新增跟读模式、字幕修正、页面切换暂停音频
- **v1.5.1** (2025-12-13)：修复本地点读跳转、修复 SW 预缓存
- **v1.5.0** (2025-12-12)：课文页交互优化、移动端体验调整
- **v1.4.9** (2025-12-06)：修复 PWA 安装入口、版本号同步
- **v1.4.8** (2025-11-27)：新增 PWA 支持
- **v1.4.4** (2025-11-22)：智能跳过开头（可开关）、优化播放体验
- **v1.4.3** (2025-11-10)：优化课程翻译、修复切换课程后倍速重置
- **v1.4.2** (2025-10-26)：修复移动端深色模式切换、优化主题切换逻辑
- **v1.3.3** (2025-10-20)：返回按钮修复 - 修复课程页面返回按钮行为
- **v1.3.2** (2025-10-19)：UI 增强与问题修复 - 快捷键面板优化、版本号显示、面板切换修复
- **v1.3.1** (2025-10-19)：布局优化 - 修复课程导航按钮布局问题
- **v1.3.0** (2025-10-19)：循环模式支持 - 新增单句循环和整篇循环功能
- **v1.2.0** (2025-10-19)：全局快捷键支持 - 空格键、方向键、音量控制等快捷操作
- **v1.1.4** (2025-10-18)：Docker 部署支持 - 一键部署，更便捷的使用方式
- **v1.1.3** (2025-10-18)：稳定性改进 - Bug 修复和代码优化
- **v1.1.1** (2025-10-17)：播放逻辑优化 - iOS Safari 兼容性增强
- **v1.1.0** (2025-10-17)：UI 优化与自动跳转 - 自动续播下一课功能
- **v1.0.0** (2025-10-11)：首个版本发布

## 免责声明

**重要声明：本工具本身不包含、也不提供任何教材音频或课文内容。**

- 所有音频与字幕均由用户自行导入，且仅保存在用户本机浏览器（IndexedDB），不上传服务器
- 用户导入内容的版权归原著作权人所有，请仅导入你合法拥有的资源
- 本工具仅供个人学习使用，严禁用于任何商业目的或未经授权的传播
- 使用本项目即表示您同意上述条款

### 支持正版

请在使用本工具前购买正版教材，以保护著作权人的合法权益：

- 购买合法授权的正版教材
- 使用官方授权的学习资源和平台
- 支持原创作者和教育出版社

如有任何版权问题或影响到您的合法权益，请联系：luzhenhuadev@qq.com，我们将立即处理。

## 致谢

感谢以下项目和个人的贡献：

- **[@reaishijie](https://github.com/reaishijie)** - 提交了 [PR #3](https://github.com/luzhenhua/NCE-Flow/pull/3)，为课文页面增加了播放速度控制按钮及播放速度持久化功能

感谢所有为本项目点赞、提出建议和反馈的朋友们！

## 许可证

[MIT License](LICENSE)

---

如果这个项目对你有帮助，请给个 Star ⭐ 支持一下！

你也可以通过 [爱发电](https://afdian.com/a/luzhenhua) ☕ 请我喝杯咖啡

Made with ❤️ by [Luzhenhua](https://zhenhua.lu)
