import { PGlite } from "@electric-sql/pglite";
import { it, expect } from "vitest";
import { bsMonthRange, nepalMidnight } from "@/domain/localization/calendar";
it("BS month boundaries select exactly the matching PostgreSQL timestamptz records", async () => {
  const db = new PGlite();
  try {
    const range = bsMonthRange(2083, 6);
    const { rows } = await db.query<{ id: string }>(
      `select id from (values ('before',$1::timestamptz-interval '1 millisecond'),('start',$1::timestamptz),('last',$2::timestamptz-interval '1 millisecond'),('next',$2::timestamptz)) as ledger(id,created_at) where created_at >= $1::timestamptz and created_at < $2::timestamptz order by created_at`,
      [range.start, range.end],
    );
    expect(rows.map((r) => r.id)).toEqual(["start", "last"]);
    const result = await db.query<{ start_date: string; end_date: string }>(
      "select to_char($1::timestamptz at time zone 'Asia/Kathmandu','YYYY-MM-DD') as start_date,to_char($2::timestamptz at time zone 'Asia/Kathmandu','YYYY-MM-DD') as end_date",
      [range.start, range.end],
    );
    expect(result.rows[0]).toEqual({
      start_date: range.from,
      end_date: "2026-10-18",
    });
    for (const date of ["1985-12-31", "1986-01-01", "1986-01-02"]) {
      const boundary = await db.query<{ instant: Date }>(
        "select $1::date::timestamp at time zone 'Asia/Kathmandu' as instant",
        [date],
      );
      expect(boundary.rows[0]!.instant.toISOString()).toBe(nepalMidnight(date));
    }
  } finally {
    await db.close();
  }
}, 30000);
