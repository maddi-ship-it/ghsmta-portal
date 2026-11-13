import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AutoLinkText } from "./auto-link-text";

describe("AutoLinkText", () => {
  it("renders safe external links without treating text as HTML", () => {
    const html = renderToStaticMarkup(
      <AutoLinkText text={'Open https://example.com?a=1&b=2 <script>'} />,
    );

    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
