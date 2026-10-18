const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);

export const MAX_SCAN_SOURCE_BYTES = 15 * 1024 * 1024;
export const MAX_SCAN_UPLOAD_BYTES = 3.5 * 1024 * 1024;
export const MAX_SCAN_DIMENSION = 2400;

type DecodedImage = {
  height: number;
  release: () => void;
  source: CanvasImageSource;
  width: number;
};

export function isHeicFile(file: Pick<File, "name" | "type">) {
  return HEIC_MIME_TYPES.has(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

export function fitScanDimensions(width: number, height: number, maxDimension = MAX_SCAN_DIMENSION) {
  if (width <= 0 || height <= 0) throw new Error("The note image has invalid dimensions.");
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

async function loadWithImageBitmap(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap !== "function") throw new Error("ImageBitmap is unavailable.");
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  return {
    height: bitmap.height,
    release: () => bitmap.close(),
    source: bitmap,
    width: bitmap.width,
  };
}

async function loadWithImageElement(blob: Blob): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The browser could not open this image."));
      image.src = objectUrl;
    });
    return {
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
      source: image,
      width: image.naturalWidth,
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function decodeImage(blob: Blob) {
  try {
    return await loadWithImageBitmap(blob);
  } catch {
    return loadWithImageElement(blob);
  }
}

async function convertHeicInBrowser(file: File) {
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({ blob: file, quality: 0.9, toType: "image/jpeg" });
  return Array.isArray(converted) ? converted[0] : converted;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("The note image could not be compressed.")),
      "image/jpeg",
      quality,
    );
  });
}

export async function prepareScanImage(file: File) {
  if (file.size > MAX_SCAN_SOURCE_BYTES) {
    throw new Error("The note image must be 15 MB or smaller.");
  }

  let sourceBlob: Blob = file;
  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(sourceBlob);
  } catch (nativeError) {
    if (!isHeicFile(file)) throw nativeError;
    try {
      sourceBlob = await convertHeicInBrowser(file);
      decoded = await decodeImage(sourceBlob);
    } catch {
      throw new Error("This HEIC photo could not be opened. Try taking a new photo, or save it as JPEG and upload it again.");
    }
  }

  try {
    const fitted = fitScanDimensions(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The browser could not prepare this image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, fitted.width, fitted.height);
    context.drawImage(decoded.source, 0, 0, fitted.width, fitted.height);

    let compressed: Blob | null = null;
    for (const quality of [0.9, 0.82, 0.74, 0.66]) {
      compressed = await canvasToJpeg(canvas, quality);
      if (compressed.size <= MAX_SCAN_UPLOAD_BYTES) break;
    }
    if (!compressed || compressed.size > MAX_SCAN_UPLOAD_BYTES) {
      throw new Error("The note image is still too large after compression. Move closer to the page and take another photo.");
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "handwritten-notes";
    return new File([compressed], `${baseName}.jpg`, { type: "image/jpeg" });
  } finally {
    decoded.release();
  }
}
