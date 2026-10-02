import { describe, expect, test } from "bun:test";
import {
  EpartsClient,
  MySuzukiClient,
  SuzukiApiError,
  SuzukiError,
  SuzukiNetworkError,
  SuzukiSessionExpiredError,
  parsePosition,
} from "../src/index.js";

/** Build a JSON Response the way the APIs actually answer. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Collects the URLs it is called with and replies from a queue. */
function mockFetch(...responses: Array<Response | (() => Response)>) {
  const urls: string[] = [];
  let i = 0;
  const impl = async (url: string): Promise<Response> => {
    urls.push(url);
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return typeof next === "function" ? next() : (next as Response);
  };
  return { impl, urls, calls: () => i };
}

const epartsOk = <T>(data: T) => ({
  status: "success",
  data,
  message: "Success get data",
  request_id: "req-1",
});

describe("EpartsClient envelope handling", () => {
  test("unwraps data from a success envelope", async () => {
    const mock = mockFetch(json(epartsOk([{ id: 1, slug: "engine", name: "Engine" }])));
    const client = new EpartsClient({ fetch: mock.impl });

    const types = await client.partTypes.list();

    expect(types).toEqual([{ id: 1, slug: "engine", name: "Engine" }]);
    expect(mock.urls[0]).toBe(
      "https://api-web-corp.suzuki.co.id/api/v1/eparts/other-part-types/index",
    );
  });

  test("throws SuzukiApiError when status is not success", async () => {
    const mock = mockFetch(json({ status: "error", data: null, message: "boom", request_id: "r" }));
    const client = new EpartsClient({ fetch: mock.impl });

    const error = await client.partTypes.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SuzukiApiError);
    expect((error as SuzukiApiError).message).toBe("boom");
    expect((error as SuzukiApiError).httpStatus).toBe(200);
  });

  test("maps HTTP 403 to SuzukiSessionExpiredError", async () => {
    const mock = mockFetch(json({}, 403));
    const client = new EpartsClient({ fetch: mock.impl });

    await expect(client.partTypes.list()).rejects.toBeInstanceOf(
      SuzukiSessionExpiredError,
    );
  });

  test("treats 404 as empty when treatNotFoundAsEmpty is set", async () => {
    const mock = mockFetch(json({}, 404));
    const client = new EpartsClient({
      fetch: mock.impl,
      treatNotFoundAsEmpty: true,
    });

    expect(await client.partTypes.list()).toEqual([]);
  });

  test("throws on 404 by default", async () => {
    const mock = mockFetch(json({}, 404));
    const client = new EpartsClient({ fetch: mock.impl });

    await expect(client.partTypes.list()).rejects.toBeInstanceOf(SuzukiApiError);
  });

  test("retries a 500 then succeeds", async () => {
    const mock = mockFetch(
      json({}, 500),
      json(epartsOk([{ id: 7, slug: "s", name: "S" }])),
    );
    const client = new EpartsClient({
      fetch: mock.impl,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
    });

    expect(await client.partTypes.list()).toHaveLength(1);
    expect(mock.calls()).toBe(2);
  });

  test("retries a network failure then succeeds", async () => {
    let attempt = 0;
    const client = new EpartsClient({
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
      fetch: async () => {
        attempt++;
        if (attempt === 1) throw new TypeError("fetch failed");
        return json(epartsOk([]));
      },
    });

    expect(await client.partTypes.list()).toEqual([]);
    expect(attempt).toBe(2);
  });

  test("surfaces a network failure as SuzukiNetworkError after retries", async () => {
    const client = new EpartsClient({
      maxRetries: 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await expect(client.partTypes.list()).rejects.toBeInstanceOf(SuzukiNetworkError);
  });

  test("passes auth headers merged over the defaults", async () => {
    let seen: Record<string, string> = {};
    const client = new EpartsClient({
      fetch: async (_url, init) => {
        seen = init?.headers as Record<string, string>;
        return json(epartsOk([]));
      },
      auth: () => ({ authorization: "Bearer test" }),
    });

    await client.partTypes.list();

    expect(seen.authorization).toBe("Bearer test");
    expect(seen.origin).toBe("https://www.suzuki.co.id");
  });
});

describe("parsePosition", () => {
  test("parses numeric strings", () => {
    expect(parsePosition({ position_x: "63.42592592592593", position_y: "12" })).toEqual({
      rawX: "63.42592592592593",
      rawY: "12",
      x: 63.42592592592593,
      y: 12,
    });
  });

  test("returns null when both are empty", () => {
    expect(parsePosition({ position_x: "", position_y: "" })).toBeNull();
  });

  test("returns null when neither coordinate is usable", () => {
    expect(parsePosition({ position_x: "n/a", position_y: "" })).toBeNull();
    expect(parsePosition({ position_x: "", position_y: "   " })).toBeNull();
  });

  test("keeps a usable coordinate when the other is blank", () => {
    // Guards the `Number("") === 0` trap: a blank y must not become 0.
    expect(parsePosition({ position_x: "42", position_y: "" })).toEqual({
      rawX: "42",
      rawY: "",
      x: 42,
      y: null,
    });
  });
});

describe("catalog.figureDetail", () => {
  const figure = { id: 42, name: "ENGINE", file_url: "f.jpg", cdn_file_url: "cdn.jpg" };
  const parts = [
    { id: 100, part_no: "P1", name: "Piston" },
    { id: 101, part_no: "P2", name: "Ring" },
  ];
  const tags = [
    { id: 1, part_id: 100, figure_id: 42, parent_id: 0, tag_no: "1", position_x: "10", position_y: "20" },
    { id: 2, part_id: 999, figure_id: 42, parent_id: 0, tag_no: "2", position_x: "", position_y: "" },
  ];

  test("joins tags to parts and resolves the image url", async () => {
    const mock = mockFetch(
      json(epartsOk(parts)),
      json(epartsOk(tags)),
    );
    const client = new EpartsClient({ fetch: mock.impl });

    const detail = await client.catalog.figureDetail(42, { figure });

    expect(detail.figureId).toBe("42");
    expect(detail.imageUrl).toBe("cdn.jpg");
    expect(detail.parts).toHaveLength(2);
    expect(detail.hotspots).toHaveLength(2);

    // First tag joins to its part and parses its position.
    expect(detail.hotspots[0]?.tagNo).toBe("1");
    expect(detail.hotspots[0]?.part?.name).toBe("Piston");
    expect(detail.hotspots[0]?.position?.x).toBe(10);

    // Second tag points at a part that is not on this figure.
    expect(detail.hotspots[1]?.part).toBeUndefined();
    expect(detail.hotspots[1]?.position).toBeNull();

    // Part 101 has no tag, so it surfaces as untagged.
    expect(detail.untaggedParts.map((p) => p.name)).toEqual(["Ring"]);

    // Both endpoints were requested.
    expect(mock.urls).toHaveLength(2);
    expect(mock.urls[0]).toContain("/parts/figure/detail?figure_id=42");
    expect(mock.urls[1]).toContain("/part-tags/figure/detail?figure_id=42");
  });

  test("returns a null imageUrl when no figure is supplied", async () => {
    const mock = mockFetch(json(epartsOk([])), json(epartsOk([])));
    const client = new EpartsClient({ fetch: mock.impl });

    const detail = await client.catalog.figureDetail(42);

    expect(detail.imageUrl).toBeNull();
    expect(detail.hotspots).toEqual([]);
  });

  test("falls back to file_url when cdn_file_url is empty", async () => {
    const mock = mockFetch(json(epartsOk([])), json(epartsOk([])));
    const client = new EpartsClient({ fetch: mock.impl });

    const detail = await client.catalog.figureDetail(42, {
      figure: { cdn_file_url: "", file_url: "only-file.jpg" },
    });

    expect(detail.imageUrl).toBe("only-file.jpg");
  });
});

describe("figures.iterate", () => {
  const page = (ids: number[]) =>
    json(
      epartsOk({
        figures: ids.map((id) => ({ id, name: `F${id}`, file_url: "", cdn_file_url: "" })),
        page: "1",
        paging: "",
        type: { id: 1, slug: "engine", name: "Engine" },
        vehicle: { id: 95, slug: "v", name: "V" },
      }),
    );

  test("stops on the first page with no new ids", async () => {
    // Page 2 repeats page 1's ids, which is what a server ignoring `page`
    // looks like; iteration must terminate instead of looping.
    const mock = mockFetch(page([1, 2]), page([1, 2]), page([1, 2]));
    const client = new EpartsClient({ fetch: mock.impl });

    const all = await client.figures.listAll({ vehicleId: 95, typeSlug: "engine" });

    expect(all.map((f) => f.id)).toEqual([1, 2]);
    expect(mock.calls()).toBe(2);
  });

  test("keeps going while pages contribute new ids", async () => {
    const mock = mockFetch(page([1]), page([2]), page([]));
    const client = new EpartsClient({ fetch: mock.impl });

    const all = await client.figures.listAll({ vehicleId: 95, typeSlug: "engine" });

    expect(all.map((f) => f.id)).toEqual([1, 2]);
  });

  test("sends page and the snake_case wire names", async () => {
    const mock = mockFetch(page([]));
    const client = new EpartsClient({ fetch: mock.impl });

    await client.figures.list({ vehicleId: 95, typeSlug: "engine", page: 3 });

    expect(mock.urls[0]).toContain("vehicle_id=95");
    expect(mock.urls[0]).toContain("type_slug=engine");
    expect(mock.urls[0]).toContain("page=3");
  });
});

describe("MySuzukiClient envelope handling", () => {
  const mysuzukiOk = <T>(response: T) => ({ code: 200, message: "success", response });

  test("unwraps the response field", async () => {
    const mock = mockFetch(
      json(mysuzukiOk({ data: [], summary: {}, pagination: { page: 1, per_page: 10, total_page: 0 } })),
    );
    const client = new MySuzukiClient({ fetch: mock.impl });

    const result = await client.vehicles.list();
    expect(result.data).toEqual([]);
    expect(mock.urls[0]).toContain("/vehicle");
  });

  test("turns envelope code 404 into an empty page", async () => {
    const mock = mockFetch(json({ code: 404, message: "not found" }));
    const client = new MySuzukiClient({ fetch: mock.impl });

    const result = await client.vehicles.list();

    expect(result.data).toEqual([]);
    expect(result.pagination.total_page).toBe(0);
  });

  test("throws on envelope code 404 when notFoundAsEmpty is off", async () => {
    const mock = mockFetch(json({ code: 404, message: "not found" }));
    const client = new MySuzukiClient({ fetch: mock.impl, notFoundAsEmpty: false });

    await expect(client.vehicles.list()).rejects.toBeInstanceOf(SuzukiApiError);
  });

  test("maps envelope code 498 to SuzukiSessionExpiredError", async () => {
    const mock = mockFetch(json({ code: 498, message: "session expired" }));
    const client = new MySuzukiClient({ fetch: mock.impl });

    const error = await client.vehicles.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SuzukiSessionExpiredError);
    expect((error as SuzukiApiError).code).toBe(498);
    // HTTP was 200; the envelope code is what carries the real status.
    expect((error as SuzukiApiError).httpStatus).toBe(200);
  });

  test("retries an envelope-level 500 (delivered as HTTP 200)", async () => {
    const ok = mysuzukiOk({ data: [], summary: {}, pagination: { page: 1, per_page: 10, total_page: 1 } });
    const mock = mockFetch(json({ code: 500, message: "boom" }), json(ok));
    const client = new MySuzukiClient({ fetch: mock.impl, retryDelayMs: 1 });

    const result = await client.vehicles.list();

    expect(result.pagination.total_page).toBe(1);
    expect(mock.calls()).toBe(2);
  });

  test("does not retry envelope code 404", async () => {
    const mock = mockFetch(json({ code: 404, message: "not found" }));
    const client = new MySuzukiClient({ fetch: mock.impl, notFoundAsEmpty: false, retryDelayMs: 1 });

    await expect(client.vehicles.list()).rejects.toBeInstanceOf(SuzukiApiError);
    expect(mock.calls()).toBe(1);
  });

  test("sends the API's own 'recomended' spelling", async () => {
    const mock = mockFetch(
      json(mysuzukiOk({ data: [], summary: {}, pagination: { page: 1, per_page: 10, total_page: 0 } })),
    );
    const client = new MySuzukiClient({ fetch: mock.impl });

    await client.parts.list({ figureId: "f1", recommended: true });

    expect(mock.urls[0]).toContain("recomended=1");
    expect(mock.urls[0]).not.toContain("recommended");
  });

  test("requires vehicleId or figureId for parts.list", () => {
    const client = new MySuzukiClient({ fetch: mockFetch().impl });
    expect(() => client.parts.list({})).toThrow(TypeError);
  });

  test("iterates using the reported total_page", async () => {
    const makePage = (page: number, total: number) =>
      json(
        mysuzukiOk({
          data: [{ id: `v${page}`, slug: `s${page}` }],
          summary: {},
          pagination: { page, per_page: 1, total_page: total },
        }),
      );
    const mock = mockFetch(makePage(1, 3), makePage(2, 3), makePage(3, 3));
    const client = new MySuzukiClient({ fetch: mock.impl });

    const all = await client.vehicles.listAll({ length: 1 });

    expect(all.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
    expect(mock.calls()).toBe(3);
  });
});

describe("error hierarchy", () => {
  test("everything thrown extends SuzukiError", () => {
    expect(new SuzukiApiError("x", { httpStatus: 500 })).toBeInstanceOf(SuzukiError);
    expect(new SuzukiNetworkError("x")).toBeInstanceOf(SuzukiError);
    expect(new SuzukiSessionExpiredError("x", { httpStatus: 401 })).toBeInstanceOf(
      SuzukiApiError,
    );
  });

  test("error names are set for debugging", () => {
    expect(new SuzukiNetworkError("x").name).toBe("SuzukiNetworkError");
    expect(new SuzukiApiError("x", { httpStatus: 500 }).name).toBe("SuzukiApiError");
  });

  test("timeout sets timedOut on the network error", async () => {
    const client = new EpartsClient({
      timeoutMs: 5,
      maxRetries: 0,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });

    const error = await client.partTypes.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SuzukiNetworkError);
    expect((error as SuzukiNetworkError).timedOut).toBe(true);
  });

  test("a caller signal abort is not reported as a timeout", async () => {
    const controller = new AbortController();
    const client = new EpartsClient({
      maxRetries: 0,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          controller.abort();
        }),
    });

    const error = await client.partTypes.list({ signal: controller.signal }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(SuzukiNetworkError);
    expect((error as SuzukiNetworkError).timedOut).toBe(false);
  });
});
