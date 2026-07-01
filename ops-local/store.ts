/**
 * Ops dashboard (LOCAL TOOL) — shared to-do store.
 *
 * Persists the to-do list to ops-local/todos.json so BOTH of you can edit it:
 * Daniel via the browser (add / check off / delete), Claude via the file
 * directly. Read fresh on every call so file edits show up without a restart.
 */

import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "ops-local", "todos.json");

export type Todo = {
  id: string; title: string; detail: string;
  status: "todo" | "in_progress" | "blocked" | "done";
  priority: "P0" | "P1" | "P2"; area: string; done: boolean;
};

export function load(): Todo[] {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}
function save(todos: Todo[]) { fs.writeFileSync(FILE, JSON.stringify(todos, null, 2) + "\n"); }

export function add(t: Partial<Todo> & { title: string }): Todo[] {
  const todos = load();
  todos.unshift({
    id: "t-" + Date.now().toString(36),
    title: t.title, detail: t.detail ?? "",
    status: t.status ?? "todo", priority: t.priority ?? "P2",
    area: t.area ?? "general", done: false,
  });
  save(todos); return todos;
}
export function toggle(id: string): Todo[] {
  const todos = load();
  const i = todos.findIndex((x) => x.id === id);
  if (i >= 0) { todos[i].done = !todos[i].done; todos[i].status = todos[i].done ? "done" : "todo"; }
  save(todos); return todos;
}
export function update(id: string, patch: Partial<Todo>): Todo[] {
  const todos = load();
  const i = todos.findIndex((x) => x.id === id);
  if (i >= 0) todos[i] = { ...todos[i], ...patch };
  save(todos); return todos;
}
export function remove(id: string): Todo[] {
  const todos = load().filter((x) => x.id !== id);
  save(todos); return todos;
}
/** Reorder: move a todo up or down one slot. Array order = display/priority order. */
export function move(id: string, dir: "up" | "down"): Todo[] {
  const todos = load();
  const i = todos.findIndex((x) => x.id === id);
  if (i < 0) return todos;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= todos.length) return todos;
  [todos[i], todos[j]] = [todos[j], todos[i]];
  save(todos); return todos;
}
