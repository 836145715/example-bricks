# com.brickly.env-test

Profile env mapping test Brick.

## What It Checks

This Brick declares Profile fields and independent env vars. Host injects the selected Profile into `ctx.config` and `process.env` when the runtime starts.

| Field / env | Inject | Env | Expected |
| --- | --- | --- | --- |
| `configOnly` | `config` | none | Present only in `ctx.config`. |
| `fieldEnvOnly` | `env` | `ENV_TEST_FIELD_ONLY` | Present only in `process.env`. |
| `bothValue` | `both` | `ENV_TEST_BOTH` | Present in both `ctx.config` and `process.env`. |
| `defaultEnv` | `env` | `ENV_TEST_DEFAULT` | Uses default `from-default` when omitted, then injects env. |
| `secretToken` | `env` | `ENV_TEST_SECRET` | Password input; present only in env and masked in output. |
| `ENV_TEST_ONLY` | env-only | `ENV_TEST_ONLY` | Independent Profile env; not in `ctx.config`. |
| `ENV_TEST_OVERRIDE` | env-only | `ENV_TEST_OVERRIDE` | Profile env overrides `runtime.env`. |
| `ENV_TEST_PROFILE_SECRET` | env-only | `ENV_TEST_PROFILE_SECRET` | Independent secret env; not in `ctx.config`. |

## Manual Test

1. Open the Brick detail page for `com.brickly.env-test`.
2. Go to the Profiles tab.
3. Create a Profile and fill the required fields.
4. Run `检查注入结果`.
5. Inspect the `checks` output. The expected values are all `true`.

The `env` output masks `ENV_TEST_SECRET` and `ENV_TEST_PROFILE_SECRET`; it only reports whether the value was present.
