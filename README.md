<div align="center">

# NCE Flow

Tap any sentence, keep reading.  
简约 · 高效 · 专注的新概念英语在线点读（NCE1–NCE4）。

</div>

## ✨ 特性

- 句子级点读：点击任一句，从该句开始连续播放，自动高亮并居中
- 语言视图：EN / EN+CN / CN 三态切换（持久化保存）
- 现代 UI：Apple 风格、浅深色自适应、顺滑过渡
- 零依赖：纯静态 HTML/CSS/JS，可直接 GitHub Pages 部署
- LRC 兼容：支持 `英文|中文` 同行，或“同时间戳上下两行”堆叠格式
- 批量翻译：内置 `translate_lrc.py`，可将纯英文 LRC 转双语（可原地写回）

## 🗂 目录结构

```
assets/          # 样式与脚本（styles.css, app.js, lesson.js）
index.html       # 首页（书目 + 课程列表）
lesson.html      # 课文点读页
static/data.json # 书目与课程元数据
NCE1..NCE4/      # 音频与 LRC 资源（文件名与 data.json 一致）
```

## 🚀 本地运行

建议使用本地静态服务器（避免浏览器对 file:// 的 fetch 限制）：

```
python3 -m http.server 8080
# 访问 http://localhost:8080
```

或直接将仓库部署到 GitHub Pages（默认入口为根目录的 `index.html`）。

## 🎧 LRC 规范（本项目兼容两种）

1) 同行双语（推荐）

```
[mm:ss.xx]English sentence | 中文译文
```

2) 上下两行（同时间戳）

```
[mm:ss.xx]English sentence
[mm:ss.xx]中文译文
```

> 播放端自动识别两种格式；连续播放的分段时长会自动兜底（避免极短句抖动）。

## 🛠 批量翻译 LRC（可选）

脚本：`translate_lrc.py`，基于 SiliconFlow Chat Completions（默认模型：`tencent/Hunyuan-MT-7B`）。

示例：

```
# 原地写回（inline：行内英文|中文，带备份 .bak）
export SILICONFLOW_API_KEY=your_key
python translate_lrc.py \
  --input-dirs NCE1 NCE2 NCE3 NCE4 \
  --in-place --backup --batch-size 12 --concurrency 4

# 生成到新目录（双行堆叠 stacked）
python translate_lrc.py \
  --input-dirs NCE1 --output-dir out_lrc --mode stacked \
  --batch-size 12 --concurrency 4

# 限速（L0 默认：RPM=1000, TPM=80000）与修复策略
python translate_lrc.py ... --rpm-limit 1000 --tpm-limit 80000 --fix-retries 2 --verbose
```

特性：

- 保留时间戳与原顺序；逐句独立翻译（不合并不拆分）
- 结果校验与重试（避免回显英文/空译文）
- 速率限制器（RPM/TPM 滑动窗口），并支持并发/分块

> 注意：请自行确认音频与文本的版权与使用范围；本脚本仅用于学习研究。

## 🙏 致谢

- 原项目与灵感来源：iChochy/NCE（https://github.com/iChochy/NCE）
- 资源参考：tangx/New-Concept-English（https://github.com/tangx/New-Concept-English）

在此对原作者和社区表达感谢；本项目仅在前人工作的基础上进行了界面与交互层的现代化重构：

- 首页整合书目与课程列表；
- 课文页支持 EN/EN+CN/CN 三态语言视图；
- 句子级点读 + 连续播放；
- 视觉与动效统一（浅/深色自适应）。

## 📄 协议

本仓库代码遵循仓库内 LICENSE 文件所述协议。音频与文本内容版权归原权利人所有，仅用于学习研究，请勿转载或商用。

---

Designed & Maintained by Luzhenhua · https://luzhenhua.cn
Open Source: https://github.com/luzhenhua/NCE-Flow

---

如有侵权，请联系：openai.luzhenhua@gmail.com，我们将尽快处理。
