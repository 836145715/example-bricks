import type { TestGroup } from './types'

export interface ScenarioGuide {
  id: string
  /** 一句话目标 */
  goal: string
  /** 为什么要测 */
  why: string
  /** 执行流程步骤 */
  steps: string[]
  /** 成功时你会看到什么 */
  successLooksLike?: string
  /** 常见失败原因 */
  commonFailures?: string[]
}

const guides: Record<string, ScenarioGuide> = {
  'create-empty': {
    id: 'create-empty',
    goal: '验证可以创建 0 字节空资源，并正确读回 size/hash。',
    why: '空载荷是边界条件：分块上传、finish、读流都不该因 size=0 崩溃。',
    steps: [
      '调用 resources.create(空 Buffer)',
      'stream/inspect 读回内容',
      '断言 sizeBytes=0 且 sha256 与空内容一致',
      '清理（revoke/close）'
    ],
    successLooksLike: '通过；sizeBytes 为 0，带有合法 resourceId/sha256。',
    commonFailures: ['create 失败', '读回 size 不为 0', 'Host 拒绝空资源']
  },
  'create-text': {
    id: 'create-text',
    goal: '验证 UTF-8 文本小资源的 create + 读回一致性。',
    why: '日常小载荷走快速路径，是最常用路径。',
    steps: [
      'create 一段 UTF-8 文本（含中文语义）',
      '读回并计算 size/sha256',
      '与本地期望 digest 对比',
      '输出脱敏 ResourceRef 元数据'
    ],
    successLooksLike: '通过；文本 hash 匹配。',
    commonFailures: ['编码不一致', '权限/协议错误']
  },
  'create-binary': {
    id: 'create-binary',
    goal: '验证固定 pattern 二进制（1 KiB）创建与校验。',
    why: '二进制与文本路径 MIME/编码处理不同，需单独覆盖。',
    steps: [
      'create 0x61 填充的 1 KiB Buffer',
      'inspect 流式读回',
      '断言 size 与 sha256'
    ]
  },
  'create-unicode-boundary': {
    id: 'create-unicode-boundary',
    goal: '验证跨分块边界的多字节 Unicode 字符不被截断损坏。',
    why: 'Writer/上传按 1MiB 等块切分时，emoji 等多字节序列可能落在块边界。',
    steps: [
      '构造含大量中文 + emoji 的大文本',
      'create 上传',
      'text()/inspect 完整读回',
      '与原文 digest 对比'
    ],
    commonFailures: ['中间替换字符/截断', 'byteLength 与字符数混淆']
  },
  'create-from-stream': {
    id: 'create-from-stream',
    goal: '验证 createFrom 流式上传 8 MiB pattern 后读回一致。',
    why: '大内容必须走 store-and-forward，而不是普通 invoke 直传。',
    steps: [
      'createFrom(AsyncIterable pattern, expectedSizeBytes=8MiB)',
      'finish 后得到 Handle',
      'stream 读回并校验 size/sha256',
      '清理资源'
    ],
    successLooksLike: '8 MiB 哈希匹配；可能有吞吐数据。'
  },
  'writer-arbitrary-chunks': {
    id: 'writer-arbitrary-chunks',
    goal: '验证 createWriter 接受任意大小 write（小块/超大块/字符串）。',
    why: 'SDK 应在内部重分块到 wire 上限，调用方不必自己切 1MiB。',
    steps: [
      'createWriter',
      '依次 write 13B、~2MiB、含 emoji 的字符串',
      'finish',
      'inspect 与本地拼接内容对比'
    ],
    commonFailures: ['大块 write 被拒', 'finish 后内容不完整']
  },
  'writer-write-from': {
    id: 'writer-write-from',
    goal: '验证 Writer.writeFrom 消费 AsyncIterable 并正确 finish。',
    why: 'writeFrom 与 write 串行队列语义是上传稳定性的关键。',
    steps: [
      'createWriter(expectedSize)',
      'writeFrom(pattern 流)',
      'finish',
      '校验 hash'
    ]
  },
  'writer-finish-state': {
    id: 'writer-finish-state',
    goal: '验证 finish 幂等，且 finish 后 write 被拒绝。',
    why: '防止重复 finish 产生多个资源或半开 Writer。',
    steps: [
      'write + finish 得到 Handle A',
      '再次 finish → 应返回同一 resourceId',
      '再 write → 期望 RESOURCE_UPLOAD_CLOSED'
    ]
  },
  'writer-abort-state': {
    id: 'writer-abort-state',
    goal: '验证 abort 后 Writer 关闭且不能再写。',
    why: '取消上传必须清理 pending，避免 .part 泄漏与脏状态。',
    steps: [
      'write 一段数据',
      'abort',
      '再 write → RESOURCE_UPLOAD_CLOSED'
    ]
  },
  'read-text': {
    id: 'read-text',
    goal: '验证 handle.text() 整体物化 UTF-8 文本。',
    why: '小文本常用路径；需保证编码往返正确。',
    steps: ['create 文本', 'text()', '严格等于原文']
  },
  'read-json': {
    id: 'read-json',
    goal: '验证 handle.json() 解析 JSON 资源。',
    why: '事件/命令结果常以 JSON 资源传递。',
    steps: ['create JSON 字符串', 'json()', '结构一致']
  },
  'read-stream': {
    id: 'read-stream',
    goal: '验证 stream() 分块读 8 MiB 并累计 hash。',
    why: '大文件不能整体物化，流式读是主路径。',
    steps: ['createFrom 8MiB', 'for-await stream', '对比 pattern hash']
  },
  'read-save-to': {
    id: 'read-save-to',
    goal: '验证 saveTo(path) 落盘内容正确。',
    why: '导出文件场景依赖 Host 流式写盘。',
    steps: [
      'createFrom',
      'saveTo 临时路径',
      'stat + 读文件校验 size/hash',
      '删除临时文件'
    ]
  },
  'read-early-close': {
    id: 'read-early-close',
    goal: '验证中途关闭流后仍可重新打开完整读取。',
    why: '读者取消不应毁掉已 finish 的不可变快照。',
    steps: [
      'createFrom 2MiB',
      'stream 读一块后 break',
      '再次 inspect 完整读',
      'size 仍为 2MiB'
    ]
  },
  'read-concurrent-rejected': {
    id: 'read-concurrent-rejected',
    goal: '验证同一 Handle 上并发两个 stream 会被拒绝。',
    why: '防止同一资源上无序并发读导致状态错乱。',
    steps: [
      '打开 stream A 并 next()',
      '再打开 stream B 并 next()',
      'B 应报 RESOURCE_LIMIT_EXCEEDED',
      '关闭两个迭代器'
    ]
  },
  'invoke-node': {
    id: 'invoke-node',
    goal: 'Lab 创建资源 → 传给 Node echo.inspect → 回报 size/hash 一致。',
    why: '验证 Node SDK 跨 brick 传 ResourceRef 与读流。',
    steps: [
      'resources.create(hello resource)',
      'invoke resource-echo-node/inspect { resource }',
      '断言 runtime=node 且 digest 匹配'
    ],
    commonFailures: [
      'echo 未安装/未就绪',
      'echo 未 resources.open(Ref) 导致无法读资源',
      '权限或依赖未声明'
    ]
  },
  'invoke-python': {
    id: 'invoke-python',
    goal: '同上，目标为 Python echo。',
    why: 'Python SDK 资源打开与 stream 语义需与 Node 对齐。',
    steps: [
      'create 资源',
      'invoke resource-echo-python/inspect',
      '校验 runtime=python 与 hash'
    ],
    commonFailures: ['Python venv/依赖未装', 'echo 未 open Ref']
  },
  'invoke-go': {
    id: 'invoke-go',
    goal: '同上，目标为 Go echo。',
    why: 'Go 使用 HydrateResource，是跨语言基准之一。',
    steps: [
      'create 资源',
      'invoke resource-echo-go/inspect',
      '校验 runtime=go 与 hash'
    ],
    commonFailures: ['Go 二进制未构建/未安装']
  },
  'relay-node-python-go': {
    id: 'relay-node-python-go',
    goal: '同一资源经 Node→Python→Go 多跳 relay，最终 Go inspect 校验。',
    why: '验证多跳只传 Ref、能力令牌正确转交，不复制字节。',
    steps: [
      'create 8MiB pattern',
      'invoke node/relay → python/relay → go/inspect',
      '最终 report 与本地 digest 一致',
      '记录 hops'
    ],
    commonFailures: ['任一语言 echo 失败', '中途 ResourceRef 丢失或未 open']
  },
  'transform-cross-language': {
    id: 'transform-cross-language',
    goal: '资源依次经 Node/Python/Go transform（XOR mask），最终内容正确。',
    why: '验证 invoke 结果里的 ResourceRef 保持名片，调用方 resources.open(ref) 后再读。',
    steps: [
      'create 原文',
      '对 node/python/go 各 invoke(transform, mask=0x20) 得到 ResourceRef',
      'brick.resources.open(ref) 打开下一跳 Handle',
      '本地三次 XOR 期望值',
      'inspect 最终 Handle 对比'
    ]
  },
  'event-resource-handle': {
    id: 'event-resource-handle',
    goal: '发布 resource-lab:probe 事件，三语言 echo 均收到并记录 probeId。',
    why: '事件总线大载荷走资源句柄，订阅方必须正确水合。',
    steps: [
      'publish(resource-lab:probe, { probeId, message })',
      '轮询各 echo 的 event-last',
      '三者均 received 且 probeId 匹配'
    ],
    commonFailures: ['echo 未订阅事件', '事件 payload 非 Handle', '时序过短未收到']
  },
  'resource-revoke': {
    id: 'resource-revoke',
    goal: 'revoke 后读取应失败（过期类错误码）。',
    why: '能力撤销必须立即生效，防止继续读敏感内容。',
    steps: [
      'create 资源',
      'handle.revoke()',
      'text() → RESOURCE_EXPIRED（或等价）'
    ]
  },
  'resource-ttl': {
    id: 'resource-ttl',
    goal: 'TTL 到期后新读失败，但到期前已打开的活动流可读完。',
    why: 'TTL 从 finish 起算；进行中的读不应被粗暴掐断，新读应拒绝。',
    steps: [
      'create 2MiB，ttlMs=60s',
      '打开 stream 读首块',
      '等到 expiresAt 之后',
      '把当前 stream 读完（应成功）',
      '新的 text() 应过期失败'
    ],
    commonFailures: ['时钟/等待不足', '活动流被误杀', '到期后仍允许新读']
  },
  'forged-token': {
    id: 'forged-token',
    goal: '伪造或未知 resourceId 的 open/读应被拒绝。',
    why: 'Host Catalog grant 是唯一授权；ResourceRef 不再携带 accessToken。',
    steps: [
      'create 资源得到真实 Ref',
      'open({ ...ref, resourceId: forged })',
      '期望 ACCESS_DENIED / PERMISSION_DENIED / NOT_FOUND'
    ]
  },
  'immutable-snapshot': {
    id: 'immutable-snapshot',
    goal: 'finish 后修改本地源 Buffer 不影响已登记资源内容。',
    why: '资源是不可变快照，不是对调用方内存的引用。',
    steps: [
      'create 前保留期望 digest',
      'create 后 fill(0) 清空源 Buffer',
      'inspect 资源仍等于期望'
    ]
  },
  'cancel-upload': {
    id: 'cancel-upload',
    goal: 'abort 未完成上传后 finish 被拒绝。',
    why: '取消必须关闭 upload 会话并清理临时 part。',
    steps: [
      'createWriter + write 部分数据',
      'abort',
      'finish → RESOURCE_UPLOAD_CLOSED'
    ]
  },
  'cancel-child-invoke': {
    id: 'cancel-child-invoke',
    goal: '取消下游 hold/慢读 invoke 后，状态收敛且可清理。',
    why: '父调用取消应传播到子调用，避免悬挂 runtime。',
    steps: [
      '发起可取消的下游 hold 场景',
      '中途 cancel',
      '期望 CANCELLED 且无资源泄漏'
    ],
    commonFailures: ['手动模式需配合 UI 取消']
  },
  'restart-runtime-recovery': {
    id: 'restart-runtime-recovery',
    goal: '准备重启检查点，进程 pid 变化后验证 Runtime 恢复。',
    why: 'stateful 实例重启后应能继续验收（Host orphan 另由 Host E2E 测；本工具不是后台 service）。',
    steps: [
      'restart-prepare 写入 checkpoint（含 pid）',
      '重启 Brickly / 本 Brick 会话进程',
      'restart-verify：若 pid 已变则 passed'
    ],
    successLooksLike: '状态 waiting-restart → 重启后 passed',
    commonFailures: ['未真正重启仍同一 pid', 'checkpoint 丢失']
  },
  'default-64m-stream': {
    id: 'default-64m-stream',
    goal: '64 MiB 本地流式校验 + 三语言 inspect 全通过。',
    why: '默认套件中的「中等压力」回归，覆盖日常可接受的大文件。',
    steps: [
      'createFrom 64MiB pattern',
      '本地 inspect',
      '分别 invoke node/python/go inspect',
      '四方 hash 一致'
    ]
  },
  'materialize-201m-rejected': {
    id: 'materialize-201m-rejected',
    goal: '对 >200MiB 资源调用 text/json 等整体物化应被拒绝。',
    why: '防止误把大资源载入内存；大内容必须 stream/saveTo。',
    steps: [
      'createFrom 201MiB',
      '尝试 text()/json() 一类物化',
      '期望 RESOURCE_MATERIALIZATION_TOO_LARGE 或等价'
    ]
  },
  'stream-201m': {
    id: 'stream-201m',
    goal: '201 MiB 纯流式读写成功。',
    why: '越过 200MiB 物化上限后，流式路径仍可用。',
    steps: ['createFrom 201MiB', 'stream 校验 hash'],
    commonFailures: ['磁盘不足', '超时', '内存被误用物化']
  },
  'stream-1g': {
    id: 'stream-1g',
    goal: '1 GiB 流式读写（需 ≥2GiB 可用磁盘）。',
    why: '极端大文件与配额/磁盘余量治理。',
    steps: [
      '检查 freeDisk ≥ 2GiB，否则 skip',
      'createFrom 1GiB + stream 校验'
    ],
    commonFailures: ['磁盘不足被 skip', '耗时过长被取消']
  },
  'slow-reader-decoupled': {
    id: 'slow-reader-decoupled',
    goal: '上传完成后慢速读者仍能读完整内容（store-and-forward）。',
    why: '读速不应拖死后端上传会话；finish 后快照独立。',
    steps: [
      '上传较大资源至 finish',
      '慢速分块读取',
      '内容/hash 仍正确'
    ]
  }
}

