import { describe, expect, it } from "vitest";

import {
  cityFromVenueAddress,
  scheduleCityLabel,
  scheduleDirectionsUrl,
} from "./schedule-location";

describe("schedule location display", () => {
  it.each([
    ["1523 Lower Fayetteville Rd, Newnan, GA 30265", "Newnan"],
    ["400 Arnold Mill Rd Woodstock, GA 30188", "Woodstock"],
    ["2530 Mt Zion Pkwy Jonesboro GA 30236", "Jonesboro"],
    ["20 Level Creek Rd Suwanee GA 30024", "Suwanee"],
    ["920 GA-96 Warner Robins, GA", "Warner Robins"],
    ["2600 Hwy 129 N Cleveland, GA 30528", "Cleveland"],
    ["10965 Woodstock Road | Roswell, GA 30075", "Roswell"],
  ])("extracts %s as %s", (address, city) => {
    expect(cityFromVenueAddress(address)).toBe(city);
  });

  it("uses a clear fallback when the city is not present", () => {
    expect(
      scheduleCityLabel({ venueAddress: "1550 Owens Store Road" }),
    ).toBe("City not provided");
  });

  it("falls back to the city from the application", () => {
    expect(
      scheduleCityLabel({
        venueAddress: "1550 Owens Store Road",
        applicationCity: "Canton",
      }),
    ).toBe("Canton");
  });

  it("creates a directions URL without including a user location", () => {
    const url = scheduleDirectionsUrl({
      venueName: "Nixon Centre",
      venueAddress: "1523 Lower Fayetteville Rd, Newnan, GA 30265",
    });

    expect(url).toContain("https://www.google.com/maps/dir/?api=1&destination=");
    expect(url).toContain("Nixon%20Centre");
    expect(url).not.toContain("origin=");
  });
});
