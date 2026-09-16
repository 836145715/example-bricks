#!/usr/bin/env node
'use strict'

/**
 * example-bricks 旧布局 → src/out 契约迁移脚本。
 *
 * 用法：
 *   node scripts/migrate-src-out.cjs                  # dry-run：打印每砖迁移计划，不落盘
 *   node scripts/migrate-src-out.cjs --apply          # 执行迁移
 *   node scripts/migrate-src-out.cjs --brick com.xxx  # 只处理单个砖（可与 --apply 组合）
 *   node scripts/migrate-src-out.cjs --verify-only    # 只跑迁移后校验（契约规则）
 *
 * 迁移规则（与 ai-bricks/specs/brick-layout.json 对齐）：
 *   manifest: 删 runtime.entry/ui.entry/include；runtime.type go→native；
 *             缺 platforms 时由旧 entry keys 合成；manifest.preload 改指 preload/<name>
 *   源码:   runtime/<lang>|runtime 散文件|平台目录 → src/runtime/
 *           根 vite 项目(根 src/+vite.config) → src/ui/；手写 ui/ → src/ui/
 *           preload.cjs|preload/ → src/preload/
 *   清理:   旧 runtime/、产物 ui/、node_modules、.venv、__pycache__、安装戳记
 *   生成:   .gitignore（out/、.brickly/、依赖目录、本地密钥配置）
 *   修补:   build.ps1/sh/mjs 输出路径改走 BRICKLY_BUILD_OUT（兜底 out/runtime/<平台>）
 *           vite.config/tsconfig/package.json scripts 内的相对路径
 *   识别不了的形态进 manual 清单，人工处理。
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const PLATFORMS = ['win-x64', 'win-arm64', 'mac-x64', 'mac-arm64', 'linux-x64', 'linux-arm64']
const PLATFORM_RE = /^(win|mac|linux)-(x64|arm64)$/
const SKIP_DIR_NAMES = new Set(['node_modules', '.venv', '__pycache__', '.git', '.brickly'])
const DEPENDENCY_DIRS = ['node_modules', '.venv', '__pycache__']
const STALE_FILES = ['.brickly-installed.json', '.brickly-build.json', '.DS_Store']

const GITIGNORE = `# Brick src/out 契约：成品树与本地状态不进库
out/
.brickly/
.brickly-build.json
.brickly-installed.json

# 依赖与缓存
node_modules/
__pycache__/
.venv/
*.log
.DS_Store

# 本地密钥配置（永不入库/入包）
mcp-adapter.local.json
`

// ---------- 小工具 ----------

function exists(p) {
  return fs.existsSync(p)
}

function listDir(dir) {
  if (!exists(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
}

function subdirs(dir) {
  return listDir(dir).filter((e) => e.isDirectory()).map((e) => e.name)
}

function filesOf(dir) {
  return listDir(dir).filter((e) => e.isFile()).map((e) => e.name)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function dirNonEmpty(dir) {
  return exists(dir) && listDir(dir).length > 0
}

/** 目录下（浅层）是否存在任一指定文件 */
function hasAny(dir, names) {
  return names.some((n) => exists(path.join(dir, n)))
}

