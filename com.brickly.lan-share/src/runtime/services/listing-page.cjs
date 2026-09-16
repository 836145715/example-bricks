'use strict'

/**
 * 目录浏览页面渲染。
 *
 * 负责把目录条目渲染为移动端友好的 HTML 页面，供局域网内其他设备访问。
 * 仅承担表现层职责，不读取文件系统、不处理路由。
 */

const path = require('node:path')
const { formatBytes, escapeHtml } = require('./format.cjs')

/**
 * 构建从根到当前目录的面包屑。
 * @param {string} relativePath 相对共享根的 POSIX 路径
 * @returns {{ name: string, href: string }[]}
 */
function buildBreadcrumbs(relativePath) {
  const crumbs = [{ name: '根目录', href: '/' }]
  const segments = relativePath.split('/').filter(Boolean)
  let acc = ''
  for (const segment of segments) {
    acc += `/${encodeURIComponent(segment)}`
    crumbs.push({ name: segment, href: `${acc}/` })
  }
  return crumbs
}

/**
 * 渲染目录列表页面。
 *
 * @param {object} params
 * @param {string} params.relativePath 当前目录相对根的路径
 * @param {{ name: string, isDirectory: boolean, size: number, modifiedAt: number }[]} params.entries
 * @param {boolean} params.allowUpload 是否展示上传区域
 * @returns {string} HTML 文本
 */
function renderListingPage({ relativePath, entries, allowUpload }) {
  const breadcrumbs = buildBreadcrumbs(relativePath)
  const basePath = relativePath ? `/${relativePath.split('/').map(encodeURIComponent).join('/')}/` : '/'

  const breadcrumbHtml = breadcrumbs
    .map((crumb, index) =>
      index === breadcrumbs.length - 1
        ? `<span class="crumb current">${escapeHtml(crumb.name)}</span>`
        : `<a class="crumb" href="${escapeHtml(crumb.href)}">${escapeHtml(crumb.name)}</a>`
    )
    .join('<span class="sep">/</span>')

  const sorted = [...entries].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })

  const parentRow =
    relativePath
      ? `<li class="row up"><a href="${escapeHtml(parentHref(relativePath))}"><span class="icon">⬆️</span><span class="name">.. 返回上级</span></a></li>`
      : ''

  const rows = sorted
    .map((entry) => {
      const href = `${basePath}${encodeURIComponent(entry.name)}${entry.isDirectory ? '/' : ''}`
      const icon = entry.isDirectory ? '📁' : '📄'
      const meta = entry.isDirectory
        ? '<span class="meta">目录</span>'
        : `<span class="meta">${escapeHtml(formatBytes(entry.size))}</span>`
      const download = entry.isDirectory
        ? ''
        : `<a class="download" href="${escapeHtml(href)}?download=1" title="下载">下载</a>`
      return `<li class="row"><a class="entry" href="${escapeHtml(href)}"><span class="icon">${icon}</span><span class="name">${escapeHtml(
        entry.name
      )}</span></a>${meta}${download}</li>`
    })
    .join('')

  const emptyHint = sorted.length === 0 ? '<li class="empty">该目录为空</li>' : ''

  const uploadHtml = allowUpload
    ? `<section class="upload">
        <h2>上传到当前目录</h2>
        <input id="file-input" type="file" multiple />
        <button id="upload-btn">上传</button>
        <div id="upload-status" class="upload-status"></div>
      </section>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>内网文件共享</title>
<style>${pageStyles()}</style>
</head>
<body>
<header>
  <h1>内网文件共享</h1>
  <nav class="breadcrumbs">${breadcrumbHtml}</nav>
</header>
<main>
  <ul class="list">${parentRow}${rows}${emptyHint}</ul>
  ${uploadHtml}
</main>
<script>${uploadScript(basePath)}</script>
</body>
</html>`
}

function parentHref(relativePath) {
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  if (segments.length === 0) return '/'
  return `/${segments.map(encodeURIComponent).join('/')}/`
}

function pageStyles() {
  return `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; background: #0f1115; color: #e5e7eb; }
header { padding: 18px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); position: sticky; top: 0; background: #0f1115; }
h1 { margin: 0 0 8px; font-size: 18px; }
.breadcrumbs { font-size: 14px; word-break: break-all; }
.crumb { color: #60a5fa; text-decoration: none; }
.crumb.current { color: #e5e7eb; }
.sep { color: #6b7280; margin: 0 4px; }
main { padding: 12px 16px 40px; max-width: 880px; margin: 0 auto; }
.list { list-style: none; margin: 0; padding: 0; }
.row { display: flex; align-items: center; gap: 10px; padding: 12px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.row .entry, .row > a:first-child { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; color: inherit; text-decoration: none; }
.icon { width: 22px; text-align: center; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 12px; color: #9ca3af; flex-shrink: 0; }
.download { font-size: 12px; color: #34d399; text-decoration: none; padding: 4px 10px; border: 1px solid rgba(52,211,153,0.4); border-radius: 6px; flex-shrink: 0; }
.download:active { transform: scale(0.97); }
.empty { padding: 24px; text-align: center; color: #6b7280; }
.upload { margin-top: 24px; padding: 16px; border: 1px dashed rgba(255,255,255,0.18); border-radius: 10px; }
.upload h2 { margin: 0 0 12px; font-size: 15px; }
.upload input { color: inherit; }
.upload button { margin-left: 8px; padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.upload button:disabled { opacity: 0.5; cursor: default; }
.upload-status { margin-top: 10px; font-size: 13px; color: #9ca3af; white-space: pre-line; }
`
}

function uploadScript(basePath) {
  // basePath 已在服务端转义为安全的 URL 前缀。
  return `
const BASE_PATH = ${JSON.stringify(basePath)};
const input = document.getElementById('file-input');
const button = document.getElementById('upload-btn');
const status = document.getElementById('upload-status');
if (button) {
  button.addEventListener('click', async () => {
    if (!input.files || input.files.length === 0) {
      status.textContent = '请选择文件';
      return;
    }
    button.disabled = true;
    const files = Array.from(input.files);
    let done = 0;
    for (const file of files) {
      status.textContent = '上传中 ' + file.name + ' (' + (done + 1) + '/' + files.length + ')';
      try {
        const target = BASE_PATH + '__upload?name=' + encodeURIComponent(file.name);
        const res = await fetch(target, { method: 'POST', body: file });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        done += 1;
      } catch (err) {
        status.textContent = '上传失败 ' + file.name + '：' + err.message;
        button.disabled = false;
        return;
      }
    }
    status.textContent = '已上传 ' + done + ' 个文件，正在刷新…';
    setTimeout(() => location.reload(), 600);
  });
}
`
}

module.exports = { renderListingPage, buildBreadcrumbs, parentHref }
