import { Fragment } from "react";

import { autoLinkSegments } from "@/lib/auto-link";

export function AutoLinkText({ text }: { text: string }) {
  return (
    <>
      {autoLinkSegments(text).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            className="auto-link"
            href={segment.href}
            key={`${segment.href}-${index}`}
            rel="noreferrer noopener"
            target="_blank"
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={`text-${index}`}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
