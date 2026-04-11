import { describe, expect, test } from "bun:test";
import { formatReply } from "../footer";

describe("formatReply", () => {
  test("joins text and footer with two newlines", () => {
    expect(formatReply("olá mundo", "IA 😜")).toBe("olá mundo\n\nIA 😜");
  });

  test("trims trailing whitespace from text", () => {
    expect(formatReply("olá\n", "IA 😜")).toBe("olá\n\nIA 😜");
  });

  test("handles empty footer gracefully", () => {
    expect(formatReply("olá", "")).toBe("olá");
  });
});