const GROUP_INTRO: Record<TestGroup, { title: string; summary: string }> = {
  create: {
    title: '创建与写入',
    summary: '覆盖 create / createFrom / Writer 的登记与分块上传语义。'
  },
  read: {
    title: '读取与落盘',
    summary: '覆盖 text/json/stream/saveTo 与并发读限制。'
  },
  'cross-language': {
    title: '跨语言',
    summary: '经 Node / Python / Go echo 验证 Ref 转交与读流一致性。'
  },
  lifecycle: {
    title: '生命周期',
    summary: 'TTL、revoke、令牌、取消上传、重启等能力治理。'
  },
  stress: {
    title: '边界与压力',
    summary: '大文件、物化上限、慢读解耦；可能较慢且占磁盘。'
  }
}

export function getScenarioGuide(id: string): ScenarioGuide {
  return (
    guides[id] ?? {
      id,
      goal: '（尚未编写说明）验证该场景在当前 Host/SDK 下的行为。',
      why: '该场景已在目录中注册，但 UI 说明尚未补全。',
      steps: ['运行场景', '查看结果状态与错误码', '对照 runtime 日志']
    }
  )
}

export function getGroupIntro(group: TestGroup) {
  return GROUP_INTRO[group]
}

export { guides as SCENARIO_GUIDES }
