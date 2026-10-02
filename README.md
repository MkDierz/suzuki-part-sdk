# @mkdierz/suzuki-parts-sdk

Unofficial, dependency-free TypeScript clients for the two Suzuki Indonesia
parts catalogs. Zero runtime dependencies — just global `fetch` (Node 18+,
Bun, Deno, browsers).

```bash
npm install @mkdierz/suzuki-parts-sdk
```

## Two clients, one package

| Client | Catalog | Figure coordinates? |
| ------ | ------- | ------------------- |
| **`EpartsClient`** | `suzuki.co.id` e-Parts | **yes** — `position_x` / `position_y` per part |
| `MySuzukiClient` | `mysuzuki.id` | no |

**Use `EpartsClient` for clickable overlays.** It is the reason this package
exists: e-Parts returns a position for every part on an exploded-view diagram,
which is what you need to pin markers onto the figure image. MySuzuki has
richer part metadata (price, stock status, weights, applicable vehicles) but no
coordinates, so it is the better source for part *data* and e-Parts for part
*placement*.

Both were reverse-engineered from captured request logs of the public sites.
Neither API is documented.

## Quick start: vehicle → figure → overlay-ready parts

```ts
import { EpartsClient } from "@mkdierz/suzuki-parts-sdk";

const client = new EpartsClient();

// 1. Vehicle selection
const { options } = await client.vehicles.list({ type: "4-wheels" });
const vehicleId = options.find((o) => o.value !== "")!.value; // skip placeholder

// 2. Figure list for that vehicle ("engine", "electrical", ...)
for await (const figure of client.figures.iterate({ vehicleId, typeSlug: "engine" })) {
  // 3. Parts joined to their hotspot coordinates — 2 requests, done for you
  const detail = await client.catalog.figureDetail(figure.id, { figure });

  for (const spot of detail.hotspots) {
    if (!spot.position || !spot.part) continue; // grouping row, or no position
    // spot.position.x / .y are numbers; spot.part.part_no, .name, .price
    console.log(spot.tagNo, spot.part.name, spot.position.x, spot.position.y);
  }
}
```

`catalog.figureDetail()` is the piece built for overlays. e-Parts splits this
across two endpoints — `parts/figure/detail` (the catalogue rows) and
`part-tags/figure/detail` (the coordinates) — and this method fetches both
concurrently and joins them on `part_id`:

```ts
interface FigureDetail {
  figureId: string;
  imageUrl: string | null;   // background image for your overlay
  parts: Epart[];            // every part on the figure
  hotspots: Hotspot[];       // tag + position + part, ready to render
  untaggedParts: Epart[];    // parts with no tag (usually sub-parts)
}

interface Hotspot {
  tag: PartTag;
  tagNo: string;                    // the number printed on the diagram
  position: ParsedPosition | null;  // null when the tag has no position
  part: Epart | undefined;          // undefined for grouping rows
}

interface ParsedPosition {
  rawX: string; rawY: string;   // exactly as the API sent them
  x: number | null; y: number | null;
}
```

### About the position unit

The API sends positions as **numeric strings** (e.g. `"63.42592592592593"`).
Those values look like percentages of the image's width and height, but the API
does not document the unit and no endpoint was found that confirms it — so
`parsePosition` exposes the raw strings next to the parsed numbers rather than
pretending to know.

Verify against a real figure before shipping an overlay. If they turn out to be
percentages, position a marker with:

```ts
style = { left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" };
```

`parsePosition` returns `null` (rather than `0`) for blank or unparseable
coordinates, so a missing position never silently pins a marker to the corner.

## MySuzuki client

Better part data, no coordinates:

