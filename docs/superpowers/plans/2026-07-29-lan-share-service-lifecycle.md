# 内网文件共享服务生命周期联动实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让内网文件共享只在用户点击启动时创建宿主 service，并在用户点击停止时同时关闭 HTTP 服务与 runtime 进程，同时保证关窗不停止后台共享。

**架构：** UI 通过独立的生命周期编排模块先读宿主 service 状态，仅在宿主为 `running` 时调用 runtime 命令；React hook 只负责把编排结果绑定到视图、管理轮询和单飞操作。非敏感配置保存在 `localStorage`，访问码明文只在当前启动请求中传递；runtime 保持 `stop` 幂等，并将空访问码解释为保留现值。

**技术栈：** React 19、TypeScript 5.9、Vite 7、Node.js `node:test`、tsx、Brickly Webview API、Node.js runtime

---

## 文件结构

- 创建 `com.brickly.lan-share/src/share-settings.ts`：读写非敏感 UI 配置缓存，生成停止态展示数据并过滤访问码。
- 创建 `com.brickly.lan-share/src/share-lifecycle.ts`：实现宿主 service 与 runtime HTTP server 的启动、停止、刷新和失败补偿。
- 创建 `com.brickly.lan-share/src/__tests__/share-settings.test.ts`：验证缓存、损坏数据回退和访问码保留规则。
- 创建 `com.brickly.lan-share/src/__tests__/share-lifecycle.test.ts`：验证调用顺序、宿主状态门控、失败补偿和停止兜底。
- 修改 `com.brickly.lan-share/src/types.ts`：补齐宿主 service 状态、记录和 Webview service/system API 类型。
- 修改 `com.brickly.lan-share/src/brickly.ts`：封装宿主 service API，并将打开目录/URL 改为宿主 system API。
- 修改 `com.brickly.lan-share/src/hooks/useShareController.ts`：接入两层生命周期、单飞、轮询及准确的部分失败状态。
- 修改 `com.brickly.lan-share/src/components/ControlPanel.tsx`：按宿主 service 状态决定启动/停止操作，空访问码不进入请求。
- 修改 `com.brickly.lan-share/src/App.tsx`：展示宿主与 HTTP 服务组合后的生命周期状态。
- 修改 `com.brickly.lan-share/runtime/node/services/share-service.cjs`：空访问码不覆盖已保存访问码。
- 修改 `com.brickly.lan-share/runtime/node/__tests__/lan-share.test.cjs`：覆盖访问码保留和重复停止。
- 修改 `com.brickly.lan-share/manifest.json`：关闭失败自动重启。
- 修改 `com.brickly.lan-share/package.json`、`package-lock.json`：加入前端纯逻辑测试命令与 `tsx`。
- 修改 `com.brickly.lan-share/README.md`：记录新的启动、关窗和停止语义。
- 重新生成 `com.brickly.lan-share/ui/`：交付与源码一致的 UI 构建产物。

### 任务 1：宿主 API 类型与安全配置缓存

**文件：**

- 创建：`com.brickly.lan-share/src/share-settings.ts`
- 创建：`com.brickly.lan-share/src/__tests__/share-settings.test.ts`
- 修改：`com.brickly.lan-share/src/types.ts`
- 修改：`com.brickly.lan-share/src/brickly.ts`
- 修改：`com.brickly.lan-share/package.json`
- 修改：`com.brickly.lan-share/package-lock.json`

- [ ] **步骤 1：加入最小 TypeScript 测试运行器并编写失败测试**

运行 `npm install --save-dev tsx`，增加脚本：

```json
"test:ui": "tsx --test src/__tests__/*.test.ts"
```

创建测试，要求缓存只含非敏感字段，损坏 JSON 回退默认值，已有访问码且输入为空时 runtime 参数不含 `accessCode`：

