/**
 * Separate shared task store for the OddSphere overhaul work.
 *
 * Kept apart from ops-local/todos.json so provider/model overhaul tasks do not
 * interfere with Daniel's general HQ to-do list.
 */

import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "ops-local", "overhaul-todos.json");

export type OverhaulTodo = {
  id: string;
  title: string;
  detail: string;
  status: "todo" | "in_progress" | "blocked" | "done";
  priority: "P0" | "P1" | "P2";
  area: string;
  owner: "unassigned" | "Daniel" | "Codex" | "Claude";
  done: boolean;
};

export function load(): OverhaulTodo[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(todos: OverhaulTodo[]) {
  fs.writeFileSync(FILE, JSON.stringify(todos, null, 2) + "\n");
}

export function add(t: Partial<OverhaulTodo> & { title: string }): OverhaulTodo[] {
  const todos = load();
  todos.unshift({
    id: "o-" + Date.now().toString(36),
    title: t.title,
    detail: t.detail ?? "",
    status: t.status ?? "todo",
    priority: t.priority ?? "P2",
    area: t.area ?? "overhaul",
    owner: t.owner ?? "unassigned",
    done: false,
  });
  save(todos);
  return todos;
}

export function toggle(id: string): OverhaulTodo[] {
  const todos = load();
  const i = todos.findIndex((x) => x.id === id);
  if (i >= 0) {
    todos[i].done = !todos[i].done;
    todos[i].status = todos[i].done ? "done" : "todo";
  }
  save(todos);
  return todos;
}

export function update(id: string, patch: Partial<OverhaulTodo>): OverhaulTodo[] {
  const todos = load();
  const i = todos.findIndex((x) => x.id === id);
  if (i >= 0) todos[i] = { ...todos[i], ...patch };
  save(todos);
  return todos;
}

export function remove(id: string): OverhaulTodo[] {
  const todos = load().filter((x) => x.id !== id);
  save(todos);
  return todos;
}

export function move(id: string, dir: "up" | "down"): OverhaulTodo[] {
  const todos = load();
  const i = todos.findIndex((x) => x.id === id);
  if (i < 0) return todos;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= todos.length) return todos;
  [todos[i], todos[j]] = [todos[j], todos[i]];
  save(todos);
  return todos;
}
