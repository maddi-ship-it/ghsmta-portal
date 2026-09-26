const STREET_SUFFIX_PATTERN =
  /\b(?:avenue|ave|boulevard|blvd|circle|cir|court|ct|drive|dr|highway|hwy|lane|ln|parkway|pkwy|path|place|pl|road|rd|street|st|trail|trl|way)\.?\s+/i;

function cleanCity(value: string) {
  return value
    .replace(/^.*\|\s*/, "")
    .replace(/^.*\bGA-\d+\s+/i, "")
    .replace(/^.*\bHwy\s+\d+\s+[NSEW]?\s*/i, "")
    .replace(/^.*\b(?:N|S|E|W|NE|NW|SE|SW)\s+/i, "")
    .replace(/^.*\b(?:Northeast|Northwest|Southeast|Southwest)\s+/i, "")
    .replace(/^.*\b(?:Road|Rd|Street|St|Avenue|Ave|Drive|Dr|Boulevard|Blvd|Highway|Hwy|Parkway|Pkwy|Lane|Ln|Trail|Trl|Court|Ct|Way|Place|Pl|Circle|Cir)\.?\s+/i, "")
    .trim();
}

export function cityFromVenueAddress(
  address: string | null | undefined,
): string | null {
  if (!address?.trim()) return null;

  const normalized = address.replace(/\s+/g, " ").trim();
  const parts = normalized
    .replace(/\s*\|\s*/g, ", ")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const stateIndex = parts.findIndex((part) => /^GA\b/i.test(part));

  if (stateIndex > 0) {
    const candidate = cleanCity(parts[stateIndex - 1]);
    if (candidate && !STREET_SUFFIX_PATTERN.test(`${candidate} `)) {
      return candidate;
    }
  }

  const beforeState = normalized.match(/\s([^,]+?)(?:,\s*|\s+)GA\b/i)?.[1];
  if (!beforeState) return null;

  const candidate = cleanCity(beforeState);
  return candidate || null;
}

export function scheduleCityLabel({
  venueAddress,
  applicationCity,
  fallbackLocation,
}: {
  venueAddress?: string | null;
  applicationCity?: string | null;
  fallbackLocation?: string | null;
}) {
  return (
    cityFromVenueAddress(venueAddress) ??
    (applicationCity?.trim() || null) ??
    cityFromVenueAddress(fallbackLocation) ??
    fallbackLocation?.trim() ??
    "City not provided"
  );
}

export function scheduleDirectionsUrl({
  venueName,
  venueAddress,
  applicationCity,
  fallbackLocation,
}: {
  venueName?: string | null;
  venueAddress?: string | null;
  applicationCity?: string | null;
  fallbackLocation?: string | null;
}) {
  const destination = [
    venueName?.trim(),
    venueAddress?.trim() || fallbackLocation?.trim(),
    applicationCity?.trim(),
    "Georgia",
  ]
    .filter(Boolean)
    .join(", ");

  if (!venueName?.trim() && !venueAddress?.trim() && !fallbackLocation?.trim()) {
    return null;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
