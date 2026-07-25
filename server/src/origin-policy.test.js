import assert from "node:assert/strict";
import test from "node:test";
import {
  createOriginPolicy,
  DEFAULT_ALLOWED_ORIGINS,
  parseAllowedOrigins,
} from "./origin-policy.js";

test("uses safe application and development origins by default", () => {
  const origins = parseAllowedOrigins();

  for (const origin of DEFAULT_ALLOWED_ORIGINS)
    assert.equal(origins.has(origin), true);
});

test("environment configuration replaces defaults and normalizes values", () => {
  const origins = parseAllowedOrigins(
    " HTTPS://EXAMPLE.COM/ , https://localhost ",
  );

  assert.deepEqual([...origins], ["https://example.com", "https://localhost"]);
  assert.equal(origins.has("http://localhost:5173"), false);
});

test("allows configured browser origins and rejects all other browser origins", () => {
  const isOriginAllowed = createOriginPolicy(
    parseAllowedOrigins("https://game.example"),
  );

  assert.equal(isOriginAllowed("https://game.example"), true);
  assert.equal(isOriginAllowed("https://evil.example"), false);
  assert.equal(isOriginAllowed("https://game.example.evil.test"), false);
});

test("allows clients without an Origin header", () => {
  const isOriginAllowed = createOriginPolicy(
    parseAllowedOrigins("https://game.example"),
  );

  assert.equal(isOriginAllowed(undefined), true);
  assert.equal(isOriginAllowed(""), true);
});
