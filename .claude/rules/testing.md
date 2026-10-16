# Testing

## Desktop Database and Test Fixtures

- This workspace contains desktop applications and shared client crates. Server
  database fixtures and backend tests belong to the separate `artcraft-services`
  repository; no MySQL server is required for desktop builds or fixture tests.
- The `sqlite_tasks` crate uses embedded SQLite. Keep its migrations in
  `_database/sql/artcraft_migrations/` and compile-time query metadata in `.sqlx/`.
- Set `SQLX_OFFLINE=true` when compiling or testing `artcraft`, `sqlite_tasks`, or
  other crates that use the desktop SQLx query macros. This uses the checked-in
  metadata instead of requiring a development database at compile time.
- Runtime database tests should create a temporary SQLite database with the
  required migrations. Never use the real `~/Artcraft/state/` task database.
- HTTP tests should use deterministic response fixtures or an in-process loopback
  server. Use temporary cookie stores and credentials; do not load a developer's
  real session or provider keys.
- Keep tests that contact hosted APIs or submit paid provider jobs marked
  `#[ignore]`. Routine test runs and CI must not enable `--ignored` or
  `--include-ignored`. A live-provider check is a separate, explicitly requested
  manual operation.

## Running Tests

- Run the tests for the affected crate or feature, after checking that they use
  local fixtures: `cargo test -p {crate_name}`
- Crates using SQLx offline mode: `SQLX_OFFLINE=true cargo test -p {crate_name}`
- Use `cargo check -p {crate_name}` for fast compilation checks without running tests
- Native login regression fixtures:
  `SQLX_OFFLINE=true cargo test -p artcraft --lib login_bridge_tests`
- Desktop request identity and HTTP bridge fixtures:
  `cargo test -p artcraft_client_identity -p tauri-plugin-http --lib`
- Current frontend app and shared-library tests:
  `npm --prefix frontend run test:unit`
- On macOS or Linux, run frontend tests and all setup/launcher fixtures with
  `npm --prefix frontend test`. See `frontend/README.md` for test scope and the
  separate legacy Jest suite, whose runner is not installed and which is not
  covered by this command.
- Combined Unix launcher fixtures, after installing frontend dependencies:
  `node --test frontend/scripts/unix-dev.test.mjs`
- Cargo's `--offline` option only disables dependency downloads; it does not
  prevent test code from making HTTP requests. Use it when dependencies are
  already cached, and keep the fixture-only requirements above.
- See `docs/website-login.md` and `docs/desktop-session-regression.md` for the
  corresponding frontend tests and the separate native acceptance checks.

## Test Patterns

- Tests live in `#[cfg(test)] mod tests { ... }` at the bottom of each file
- Group related tests into sub-modules by category (e.g. `mod pricing_tests`, `mod resolution_tests`)
- Only create a sub-module when it has 2+ tests — don't wrap a single test in its own module
- Keep nesting shallow: `mod tests { mod category { ... } }` is fine; a third level is rarely needed
- Shared helpers used by multiple sub-modules belong in the parent `mod tests`, not duplicated in each sub-module
- Enum tests should cover: serialization, deserialization, `to_str`/`from_str` round-trip, variant count
- Password/crypto tests: be mindful of computation cost, don't add too many bcrypt test cases

## Test File Layout

Put test cases first, helpers last. Engineers should see the actual tests before scrolling
to understand helper plumbing.

Within a `mod tests { ... }` block:

1. **Imports** at the top
2. **Constants** (test data IDs, URLs, etc.) — small context that tests reference
3. **Test functions** (`#[test]` / `#[tokio::test]`) grouped by category
4. **Helper functions** (builders, pipeline runners, etc.) at the very bottom

If tests are grouped into sub-modules, the same rule applies within each sub-module:
constants first, then tests, then helpers at the end of that sub-module.

## What to Test

- New error types and their mappings
- Enum variant serialization stability (these are stored in the database)
- Hash/deduplication functions with known inputs
- Edge cases in parsers (empty input, missing fields, malformed data)

## Imports in Tests

- Import test fixtures and constants with `use`, not inline fully-qualified paths.
  Write `use test_data::web::image_urls::JUNO_AT_LAKE_IMAGE_URL;` at the top,
  then reference `JUNO_AT_LAKE_IMAGE_URL` in test bodies.
- Same rule applies to enum variants used in match arms — import them, don't write
  `crate::some::deep::module::MyEnum::Variant` inline.

## What Not to Test

- Don't add integration tests that require a separate database server unless explicitly asked
- Don't make routine tests depend on a hosted backend, provider account, credits, or external network access
- Don't add tests for simple struct construction or trivial getters
