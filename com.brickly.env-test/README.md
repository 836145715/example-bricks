# com.brickly.env-test

Profile env mapping test plugin.

## What It Checks

This plugin declares one Profile with five fields:

| Field | Inject | Env | Expected |
| --- | --- | --- | --- |
| `configOnly` | `config` | none | Present only in `host.hello.config`. |
| `envOnly` | `env` | `ENV_TEST_ONLY` | Present only in `process.env`. |
| `bothValue` | `both` | `ENV_TEST_BOTH` | Present in both `host.hello.config` and `process.env`. |
| `defaultEnv` | `env` | `ENV_TEST_DEFAULT` | Uses default `from-default` when omitted, then injects env. |
| `secretToken` | `env` | `ENV_TEST_SECRET` | Password input; present only in env and masked in output. |

## Manual Test

1. Open the plugin detail page for `com.brickly.env-test`.
2. Go to the Profiles tab.
3. Create a Profile and fill the required fields.
4. Run `检查注入结果`.
5. Inspect the `checks` output. The expected values are all `true`.

The `env` output masks `ENV_TEST_SECRET`; it only reports whether the value was present.
