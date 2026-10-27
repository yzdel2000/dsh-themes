# @dsh-suite/themes — 151 款 DSH 皮肤聚合 / 151-skin pack for DSH Web UI

[💬 问题反馈](https://github.com/whyihaveyou/dsh-suite/issues/new?template=plugin-feedback.yml&labels=feedback&plugin=skin-center)

> 把 dsh-themes 的 151 个皮肤包**一包打尽**：一个 npm 包 + 一个「皮肤中心」试穿面板。

## 安装 / Install

```sh
dsh plugin --profile <你的 profile 名> add @dsh-suite/themes
```

安装后重启 `dsh`（或桌面版），Settings → **皮肤中心 / Skin Center** 即可用。
包内 `dsh.engines.dsh` 声明了兼容范围（当前为 `>=0.2.1-rc.3 <0.3.0`），
`dsh.manifestVersion = 1`、`locale/{zh,en}.json` 与 `icon.webp` 提供插件列表里的
标题 / 简介 / 图标。

## 兼容性 / Compatibility

- **DSH ≥ 0.2.1-rc.3**：浏览器半使用 `window.__ModuleLoader__.load({ id, factory })` 契约
  + `ctx.slots.inject('settings.section')` / `ctx.locale.bind(ns)`；宿主半使用
  `ctx.webServer.register({ kind, path, handler })`（`exact` + `prefix`）。
- **面板配色**只用当前设计系统的 `--dsw-alias-*` 令牌（`bg-layer-1/2/3`、`border-l1`、
  `brand-primary`、`label-primary/secondary`），无硬编码色值。
- **昼夜由 shell 的 `theme` 服务负责**（v0.4）：面板把「昼 / 夜 / 跟随系统」转发给
  `ctx.theme.setTheme()`，不再与 Settings → Appearance 抢同一个 `body[data-ds-dark-theme]`；
  该服务不可用时自动退化为本地属性切换。
- **皮肤是 DSH 原生的（v0.4）**：每款皮肤在 `body[data-dsh-<id>]` 与
  `body[data-dsh-<id>][data-ds-dark-theme]` 两个作用域里直接重写 **125 个 DSH 语义令牌**
  （120 个 `--dsw-alias-*` + 11 个 `--dsw-specific-*`；跳过 6 个与配色无关的遮罩/临时别名），
  值取自该皮肤自己的调色板语义（`--bg-2 → --dsw-alias-bg-layer-2`、
  `--color-primary → --dsw-alias-brand-primary`、状态色 → `state-*`、悬停/选中 → `interactive-*`），
  派生色用 `color-mix()` 就地算，不再依赖旧调色板的静态步进。
  AionUI 变量名（67 个）已删除，只保留皮肤纹理所消费的辅助变量（`--aou-*`、`--*-accent` 等）。
- **死选择器已清除**：构建时 CSS module 会把类名哈希（`.markdown-body` →
  `._6_hrsq_markdown-body`），所以 `[class*='…']`、`.arco-btn*` 那类规则在 DSH 里永远匹配不到；
  `tools/native_port.mjs` 删掉它们，保留 `pre` / `code` / `a` / `blockquote` 等真实元素选择器，
  主按钮改由 `--dsw-alias-button-primary-fill` 生效。
- **资产热更新**：宿主按请求懒加载 `assets/*` 并以 mtime 校验缓存，`generate.mjs` 重建后
  **无需重启** DSH（响应头 `x-skin-center-rev` 可确认版本）。
- **死动画已清除**：151 款里共删掉 **480 个没有任何 `animation` 引用的 `@keyframes`**
  （mock 时代写给 `.app-titlebar` 之类元素的动画，在 DSH 里永远不会跑）；
  聚合 CSS 里现存 211 个，全部有引用。
- **外壳几何（v0.4+）**：每款按自己的圆角语言写 `--dsh-windows-content-radius`
  （像素/复古 5 款为 `0`，其余 4–7px，中位数 6px）；只有真正柔和的皮肤才把
  `--dsh-windows-titlebar-height` 抬到 44px（仅 1 款）。侧栏宽度/缩进保持 DSH 默认，
  不动布局。注意：标题栏的窗口按钮由系统绘制、左侧栏的行高/图标/字号属于 DSH 组件，
  皮肤只能改它们的颜色与这两处几何。

## 功能 / Features

- **试穿**: 点卡片即写 `body[data-dsh-<id>]` 属性切肤（CSS 变量实时生效），再次点击其他卡片切换，✖ 清除皮肤。切肤只回收本包 manifest 声明的 151 个属性，不动 shell / 其他插件写在 `<body>` 上的 `data-dsh-*`。
- **151 款皮肤**: 分组（绝区零 / 原神 / 经典配色 / 节日限定 …，游戏系按品牌分组）、搜索（中文名/英文名/分组/标签）。
- **昼夜三态 (v0.3)**: 工具条「☀️ 昼 / 🌙 夜 / 🖥 跟随系统」——昼/夜手动切换预览与实际主题（`data-ds-dark-theme`）；「跟随系统」监听 `prefers-color-scheme`，系统深浅色切换时预览与已应用皮肤自动跟随。
- **皮肤详情卡 (v0.3)**: 点击卡片除试穿外，网格上方展示详情——作者 / 标签 / 令牌数（CSS 体积估算）/ 分组 / 宣传语 + 昼·夜两张 640px 大图预览。
- **懒加载**: 缩略图经 IntersectionObserver 视口按需加载，151 卡不全量拉图。
- **收藏**: 卡片 ♡/♥ 收藏按钮，localStorage 持久化（重开面板/重启 DSH 仍在），网格顶部「♡ 只看收藏」开关。
- **最近试穿**: 最近试穿的 8 款皮肤在网格上方横向展示，点击可再次应用。
- **随机一款**: 工具条「🎲 随机试穿」从当前筛选结果（无筛选则全部 151 款）随机应用一款。

## 体积 / Volume

| 内容 | 体积 |
|---|---|
| 原始预览图（151×2 PNG, 1280×800） | ~67 MB |
| 打包后 assets（320×200 WebP 缩略图 + 640px WebP 大图 + manifest + 全量 CSS） | **~7.1 MB**（压缩 ~10×） |
| skins.css（151 皮肤全量 CSS，试穿时经宿主 gzip 按需拉取） | 3.2 MB raw / 0.44 MB gzip |

## 生成 / Regenerate

皮肤清单、CSS、缩略图全部由脚本从 `skins/` 扫描生成，**不手写**：

```sh
cd packages/skin-center && node scripts/generate.mjs   # 需要系统 python3 + Pillow（缩略图）
```

产物 `assets/manifest.json`、`assets/skins.css`、`assets/thumbs/*.webp` 随包发布。

## 宿主路由 / Host routes

`/skin-center/manifest`（gzip JSON）、`/skin-center/css`（gzip CSS）、`/skin-center/thumbs/*`（缩略图）、
`/skin-center/previews/*`（640px 大图）。gzip 由路由自己协商并带 `Vary: Accept-Encoding`
（实测 manifest 86 KB → 17 KB、css 3.3 MB → 0.46 MB）。

## 关系 / Architecture

- 单皮肤包（`skins/*`）：cordis.patch.yml 插入 `ui-skin-<id>` roster + client.js 注入 `body[data-dsh-<id>]` CSS。
- 本聚合包：**不等价替换**单包，而是宿主半批量服务全部皮肤资产 + 浏览器半统一试穿面板；已装单包与聚合包共存互不干扰（CSS 同选择器幂等）。


---

## Theme & Skin Compatibility / 主题与皮肤兼容

The **panel itself** follows the DSH Web styling contract
([`docs/web-styling.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/web-styling.md)):
all colors come from `--dsw-alias-*` design tokens, no hardcoded color literals.
It also implements the dsh-web Skin Center compatibility contract
**L1 (token coverage) + L2 (semantic attributes)** — root node
`data-dsh-plugin="skin-center"` + `data-dsh-surface="settings"`, parts
`input / select / button-ghost / card` (v0.3.1).

As a **skin pack**, each skin scopes its palette via `body[data-dsh-<id>]` and
overrides `--dsw-alias-*` tokens for day/night; it follows the primary-action
token rules (verbatim four-token set, no cross-family pairing). The bundled
manifest is an aggregate format (151 skins in one manifest + one CSS), not the
per-skin skin-manifest-v2 asset-directory layout.

面板自身遵循 DSH Web 样式契约：全部颜色经 `--dsw-alias-*` 设计令牌引用、无硬编码色值；并实现 dsh-web 皮肤中心兼容契约
**L1（令牌覆盖）+ L2（语义属性）**——根节点 `data-dsh-plugin="skin-center"` + `data-dsh-surface="settings"`，
部件标注 `input / select / button-ghost / card`（v0.3.1）。
作为皮肤聚合包，每个皮肤经 `body[data-dsh-<id>]` 作用域覆写 `--dsw-alias-*` 令牌（昼夜双模式），并遵循
primary-action 令牌规则（主按钮四件套 verbatim、禁止跨族配对）；随包 manifest 为聚合格式（151 皮合一），
非逐皮的 skin-manifest-v2 资产目录布局。
