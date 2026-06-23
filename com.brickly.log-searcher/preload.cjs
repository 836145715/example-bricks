/**
 * com.brickly.log-searcher — Preload
 * 
 * 本 Brick 使用 Go 作为 native 核心运行时，所有重度业务逻辑（如本地文件正则检索、远程 SSH 登录）
 * 均在 Go runtime 中实现，底座会自动通过 window.brickly 注入通信 API。
 * 此处作为 preload 保留，以便日后需要使用 Electron 进程专有 API。
 */
console.info('[com.brickly.log-searcher][preload] loaded');
