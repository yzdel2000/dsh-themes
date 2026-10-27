#!/usr/bin/env node
/**
 * native_port.mjs — 把一款皮肤从「AionUI 移植」改写成「DSH 原生皮肤」。
 *
 * 背景（见 README 的 Compatibility 段）：这些皮肤最初是 AionUI 主题的机械翻译，
 * 每个皮肤块里写的是 AionUI 的 67 个语义变量（--bg-2 / --text-primary / --color-border…）。
 * DSH 不读那些名字，只读 --dsw-*；而且构建时 CSS module 会把类名哈希
 * （.markdown-body → ._6_hrsq_markdown-body），所以带类名的规则在 DSH 里永远不匹配。
 *
 * 本工具做的三件事（每个 light/dark 块各一次）：
 *   1. 用 AionUI 语义值推导出 DSH 的 120 个 --dsw-alias-* 与 11 个 --dsw-specific-*
 *      覆盖（皮肤自己给的值，不是猜的默认色），让整套 UI 而不只是按钮跟随配色；
 *   2. 删掉 67 个死变量，保留皮肤自己的调色板辅助变量、--dsw-static-* 静态色阶
 *      与 --primary-rgb 数据变量；
 *   3. 把永远匹配不到的选择器改写掉：去掉被哈希的类名复合选择器、丢掉
 *      button[class*=…] 这类猜实现类的写法（主按钮改由 --dsw-alias-button-primary-fill 生效）。
 *
 * 用法：
 *   node tools/native_port.mjs --ids ayu,egg-matrix      # 只处理这两款（写盘）
 *   node tools/native_port.mjs --all                    # 全部 151 款
 *   node tools/native_port.mjs --all --dry-run          # 只报告，不写盘
 *   node tools/native_port.mjs --all --check            # 校验现存文件是否已原生
 *
 * 写盘会同时更新 skins/<id>/src/client/<id>.module.css 与 skins/<id>/lib/client.js
 * 内嵌的 CSS 字面量（等价于 pnpm build 的产物），保持两者一致。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKINS = join(ROOT, 'skins')

/** DSH 0.2.1-rc.3 的令牌面（取自安装包内的 design-platform/base 样式表）；125 个可覆盖令牌。 */
const ALIAS = [
  'bg-base', 'bg-document-preview', 'bg-document-selection', 'bg-l1', 'bg-l2', 'bg-layer-1',
  'bg-layer-2', 'bg-layer-3', 'bg-layer-4', 'bg-module-platform', 'bg-multi-select', 'bg-overlay',
  'bg-skeleton', 'border-inverted', 'border-inverted2', 'border-l1', 'border-l2',
  'border-l2-darkmode-thin', 'border-l3', 'border-l4', 'brand-primary', 'brand-primary-invert',
  'brand-text', 'code-diff-added', 'code-diff-deleted', 'file-diff', 'file-diff-added-bg',
  'file-diff-added-gutter', 'file-diff-added-marker', 'file-diff-deleted-bg',
  'file-diff-deleted-gutter', 'file-diff-deleted-marker', 'fill-l1', 'fill-l2', 'fill-tertiary',
  'fill-tsp-secondary', 'interactive-bg-active', 'interactive-bg-hover', 'interactive-bg-hover-accent',
  'interactive-bg-hover-danger', 'interactive-bg-hover-solid', 'label-caption', 'label-deep-diving',
  'label-deep-diving-shimmer', 'label-dimmed', 'label-document-preview', 'label-error',
  'label-primary', 'label-primary-bluish', 'label-primary-dimmed', 'label-primary-foreground',
  'label-primary-inverted', 'label-quaternary', 'label-secondary', 'label-shimmer', 'label-tertiary',
  'link', 'markdown-citation', 'markdown-code-block', 'markdown-code-block-banner',
  'markdown-code-segment-selected', 'markdown-code-segment-unselected', 'markdown-inline-code',
  'markdown-placeholder', 'markdown-tag', 'menu-group-header-fill', 'menu-icon', 'onboarding-accent',
  'onboarding-card-fill', 'onboarding-checkbox-border', 'onboarding-secondary-fill', 'scrollbar',
  'scrollbar-bg-l1', 'scrollbar-bg-l2', 'scrollbar-hover-l1', 'scrollbar-hover-l2',
  'separator-primary', 'settings-card-fill', 'settings-card-stroke', 'state-business-primary',
  'state-business-tertiary', 'state-error-primary', 'state-error-secondary', 'state-idle-primary',
  'state-success-primary', 'state-success-secondary', 'state-success-tertiary', 'state-warn-label',
  'state-warn-primary', 'state-warn-secondary', 'state-warn-tertiary', 'switch-thumb', 'toast-bg',
  'toast-label', 'tooltip-bg', 'tooltip-key-bg', 'turn-trigger', 'turn-trigger-bg',
  'turn-trigger-bg-hover',
  'button-contrast-fill', 'button-elevated-fill', 'button-floating-fill', 'button-floating-hover',
  'button-ghost-active-border', 'button-ghost-active-fill', 'button-ghost-active-hover',
  'button-info-fill', 'button-info-hover', 'button-primary-dimmed', 'button-primary-fill',
  'button-primary-hover', 'button-tool-bar-fill', 'button-tool-bar-fill-invisible',
  'button-tool-bar-hover',
].map((n) => `--dsw-alias-${n}`)

