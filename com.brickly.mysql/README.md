# com.brickly.mysql

MySQL database plugin used as the reference implementation for Brickly plugin Profiles.

It does not expose a `configure` command. Connection environments are declared in
`manifest.json` under `config.fields`, created by users in the plugin detail Profiles tab, and
injected into the runtime through `host.hello.config`.

## Profile Fields

| Field | Required | Notes |
| --- | --- | --- |
| `host` | Yes | MySQL host, IP, `localhost`, or domain. Defaults to `127.0.0.1`. |
| `port` | Yes | MySQL TCP port. Defaults to `3306`. Rendered as a number input. |
| `user` | Yes | MySQL username. |
| `password` | Yes | Rendered as a password input. Current Profile MVP stores it as plain JSON. |
| `database` | No | Optional default database. SQL can still use `database.table`. |
| `charset` | No | Defaults to `utf8mb4`. |

Each field is also mapped to a conventional runtime environment variable such as `MYSQL_HOST`,
`MYSQL_PORT`, and `MYSQL_PASSWORD`. The runtime still reads `host.hello.config` directly; the env
mapping is there for compatibility with libraries or scripts that expect environment variables.

## Commands

| ID | Purpose |
| --- | --- |
| `test-connection` | Opens the selected Profile connection and returns the MySQL server version. |
| `query` | Runs read-only SQL and returns rows, columns, and row count. |
| `execute` | Runs write SQL such as `INSERT`, `UPDATE`, or `DELETE`. |
| `transaction` | Runs multiple SQL statements in one transaction and rolls back on failure. |

`query` accepts `SELECT`, `SHOW`, `DESCRIBE`, `DESC`, `EXPLAIN`, and `WITH`. Use `execute` for
write statements.

## Parameterized SQL

Use PyMySQL placeholders instead of string concatenation:

```json
{
  "sql": "SELECT * FROM users WHERE id > %s",
  "params": [100]
}
```

For writes:

```json
{
  "sql": "INSERT INTO users (name, email) VALUES (%s, %s)",
  "params": ["Alice", "alice@example.com"]
}
```

For transactions:

```json
{
  "statements": [
    { "sql": "UPDATE accounts SET balance = balance - %s WHERE id = %s", "params": [100, 1] },
    { "sql": "UPDATE accounts SET balance = balance + %s WHERE id = %s", "params": [100, 2] }
  ]
}
```

## Runtime Notes

The runtime reads Profile config once, when it receives `host.hello`:

```python
if msg_type == "host.hello":
    profile_config = message.get("config")
```

Editing a Profile does not hot-update an already running runtime instance. Run the command again
after changing Profile values so Brickly can start a new instance with the new config.

## Manual Check

1. Open the MySQL plugin detail page.
2. Go to the Profiles tab and create a Profile.
3. Set it as default, or select it in the usage panel.
4. Run `test-connection`.
5. Run `query` with `SHOW TABLES` or a small `SELECT`.
