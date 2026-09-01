import assert from "node:assert";
import { getVideoCounts } from "../app/api/videos/route";
import { annotations, scenes, keyMoments, transcripts } from "../lib/schema";
import { getDb } from "../lib/db";

type Row = { value?: number; id?: number };
type Db = ReturnType<typeof getDb>;

/**
 * Minimal builder-shaped mock of the drizzle query chain used by
 * getVideoCounts. Rows are keyed by the actual drizzle table reference so
 * `.from(table)` routes to the right fixture. `throwOn` makes an individual
 * table reject so the test can exercise the Promise.allSettled resilience.
 */
function makeDb(fixtures: { table: unknown; rows: Row[] }[], throwOn: unknown[] = []) {
  const byTable = new Map<unknown, Row[]>();
  for (const f of fixtures) byTable.set(f.table, f.rows);
  const throwSet = new Set(throwOn);

  return {
    select(_shape?: unknown) {
      return {
        from(table: unknown) {
          const rows = byTable.get(table) ?? [];
          // A real Promise so `await` settles like the genuine query, with a
          // `limit` method for the transcript query's .where(...).limit(1).
          const p = new Promise<Row[]>((resolve, reject) => {
            if (throwSet.has(table)) reject(new Error("transient count failure"));
            else resolve(rows);
          });
          (p as Promise<Row[]> & { limit(n: number): Row[] }).limit = (n: number) => rows.slice(0, n);
          return { where: () => p };
        },
      };
    },
  };
}

async function main() {
  const db = makeDb([
    { table: annotations, rows: [{ value: 2 }] },
    { table: scenes, rows: [{ value: 3 }] },
    { table: keyMoments, rows: [{ value: 4 }] },
    { table: transcripts, rows: [{ id: 1 }] },
  ]);

  const result = await getVideoCounts(db as unknown as Db, 42);
  assert.deepEqual(result, {
    annotationCount: 2,
    sceneCount: 3,
    momentCount: 4,
    hasTranscript: true,
  });

  const flakyDb = makeDb(
    [
      { table: annotations, rows: [{ value: 1 }] },
      { table: transcripts, rows: [{ id: 1 }] },
    ],
    [scenes, keyMoments],
  );

  const resilient = await getVideoCounts(flakyDb as unknown as Db, 99);
  assert.deepEqual(resilient, {
    annotationCount: 1,
    sceneCount: 0,
    momentCount: 0,
    hasTranscript: true,
  });

  console.log("video count resilience ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});