const SPECIFIC = [
  'bubble', 'bubble-highlight', 'input-major', 'login-input', 'menu', 'selector', 'sidebar-fill',
  'sidebar-nav-item-active', 'sidebar-nav-item-active-accent', 'sidebar-nav-item-hover', 'tip',
].map((n) => `--dsw-specific-${n}`)

/**
 * 有意跳过、保持 DSH 默认的令牌：
 * - bg-mask-* / bg-mask-photo / bg-mask-drop 是纯黑透明度遮罩，与配色无关；
 * - brand-primary-new-colorprimary-new-color 是产品临时别名，不应由皮肤接管。
 */
const SKIP = new Set(['--dsw-alias-bg-mask-1', '--dsw-alias-bg-mask-2', '--dsw-alias-bg-mask-3',
  '--dsw-alias-bg-mask-drop', '--dsw-alias-bg-mask-photo', '--dsw-alias-brand-primary-new-colorprimary-new-color'])

/** AionUI 的 67 个语义变量：改写后不再保留（--primary-rgb 例外，它是皮肤自用的数据）。 */
const LEGACY = new Set([
  '--aou-1', '--aou-10', '--aou-2', '--aou-3', '--aou-4', '--aou-5', '--aou-6', '--aou-7', '--aou-8',
  '--aou-9', '--bg-1', '--bg-10', '--bg-2', '--bg-3', '--bg-4', '--bg-5', '--bg-6', '--bg-8', '--bg-9',
  '--bg-active', '--bg-base', '--bg-hover', '--border-base', '--border-light', '--border-special',
  '--brand', '--brand-hover', '--brand-light', '--color-bg-1', '--color-bg-2', '--color-bg-3',
  '--color-bg-4', '--color-border', '--color-border-1', '--color-border-2', '--color-brand-bg',
  '--color-brand-fill', '--color-fill', '--color-guid-agent-bar', '--color-primary',
  '--color-primary-dark-1', '--color-primary-light-1', '--color-primary-light-2',
  '--color-primary-light-3', '--color-text-1', '--color-text-2', '--color-text-3', '--color-text-4',
  '--danger', '--dialog-fill-0', '--fill', '--fill-0', '--fill-white-to-black', '--info', '--inverse',
  '--message-tips-bg', '--message-user-bg', '--primary', '--success', '--text-0', '--text-disabled',
  '--text-primary', '--text-secondary', '--text-white', '--warning', '--workspace-btn-bg',
])
/** 数据型变量：不是颜色，皮肤规则里会引用，保留。 */
const KEEP_LEGACY_DATA = new Set(['--primary-rgb'])

/** 规则体里残留的 var(--legacy) 引用 → 原生令牌（保持规则可解析）。 */
const REF_REWRITE = {
  '--bg-base': '--dsw-alias-bg-base',
  '--bg-1': '--dsw-alias-bg-layer-1',
  '--bg-2': '--dsw-alias-bg-layer-2',
  '--bg-3': '--dsw-alias-bg-layer-3',
  '--bg-4': '--dsw-alias-bg-layer-4',
  '--bg-hover': '--dsw-alias-interactive-bg-hover',
  '--bg-active': '--dsw-alias-interactive-bg-active',
  '--text-primary': '--dsw-alias-label-primary',
  '--text-secondary': '--dsw-alias-label-secondary',
  '--text-disabled': '--dsw-alias-label-quaternary',
  '--color-text-1': '--dsw-alias-label-primary',
  '--color-text-2': '--dsw-alias-label-secondary',
  '--color-text-3': '--dsw-alias-label-tertiary',
  '--color-text-4': '--dsw-alias-label-quaternary',
  '--color-border': '--dsw-alias-border-l2',
  '--color-border-1': '--dsw-alias-border-l1',
  '--color-border-2': '--dsw-alias-border-l2',
  '--border-light': '--dsw-alias-border-l1',
  '--border-base': '--dsw-alias-border-l2',
  '--border-special': '--dsw-alias-border-l3',
  '--color-primary': '--dsw-alias-brand-primary',
  '--primary': '--dsw-alias-brand-primary',
  '--brand': '--dsw-alias-brand-primary',
  '--brand-hover': '--dsw-alias-button-primary-hover',
  '--brand-light': '--dsw-alias-markdown-citation',
  '--color-primary-light-1': '--dsw-alias-markdown-citation',
  '--color-primary-light-2': '--dsw-alias-markdown-tag',
  '--color-primary-light-3': '--dsw-alias-interactive-bg-hover-accent',
  '--color-primary-dark-1': '--dsw-alias-button-primary-hover',
  '--color-brand-fill': '--dsw-alias-button-primary-fill',
  '--color-brand-bg': '--dsw-alias-interactive-bg-hover-accent',
  '--color-fill': '--dsw-alias-fill-l1',
  '--fill': '--dsw-alias-fill-l1',
  '--fill-0': '--dsw-alias-fill-l2',
  '--dialog-fill-0': '--dsw-alias-bg-overlay',
  '--message-user-bg': '--dsw-specific-bubble-highlight',
  '--message-tips-bg': '--dsw-specific-tip',
  '--workspace-btn-bg': '--dsw-alias-button-elevated-fill',
  '--color-guid-agent-bar': '--dsw-alias-separator-primary',
  '--success': '--dsw-alias-state-success-primary',
  '--danger': '--dsw-alias-state-error-primary',
  '--warning': '--dsw-alias-state-warn-primary',
  '--info': '--dsw-alias-state-business-primary',
  '--inverse': '--dsw-alias-border-inverted',
  '--text-white': '--dsw-alias-label-primary-inverted',
  '--text-0': '--dsw-alias-label-caption',
}

