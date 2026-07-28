# 日志查询按文件提交结果实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 单个日志文件查询完成后立即显示其 Tab 的结果和完成状态。

**架构：** 在 Go 的本地和远程检索循环中公开文件开始/完成回调。存储模式使用这些回调更新每个文件的结果状态并强制发送 `searchState`；React 继续根据该状态读取当前 Tab 的结果窗口。

**技术栈：** Go 1.21、brickly-sdk-go、React/Vite。

---

### 任务 1：验证文件级完成状态

**文件：**
- 修改：`com.brickly.log-searcher/runtime/main_test.go`

- [ ] **步骤 1：编写失败的测试**

```go
func TestStoredLocalSearchFinalizesEachFileBeforeTheNextFile(t *testing.T) {
    // 第一个文件完成时断言它是 success、第二个文件仍是 queued。
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`go test ./... -run TestStoredLocalSearchFinalizesEachFileBeforeTheNextFile`
预期：FAIL，因文件生命周期检索函数尚不存在。

### 任务 2：接入文件生命周期

**文件：**
- 修改：`com.brickly.log-searcher/runtime/grep.go`
- 修改：`com.brickly.log-searcher/runtime/ssh.go`
- 修改：`com.brickly.log-searcher/runtime/main.go`

- [ ] **步骤 1：实现最少回调**

```go
onFileStart(filePath)
// 扫描当前文件
onFileDone(filePath)
```

- [ ] **步骤 2：存储模式完成每个文件并推送状态**

```go
searchResults.FinishFile(serverID, runID, tabID, searchStatusSuccess, "")
emitState(true)
```

- [ ] **步骤 3：运行测试验证通过**

运行：`go test ./...`
预期：PASS。

### 任务 3：验证交付产物

**文件：**
- 修改：`com.brickly.log-searcher/ui/*`

- [ ] **步骤 1：检查 Go 测试和前端类型**

运行：`go test ./...`、`npm run typecheck`

- [ ] **步骤 2：重新构建 Webview**

运行：`npm run build`
预期：PASS，`ui/` 产物与源码一致。
