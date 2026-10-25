import { describe, expect, it } from "vitest";

import { extractAcceptdPickSix } from "./pick-six";

function answer(value: unknown, id = 156852, label = "Pick 6 categories you'd like to receive feedback on within 3 weeks of your adjudication:") {
  return {
    value,
    relationships: {
      question: {
        data: { id, label },
      },
    },
  };
}

describe("extractAcceptdPickSix", () => {
  it("collects and deduplicates separate Acceptd multiselect answers", () => {
    expect(
      extractAcceptdPickSix({
        answers: [
          answer("Direction"),
          answer("Music Direction"),
          answer("Technical Execution"),
          answer("Scenic"),
          answer("Lighting Design"),
          answer("Sound Design"),
          answer("Direction"),
        ],
      }),
    ).toEqual([
      "Direction",
      "Music Direction",
      "Technical Execution",
      "Scenic",
      "Lighting Design",
      "Sound Design",
    ]);
  });

  it("supports an array value and the Pick 6 label when the question id changes", () => {
    expect(
      extractAcceptdPickSix({
        answers: [answer(["Ensemble", "Costumes"], 999999)],
      }),
    ).toEqual(["Ensemble", "Costumes"]);
  });

  it("ignores other questions in the Pick 6 section", () => {
    expect(
      extractAcceptdPickSix({
        answers: [
          answer(
            1,
            156851,
            "Is your adjudication date on or before February 14th?",
          ),
        ],
      }),
    ).toEqual([]);
  });
});