const mix = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

/**
 * 由一款皮肤的 AionUI 语义值推导完整原生令牌表。
 * @param {Map<string,string>} decls - 该模式块的变量表（AionUI 名 → 值）。
 * @returns {Array<[string,string]>} 原生声明（顺序稳定）。
 */
function derive(decls) {
  const g = (name) => decls.get(name)
  const pick = (...names) => {
    for (const n of names) if (g(n)) return g(n)
    return undefined
  }
  const out = []
  const put = (token, value) => {
    if (SKIP.has(token) || value === undefined) return
    out.push([token, value])
  }

  const bgBase = pick('--bg-base', '--bg-1')
  const bg1 = pick('--bg-1', '--bg-base')
  const bg2 = pick('--bg-2', '--bg-1')
  const bg3 = pick('--bg-3', '--bg-2')
  const bg4 = pick('--bg-4', '--bg-3')
  const overlay = pick('--dialog-fill-0', '--bg-1')
  const hover = pick('--bg-hover', '--bg-2')
  const active = pick('--bg-active', '--bg-3')
  const t1 = pick('--text-primary', '--color-text-1')
  const t2 = pick('--text-secondary', '--color-text-2')
  const t3 = pick('--color-text-3', '--text-disabled', '--text-secondary')
  const t4 = pick('--text-disabled', '--color-text-4', '--text-secondary')
  const onBrand = pick('--text-white', '--inverse', '--bg-base')
  const b1 = pick('--border-light', '--color-border-1', '--color-border')
  const b2 = pick('--border-base', '--color-border', '--color-border-2')
  const b3 = pick('--border-special', '--color-border-2', '--border-base')
  const brand = pick('--color-primary', '--brand')
  const brandHover = pick('--color-primary-dark-1', '--color-primary')
  const brandSoft = pick('--color-primary-light-1', '--color-brand-bg')
  const brandFill = pick('--color-brand-fill', '--color-primary')
  const fill = pick('--color-fill', '--fill', '--bg-2')
  const fill0 = pick('--fill-0', '--bg-1')
  const userBubble = pick('--message-user-bg', '--bg-3')
  const inverse = pick('--inverse', '--text-white')
  const success = g('--success')
  const danger = g('--danger')
  const warn = g('--warning')
  const info = g('--info')

  // surfaces
  put('--dsw-alias-bg-base', bgBase)
  put('--dsw-alias-bg-l1', bg1)
  put('--dsw-alias-bg-l2', bg2)
  put('--dsw-alias-bg-layer-1', bg1)
  put('--dsw-alias-bg-layer-2', bg2)
  put('--dsw-alias-bg-layer-3', bg3)
  put('--dsw-alias-bg-layer-4', bg4)
  put('--dsw-alias-bg-overlay', overlay)
  put('--dsw-alias-bg-module-platform', bg2)
  put('--dsw-alias-bg-multi-select', active)
  put('--dsw-alias-bg-skeleton', bg3)
  put('--dsw-alias-bg-document-preview', bg1)
  put('--dsw-alias-bg-document-selection', brand && mix(brand, 30))

  // text
  put('--dsw-alias-label-primary', t1)
  put('--dsw-alias-label-secondary', t2)
  put('--dsw-alias-label-tertiary', t3)
  put('--dsw-alias-label-quaternary', t4)
  put('--dsw-alias-label-caption', pick('--text-0', '--text-disabled'))
  put('--dsw-alias-label-dimmed', t4)
  put('--dsw-alias-label-primary-dimmed', t2)
  put('--dsw-alias-label-primary-bluish', t1)
  put('--dsw-alias-label-primary-inverted', onBrand)
  put('--dsw-alias-label-primary-foreground', onBrand)
  put('--dsw-alias-label-document-preview', t1)
  put('--dsw-alias-label-error', danger)
  put('--dsw-alias-label-shimmer', t1 && mix(t1, 30))
  put('--dsw-alias-label-deep-diving', info)
  put('--dsw-alias-label-deep-diving-shimmer', info && mix(info, 55))
  put('--dsw-alias-link', brand)

  // borders & separators
  put('--dsw-alias-border-l1', b1)
  put('--dsw-alias-border-l2', b2)
  put('--dsw-alias-border-l2-darkmode-thin', b1)
  put('--dsw-alias-border-l3', b3)
  put('--dsw-alias-border-l4', pick('--border-special', '--color-border-2', '--border-base'))
  put('--dsw-alias-border-inverted', inverse)
  put('--dsw-alias-border-inverted2', inverse)
  put('--dsw-alias-separator-primary', b1)

  // brand
  put('--dsw-alias-brand-primary', brand)
  put('--dsw-alias-brand-primary-invert', inverse)
  put('--dsw-alias-brand-text', onBrand)
  put('--dsw-alias-onboarding-accent', brand)
  put('--dsw-alias-markdown-citation', brandSoft)
  put('--dsw-alias-markdown-tag', brand && mix(brand, 14))
  put('--dsw-alias-markdown-inline-code', fill)
  put('--dsw-alias-markdown-code-block', bg1)
  put('--dsw-alias-markdown-code-block-banner', bg2)
  put('--dsw-alias-markdown-code-segment-selected', bg3)
  put('--dsw-alias-markdown-code-segment-unselected', bg1)
  put('--dsw-alias-markdown-placeholder', t4)

  // fills & interaction
  put('--dsw-alias-fill-l1', fill)
  put('--dsw-alias-fill-l2', fill0)
  put('--dsw-alias-fill-tertiary', bg3)
  put('--dsw-alias-fill-tsp-secondary', t1 && mix(t1, 8))
  put('--dsw-alias-interactive-bg-hover', hover)
  put('--dsw-alias-interactive-bg-active', active)
  put('--dsw-alias-interactive-bg-hover-accent', brand && mix(brand, 12))
  put('--dsw-alias-interactive-bg-hover-danger', danger && mix(danger, 12))
  put('--dsw-alias-interactive-bg-hover-solid', bg3)

  // states
  put('--dsw-alias-state-error-primary', danger)
  put('--dsw-alias-state-error-secondary', danger && mix(danger, 15))
  put('--dsw-alias-state-success-primary', success)
  put('--dsw-alias-state-success-secondary', success && mix(success, 15))
  put('--dsw-alias-state-success-tertiary', success && mix(success, 8))
  put('--dsw-alias-state-warn-primary', warn)
  put('--dsw-alias-state-warn-secondary', warn && mix(warn, 15))
  put('--dsw-alias-state-warn-tertiary', warn && mix(warn, 8))
  put('--dsw-alias-state-warn-label', warn)
  put('--dsw-alias-state-business-primary', info)
  put('--dsw-alias-state-business-tertiary', info && mix(info, 10))
  put('--dsw-alias-state-idle-primary', t4)

  // diff
  put('--dsw-alias-code-diff-added', success && mix(success, 18))
  put('--dsw-alias-code-diff-deleted', danger && mix(danger, 18))
  put('--dsw-alias-file-diff', t2 && mix(t2, 12))
  put('--dsw-alias-file-diff-added-bg', success && mix(success, 12))
  put('--dsw-alias-file-diff-added-gutter', success && mix(success, 22))
  put('--dsw-alias-file-diff-added-marker', success && mix(success, 45))
  put('--dsw-alias-file-diff-deleted-bg', danger && mix(danger, 12))
  put('--dsw-alias-file-diff-deleted-gutter', danger && mix(danger, 22))
  put('--dsw-alias-file-diff-deleted-marker', danger && mix(danger, 45))

  // scrollbar / menu / tooltip / toast
  put('--dsw-alias-scrollbar', t2 && mix(t2, 45))
  put('--dsw-alias-scrollbar-bg-l1', bg1)
  put('--dsw-alias-scrollbar-bg-l2', bg2)
  put('--dsw-alias-scrollbar-hover-l1', hover)
  put('--dsw-alias-scrollbar-hover-l2', hover)
  put('--dsw-alias-menu-icon', t2)
  put('--dsw-alias-menu-group-header-fill', bg2)
  put('--dsw-alias-tooltip-bg', inverse ?? t1)
  put('--dsw-alias-tooltip-key-bg', mix('#ffffff', 14))
  put('--dsw-alias-toast-bg', bg3)
  put('--dsw-alias-toast-label', t1)
  put('--dsw-alias-switch-thumb', pick('--text-white', '--bg-base'))
  put('--dsw-alias-turn-trigger', t2)
  put('--dsw-alias-turn-trigger-bg', bg2)
  put('--dsw-alias-turn-trigger-bg-hover', bg3)

  // buttons
  put('--dsw-alias-button-primary-fill', brandFill)
  put('--dsw-alias-button-primary-hover', brandHover)
  put('--dsw-alias-button-primary-dimmed', brand && mix(brand, 45))
  put('--dsw-alias-button-contrast-fill', pick('--color-primary-dark-1', '--color-primary-light-1', '--inverse'))
  put('--dsw-alias-button-elevated-fill', bg1)
  put('--dsw-alias-button-floating-fill', bg2)
  put('--dsw-alias-button-floating-hover', hover)
  put('--dsw-alias-button-ghost-active-fill', brand && mix(brand, 16))
  put('--dsw-alias-button-ghost-active-border', pick('--color-primary-light-2') ?? (brand && mix(brand, 55)))
  put('--dsw-alias-button-ghost-active-hover', brand && mix(brand, 24))
  put('--dsw-alias-button-info-fill', info)
  put('--dsw-alias-button-info-hover', info && mix(info, 85))
  put('--dsw-alias-button-tool-bar-fill', bg2)
  put('--dsw-alias-button-tool-bar-fill-invisible', 'transparent')
  put('--dsw-alias-button-tool-bar-hover', hover)

  // onboarding & cards
  put('--dsw-alias-onboarding-card-fill', bg1)
  put('--dsw-alias-onboarding-secondary-fill', bg2)
  put('--dsw-alias-onboarding-checkbox-border', b2)
  put('--dsw-alias-settings-card-fill', bg2)
  put('--dsw-alias-settings-card-stroke', b2)

  // feature-specific seats
  put('--dsw-specific-bubble', bg2)
  put('--dsw-specific-bubble-highlight', userBubble)
  put('--dsw-specific-input-major', overlay)
  put('--dsw-specific-login-input', bg1)
  put('--dsw-specific-menu', bg1)
  put('--dsw-specific-selector', bg2)
  put('--dsw-specific-sidebar-fill', bg1)
  put('--dsw-specific-sidebar-nav-item-active', active)
  put('--dsw-specific-sidebar-nav-item-active-accent', brand)
  put('--dsw-specific-sidebar-nav-item-hover', hover)
  put('--dsw-specific-tip', bg3)

  const seen = new Set()
  return out.filter(([k]) => (seen.has(k) ? false : (seen.add(k), true)))
}

