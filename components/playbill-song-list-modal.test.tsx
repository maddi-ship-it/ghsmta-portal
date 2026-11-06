import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlaybillSongListModal } from "./playbill-song-list-modal";

describe("PlaybillSongListModal", () => {
  it("renders an adjudication song-list trigger", () => {
    const html = renderToStaticMarkup(
      <PlaybillSongListModal
        applicationId="00000000-0000-4000-8000-000000000001"
        sourceFileName="Spring Musical Playbill.pdf"
      />,
    );

    expect(html).toContain("Playbill song list");
    expect(html).toContain('aria-haspopup="dialog"');
  });
});