```ts
import { MySuzukiClient, formatRupiah } from "@mkdierz/suzuki-parts-sdk";

const suzuki = new MySuzukiClient();

const bikes = await suzuki.vehicles.list({ typeCode: "2-wheels", length: 100 });
const categories = await suzuki.categories.list({ typeId: bikes.data[0]!.type_id });
const figures = await suzuki.figures.list({ vehicleId: bikes.data[0]!.id });
const { data: parts } = await suzuki.parts.list({ figureId: figures.data[0]!.id });

formatRupiah(parts[0]!.price); // "Rp 1.025.500"
```

> **This API always answers HTTP 200.** The real status is in the envelope's
> `code` field (`200` ok, `404` nothing found, `498` session expired), so
> checking `response.ok` is meaningless — the client handles it for you. List
> methods turn `404` into an empty page by default (`notFoundAsEmpty`).
>
> Numeric-looking fields are **strings** on this API (`quantity: "1"`,
> `price_diskon: "0"`). The types mirror that exactly; parse explicitly.

## Subpath imports

```ts
import { EpartsClient } from "@mkdierz/suzuki-parts-sdk/eparts";
import { MySuzukiClient } from "@mkdierz/suzuki-parts-sdk/mysuzuki";
```

Available if you prefer explicit imports or want to keep one catalog out of
your bundle. Both ship ESM and CJS with full type declarations.

## Errors

Every error extends `SuzukiError`, so one check catches everything:

```
SuzukiError
├── SuzukiApiError              server answered, but reported failure
│   └── SuzukiSessionExpiredError   401/403 (e-Parts) or envelope 498 (MySuzuki)
└── SuzukiNetworkError          fetch failed / timed out / aborted
```

```ts
import { SuzukiApiError, SuzukiNetworkError } from "@mkdierz/suzuki-parts-sdk";

try {
  await client.partTypes.list();
} catch (err) {
  if (err instanceof SuzukiNetworkError) retryLater();
  else if (err instanceof SuzukiApiError) console.error(err.code, err.httpStatus, err.requestId);
}
```

Every method also accepts an `AbortSignal`:

```ts
const controller = new AbortController();
const parts = await client.parts.listByFigure(figureId, { signal: controller.signal });
```

## Client options

Both clients accept a custom `fetch` (handy for tests, proxies and
instrumentation), plus headers and timeouts:

```ts
new EpartsClient({
  timeoutMs: 15_000,
  maxRetries: 2,      // retries network errors, 429 and 5xx, with full-jitter backoff
  treatNotFoundAsEmpty: true,
  headers: { "x-trace": traceId },
  fetch: myFetch,
});
```

MySuzuki uses `retries` / `retryDelayMs` where e-Parts uses `maxRetries` /
`retryBaseDelayMs`; see the exported `MySuzukiClientOptions` and
`EpartsClientOptions` types.

### Typing note

The public types reference `fetch`-adjacent globals (`Response`,
`AbortSignal`). Every runtime that can run this package provides them, but your
TypeScript config needs to see them too — i.e. `lib: ["DOM"]`, `@types/node`
>= 18, or `bun-types`. If you hit `Cannot find name 'AbortSignal'`, add one of
those.

## Pagination

Both clients expose `list`, `iterate` (async generator) and `listAll` on their
paginated resources. They differ because the APIs do:

- **MySuzuki** returns a real `pagination.total_page`, so iteration is bounded.
- **e-Parts** exposes no page count on `/figures/ajax`, so iteration stops at
  the first page that contributes no new figure id — which also prevents an
  infinite loop if the server ignores `page`. Both paths take `maxPages` as a
  safety cap.

## Be a good citizen

These are undocumented, unauthenticated endpoints behind public websites.

- Keep request rates low; prefer caching over refetching (catalog data changes
  rarely).
- Respect the sites' terms of use.
- Data belongs to PT Suzuki Indomobil Motor; this package is not affiliated
  with or endorsed by them.

## Disclaimer

Unofficial and unsupported. Built from observed traffic; endpoints and response
shapes can change without notice. Types marked as "assumed" in the source are
inferences from limited samples, not confirmed behaviour.

## License

MIT
