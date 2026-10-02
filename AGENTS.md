# AGENTS.md — suzuki-indo-part-sdk

Publishable npm package: `@mkdierz/suzuki-indo-parts-sdk`. Unofficial,
zero-dependency TypeScript clients for the two Suzuki Indonesia parts catalogs,
both reverse-engineered from captured request logs.

## Commands

```bash
bun install
bun run typecheck          # tsc -p tsconfig.json (noEmit)
bun test                   # bun test — mocks fetch, no network
bun run build              # clean + typecheck + ESM + CJS + postbuild markers
npm pack --dry-run         # verify publish contents
bun run publish:check      # typecheck + test + build (what CI should run)
```

There is no lint or formatter config. **The build already runs `typecheck`,
so run `bun test` too before publishing** — `prepublishOnly` does both.

## Layout

```
src/
  index.ts            root barrel — both clients + shared errors + types
  shared/             errors.ts, http.ts (Requester), pagination.ts
  eparts/             suzuki.co.id e-Parts  — client.ts, types.ts
  mysuzuki/           mysuzuki.id           — client.ts, types.ts, helpers.ts
scripts/postbuild.ts  writes dist/{esm,cjs}/package.json type markers
test/sdk.test.ts      all tests, mocked fetch
```

Consumers import the root (`@mkdierz/suzuki-indo-parts-sdk`) or the
`/eparts` and `/mysuzuki` subpaths. Both map to real `dist/` folders via
`package.json` `exports` — keep the exports map in sync when adding files.

## Build constraints (these will bite you)

- **TypeScript 7 native compiler** (`tsc` from `typescript@7`), not the old
  JS one. Some flags are gone: `moduleResolution: node10` was **removed**.
- **Dual ESM + CJS output.** `tsconfig.build.esm.json` and
  `tsconfig.build.cjs.json` both extend the base config.
  - `verbatimModuleSyntax` **cannot** be combined with `module: commonjs`
    (TS1295/TS1287). The CJS config disables it; the ESM config keeps it.
  - `allowImportingTsExtensions` must be `false` in both build configs,
    otherwise emit is rejected. So **relative imports in `src/` must use
    explicit `.js` extensions** (`./errors.js`, not `./errors`) even though the
    sources are `.ts`.
  - `scripts/postbuild.ts` must run after emit. Without the
    `{"type":"commonjs"}` marker in `dist/cjs/`, `require()` of the package
    throws `ERR_REQUIRE_ESM` — the root package.json says `"type": "module"`.
- Base `tsconfig.json` uses `lib: ["ESNext", "DOM"]` and `types: []` so the
  build does not depend on `@types/bun`. The public `.d.ts` references
  `Response` / `RequestInit` / `AbortSignal`; consumers need `lib: ["DOM"]`,
  `@types/node` >= 18, or `bun-types` (documented in the README).

## Why there are two clients

Do not "simplify" by merging them. They are genuinely different APIs and both
ship:

- **`EpartsClient`** (suzuki.co.id) is the primary one — it is the only source
  of `position_x` / `position_y`, which is what makes clickable overlays on
  exploded-view diagrams possible. `catalog.figureDetail()` joins
  `parts/figure/detail` + `part-tags/figure/detail` on `part_id`.
- **`MySuzukiClient`** (mysuzuki.id) has richer part data (price, stock,
  weights) but no coordinates.

Naming: where both APIs had the same name for different shapes, the e-Parts
name is unprefixed at the root and the MySuzuki one is suffixed
(`MysuzukiPart`, `MysuzukiFigure`). Don't unify these — the collision is real.

## API quirks that must be preserved

**e-Parts** (`/api/v1/eparts`, all GET, envelope `{status, data, message, request_id, code?}`)
- Envelope success requires `status === "success"`.
- Only `/figures/ajax` paginates, `page` is echoed as a **string**, and there
  is **no total page count** — iteration must stop on the first page yielding
  no new ids (see `getKey` in `figures.iterate`).
- `position_x` / `position_y` are numeric **strings**.
- `/parts/figure/detail/table` returns an HTML fragment.
- `origin` / `referer` default headers are forbidden in browsers (silently
  ignored) but sent by Node/Bun/Deno.

**MySuzuki**
- **HTTP is always 200.** The envelope `code` is authoritative: `200` ok,
  `404` nothing found, `498` session expired. `response.ok` is meaningless.
- `404` becomes an empty page by default (`notFoundAsEmpty`).
- Server errors arrive as HTTP 200 with `code >= 500` and must be retried
  separately from HTTP-level retries — see the recursion in `MySuzukiClient.call`.
- Query param is spelled **`recomended`** by the API (sic).
- `quantity` / `price_diskon` are numeric **strings**.

**Shared**
- Errors: `SuzukiError` → `SuzukiApiError` → `SuzukiSessionExpiredError`, plus
  `SuzukiNetworkError`. One `instanceof SuzukiError` catches everything.
- `parsePosition` must treat blank coordinates as `null`, **not** `0`
  (`Number("") === 0` would pin overlays to the corner). There is a test for it.

## Conventions

- Wire types mirror the API exactly (`snake_case`, numbers-as-strings stay
  strings). Public *param* types are camelCase and mapped in the client.
- Never `any` on the wire; use `unknown` + narrowing.
- Both files are large but deliberately **one file per client** (`client.ts` +
  `types.ts`) — do not split resources into per-endpoint files.
- Tests mock `fetch` and assert on wire param names; keep them network-free.

## Deps

Runtime: none. Dev: `typescript@^7` (build), `@types/bun` (tests/scripts).
Lockfile is `bun.lock` — use `bun install`, not npm.
