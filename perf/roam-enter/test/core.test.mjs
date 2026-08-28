import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAbbaSchedule,
  percentile,
  summarizeSamples,
  validateConfig,
} from "../src/core.mjs";

test("buildAbbaSchedule interleaves baseline and candidate", () => {
  assert.deepEqual(buildAbbaSchedule("baseline", "without-font", 2), [
    "baseline",
    "without-font",
    "without-font",
    "baseline",
    "without-font",
    "baseline",
    "baseline",
    "without-font",
  ]);
});

test("percentile uses linear interpolation without mutating input", () => {
  const values = [40, 10, 30, 20];
  assert.equal(percentile(values, 0.5), 25);
  assert.equal(percentile(values, 0.75), 32.5);
  assert.deepEqual(values, [40, 10, 30, 20]);
});

test("summarizeSamples groups valid application durations", () => {
  const summary = summarizeSamples([
    { variant: "baseline", appDurationMs: 30, cleanupVerified: true },
    { variant: "baseline", appDurationMs: 10, cleanupVerified: true },
    { variant: "candidate", appDurationMs: 8, cleanupVerified: true },
  ]);

  assert.deepEqual(summary.baseline, {
    count: 2,
    medianMs: 20,
    p75Ms: 25,
    minMs: 10,
    maxMs: 30,
  });
  assert.equal(summary.candidate.medianMs, 8);
});

test("validateConfig rejects ambiguous style matching", () => {
  assert.throws(
    () => validateConfig({
      graphSlug: "EXUBERANTIA",
      pageUid: "page-uid",
      targetUid: "target-uid",
      variants: [
        { id: "baseline", type: "baseline" },
        {
          id: "without-font",
          type: "disable-style",
          styleTextIncludes: "/* Global Font */",
          expectedMatches: 0,
        },
      ],
    }),
    /expectedMatches/,
  );
});

test("validateConfig accepts a safe two-variant benchmark", () => {
  const config = validateConfig({
    graphSlug: "EXUBERANTIA",
    pageUid: "page-uid",
    targetUid: "target-uid",
    warmups: 3,
    rounds: 4,
    variants: [
      { id: "baseline", type: "baseline" },
      {
        id: "without-font",
        type: "disable-style",
        styleTextIncludes: "/* Global Font */",
        expectedMatches: 1,
      },
    ],
  });

  assert.equal(config.warmups, 3);
  assert.equal(config.rounds, 4);
});

test("validateConfig rejects an invalid candidate fingerprint", () => {
  assert.throws(
    () => validateConfig({
      graphSlug: "EXUBERANTIA",
      pageUid: "page-uid",
      targetUid: "target-uid",
      variants: [
        { id: "baseline", type: "baseline" },
        {
          id: "without-font",
          type: "disable-style",
          styleTextIncludes: "/* Global Font */",
          expectedMatches: 1,
          expectedTextHash: "abcd1234",
          expectedRuleCount: -1,
        },
      ],
    }),
    /expectedRuleCount/,
  );
});

test("validateConfig accepts a fingerprinted Roam CSS block injection", () => {
  const config = validateConfig({
    graphSlug: "EXUBERANTIA",
    pageUid: "page-uid",
    targetUid: "target-uid",
    variants: [
      { id: "baseline", type: "baseline" },
      {
        id: "with-font",
        type: "inject-roam-css-block",
        sourceBlockUid: "css-block",
        expectedSourceHash: "abcd1234",
        styleTextIncludes: "/* Global Font */",
      },
    ],
  });

  assert.equal(config.variants[1].sourceBlockUid, "css-block");
  assert.equal(config.variants[1].expectedSourceHash, "abcd1234");
});

test("validateConfig accepts excluding one fingerprinted block from merged Roam CSS", () => {
  const config = validateConfig({
    graphSlug: "EXUBERANTIA",
    pageUid: "page-uid",
    targetUid: "target-uid",
    variants: [
      { id: "baseline", type: "baseline" },
      {
        id: "without-bullet-breathing",
        type: "exclude-roam-css-block",
        sourceBlockUid: "css-block",
        expectedSourceHash: "abcd1234",
        styleTextIncludes: "/* Roam bullet breathing */",
        expectedMatches: 1,
      },
    ],
  });

  assert.equal(config.variants[1].type, "exclude-roam-css-block");
  assert.equal(config.variants[1].expectedMatches, 1);
});
