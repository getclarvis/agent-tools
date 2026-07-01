import { randomBytes } from "node:crypto";

let counter = 0;

export function uniqueToken(): string {
  return `${process.pid}-${Date.now()}-${counter++}-${randomBytes(6).toString("hex")}`;
}