/** 把一个选择器里永远不匹配的复合选择器摘掉；返回 null 表示整条丢掉。 */
function cleanSelector(selector) {
  const s = selector.trim()
  if (s.startsWith('@')) return s
  if (/\[class\s*[*^$|~]?=/.test(s)) return null // 猜实现类名的写法，DSH 里没有稳定类名
  let out = s
    .replace(/\._?[A-Za-z0-9-]*_?arco-[A-Za-z0-9-]+/g, '') // 构建时已哈希的 Arco 类
    .replace(/\._?[A-Za-z0-9-]*_?markdown-body/g, '')      // 同上，DSH 无此类名
    .replace(/\.arco-[A-Za-z0-9-]+/g, '')
  out = out.replace(/\(\s*\)/g, '').replace(/:not\(\s*\)/g, '').trim()
  if (out === '' || /:not\(\s*\)/.test(out)) return null
  return out.replace(/\s{2,}/g, ' ').replace(/\s*([>+~])\s*/g, ' $1 ')
}

function parseDecls(body) {
  const out = []
  for (const part of body.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const name = part.slice(0, i).trim()
    if (!name.startsWith('--')) continue
    out.push([name, part.slice(i + 1).trim()])
  }
  return out
}

/**
 * Merge rules that repeat the same selector, keeping the last value of each
 * property (identical cascade result), so one skin cannot declare a token
 * twice in the same scope. Single-occurrence rules keep their original text —
 * including the generated palette block's formatting. @-blocks are emitted
 * verbatim, so keyframe steps are never merged across animations.
 * @param css - the full stylesheet.
 * @returns the stylesheet with duplicate selectors collapsed.
 */
function mergeSameSelector(css) {
  const rules = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) { rules.push({ raw: css.slice(i) }); break }
    let depth = 0
    let j = open
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') { depth--; if (depth === 0) break }
    }
    const raw = css.slice(i, j + 1)
    const prelude = css.slice(i, open)
    if (prelude.trim().startsWith('@')) rules.push({ raw })
    else {
      rules.push({
        raw,
        key: prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' '),
        prelude,
        body: css.slice(open + 1, j),
      })
    }
    i = j + 1
  }

  const groups = new Map()
  for (const r of rules) {
    if (r.key === undefined) continue
    groups.set(r.key, [...(groups.get(r.key) ?? []), r])
  }

  return rules.map((r) => {
    if (r.key === undefined) return r.raw
    const group = groups.get(r.key)
    if (group.length === 1 || group[0] !== r) return group[0] === r ? mergeGroup(group) : ''
    return mergeGroup(group)
  }).join('')
}

