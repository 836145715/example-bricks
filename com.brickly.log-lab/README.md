# 日志实验室

用来在日志中心**肉眼对照**分层，不是单元测试替代品。

```text
左侧顶级
  ├─ 宿主 / 页面 window.brickly.log
  ├─ 无当前命令时的 brick.log、裸 stdout
  └─ 一次 command 节点

点开 command
  ├─ 日志栏  brick.log / ctx.log
  └─ 事件栏  stream / interact 帧 / 命令内 publish
```

子工具 `com.brickly.log-lab-child` 的日志必须挂在**子节点**上。

## 怎么看

1. 两个目录都导入开发工作台（先子后父，或一起导入）：
   - `example-bricks/com.brickly.log-lab-child`
   - `example-bricks/com.brickly.log-lab`
2. 联调本地 SDK：

```bash
cd example-bricks/com.brickly.log-lab-child && npm run setup -- --local
cd ../com.brickly.log-lab && npm run setup -- --local
```

3. 打开「日志实验室」，再打开侧栏「日志中心」。
4. 按卡片运行。每张卡上写了应该出现在哪一层。

延后类卡片（命令结束后的工具日志 / stdout）要等大约 1.2 秒再看左侧。