```ts
class MemoryStorage {
  value = "";

  getItem(): string | null {
    return this.value || null;
  }

  setItem(_key: string, value: string): void {
    this.value = value;
  }
}

test("缓存不保存访问码明文", () => {
  const storage = new MemoryStorage();
  saveShareSettings(
    storage,
    { root: "/srv/logs", port: 9000, allowUpload: true, accessCode: "secret" },
    true,
  );
  assert.equal(storage.value.includes("secret"), false);
  assert.deepEqual(loadShareSettings(storage), {
    root: "/srv/logs",
    port: 9000,
    allowUpload: true,
    hasAccessCode: true,
  });
});

test("已有访问码且输入为空时保留 runtime 原值", () => {
  assert.deepEqual(
    toRuntimeConfig(
      { root: "/srv", port: 8723, allowUpload: false, accessCode: "" },
      true,
    ),
    {
      root: "/srv",
      port: 8723,
      allowUpload: false,
    },
  );
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:ui`

预期：FAIL，报错无法解析 `../share-settings`。

- [ ] **步骤 3：实现类型、宿主 API 封装和缓存**

在 `types.ts` 定义：

```ts
export type BrickServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "restarting"
  | "stopping"
  | "crashed"
  | "error";
export interface BrickServiceRecord {
  brickId: string;
  status: BrickServiceStatus;
  instanceId?: string;
  lastError?: string;
}
```

给 `BricklyApi` 增加 `service.getStatus/start/stop/restart` 与 `system.shellOpenPath/shellOpenExternal`，并在 `brickly.ts` 导出 `getBrickServiceStatus()`、`startBrickService()`、`stopBrickService()`。`openFolder()` 和 `openUrl()` 直接使用 `window.brickly.system`，不再 invoke runtime。

在 `share-settings.ts` 使用固定 key `brickly.lan-share.settings.v1`，只序列化 `root`、`port`、`allowUpload`、`hasAccessCode`。`toRuntimeConfig()` 仅在输入访问码去空白后非空时包含 `accessCode`。

- [ ] **步骤 4：运行测试与类型检查验证通过**

运行：`npm run test:ui && npm run typecheck`

预期：缓存测试全部 PASS，TypeScript 退出码为 0。

- [ ] **步骤 5：Commit**

```bash
git add com.brickly.lan-share/package.json com.brickly.lan-share/package-lock.json com.brickly.lan-share/src/types.ts com.brickly.lan-share/src/brickly.ts com.brickly.lan-share/src/share-settings.ts com.brickly.lan-share/src/__tests__/share-settings.test.ts
git commit -m "feat(lan-share): add service api and safe settings cache"
```

### 任务 2：两层生命周期编排

**文件：**

- 创建：`com.brickly.lan-share/src/share-lifecycle.ts`
- 创建：`com.brickly.lan-share/src/__tests__/share-lifecycle.test.ts`

- [ ] **步骤 1：编写初始化与启动流程失败测试**

用记录调用名的 fake API 覆盖：停止状态不调用 runtime；运行状态读取 runtime；启动顺序为 `service.getStatus -> service.start -> service.getStatus -> runtime.start`；宿主已运行且 HTTP 已运行时不重复启动；runtime 启动失败时调用 `service.stop` 补偿。

```ts
const cachedSettings = {
  root: "/srv",
  port: 8723,
  allowUpload: false,
  hasAccessCode: false,
};
const input = { root: "/srv", port: 8723, allowUpload: false };
const runningStatus: ShareStatus = {
  running: true,
  root: "/srv",
  port: 8723,
  allowUpload: false,
  hasAccessCode: false,
  startedAt: 1,
  urls: [],
  log: [],
};

function fakeApi(options: {
  service: BrickServiceStatus;
  runtimeStartError?: Error;
  runtimeStopError?: Error;
  serviceStopError?: Error;
}) {
  const calls: string[] = [];
  let serviceStatus = options.service;
  const api: ShareLifecycleApi = {
    async getServiceStatus() {
      calls.push("service.getStatus");
      return { brickId: "com.brickly.lan-share", status: serviceStatus };
    },
    async startService() {
      calls.push("service.start");
      serviceStatus = "running";
    },
    async stopService() {
      calls.push("service.stop");
      if (options.serviceStopError) throw options.serviceStopError;
      serviceStatus = "stopped";
    },
    async fetchStatus() {
      calls.push("runtime.status");
      return runningStatus;
    },
    async startShare() {
      calls.push("runtime.start");
      if (options.runtimeStartError) throw options.runtimeStartError;
      return runningStatus;
    },
    async stopShare() {
      calls.push("runtime.stop");
      if (options.runtimeStopError) throw options.runtimeStopError;
      return { ...runningStatus, running: false, startedAt: 0, urls: [] };
    },
  };
  return { api, calls };
}

test("停止状态初始化不会唤起 runtime", async () => {
  const { api, calls } = fakeApi({ service: "stopped" });
  const snapshot = await loadShareSnapshot(api, cachedSettings);
  assert.equal(snapshot.service.status, "stopped");
  assert.deepEqual(calls, ["service.getStatus"]);
});

test("runtime 启动失败会补偿停止刚启动的 service", async () => {
  const { api, calls } = fakeApi({
    service: "stopped",
    runtimeStartError: new Error("bind failed"),
  });
  await assert.rejects(
    () => startShareLifecycle(api, input, cachedSettings),
    /bind failed/,
  );
  assert.deepEqual(calls, [
    "service.getStatus",
    "service.start",
    "service.getStatus",
    "runtime.start",
    "service.stop",
  ]);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:ui`

