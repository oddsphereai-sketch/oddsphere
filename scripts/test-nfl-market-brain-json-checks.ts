import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPaths = [
  "lib/db/schema-migration-v45-nfl-market-brain-shadow.sql",
  "lib/db/schema-migration-v46-nfl-market-brain-proof-boundary.sql",
];

for (const migrationPath of migrationPaths) {
  const sql = readFileSync(resolve(process.cwd(), migrationPath), "utf8");
  const checks = extractCheckPredicates(sql);
  const nullableBindings = checks.filter(
    (predicate) =>
      /->>|#>>/.test(predicate) &&
      !/\bIS TRUE\b/.test(predicate) &&
      !/\bIS NOT DISTINCT FROM\b/.test(predicate),
  );

  assert.deepEqual(
    nullableBindings,
    [],
    `${migrationPath} contains JSON relational CHECK bindings that can pass on NULL`,
  );
}

console.log("NFL Market Brain v45/v46 JSON CHECK constraints are explicitly two-valued.");

function extractCheckPredicates(sql: string): string[] {
  const predicates: string[] = [];
  const checkPattern = /\bCHECK\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = checkPattern.exec(sql)) !== null) {
    const expressionStart = checkPattern.lastIndex;
    let depth = 1;
    let quote: "'" | '"' | null = null;
    let index = expressionStart;

    for (; index < sql.length && depth > 0; index += 1) {
      const character = sql[index];
      const next = sql[index + 1];

      if (quote !== null) {
        if (character === quote && next === quote) {
          index += 1;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
      }
    }

    assert.equal(depth, 0, `unterminated CHECK expression near byte ${match.index}`);
    predicates.push(sql.slice(expressionStart, index - 1));
    checkPattern.lastIndex = index;
  }

  return predicates;
}
