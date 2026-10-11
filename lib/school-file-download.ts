import { Zip, ZipPassThrough } from "fflate";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_SCHOOL_FILE_DOWNLOADS = 100;

export function parseSchoolFileIds(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return Array.from(
      new Set(
        parsed.filter(
          (item): item is string =>
            typeof item === "string" && UUID_PATTERN.test(item),
        ),
      ),
    );
  } catch {
    return [];
  }
}

export function safeSchoolFileName(value: string, fallback = "school-file") {
  return (
    value
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[.\-\s]+/, "")
      .trim()
      .slice(0, 180) || fallback
  );
}

export function uniqueSchoolFileNames(names: string[]) {
  const used = new Set<string>();

  return names.map((rawName) => {
    const safeName = safeSchoolFileName(rawName);
    const extensionIndex = safeName.lastIndexOf(".");
    const hasExtension = extensionIndex > 0;
    const stem = hasExtension ? safeName.slice(0, extensionIndex) : safeName;
    const extension = hasExtension ? safeName.slice(extensionIndex) : "";
    let candidate = safeName;
    let suffix = 2;

    while (used.has(candidate.toLocaleLowerCase())) {
      candidate = `${stem} (${suffix})${extension}`;
      suffix += 1;
    }

    used.add(candidate.toLocaleLowerCase());
    return candidate;
  });
}

export function attachmentDisposition(fileName: string) {
  const safeName = safeSchoolFileName(fileName);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export function createSchoolFileZipStream(
  sources: Array<{ name: string; url: string }>,
) {
  let archive: Zip | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        archive?.terminate();
        controller.error(error);
      };

      archive = new Zip((error, chunk, final) => {
        if (error) {
          fail(error);
          return;
        }
        if (finished) return;
        controller.enqueue(chunk);
        if (final) {
          finished = true;
          controller.close();
        }
      });

      void (async () => {
        for (const source of sources) {
          const response = await fetch(source.url, { cache: "no-store" });
          if (!response.ok || !response.body) {
            throw new Error(`Could not download ${source.name}.`);
          }

          const archiveFile = new ZipPassThrough(source.name);
          archive?.add(archiveFile);
          const reader = response.body.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            archiveFile.push(value);
          }
          archiveFile.push(new Uint8Array(0), true);
        }

        archive?.end();
      })().catch(fail);
    },
    cancel() {
      archive?.terminate();
    },
  });
}
