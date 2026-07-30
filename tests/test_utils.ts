import { formatTimestamp, shortId, parseTimestamp } from "../src/lib/utils";

// Simple assertion helper
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

// Tests
function testFormatTimestamp() {
  assert(formatTimestamp(0) === "0:00", "0ms → 0:00");
  assert(formatTimestamp(30000) === "0:30", "30000ms → 0:30");
  assert(formatTimestamp(60000) === "1:00", "60000ms → 1:00");
  assert(formatTimestamp(3600000) === "1:00:00", "3600000ms → 1:00:00");
  assert(formatTimestamp(3661000) === "1:01:01", "3661000ms → 1:01:01");
  assert(formatTimestamp(-1) === "0:00", "negative → 0:00");
  console.log("  formatTimestamp: all passed");
}

function testShortId() {
  const id = shortId("vid");
  assert(id.startsWith("vid_"), "prefix is vid_");
  assert(id.length === 12, "length is 12 (4 + 8)");
  console.log("  shortId: all passed");
}

function testParseTimestamp() {
  assert(parseTimestamp("0:30") === 30000, "0:30 → 30000ms");
  assert(parseTimestamp("1:00") === 60000, "1:00 → 60000ms");
  assert(parseTimestamp("1:01:01") === 3661000, "1:01:01 → 3661000ms");
  console.log("  parseTimestamp: all passed");
}

// Run
console.log("\nRunning utils tests:");
testFormatTimestamp();
testShortId();
testParseTimestamp();
console.log("\nAll tests passed! ✓");
