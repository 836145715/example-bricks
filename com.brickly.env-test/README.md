# com.brickly.env-test

Profile 字段注入测试 Brick。

## 检查项

只声明 `config.fields`。未写 `env` 的字段只进 `ctx.config`；写了 `env` 默认两边都进。`inject: "env"` 只进进程环境。`runtime.env` 是作者静态启动环境，可被同名字段覆盖。

| 字段 | inject | 环境变量 | 期望 |
| --- | --- | --- | --- |
| `configOnly` | `config` | 无 | 只在 `ctx.config` |
| `fieldEnvOnly` | `env` | `ENV_TEST_FIELD_ONLY` | 只在 `process.env` |
| `bothValue` | `both` | `ENV_TEST_BOTH` | 两边都有 |
| `defaultEnv` | `env` | `ENV_TEST_DEFAULT` | 空值用默认 `from-default` |
| `secretToken` | `env` | `ENV_TEST_SECRET` | 只在 env，输出打码 |
| `envOnly` | `env` | `ENV_TEST_ONLY` | 只在 `process.env` |
| `override` | `env` | `ENV_TEST_OVERRIDE` | 覆盖 `runtime.env` |
| `profileSecret` | `env` | `ENV_TEST_PROFILE_SECRET` | 只在 env，输出打码 |

## 手工验收

1. 打开 `com.brickly.env-test` 详情。
2. 建一条 Profile 并填必填项。
3. 运行「检查注入结果」。
4. `checks` 里各项应为 `true`。