/** 递归收集目录内全部相对路径（跳过依赖/缓存目录） */
function walkRel(dir, base = dir, out = []) {
  for (const e of listDir(dir)) {
    if (e.isDirectory() && SKIP_DIR_NAMES.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkRel(full, base, out)
    else out.push(path.relative(base, full).replace(/\\/g, '/'))
  }
  return out
}

// ---------- 计划构建 ----------

function planBrick(brickDir) {
  const id = path.basename(brickDir)
  const plan = { id, dir: brickDir, ops: [], warnings: [], manual: [], skipped: false }
  const P = (...segs) => path.join(brickDir, ...segs)
  const manifestFile = P('manifest.json')
  if (!exists(manifestFile)) {
    plan.skipped = true
    plan.skipReason = '无 manifest.json'
    return plan
  }
  if (exists(P('src', 'runtime')) || exists(P('src', 'ui')) || exists(P('src', 'preload'))) {
    plan.skipped = true
    plan.skipReason = 'src/ 契约目录已存在（疑似已迁移）'
    return plan
  }

  const manifest = readJson(manifestFile)
  const rt = manifest.runtime && manifest.runtime.type
  const runtimeType = rt === 'go' ? 'native' : rt
  const uiType = manifest.ui && manifest.ui.type

  const move = (from, to, note) =>
    plan.ops.push({ kind: 'move', from, to, note })
  const copytree = (from, to, excludes, note) =>
    plan.ops.push({ kind: 'copytree', from, to, excludes: excludes || [], note })
  const del = (target, note) => plan.ops.push({ kind: 'delete', target, note })
  const patch = (file, edits, note) => plan.ops.push({ kind: 'patch', file, edits, note })
  const write = (file, content, note) => plan.ops.push({ kind: 'write', file, content, note })

  // ===== runtime 源码 → src/runtime/ =====
  if (runtimeType) {
    planRuntime(plan, manifest, runtimeType, { P, move, copytree, del })
  }

  // ===== UI 源码 → src/ui/ =====
  planUi(plan, manifest, uiType, { P, move, del, patch })

  // ===== preload → src/preload/ =====
  planPreload(plan, manifest, { P, move, del })

  // ===== manifest 改写 =====
  planManifest(plan, manifest, runtimeType)

  // ===== 根 package.json 空壳清理（vite 砖的已在 planUi 挪走） =====
  planRootPkg(plan, { P, del, patch })

  // ===== 清理与生成 =====
  if (exists(P('runtime'))) del(P('runtime'), '旧 runtime/ 树（源码已迁走，产物不入库）')
  for (const stale of STALE_FILES) if (exists(P(stale))) del(P(stale), '本地状态戳记')
  plan.ops.push({ kind: 'gitignore', note: '写入 src/out 契约 .gitignore' })

  return plan
}

/** runtime 源定位：非平台源码目录 > runtime 根散文件 > 平台目录内拷贝 > 预构建 */
function planRuntime(plan, manifest, runtimeType, { P, move, copytree }) {
  const runtimeDir = P('runtime')
  const nonPlatDirs = subdirs(runtimeDir).filter((n) => !PLATFORM_RE.test(n))
  const loose = filesOf(runtimeDir)
  const platDirs = subdirs(runtimeDir).filter((n) => PLATFORM_RE.test(n))

  // 各类型「这是源码目录」的判别标记（*.ext 为后缀通配）；
  // 并集用来把「不属于本类型但确实是源码」的目录识别出来，防止被 runtime/ 删除误伤。
  const markersByType = {
    native: ['go.mod', 'CMakeLists.txt', 'main.cpp', 'build.mjs', 'build.ps1', 'build.sh', '*.csproj'],
    node: ['package.json'],
    python: ['pyproject.toml']
  }
  const markers = markersByType[runtimeType] || []
  const isSourceDir = (dir, list) =>
    list.some((m) => m.startsWith('*.')
      ? filesOf(dir).some((f) => f.endsWith(m.slice(1)))
      : exists(path.join(dir, m)))

  // 先按全集把「像源码」的目录全部找出，再按 manifest 类型匹配
  const allSrcDirs = nonPlatDirs.filter((d) =>
    isSourceDir(path.join(runtimeDir, d), Object.values(markersByType).flat()))
  const srcDirs = allSrcDirs.filter((d) => isSourceDir(path.join(runtimeDir, d), markers))
  const looseIsSource = isSourceDir(runtimeDir, markers)

  // 与 manifest 类型不匹配的源码目录：挪进 src/runtime 保留原名，人工裁决（防误删）
  const foreign = allSrcDirs.filter((d) => !srcDirs.includes(d))
  for (const d of foreign) {
    move(path.join(runtimeDir, d), P('src', 'runtime', d), `runtime/${d} → src/runtime/${d}（非 ${runtimeType} 源码）`)
    plan.manual.push(`runtime/${d} 疑似非 ${runtimeType} 源码，已保留在 src/runtime/${d}，请人工确认归属`)
  }

  // 记录将被搬到 src/runtime 根的「搬迁前目录」，构建脚本在其内原位读取、
  // patch 目标写成搬迁后的 src/runtime/<脚本名>
  let sourceRootPre = null
  if (srcDirs.length === 1 && !looseIsSource) {
    sourceRootPre = path.join(runtimeDir, srcDirs[0])
    move(sourceRootPre, P('src', 'runtime'), `runtime/${srcDirs[0]} → src/runtime`)
  } else if (srcDirs.length === 0 && looseIsSource) {
    // log-searcher 型：go 源码散在 runtime/ 根
    sourceRootPre = runtimeDir
    for (const f of loose) move(path.join(runtimeDir, f), P('src', 'runtime', f), `runtime/${f} → src/runtime/`)
  } else if (srcDirs.length > 1) {
    const preferred = pickPreferredSourceDir(srcDirs, runtimeType)
    sourceRootPre = path.join(runtimeDir, preferred)
    move(sourceRootPre, P('src', 'runtime'), `runtime/${preferred} → src/runtime`)
    const rest = srcDirs.filter((d) => d !== preferred)
    for (const d of rest) {
      move(path.join(runtimeDir, d), P('src', 'runtime', d), `runtime/${d} → src/runtime/${d}`)
      plan.manual.push(`runtime/ 下还有额外 ${runtimeType} 源码目录 ${d}，已挪入 src/runtime/${d}，请人工确认`)
    }
  } else if (platDirs.length > 0) {
    // 源码藏在平台目录（node/python 砖每平台一份拷贝）
    const pick = pickPlatformSourceDir(runtimeDir, platDirs, runtimeType)
    if (pick) {
      copytree(
        path.join(runtimeDir, pick),
        P('src', 'runtime'),
        DEPENDENCY_DIRS,
        `runtime/${pick} → src/runtime（剔除依赖目录）`
      )
    } else {
      // 平台目录全是制品无源码 → 预构建逃逸舱 bin/<platform>/
      const hasArtifacts = platDirs.some((d) => dirNonEmpty(path.join(runtimeDir, d)))
      if (hasArtifacts) {
        for (const d of platDirs) {
          if (dirNonEmpty(path.join(runtimeDir, d)))
            move(path.join(runtimeDir, d), P('src', 'runtime', 'bin', d), `预构建 runtime/${d} → src/runtime/bin/${d}`)
        }
        plan.warnings.push('未找到 runtime 源码，平台目录按预构建产物迁入 bin/，请确认')
      } else {
        plan.manual.push('manifest 声明了 runtime 但找不到任何源码或产物')
      }
    }
  } else {
    plan.manual.push('manifest 声明了 runtime 但 runtime/ 无可识别源码')
  }

  // 构建脚本在搬迁前位置探测，patch 目标指向 src/runtime 下的落点
  if (sourceRootPre) planBuildScriptPatches(plan, sourceRootPre, P('src', 'runtime'))
}

function pickPreferredSourceDir(srcDirs, runtimeType) {
  const order = { native: ['go', 'cpp', 'dotnet'], node: ['node'], python: ['python'] }
  for (const name of order[runtimeType] || []) if (srcDirs.includes(name)) return name
  return srcDirs[0]
}

/** 平台目录是否是「源码型」（含该语言入口文件而非纯制品） */
function pickPlatformSourceDir(runtimeDir, platDirs, runtimeType) {
  const signature = {
    node: ['index.js', 'index.cjs', 'package.json'],
    python: ['main.py', 'pyproject.toml'],
    native: ['go.mod']
  }[runtimeType] || []
  const sorted = [...platDirs].sort((a, b) => (a === 'win-x64' ? -1 : b === 'win-x64' ? 1 : a.localeCompare(b)))
  for (const d of sorted) {
    if (hasAny(path.join(runtimeDir, d), signature)) return d
  }
  return null
}

// ===== UI =====

// vite 工程的 outDir 补丁组：CLI --outDir 会覆盖配置，此处是给手动构建兜底
const VITE_OUTDIR_EDITS = [
  { match: /outDir:\s*'\.\.\/ui'/g, replace: `outDir: '../../out/ui'` },
  { match: /outDir:\s*"\.\.\/ui"/g, replace: `outDir: "../../out/ui"` },
  {
    match: /resolve\((here|__dirname),\s*['"]\.\.\/ui['"]\)/g,
    replace: (m, base) => `resolve(${base}, '../../out/ui')`
  }
]

function planUi(plan, manifest, uiType, { P, move, del, patch }) {
  const rootSrc = P('src')
  const viteConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mts'].find((f) => exists(P(f)))
  const rootSrcIsVite = dirNonEmpty(rootSrc) && (Boolean(viteConfig) || exists(P('src', 'index.html')))
  const uiDir = P('ui')

  // 子目录型 vite 工程（如 sunnynettools 的 frontend/）：整目录平铺进 src/ui/
  const subUiDir = ['frontend', 'ui-src', 'web'].find((d) =>
    dirNonEmpty(P(d)) && (
      ['vite.config.ts', 'vite.config.js', 'vite.config.mts'].some((f) => exists(P(d, f))) ||
      (exists(P(d, 'package.json')) && (exists(P(d, 'index.html')) || dirNonEmpty(P(d, 'src'))))
    ))

  if (!rootSrcIsVite && subUiDir) {
    const from = P(subUiDir)
    for (const e of listDir(from)) {
      if (DEPENDENCY_DIRS.includes(e.name)) continue // node_modules 等依赖目录不随源码走
      move(path.join(from, e.name), P('src', 'ui', e.name), `${subUiDir}/ → src/ui/`)
    }
    del(from, `${subUiDir}/ 已平铺进 src/ui/`)
    const subViteConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mts'].find((f) => exists(path.join(from, f)))
    if (subViteConfig)
      patch(P('src', 'ui', subViteConfig), VITE_OUTDIR_EDITS,
        'vite.config：outDir 指 out/ui（CLI --outDir 优先，此处为手动构建兜底）')
    // file:.. 自引用与 lockfile 的 resolved:.. 都要上移一层（src/ui → 砖根）
    for (const f of ['package.json', 'package-lock.json']) {
      if (!exists(P(subUiDir, f))) continue
      patch(P('src', 'ui', f), [
        { match: /"(file|link|resolved):\.\.(?=\/|\\|")/g, replace: '"$1:../.."' },
        { match: /"resolved":\s*"\.\."/g, replace: '"resolved": "../.."' }
      ], `${f} file:/resolved: 自引用上移一层`)
    }
    if (dirNonEmpty(uiDir)) del(uiDir, 'ui/ 为 vite 产物，不入库')
    plan.manual.push(`${subUiDir}/ 为子目录前端工程，已平铺进 src/ui/，请人工核对根 package.json 脚本与 scripts/ 工具内的路径引用`)
    return
  }

  if (rootSrcIsVite) {
    // 根级 Vite 项目：src/* → src/ui/，工程文件跟进
    for (const e of listDir(rootSrc)) move(path.join(rootSrc, e.name), P('src', 'ui', e.name), 'src/ → src/ui/')
    const aux = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
      'tsconfig.json', 'tsconfig.node.json', 'tsconfig.app.json', 'index.html',
      'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js']
    for (const f of aux) if (exists(P(f))) move(P(f), P('src', 'ui', f), `${f} → src/ui/`)
    if (viteConfig) {
      move(P(viteConfig), P('src', 'ui', viteConfig), `${viteConfig} → src/ui/`)
      patch(P('src', 'ui', viteConfig), [
        { match: /^\s*root:\s*'src'\s*,?\s*$/m, replace: '' },
        ...VITE_OUTDIR_EDITS,
        // 旧根 src/ 的内容已平铺到 src/ui/ 根部，@/src 别名指回工程根自身
        { match: /resolve\(__dirname,\s*'src'\)/g, replace: 'resolve(__dirname)' }
      ], 'vite.config：root 取消（src/ui 即根）、outDir 指 out/、alias 归位')
    }
    for (const f of ['tsconfig.json', 'tsconfig.app.json']) {
      if (exists(P(f)))
        patch(P('src', 'ui', f), [
          { match: /"include"\s*:\s*\[\s*"src"\s*\]/g, replace: '"include": ["."]' },
          { match: /"include"\s*:\s*\[\s*"src\/\*\*\/\*"?\s*\]/g, replace: '"include": ["."]' }
        ], `tsconfig include 归位 src/ui`)
    }
    if (exists(P('src', 'ui', 'package.json')))
      patch(P('src', 'ui', 'package.json'), [
        { match: DROP_SETUP_SCRIPT, replace: '' },
        { match: /runtime\/(go|node|cpp|dotnet|python)/g, replace: '../../src/runtime' },
        { match: /\.\.\/ui\b/g, replace: '../out/ui' }
      ], 'package.json scripts 路径归位')
    if (dirNonEmpty(uiDir)) del(uiDir, 'ui/ 为 vite 产物，不入库')
    return
  }

  if (dirNonEmpty(uiDir)) {
    // 手写静态页 / 开窗资源：整目录挪入 src/ui
    for (const e of listDir(uiDir)) move(path.join(uiDir, e.name), P('src', 'ui', e.name), 'ui/ → src/ui/')
    del(uiDir, 'ui/ 已迁入 src/ui')
    if (uiType === 'webview' && !exists(P('ui', 'index.html')))
      plan.manual.push('ui.type=webview 但 ui/ 无 index.html，迁移后需补入口页')
  } else if (uiType === 'webview') {
    plan.manual.push('ui.type=webview 但找不到 UI 源码（无 src/ 也无 ui/）')
  }

  // 根 src/ 存在但不是 vite 项目（无 index.html/vite.config）→ 不参与 UI 迁移，防误混
  if (exists(rootSrc) && !rootSrcIsVite && listDir(rootSrc).length > 0)
    plan.manual.push('根 src/ 存在但无法识别为前端源码，已保留原位，请人工核对')
}

// ===== preload =====

function planPreload(plan, manifest, { P, move, del }) {
  const declared = manifest.preload
  const preloadDir = P('preload')
  const rootFile = P('preload.cjs')
  const moved = new Set() // 已排队的源路径，防 declared 与整目录搬迁重复 move

  if (declared) {
    const src = P(...declared.split('/'))
    const base = path.basename(declared)
    if (exists(src)) {
      move(src, P('src', 'preload', base), `${declared} → src/preload/${base}`)
      moved.add(src)
    } else if (exists(rootFile)) {
      move(rootFile, P('src', 'preload', 'preload.cjs'), 'preload.cjs → src/preload/')
      moved.add(rootFile)
    } else {
      plan.manual.push(`manifest.preload=${declared} 但文件不存在`)
    }
    manifest.__newPreload = `preload/${base}` // planManifest 统一落盘
  }

  // preload/ 目录里的其余文件（声明文件的兄弟、未声明 preload）一并归位
  if (dirNonEmpty(preloadDir)) {
    for (const e of listDir(preloadDir)) {
      const src = path.join(preloadDir, e.name)
      if (moved.has(src)) continue
      move(src, P('src', 'preload', e.name), 'preload/ → src/preload/')
    }
    if (!declared) plan.warnings.push('存在 preload/ 目录但 manifest 未声明 preload 字段')
  }
  if (!declared && exists(rootFile)) {
    move(rootFile, P('src', 'preload', 'preload.cjs'), 'preload.cjs → src/preload/')
    plan.warnings.push('根目录存在 preload.cjs 但 manifest 未声明 preload 字段')
  }
  if (exists(preloadDir)) del(preloadDir, '旧 preload/ 目录（内容已迁走）')
}

// ===== manifest 改写 =====

function planManifest(plan, manifest, runtimeType) {
  plan.ops.push({
    kind: 'manifest',
    note: '删 entry/include、go→native、合成 platforms、preload 归位',
    apply(current) {
      const next = JSON.parse(JSON.stringify(current))
      if (next.runtime) {
        const entryKeys = next.runtime.entry ? Object.keys(next.runtime.entry) : []
        delete next.runtime.entry
        delete next.runtime.include
        if (next.runtime.type === 'go') next.runtime.type = 'native'
        if (!Array.isArray(next.runtime.platforms) || next.runtime.platforms.length === 0) {
          const plats = entryKeys.filter((k) => PLATFORMS.includes(k))
          const bad = entryKeys.filter((k) => !PLATFORMS.includes(k))
          if (bad.length) plan.warnings.push(`entry 含未知平台键 ${bad.join(',')}，未纳入 platforms`)
          next.runtime.platforms = plats.length ? plats : PLATFORMS.slice()
          if (!plats.length) plan.warnings.push('platforms 由全量兜底合成，请人工确认')
        }
      }
      if (next.ui && next.ui.entry !== undefined) delete next.ui.entry
      if (manifest.__newPreload) next.preload = manifest.__newPreload
      return next
    }
  })
}

// ===== 根 package.json 空壳清理 =====

// 删除 JSON 里的 "setup" 脚本项：优先连同前导逗号删（setup 在末位），
// 否则连同尾部逗号删（setup 在首/中位）——避免留下 `"a":1, }` 这种残逗号
const DROP_SETUP_SCRIPT =
  /,\s*"setup"\s*:\s*"[^"]*setup-brick[^"]*"|"setup"\s*:\s*"[^"]*setup-brick[^"]*"\s*,?\s*/g

/**
 * 旧布局里砖根常有仅含 "setup": "node ../scripts/setup-brick.cjs" 的空壳
 * package.json——新布局下它不是契约成员，setup-all 按 manifest 遍历不依赖它。
 * - 纯壳（无 deps/main/bin/exports/真实脚本）→ 连 lockfile 一起删
 * - 有 dev 脚本但无依赖 → 机械改写旧路径引用后保留，报人工核对
 * - 有依赖 → 不动，报人工
 */
function planRootPkg(plan, { P, del, patch }) {
  const pkgFile = P('package.json')
  if (!exists(pkgFile)) return
  // vite 砖的根 package.json 已被 planUi 排入 move 到 src/ui/，跳过
  if (plan.ops.some((op) => op.kind === 'move' && op.from === pkgFile)) return
  const pkg = readJson(pkgFile)
  const scripts = pkg.scripts || {}
  const realScripts = Object.keys(scripts).filter((s) => !/setup-brick|setup:all/.test(scripts[s]))
  const meaningful = ['dependencies', 'devDependencies', 'peerDependencies', 'main',
    'bin', 'exports', 'workspaces'].some((k) => pkg[k] !== undefined)
  if (meaningful) {
    plan.manual.push('根 package.json 含依赖声明，未动，请人工核对归属')
    return
  }
  if (realScripts.length === 0) {
    del(pkgFile, '根 package.json 空壳（仅 setup 转发脚本），新布局不需要')
    for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'])
      if (exists(P(lock))) del(P(lock), '空壳 package.json 的 lockfile')
    return
  }
  patch(pkgFile, [
    { match: DROP_SETUP_SCRIPT, replace: '' },
    { match: /runtime\/(go|node|cpp|dotnet|python)/g, replace: 'src/runtime' },
    { match: /--prefix\s+(frontend|ui-src|web)\b/g, replace: '--prefix src/ui' },
    { match: /\bfrontend\//g, replace: 'src/ui/' }
  ], '根 package.json dev 脚本路径归位 src/')
  plan.manual.push('根 package.json 含 dev 脚本，已机械改写旧路径，请人工核对')
}

// ===== 构建脚本修补 =====

function planBuildScriptPatches(plan, srcDirPre, srcDirPost) {
  for (const name of ['build.ps1', 'build.sh', 'build.mjs']) {
    const filePre = path.join(srcDirPre, name)
    if (!exists(filePre)) continue
    const filePost = path.join(srcDirPost, name)
    const text = fs.readFileSync(filePre, 'utf8')
    const edits = buildScriptEdits(name, text)
    if (edits.length === 0) {
      plan.manual.push(`${name} 输出路径未匹配已知模式，需人工改 BRICKLY_BUILD_OUT`)
      continue
    }
    plan.ops.push({ kind: 'patch', file: filePost, edits, note: `${name} 输出目录改走 BRICKLY_BUILD_OUT` })
    // 修补后仍残留旧 runtime 输出路径 → 人工
    const patched = edits.reduce((t, e) => t.replace(e.match, e.replace), text)
    if (/runtime[\\/]\$?\{?\$?\w*(key|platform|target|plat)/i.test(patched) && !/out[\\/]runtime/i.test(patched)) {
      plan.manual.push(`${name} 修补后仍疑似含旧输出路径，需人工核对`)
    }
  }
}

/**
 * 构建脚本输出目录改写：BRICKLY_BUILD_OUT 优先，手动执行兜底 out/runtime/<平台>。
 * edits.replace 支持字符串或 replacer 函数（避免 $1/$& 在替换串里的歧义）。
 */
function buildScriptEdits(name, text) {
  const edits = []
  const push = (match, replace) => { if (match.test(text)) edits.push({ match, replace }) }
  const PLAT = '(win-x64|win-arm64|mac-x64|mac-arm64|linux-x64|linux-arm64)'

  if (name === 'build.ps1') {
    // 脚本迁移到 src/runtime 后，$PSScriptRoot\..\.. 即砖根——else 兜底统一走它，不依赖根变量名
    // A: $x = Join-Path $brickRoot "runtime\$target"（双引号内联平台变量）
    push(/(\$\w+)\s*=\s*Join-Path\s+\$\w+\s+"runtime\\(\$\w+)"/g,
      (m, dirVar, pv) => `${dirVar} = if ($env:BRICKLY_BUILD_OUT) { $env:BRICKLY_BUILD_OUT } else { "$PSScriptRoot\\..\\..\\out\\runtime\\${pv}" }`)
    // B: $x = Join-Path $<var> $<key|target|platform>（变量根 + 平台变量）
    push(/(\$\w+)\s*=\s*Join-Path\s+\$\w+\s+(\$(?:key|target|platform|plat)\w*)/g,
      (m, dirVar, pv) => `${dirVar} = if ($env:BRICKLY_BUILD_OUT) { $env:BRICKLY_BUILD_OUT } else { "$PSScriptRoot\\..\\..\\out\\runtime\\${pv}" }`)
    // B2: $x = Join-Path $<var> "<平台>"（变量根 + 字面平台）
    push(new RegExp('(\\$\\w+)\\s*=\\s*Join-Path\\s+\\$\\w+\\s+"' + PLAT + '"', 'g'),
      (m, dirVar, plat) => `${dirVar} = if ($env:BRICKLY_BUILD_OUT) { $env:BRICKLY_BUILD_OUT } else { "$PSScriptRoot\\..\\..\\out\\runtime\\${plat}" }`)
    // C: $x = "$PSScriptRoot\<平台>"（脚本与输出同级的老写法）
    push(new RegExp('(\\$\\w+)\\s*=\\s*"\\$PSScriptRoot\\\\' + PLAT + '"', 'g'),
      (m, dirVar, plat) => `${dirVar} = if ($env:BRICKLY_BUILD_OUT) { $env:BRICKLY_BUILD_OUT } else { "$PSScriptRoot\\..\\..\\out\\runtime\\${plat}" }`)
    // D: $x = Join-Path $<var> "runtime"（runtime 根定义，改指 out\runtime）
    push(/(\$\w+)\s*=\s*Join-Path\s+(\$\w+)\s+"runtime"/g,
      (m, v, root) => `${v} = Join-Path ${root} "out\\runtime"`)
    // E: $x = "$brickRoot\runtime"（反斜杠字面量根定义）
    push(/(\$\w+)\s*=\s*"\$\w+\\runtime"/g,
      (m, v) => `${v} = "$PSScriptRoot\\..\\..\\out\\runtime"`)
  } else if (name === 'build.sh') {
    // A: RUNTIME_ROOT="$ROOT/runtime" → out/runtime（大小写不敏感）
    push(/(\w*runtime\w*)=("?)\$ROOT\/runtime"?/gi,
      (m, v) => `${v}="$ROOT/out/runtime"`)
    // B: [local] out_dir="$RUNTIME_ROOT/$key" → BRICKLY_BUILD_OUT 优先（root 变量名按实际捕获保留）
    push(/((?:local\s+)?\w*[Oo]ut_?[Dd]ir\w*)="?(\$\w*runtime\w*)\/(\$\w+)"?/gi,
      (m, dirVar, rv, pv) => m.includes('BRICKLY_BUILD_OUT') ? m
        : `${dirVar}="\${BRICKLY_BUILD_OUT:-${rv}/${pv}}"`)
    // C: BIN_DIR/OUT_DIR/OUT="$SCRIPT_DIR/<平台>"（与脚本同级的老写法）
    push(new RegExp('((?:local\\s+)?\\w*(?:BIN|OUT)\\w*[Dd][Ii][Rr]\\w*)="?\\$SCRIPT_DIR\\/' + PLAT + '"?', 'g'),
      (m, dirVar, plat) => m.includes('BRICKLY_BUILD_OUT') ? m
        : `${dirVar}="\${BRICKLY_BUILD_OUT:-$SCRIPT_DIR/../../out/runtime/${plat}}"`)
    // D: 顶层 BIN_DIR/OUT_DIR/OUT=<任意> 兜底（runtime/ → out/runtime/；已含 BRICKLY_BUILD_OUT 的行跳过）
    push(/^((?:BIN_DIR|OUT_DIR|OUT))=("?)([^"\n]*)\2$/gm,
      (m, v, q, rhs) => rhs.includes('BRICKLY_BUILD_OUT') ? m
        : `${v}="\${BRICKLY_BUILD_OUT:-${rhs.replace(/([^/])runtime\//g, '$1out/runtime/')}}"`)
  } else if (name === 'build.mjs') {
    // join(brickRoot, 'runtime', <var>, ...) → BRICKLY_BUILD_OUT ?? out/runtime/<var>
    push(/join\(brickRoot,\s*'runtime',\s*(\w+),/g,
      (m, v) => `join(process.env.BRICKLY_BUILD_OUT ?? join(brickRoot, 'out', 'runtime', ${v}),`)
    push(/join\(brickRoot,\s*'runtime',\s*(\w+)\)/g,
      (m, v) => `(process.env.BRICKLY_BUILD_OUT ?? join(brickRoot, 'out', 'runtime', ${v}))`)
  }
  return edits
}

// ---------- 计划执行 ----------

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function applyOps(plan) {
  for (const op of plan.ops) {
    if (op.kind === 'move') {
      if (!exists(op.from)) { plan.warnings.push(`move 源不存在：${op.from}`); continue }
      if (statIsDir(op.from) && statIsDir(op.to)) {
        // 目标目录已存在（如 foreign 目录先落位 src/runtime/node）→ 合并搬内容
        for (const e of listDir(op.from)) {
          const c = path.join(op.from, e.name), d = path.join(op.to, e.name)
          if (exists(d)) { plan.warnings.push(`合并冲突：${path.relative(plan.dir, d)} 已存在，跳过`); continue }
          fs.renameSync(c, d)
        }
        fs.rmdirSync(op.from)
        continue
      }
      ensureParent(op.to)
      fs.renameSync(op.from, op.to)
    } else if (op.kind === 'copytree') {
      ensureParent(op.to)
      fs.cpSync(op.from, op.to, {
        recursive: true,
        filter: (src) => !statIsDir(src) || !op.excludes.includes(path.basename(src))
      })
    } else if (op.kind === 'delete') {
      fs.rmSync(op.target, { recursive: true, force: true })
    } else if (op.kind === 'patch') {
      if (!exists(op.file)) { plan.warnings.push(`patch 目标不存在：${op.file}`); continue }
      let text = fs.readFileSync(op.file, 'utf8')
      for (const e of op.edits) text = text.replace(e.match, e.replace)
      fs.writeFileSync(op.file, text)
    } else if (op.kind === 'manifest') {
      const file = path.join(plan.dir, 'manifest.json')
      fs.writeFileSync(file, JSON.stringify(op.apply(readJson(file)), null, 2) + '\n')
    } else if (op.kind === 'gitignore') {
      const file = path.join(plan.dir, '.gitignore')
      const existing = exists(file) ? fs.readFileSync(file, 'utf8') : ''
      const merged = mergeGitignore(existing, GITIGNORE)
      fs.writeFileSync(file, merged)
    }
  }
  // 收尾清理：依赖目录与 stale 文件深度扫除（copytree 之外的漏网）
  sweepStale(plan.dir)
}

function statIsDir(p) {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

function mergeGitignore(existing, generated) {
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
  const add = generated.split('\n').filter((l) => l.trim() && !l.startsWith('#') && !have.has(l.trim()))
  if (!add.length) return existing.endsWith('\n') ? existing : existing + '\n'
  return (existing.endsWith('\n') || !existing ? existing : existing + '\n') +
    '\n# --- src/out 契约 ---\n' + add.join('\n') + '\n'
}

/** 深度扫除依赖目录与平台戳记 */
function sweepStale(brickDir) {
  for (const e of listDir(brickDir)) {
    const full = path.join(brickDir, e.name)
    if (e.isDirectory()) {
      if (DEPENDENCY_DIRS.includes(e.name) || e.name === '.brickly') fs.rmSync(full, { recursive: true, force: true })
      else sweepStale(full)
    } else if (STALE_FILES.includes(e.name)) {
      fs.rmSync(full, { force: true })
    }
  }
}

// ---------- 迁移后校验（对照契约） ----------

function verifyBrick(brickDir) {
  const issues = []
  const P = (...segs) => path.join(brickDir, ...segs)
  if (!exists(P('manifest.json'))) return ['缺 manifest.json']
  const m = readJson(P('manifest.json'))
  const rt = m.runtime && m.runtime.type

  if (m.runtime) {
    if (m.runtime.entry) issues.push('runtime.entry 未删除')
    if (m.runtime.include) issues.push('runtime.include 未删除')
    const plats = m.runtime.platforms
    if (!Array.isArray(plats) || plats.length === 0) issues.push('runtime.platforms 缺失或为空')
    else for (const p of plats) if (!PLATFORMS.includes(p)) issues.push(`未知平台 ${p}`)
  }
  if (m.ui && m.ui.entry) issues.push('ui.entry 未删除')

  // 源码形态
  const srcRt = P('src', 'runtime')
  if (rt) {
    if (rt === 'node' && !exists(path.join(srcRt, 'package.json')))
      issues.push('node 缺 src/runtime/package.json')
    if (rt === 'python') {
      for (const f of ['pyproject.toml', 'uv.lock', 'main.py'])
        if (!exists(path.join(srcRt, f))) issues.push(`python 缺 src/runtime/${f}`)
    }
    if (rt === 'native' &&
        !hasAny(srcRt, ['go.mod', 'build.ps1', 'build.sh', 'build.mjs', 'CMakeLists.txt']) &&
        !filesOf(srcRt).some((f) => f.endsWith('.csproj')) &&
        !subdirs(path.join(srcRt, 'bin')).some((d) => PLATFORM_RE.test(d)))
      issues.push('native 缺 src/runtime 源码标记或 bin/<平台> 预构建')
  }
  if (m.ui && m.ui.type === 'webview' && !dirNonEmpty(P('src', 'ui')))
    issues.push('ui.type=webview 但 src/ui 为空')

  // 残留旧结构
  if (exists(P('runtime')) && subdirs(P('runtime')).some((d) => PLATFORM_RE.test(d)))
    issues.push('runtime/<平台> 旧树残留')
  if (exists(P('ui-src'))) issues.push('ui-src/ 残留')
  // out/ 是构建产物的合法位置，只要求它不被 git 跟踪
  if (exists(P('out'))) {
    try {
      const tracked = execFileSync('git', ['-C', brickDir, 'ls-files', 'out'], { encoding: 'utf8' }).trim()
      if (tracked) issues.push('out/ 成品被提交入库')
    } catch { /* 非 git 环境时跳过此检查 */ }
  }
  if (m.preload && !exists(P('src', ...m.preload.split('/'))))
    issues.push(`preload 声明 ${m.preload} 但 src/ 下无对应文件`)
  return issues
}

// ---------- 报告与入口 ----------

function printPlan(plan) {
  console.log(`\n### ${plan.id}`)
  if (plan.skipped) { console.log(`  [跳过] ${plan.skipReason}`); return }
  for (const op of plan.ops) {
    const desc = {
      move: () => `移动 ${path.relative(plan.dir, op.from)} → ${path.relative(plan.dir, op.to)}`,
      copytree: () => `复制 ${path.relative(plan.dir, op.from)} → ${path.relative(plan.dir, op.to)}`,
      delete: () => `删除 ${path.relative(plan.dir, op.target)}`,
      patch: () => `修补 ${path.relative(plan.dir, op.file)}`,
      write: () => `写入 ${path.relative(plan.dir, op.file)}`,
      manifest: () => '改写 manifest.json',
      gitignore: () => '写入 .gitignore'
    }[op.kind]()
    console.log(`  ${desc}${op.note ? '  — ' + op.note : ''}`)
  }
  for (const w of plan.warnings) console.log(`  [警告] ${w}`)
  for (const mm of plan.manual) console.log(`  [人工] ${mm}`)
}

function main() {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const verifyOnly = argv.includes('--verify-only')
  const only = argv.find((a) => a.startsWith('--brick='))?.slice(8)
    || (argv.includes('--brick') ? argv[argv.indexOf('--brick') + 1] : null)

  const bricks = fs.readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && exists(path.join(REPO_ROOT, d.name, 'manifest.json')))
    .map((d) => path.join(REPO_ROOT, d.name))
    .filter((d) => !only || path.basename(d) === only)

  if (verifyOnly) {
    let bad = 0
    for (const dir of bricks) {
      const issues = verifyBrick(dir)
      if (issues.length) { bad++; console.log(`✗ ${path.basename(dir)}`); for (const i of issues) console.log(`    ${i}`) }
    }
    console.log(`\nverify: ${bricks.length - bad}/${bricks.length} 通过`)
    process.exit(bad ? 1 : 0)
  }

  const plans = bricks.map(planBrick)
  let manualTotal = 0
  for (const p of plans) { printPlan(p); manualTotal += p.manual.length }

  console.log(`\n===== 汇总：${plans.length} 砖，${plans.filter((p) => p.skipped).length} 跳过，` +
    `${plans.filter((p) => p.manual.length).length} 含人工项（共 ${manualTotal} 条） =====`)

  if (!apply) {
    console.log('dry-run 模式：未落盘。加 --apply 执行。')
    return
  }
  for (const p of plans) {
    if (p.skipped) continue
    applyOps(p)
  }
  console.log('\n已执行。运行 --verify-only 校验结果。')
}

main()