预期：FAIL，报错无法解析 `../share-lifecycle`。

- [ ] **步骤 3：实现初始化和启动最少逻辑**

实现 `loadShareSnapshot()` 与 `startShareLifecycle()`：每次 runtime 调用前检查宿主状态恰为 `running`；新启动宿主后重新确认状态；如果 HTTP 已运行直接复用状态；只有本次操作启动了宿主且 runtime 启动失败时执行补偿停止，并保留原始错误信息。

- [ ] **步骤 4：运行启动相关测试验证通过**

运行：`npm run test:ui`

预期：初始化与启动测试全部 PASS。

- [ ] **步骤 5：编写停止和刷新流程失败测试**

```ts
test("runtime stop 失败仍停止宿主 service", async () => {
  const { api, calls } = fakeApi({
    service: "running",
    runtimeStopError: new Error("http stop failed"),
  });
  const result = await stopShareLifecycle(api, cachedSettings);
  assert.equal(result.snapshot.service.status, "stopped");
  assert.match(result.warning ?? "", /http stop failed/);
  assert.deepEqual(calls, [
    "service.getStatus",
    "runtime.stop",
    "service.stop",
    "service.getStatus",
  ]);
});

test("宿主停止失败且仍 running 时不得返回已停止", async () => {
  const { api } = fakeApi({
    service: "running",
    serviceStopError: new Error("host stop failed"),
  });
  await assert.rejects(
    () => stopShareLifecycle(api, cachedSettings),
    /host stop failed/,
  );
});
```

刷新失败测试要求 runtime `status` 失败后再次读取宿主；若宿主已停则返回缓存停止态，否则抛出原 runtime 错误。

- [ ] **步骤 6：运行测试验证失败**

运行：`npm run test:ui`

预期：FAIL，`stopShareLifecycle` 或刷新失败恢复逻辑尚未定义。

- [ ] **步骤 7：实现停止、刷新与错误合并**

停止流程在 runtime stop 的 `finally` 路径调用宿主 stop，再读宿主状态。仅当复查结果为 `stopped` 才返回停止快照；runtime stop 失败作为 `warning` 返回。宿主仍运行时抛出含宿主错误的异常。刷新先读宿主，runtime 查询失败后再读一次宿主，避免网络波动期间错误地显示已停止。

- [ ] **步骤 8：运行测试验证通过并提交**

运行：`npm run test:ui && npm run typecheck`

预期：全部 UI 纯逻辑测试 PASS，类型检查退出码为 0。

```bash
git add com.brickly.lan-share/src/share-lifecycle.ts com.brickly.lan-share/src/__tests__/share-lifecycle.test.ts
git commit -m "feat(lan-share): coordinate host and http lifecycles"
```

### 任务 3：React 控制器与界面状态接入

**文件：**

- 修改：`com.brickly.lan-share/src/hooks/useShareController.ts`
- 修改：`com.brickly.lan-share/src/components/ControlPanel.tsx`
- 修改：`com.brickly.lan-share/src/App.tsx`

- [ ] **步骤 1：实现 hook 的单飞和宿主状态门控**

hook 初始化调用 `loadShareSnapshot()`；`operationRef` 已有 Promise 时直接复用，避免重复点击并发启动。运行中每 1.5 秒调用刷新；宿主处于 `starting/restarting/stopping` 时也继续短轮询直到稳定。effect cleanup 只能清除 timer 和 `cancelled` 标志，不得调用任何 stop API。

