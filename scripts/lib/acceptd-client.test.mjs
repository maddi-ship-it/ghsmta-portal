import { describe, expect, it, vi } from "vitest";

import { AcceptdApiError, createAcceptdClient } from "./acceptd-client.mjs";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("Acceptd API client", () => {
  it("follows JSON:API pagination and sends the bearer token", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(init.headers.authorization).toBe("Bearer secret-token");
      const requestUrl = new URL(url);
      if (requestUrl.searchParams.get("page") === "2") {
        return jsonResponse({ data: [{ id: "app-2" }], links: { next: null } });
      }
      expect(requestUrl.searchParams.get("filter[program]")).toBe("program-1");
      return jsonResponse({
        data: [{ id: "app-1" }],
        links: { next: "/v2/applications?page=2" },
      });
    });
    const client = createAcceptdClient({
      token: "secret-token",
      baseUrl: "http://127.0.0.1:3001",
      fetchImpl,
    });

    const result = await client.listApplications({
      query: [["filter[program]", "program-1"]],
    });

    expect(result).toEqual({
      applications: [{ id: "app-1" }, { id: "app-2" }],
      pageCount: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("hydrates list records from the per-application endpoint", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const requestUrl = new URL(url);
      if (requestUrl.pathname === "/v2/applications") {
        return jsonResponse({ data: [{ id: "100" }, { id: "200" }] });
      }
      const id = requestUrl.pathname.split("/").at(-1);
      return jsonResponse({ data: { id, attributes: { stage: "Submitted" } } });
    });
    const client = createAcceptdClient({
      token: "secret-token",
      baseUrl: "http://localhost:3001",
      fetchImpl,
    });

    const result = await client.pullApplications({ concurrency: 2 });

    expect(result.applications).toEqual([
      { id: "100", attributes: { stage: "Submitted" } },
      { id: "200", attributes: { stage: "Submitted" } },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries rate-limited requests using Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "Slow down" },
          { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "0" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const client = createAcceptdClient({
      token: "secret-token",
      baseUrl: "http://localhost:3001",
      fetchImpl,
      sleep,
    });

    await expect(client.listApplications()).resolves.toEqual({
      applications: [],
      pageCount: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it("does not send the token to a cross-origin pagination link", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ id: "app-1" }],
        links: { next: "https://example.com/steal-token" },
      }),
    );
    const client = createAcceptdClient({
      token: "secret-token",
      baseUrl: "http://localhost:3001",
      fetchImpl,
    });

    await expect(client.listApplications()).rejects.toThrow(
      "bearer token was not sent",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("redacts the bearer token from API errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { message: "Rejected Bearer secret-token" },
        { status: 401, statusText: "Unauthorized" },
      ),
    );
    const client = createAcceptdClient({
      token: "secret-token",
      baseUrl: "http://localhost:3001",
      fetchImpl,
    });

    const error = await client.listApplications().catch((caught) => caught);
    expect(error).toBeInstanceOf(AcceptdApiError);
    expect(error.message).not.toContain("secret-token");
    expect(error.status).toBe(401);
    expect(error.retryable).toBe(false);
  });
});
