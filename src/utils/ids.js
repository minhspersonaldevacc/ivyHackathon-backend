import { randomUUID } from "node:crypto";

export function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}