/** Merge one selector group, preserving the first rule's formatting. */
function mergeGroup(group) {
  if (group.length === 1) return group[0].raw
  const props = new Map()
  const order = []
  for (const r of group) {
    for (const part of r.body.split(';')) {
      const k = part.indexOf(':')
      if (k < 0) continue
      const name = part.slice(0, k).trim()
      if (!name) continue
      if (!props.has(name)) order.push(name)
      props.set(name, part.slice(k + 1).trim())
    }
  }
  const first = group[0].body
  const indent = (first.match(/\n(\s+)--/) ?? ['', '  '])[1]
  const body = order.map((n, idx) => {
    const sep = first.includes('\n') ? `\n${indent}` : (idx === 0 ? '' : '')
    return `${sep}${n}: ${props.get(n)};`
  }).join('')
  return `${group[0].prelude}{${body}${first.includes('\n') ? `\n` : ''}}`
}

/**
 * Drop `@keyframes` blocks that no `animation` / `animation-name` declaration in
 * the same stylesheet references. These are leftovers of the AionUI mock era
 * (animations written for mock-only elements), so they can never run in DSH.
 * @param css - the full stylesheet.
 * @returns the stylesheet without unreferenced animations, plus what was pruned.
 */
function pruneDeadKeyframes(css) {
  const referenced = new Set()
  for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    for (const token of m[1].split(/[\s,]+/)) {
      if (/^-?[A-Za-z_][\w-]*$/.test(token)) referenced.add(token)
    }
  }
  let out = ''
  let i = 0
  let removed = 0
  const names = []
  const re = /@keyframes\s+([\w-]+)\s*\{/g
  while (true) {
    re.lastIndex = i
    const m = re.exec(css)
    if (m === null) { out += css.slice(i); break }
    let depth = 0
    let j = m.index + m[0].length - 1
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') { depth--; if (depth === 0) break }
    }
    out += css.slice(i, m.index)
    if (referenced.has(m[1])) out += css.slice(m.index, j + 1)
    else { removed++; names.push(m[1]) }
    i = j + 1
  }
  return { css: out, removed, names }
}

