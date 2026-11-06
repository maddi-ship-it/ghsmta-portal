export const PLAYBILL_SONG_LIST_EXTRACTOR_VERSION = 1;
export const MAX_PLAYBILL_SONGS = 250;

export type PlaybillSong = {
  section: string;
  title: string;
  performers: string;
};

export type PlaybillSongListSection = {
  heading: string;
  songs: PlaybillSong[];
};

export type PlaybillInputKind =
  | { kind: "pdf"; mimeType: "application/pdf" }
  | {
      kind: "image";
      mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
    };

const IMAGE_MIME_TYPES = new Set<PlaybillInputKind["mimeType"]>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const IMAGE_EXTENSION_MIME_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
] as const);

function cleanField(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

export function parsePlaybillSongList(value: unknown): PlaybillSong[] | null {
  if (!value || typeof value !== "object") return null;
  const songs = (value as { songs?: unknown }).songs;
  if (!Array.isArray(songs)) return null;

  return songs
    .slice(0, MAX_PLAYBILL_SONGS)
    .flatMap<PlaybillSong>((song) => {
      if (!song || typeof song !== "object") return [];
      const item = song as {
        section?: unknown;
        title?: unknown;
        performers?: unknown;
      };
      const title = cleanField(item.title, 300);
      if (!title) return [];
      return [
        {
          section: cleanField(item.section, 120),
          title,
          performers: cleanField(item.performers, 500),
        },
      ];
    });
}

export function buildPlaybillSongListSections(
  songs: PlaybillSong[],
): PlaybillSongListSection[] {
  const sections: PlaybillSongListSection[] = [];

  for (const song of songs) {
    const heading = song.section || "Musical numbers";
    const previousSection = sections.at(-1);
    if (previousSection?.heading === heading) {
      previousSection.songs.push(song);
    } else {
      sections.push({ heading, songs: [song] });
    }
  }

  return sections;
}

export function resolvePlaybillInputKind({
  fileName,
  mimeType,
}: {
  fileName: string;
  mimeType: string | null;
}): PlaybillInputKind | null {
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  const normalizedFileName = fileName.trim().toLowerCase();

  if (normalizedMimeType === "application/pdf" || normalizedFileName.endsWith(".pdf")) {
    return { kind: "pdf", mimeType: "application/pdf" };
  }

  if (IMAGE_MIME_TYPES.has(normalizedMimeType as PlaybillInputKind["mimeType"])) {
    return {
      kind: "image",
      mimeType: normalizedMimeType as Extract<PlaybillInputKind, { kind: "image" }>["mimeType"],
    };
  }

  for (const [extension, resolvedMimeType] of IMAGE_EXTENSION_MIME_TYPES) {
    if (normalizedFileName.endsWith(extension)) {
      return { kind: "image", mimeType: resolvedMimeType };
    }
  }

  return null;
}
