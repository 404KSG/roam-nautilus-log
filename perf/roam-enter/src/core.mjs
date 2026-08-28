const DEFAULT_WARMUPS = 5;
const DEFAULT_ROUNDS = 5;

const assertNonEmptyString = (value, field) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
};

const assertNonNegativeInteger = (value, field) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value;
};

const assertPositiveInteger = (value, field) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
};

export function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("values must be a non-empty array");
  }
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new RangeError("quantile must be between 0 and 1");
  }

  const sorted = values.map((value) => {
    if (!Number.isFinite(value)) {
      throw new TypeError("values must contain only finite numbers");
    }
    return value;
  }).sort((left, right) => left - right);

  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sorted[lowerIndex] + ((sorted[upperIndex] - sorted[lowerIndex]) * weight);
}

export function buildAbbaSchedule(baselineId, candidateId, rounds) {
  assertNonEmptyString(baselineId, "baselineId");
  assertNonEmptyString(candidateId, "candidateId");
  assertPositiveInteger(rounds, "rounds");

  const schedule = [];
  for (let round = 0; round < rounds; round += 1) {
    if (round % 2 === 0) {
      schedule.push(baselineId, candidateId, candidateId, baselineId);
    } else {
      schedule.push(candidateId, baselineId, baselineId, candidateId);
    }
  }
  return schedule;
}

export function summarizeSamples(samples) {
  if (!Array.isArray(samples)) {
    throw new TypeError("samples must be an array");
  }

  const grouped = new Map();
  for (const sample of samples) {
    if (
      !sample
      || sample.cleanupVerified !== true
      || typeof sample.variant !== "string"
      || !Number.isFinite(sample.appDurationMs)
    ) {
      continue;
    }

    const values = grouped.get(sample.variant) ?? [];
    values.push(sample.appDurationMs);
    grouped.set(sample.variant, values);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([variant, values]) => [variant, {
      count: values.length,
      medianMs: percentile(values, 0.5),
      p75Ms: percentile(values, 0.75),
      minMs: Math.min(...values),
      maxMs: Math.max(...values),
    }]),
  );
}

export function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("config must be an object");
  }

  const config = {
    ...input,
    graphSlug: assertNonEmptyString(input.graphSlug, "graphSlug"),
    pageUid: assertNonEmptyString(input.pageUid, "pageUid"),
    targetUid: assertNonEmptyString(input.targetUid, "targetUid"),
    warmups: assertNonNegativeInteger(input.warmups ?? DEFAULT_WARMUPS, "warmups"),
    rounds: assertPositiveInteger(input.rounds ?? DEFAULT_ROUNDS, "rounds"),
  };

  if (!Array.isArray(input.variants) || input.variants.length !== 2) {
    throw new TypeError("variants must contain exactly two entries");
  }

  const ids = new Set();
  let baselineCount = 0;
  config.variants = input.variants.map((rawVariant, index) => {
    if (!rawVariant || typeof rawVariant !== "object" || Array.isArray(rawVariant)) {
      throw new TypeError(`variants[${index}] must be an object`);
    }

    const variant = {
      ...rawVariant,
      id: assertNonEmptyString(rawVariant.id, `variants[${index}].id`),
      type: assertNonEmptyString(rawVariant.type, `variants[${index}].type`),
    };

    if (ids.has(variant.id)) {
      throw new TypeError(`variant id must be unique: ${variant.id}`);
    }
    ids.add(variant.id);

    if (variant.type === "baseline") {
      baselineCount += 1;
      return variant;
    }

    if (variant.type === "disable-style") {
      variant.styleTextIncludes = assertNonEmptyString(
        rawVariant.styleTextIncludes,
        `variants[${index}].styleTextIncludes`,
      );
      variant.expectedMatches = assertPositiveInteger(
        rawVariant.expectedMatches,
        `variants[${index}].expectedMatches`,
      );
      if (rawVariant.expectedTextHash !== undefined) {
        variant.expectedTextHash = assertNonEmptyString(
          rawVariant.expectedTextHash,
          `variants[${index}].expectedTextHash`,
        );
      }
      if (rawVariant.expectedRuleCount !== undefined) {
        variant.expectedRuleCount = assertNonNegativeInteger(
          rawVariant.expectedRuleCount,
          `variants[${index}].expectedRuleCount`,
        );
      }
      return variant;
    }

    if (variant.type === "inject-roam-css-block") {
      variant.sourceBlockUid = assertNonEmptyString(
        rawVariant.sourceBlockUid,
        `variants[${index}].sourceBlockUid`,
      );
      variant.expectedSourceHash = assertNonEmptyString(
        rawVariant.expectedSourceHash,
        `variants[${index}].expectedSourceHash`,
      );
      variant.styleTextIncludes = assertNonEmptyString(
        rawVariant.styleTextIncludes,
        `variants[${index}].styleTextIncludes`,
      );
      return variant;
    }

    if (variant.type === "exclude-roam-css-block") {
      variant.sourceBlockUid = assertNonEmptyString(
        rawVariant.sourceBlockUid,
        `variants[${index}].sourceBlockUid`,
      );
      variant.expectedSourceHash = assertNonEmptyString(
        rawVariant.expectedSourceHash,
        `variants[${index}].expectedSourceHash`,
      );
      variant.styleTextIncludes = assertNonEmptyString(
        rawVariant.styleTextIncludes,
        `variants[${index}].styleTextIncludes`,
      );
      variant.expectedMatches = assertPositiveInteger(
        rawVariant.expectedMatches,
        `variants[${index}].expectedMatches`,
      );
      return variant;
    }

    throw new TypeError(`unsupported variant type: ${variant.type}`);
  });

  if (baselineCount !== 1) {
    throw new TypeError("variants must contain exactly one baseline");
  }

  return config;
}