/**
 * The skin's own corner language, taken from the `border-radius` values its
 * rules still declare. Flush-cornered skins (pixel/retro families, where most
 * declarations are 0) stay square; every other skin gets the median of its
 * non-zero radii, clamped to a sane window range. Percentages, variables and
 * multi-value shorthands are skipped.
 * @param css - the full stylesheet.
 * @returns the radius in px, or undefined when the skin declares none.
 */
function dominantRadius(css) {
  const values = []
  for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
    const raw = m[1].trim()
    if (raw.includes('%') || raw.includes('var(')) continue
    const first = raw.split(/\s+/)[0]
    // `0` without a unit is valid CSS and is the signature of the pixel/retro
    // skins, so it must count as 0px instead of being skipped.
    const px = /^(\d+(?:\.\d+)?)(px)?$/.exec(first)
    if (px === null) continue
    if (px[2] === undefined && Number(px[1]) !== 0) continue
    const n = Math.round(Number(px[1]))
    if (n < 0 || n > 16) continue
    values.push(n)
  }
  if (values.length === 0) return undefined

  const zeros = values.filter((v) => v === 0).length
  if (zeros / values.length >= 0.6) return 0

  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (nonZero.length === 0) return 0
  const mid = nonZero[Math.floor((nonZero.length - 1) / 2)]
  return Math.min(10, Math.max(4, mid))
}

