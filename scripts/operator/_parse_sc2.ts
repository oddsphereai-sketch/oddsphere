import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync("/tmp/sc.json","utf8"));
console.log("TOP KEYS:", Object.keys(j));
console.log(JSON.stringify(j, null, 1).slice(0, 1200));