```ts
return () => {
  cancelled = true;
  if (pollTimer.current) clearInterval(pollTimer.current);
};
```

启动前先保存非敏感配置；停止后应用复查得到的宿主状态。保存按钮在 service 停止时只更新 localStorage 和本地快照，不 invoke runtime `update-config`。

- [ ] **步骤 2：更新控制面板和状态徽章**

`ControlPanel` 接收 `serviceStatus`。宿主为 `running/starting/restarting/stopping` 时展示停止动作；`stopping` 期间禁用按钮。`collectConfig()` 只在访问码非空时附加 `accessCode`。`StatusBadge` 区分“正在启动”“共享中”“正在停止”“进程运行/共享未启动”“已停止”，避免宿主停止失败时提前显示“已停止”。

- [ ] **步骤 3：运行静态验证并提交**

运行：`npm run test:ui && npm run typecheck`

预期：测试全部 PASS，类型检查退出码为 0。

```bash
git add com.brickly.lan-share/src/hooks/useShareController.ts com.brickly.lan-share/src/components/ControlPanel.tsx com.brickly.lan-share/src/App.tsx
git commit -m "feat(lan-share): bind ui to service lifecycle"
```

### 任务 4：runtime 语义、manifest、文档与交付构建

**文件：**

- 修改：`com.brickly.lan-share/runtime/node/services/share-service.cjs`
- 修改：`com.brickly.lan-share/runtime/node/__tests__/lan-share.test.cjs`
- 修改：`com.brickly.lan-share/manifest.json`
- 修改：`com.brickly.lan-share/README.md`
- 修改：`com.brickly.lan-share/ui/index.html`
- 修改：`com.brickly.lan-share/ui/assets/*`

- [ ] **步骤 1：编写 runtime 失败测试**

```js
test("ShareService 空访问码保留已保存值且重复停止幂等", async (t) => {
  const dataDir = await makeTempDir("lan-share-code-");
  const service = new ShareService({ dataDir });
  t.after(() => fsp.rm(dataDir, { recursive: true, force: true }));
  await service.updateConfig({ accessCode: "secret" });
  await service.updateConfig({ accessCode: "   " });
  assert.equal(service.status().hasAccessCode, true);
  await service.stop();
  await service.stop();
  assert.equal(service.status().running, false);
});
```

- [ ] **步骤 2：运行 runtime 测试验证失败**

运行：`npm run test:runtime`

预期：FAIL，空字符串把 `hasAccessCode` 变成 `false`。

- [ ] **步骤 3：实现访问码保留，关闭自动重启并更新文档**

`sanitizePartial()` 仅在 `partial.accessCode.trim()` 非空时写入 `accessCode`。manifest 将 lifecycle service 改为：

```json
"service": {
  "autoStart": false,
  "restart": "none"
}
```

README 明确：点击启动才启动、关窗继续运行、点击停止才关闭进程、Brickly 重启后不恢复。

- [ ] **步骤 4：运行完整验证并重新构建 UI**

运行：

```powershell
npm run test:runtime
npm run test:ui
npm run typecheck
npm run build
git diff --check
```

预期：runtime 与 UI 测试全部 PASS，类型检查和构建退出码均为 0，`git diff --check` 无输出；`ui/` 只包含本次构建引用的资源文件。

- [ ] **步骤 5：Commit**

```bash
git add com.brickly.lan-share/runtime/node/services/share-service.cjs com.brickly.lan-share/runtime/node/__tests__/lan-share.test.cjs com.brickly.lan-share/manifest.json com.brickly.lan-share/README.md com.brickly.lan-share/ui
git commit -m "feat(lan-share): finalize explicit service lifecycle"
```

- [ ] **步骤 6：提交后复验与需求核对**

重新运行 `npm run test:runtime && npm run test:ui && npm run typecheck && npm run build`，再执行 `git status --short --branch` 和 `git log -5 --oneline`。逐项核对：停止态不 invoke runtime、启动失败补偿、停止失败不虚报、关窗不停止、访问码不落本地缓存、`autoStart: false`、`restart: none`。