/** 极简压缩：注释、空白、末尾分号；引号内不动。 */function minify(css) {
  let out = ''
  let quote = null
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (quote) {
      out += ch
      if (ch === '\\') { out += css[++i] ?? ''; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 1
      continue
    }
    if (ch === '\n' || ch === '\t' || ch === '\r') { out += ' '; continue }
    out += ch
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

/** 处理一款皮肤，返回报告。 */
function portSkin(id, { dryRun }) {
  const cssPath = join(SKINS, id, 'src', 'client', `${id}.module.css`)
  const libPath = join(SKINS, id, 'lib', 'client.js')
  if (!existsSync(cssPath)) return { id, skipped: 'no source css' }
  const source = readFileSync(cssPath, 'utf8')

  const report = { id, blocks: 0, droppedLegacy: 0, emittedTokens: 0, rewrittenRefs: 0, droppedSelectors: 0, droppedAliasBlocks: 0, errors: [], warnings: [] }

  let out = ''
  let last = 0
  // Data variables: legacy names the skin's own rules still consume (e.g.
  // --aou-1..10 accent slots, --primary-rgb triplet). They have no native
  // equivalent, so keep the declaration instead of leaving a dangling var().
  const referenced = new Set([...source.matchAll(/var\(\s*(--[\w-]+)/g)].map((mm) => mm[1]))
  const NEEDS_KEEP = new Set([...referenced].filter((n) => LEGACY.has(n) && !REF_REWRITE[n]))
  report.keptDataVars = [...NEEDS_KEEP].sort()
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(source))) {
    const rawSelector = m[1]
    const decls = parseDecls(m[2])
    const legacyCount = decls.filter(([n]) => LEGACY.has(n)).length

    // 非调色板块：只清理选择器里的死类名
    if (legacyCount < 8) {
      // 旧版转换器手写的 partial alias 覆盖块（"alias & specific: light/dark"）：
      // 它在文件里位于本工具产出的块之后，同特异性下会赢，把侧栏、气泡、按钮
      // 等覆盖成主色/杂色（侧栏底 = 主色，正是「左侧跟预览不一样」的成因）。
      // 本工具已经为每个块产出完整的 125 个令牌，故整块删除；只识别「全部是
      // alias/specific、且不是本工具产出」的块，含 --dsw-static-* 的静态色阶块保留。
      const onlyAliasOrSpecific = decls.length > 0 && decls.every(([n]) => n.startsWith('--dsw-alias-') || n.startsWith('--dsw-specific-'))
      const isOwnBlock = m[2].includes('DSH native aliases')
      const selectorText = rawSelector.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      const allBodyScoped = selectorText.split(',').every((s) => /^\s*(body|html)\[data-dsh-/.test(s))
      if (onlyAliasOrSpecific && !isOwnBlock && allBodyScoped) {
        report.droppedAliasBlocks++
        out += source.slice(last, m.index)
        last = m.index + m[0].length
        continue
      }
      const selectors = [...new Set(rawSelector.split(',').map(cleanSelector).filter(Boolean))]
      if (selectors.length === 0) {
        report.droppedSelectors++
        out += source.slice(last, m.index)
        last = m.index + m[0].length
        continue
      }
      const rebuilt = selectors.join(',')
      let body = m[2]
      for (const [from, to] of Object.entries(REF_REWRITE)) {
        const rx = new RegExp(`var\\(\\s*${from.replace(/[-]/g, '\\-')}\\s*\\)`, 'g')
        if (rx.test(body)) { body = body.replace(rx, `var(${to})`); report.rewrittenRefs++ }
      }
      out += source.slice(last, m.index)
      out += rebuilt + '{' + body + '}'
      last = m.index + m[0].length
      continue
    }

    // 调色板块：重写为原生令牌
    const map = new Map(decls)
    const native = derive(map)
    if (native.length < 100) report.errors.push(`block "${rawSelector.trim().slice(0, 40)}" produced only ${native.length} tokens`)

    const kept = decls.filter(([n]) => !LEGACY.has(n) || KEEP_LEGACY_DATA.has(n) || NEEDS_KEEP.has(n))
    const dropped = decls.length - kept.length
    report.droppedLegacy += dropped
    report.emittedTokens = Math.max(report.emittedTokens, native.length)
    report.blocks++

    const missing = [...ALIAS, ...SPECIFIC].filter((t) => !SKIP.has(t) && !native.some(([k]) => k === t))
    if (missing.length) report.warnings.push(`block missing ${missing.length} tokens: ${missing.slice(0, 4).join(' ')}`)

    const bodyLines = []
    for (const [n, v] of kept) bodyLines.push(`  ${n}: ${v};`)
    bodyLines.push('  /* --- DSH native aliases (derived by tools/native_port.mjs) --- */')
    for (const [n, v] of native) bodyLines.push(`  ${n}: ${v};`)

    out += source.slice(last, m.index)
    out += rawSelector + '{\n' + bodyLines.join('\n') + '\n}'
    last = m.index + m[0].length
  }
  out += source.slice(last)
  out = out.replace(/\{\s*\}/g, '{}').replace(/\n{3,}/g, '\n\n')

  // 上一轮生成的块先摘掉（必须在 mergeSameSelector 之前：它会把同选择器的
  // 几何块并进调色板块，之后再按块删除就删不到了）。几何声明本身也一并清掉，
  // 保证重跑幂等、同一作用域内不出现重复令牌。
  out = out.replace(/\n?\/\* --- DSH shell geometry[^\n]*\n/g, '\n')
  out = out.replace(/--dsh-windows-content-radius\s*:\s*[^;}]+;?/g, '')
  out = out.replace(/--dsh-windows-titlebar-height\s*:\s*[^;}]+;?/g, '')
  out = out.replace(/\n?\/\* --- helper fallbacks[\s\S]*?\nbody\[data-dsh-[^\]]+\]\{[^}]*\}\n?/g, '\n')

  out = mergeSameSelector(out)

  // mock 时代留下的死动画：@keyframes 定义了却没有任何 animation 引用它。
  const pruned = pruneDeadKeyframes(out)
  out = pruned.css
  if (pruned.removed) report.warnings.push(`pruned ${pruned.removed} unreferenced @keyframes (${pruned.names.slice(0, 3).join(' ')}…)`)

  // 源转换器漏声明过的辅助变量（如 --db-leaf、--sf-flame-blue）：给出品牌色兜底，
  // 否则引用它们的渐变/阴影整条失效。已声明过就不再补。
  const declaredNow = new Set([...out.matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]))
  const unresolvedHelpers = [...new Set([...out.matchAll(/var\(\s*(--[\w-]+)/g)].map((x) => x[1]))]
    .filter((n) => !declaredNow.has(n) && !n.startsWith('--dsw-'))
  if (unresolvedHelpers.length) {
    report.warnings.push(`fallback for ${unresolvedHelpers.length} undeclared helper vars: ${unresolvedHelpers.slice(0, 3).join(' ')}`)
    const fallback = unresolvedHelpers.map((n) => `  ${n}: var(--dsw-alias-brand-primary);`).join('\n')
    out += `\n/* --- helper fallbacks (undeclared in the source palette) --- */\nbody[data-dsh-${id}]{\n${fallback}\n}\n`
  }

  // 外壳几何：只接两个低风险旋钮。圆角取皮肤自己的圆角语言（众数），
  // 标题栏高度只在「圆角 >= 8px 的柔和皮肤」上抬到 44（只增不减，
  // 避免比系统 40px 覆盖层更矮而露出接缝）。
  const radius = dominantRadius(out)
  if (radius !== undefined) {
    const height = radius >= 8 ? 44 : undefined
    const decls = [`  --dsh-windows-content-radius: ${radius}px;`]
    if (height !== undefined) decls.push(`  --dsh-windows-titlebar-height: ${height}px;`)
    out += `\n/* --- DSH shell geometry (tools/native_port.mjs) --- */\nbody[data-dsh-${id}]{\n${decls.join('\n')}\n}\n`
    report.geometry = { radius, height }
  }

  // 校验：不应再有被删除的遗留变量被引用
  for (const name of LEGACY) {
    if (KEEP_LEGACY_DATA.has(name) || NEEDS_KEEP.has(name)) continue
    const rx = new RegExp(`var\\(\\s*${name.replace(/[-]/g, '\\-')}\\s*[,)]`)
    if (rx.test(out)) report.errors.push(`dangling reference to removed ${name}`)
  }
  if (!dryRun) {
    writeFileSync(cssPath, out, 'utf8')
    // 同步构建产物里内嵌的 CSS（等价于 pnpm build 的 css 模块产物）
    if (existsSync(libPath)) {
      const src = readFileSync(libPath, 'utf8')
      const marker = 'const css = '
      const at = src.indexOf(marker)
      if (at < 0) report.errors.push('lib/client.js has no embedded css literal')
      else {
        const start = src.indexOf('"', at)
        let end = start + 1
        while (end < src.length) {
          if (src[end] === '\\') { end += 2; continue }
          if (src[end] === '"') break
          end++
        }
        const literal = JSON.stringify(minify(out))
        writeFileSync(libPath, src.slice(0, start) + literal + src.slice(end + 1), 'utf8')
      }
    }
  }
  return report
}

