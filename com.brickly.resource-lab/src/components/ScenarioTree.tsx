/** @deprecated 使用 ScenarioNav。保留导出以免旧引用报错。 */
export { ScenarioNav as ScenarioTree } from './ScenarioNav'

export const GROUP_LABELS = {
  create: '创建与写入',
  read: '读取与落盘',
  'cross-language': '跨语言',
  lifecycle: '生命周期',
  stress: '边界与压力'
} as const
