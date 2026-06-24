'use strict'

/**
 * 内网网络信息服务。
 *
 * 职责：从本机网卡中筛选出可用于局域网访问的 IPv4 地址，并据此构建访问 URL。
 * 仅做网络地址相关的纯计算，不感知 HTTP 服务与业务状态。
 */

const os = require('node:os')

/**
 * 判断一个 IPv4 地址是否属于私有/内网网段。
 * 覆盖 RFC1918 私网段以及 169.254/16 链路本地段。
 */
function isPrivateIPv4(address) {
  if (typeof address !== 'string') return false
  const parts = address.split('.').map((item) => Number(item))
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return false
  }
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

/**
 * 列出本机所有可对外提供局域网访问的 IPv4 网卡地址。
 * 优先返回私网地址；过滤回环与内部网卡。
 *
 * @returns {{ address: string, interface: string, private: boolean }[]}
 */
function listLanAddresses() {
  const interfaces = os.networkInterfaces()
  const result = []
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!Array.isArray(infos)) continue
    for (const info of infos) {
      const family = typeof info.family === 'string' ? info.family : `IPv${info.family}`
      if (family !== 'IPv4') continue
      if (info.internal) continue
      result.push({ address: info.address, interface: name, private: isPrivateIPv4(info.address) })
    }
  }
  // 私网地址排前，便于 UI 取首个作为主访问地址。
  result.sort((left, right) => Number(right.private) - Number(left.private))
  return result
}

/**
 * 根据网卡地址与端口构建访问 URL 列表。
 *
 * @param {number} port 监听端口
 * @returns {{ url: string, host: string, label: string, private: boolean }[]}
 */
function buildAccessUrls(port) {
  const safePort = Number(port)
  const addresses = listLanAddresses()
  const urls = addresses.map((item) => ({
    url: `http://${item.address}:${safePort}/`,
    host: item.address,
    label: item.interface,
    private: item.private
  }))
  // 始终附带本机回环地址，方便在本机自测。
  urls.push({
    url: `http://127.0.0.1:${safePort}/`,
    host: '127.0.0.1',
    label: 'loopback',
    private: false
  })
  return urls
}

module.exports = {
  isPrivateIPv4,
  listLanAddresses,
  buildAccessUrls
}