// ---- CLI ----
const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const dryRun = has('--dry-run')
const idsFlag = valueOf('--ids')
const all = has('--all') || (!idsFlag && !has('--check'))

const ids = idsFlag
  ? idsFlag.split(',').map((s) => s.trim()).filter(Boolean)
  : readdirSync(SKINS).filter((d) => existsSync(join(SKINS, d, 'src', 'client', `${d}.module.css`)))

const reports = (all ? ids : idsFlag.split(',')).map((id) => portSkin(id, { dryRun: dryRun || has('--check') }))

let errors = 0
for (const r of reports) {
  const bits = []
  if (r.skipped) bits.push(`SKIP ${r.skipped}`)
  else {
    bits.push(`blocks=${r.blocks}`, `legacy-removed=${r.droppedLegacy}`, `tokens=${r.emittedTokens}`,
      `refs=${r.rewrittenRefs}`, `selectors-cleaned=${r.droppedSelectors}`)
  }
  const status = r.errors?.length ? 'FAIL' : r.warnings?.length ? 'WARN' : 'ok  '
  console.log(`${status} ${String(r.id).padEnd(22)} ${bits.join(' ')}`)
  for (const e of r.errors ?? []) { console.log(`     error: ${e}`); errors++ }
  for (const w of r.warnings ?? []) console.log(`     warn:  ${w}`)
}
console.log(`\n${reports.length} skins, ${errors} errors${dryRun || has('--check') ? ' (no files written)' : ''}`)
process.exitCode = errors ? 1 : 0
