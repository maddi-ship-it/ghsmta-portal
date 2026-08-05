import { describe, expect, it } from "vitest";

import {
  buildBillingApplicationDetails,
  loadBillingApplicationDetails,
} from "./application-details";

type FakeResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

type FakeRow = Record<string, unknown>;

class FakeSupabaseQuery implements PromiseLike<FakeResult> {
  private filters: Array<{ column: string; values: Set<unknown> }> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private rangeBounds: { from: number; to: number } | null = null;

  constructor(private rows: FakeRow[]) {}

  in(column: string, values: string[]) {
    this.filters.push({ column, values: new Set(values) });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({
      column,
      ascending: options?.ascending ?? true,
    });
    return this;
  }

  range(from: number, to: number) {
    this.rangeBounds = { from, to };
    return this;
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      | ((value: FakeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): FakeResult {
    let data = this.rows.filter((row) =>
      this.filters.every((filter) => filter.values.has(row[filter.column])),
    );
    for (const order of [...this.orders].reverse()) {
      data = [...data].sort((left, right) => {
        const leftValue = String(left[order.column] ?? "");
        const rightValue = String(right[order.column] ?? "");
        return order.ascending
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue);
      });
    }
    const { from, to } = this.rangeBounds ?? { from: 0, to: 999 };
    return { data: data.slice(from, to + 1), error: null };
  }
}

function fakeSupabase(tables: Record<string, FakeRow[]>) {
  return {
    from(table: string) {
      return {
        select() {
          return new FakeSupabaseQuery(tables[table] ?? []);
        },
      };
    },
  };
}

describe("billing application details", () => {
  it("extracts school type and prefers the Acceptd program question for the selected track", () => {
    const details = buildBillingApplicationDetails(
      [
        {
          id: "school-type",
          form_version_id: "form-1",
          question_key: "acceptd_q_137656",
          label: "School Type",
          source_label: "School Type",
          sort_order: 10,
        },
        {
          id: "legacy-track",
          form_version_id: "form-1",
          question_key: "which_track_are_you_registering_for_in_the_2026_27_season",
          label: "Which Track are you registering for in the 2026-27 Season?",
          source_label: null,
          sort_order: 20,
        },
        {
          id: "acceptd-program",
          form_version_id: "form-1",
          question_key: "acceptd_q_163198",
          label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          source_label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          sort_order: 280,
        },
      ],
      [
        {
          application_id: "application-1",
          question_id: "school-type",
          value: "Public (Title I)",
        },
        {
          application_id: "application-1",
          question_id: "legacy-track",
          value: "Mentorship Track",
        },
        {
          application_id: "application-1",
          question_id: "acceptd-program",
          value:
            "Competition Track- A three-person adjudication panel will attend your production.",
        },
      ],
    );

    expect(details.schoolType).toBe("Public (Title I)");
    expect(details.selectedTrack).toBe("Competition Track");
  });

  it("normalizes mentorship track answers even when Acceptd text has a typo", () => {
    const details = buildBillingApplicationDetails(
      [
        {
          id: "acceptd-program",
          form_version_id: "form-1",
          question_key: "acceptd_q_163198",
          label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          source_label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          sort_order: 10,
        },
      ],
      [
        {
          application_id: "application-1",
          question_id: "acceptd-program",
          value: "Mentorship Trak",
        },
      ],
    );

    expect(details.selectedTrack).toBe("Mentorship Track");
  });

  it("loads billing details in bulk without losing imported answers past the default Supabase page size", async () => {
    const applicationId = "application-1";
    const schoolTypeQuestionId = "school-type";
    const trackQuestionId = "acceptd-program";
    const irrelevantAnswers = Array.from({ length: 1100 }, (_, index) => ({
      id: `answer-${index.toString().padStart(4, "0")}`,
      application_id: `irrelevant-application-${index}`,
      question_id: "irrelevant-question",
      value: "Ignore me",
    }));
    const supabase = fakeSupabase({
      application_questions: [
        {
          id: "irrelevant-question",
          form_version_id: "form-1",
          question_key: "favorite_color",
          label: "Favorite color",
          source_label: "Favorite color",
          sort_order: 1,
        },
        {
          id: schoolTypeQuestionId,
          form_version_id: "form-1",
          question_key: "acceptd_q_137656",
          label: "School Type",
          source_label: "School Type",
          sort_order: 130,
        },
        {
          id: trackQuestionId,
          form_version_id: "form-1",
          question_key: "acceptd_q_163198",
          label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          source_label: "Please select the program you are registering for the 2026-2027 GHSMTA season:",
          sort_order: 280,
        },
      ],
      application_answers: [
        ...irrelevantAnswers,
        {
          id: "answer-target-school-type",
          application_id: applicationId,
          question_id: schoolTypeQuestionId,
          value: "Public (Non-Title I)",
        },
        {
          id: "answer-target-track",
          application_id: applicationId,
          question_id: trackQuestionId,
          value: "Competition Track- A three-person adjudication panel will attend your production.",
        },
      ],
    });

    const details = await loadBillingApplicationDetails(supabase, [
      { id: applicationId, form_version_id: "form-1" },
    ]);

    expect(details.get(applicationId)).toMatchObject({
      schoolType: "Public (Non-Title I)",
      selectedTrack: "Competition Track",
    });
  });
});
