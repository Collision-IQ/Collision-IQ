/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");

const REQUIRED_FIELDS = ["state", "category", "rule", "citation", "sourceName"];

function normalizeVerifiedRegulationSeedRecord(record, index = 0) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Verified regulation record ${index + 1} must be an object.`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      throw new Error(`Verified regulation record ${index + 1} is missing required field: ${field}.`);
    }
  }

  if (/^TBD\b/i.test(record.citation.trim())) {
    throw new Error(`Verified regulation record ${index + 1} citation must not start with TBD.`);
  }

  const sourceUrl = typeof record.sourceUrl === "string" && record.sourceUrl.trim()
    ? record.sourceUrl.trim()
    : typeof record.source_url === "string" && record.source_url.trim()
      ? record.source_url.trim()
      : "";

  if (!sourceUrl) {
    throw new Error(`Verified regulation record ${index + 1} requires sourceUrl or source_url.`);
  }

  const retrievedAt = normalizeRequiredIsoDate(record.retrievedAt ?? record.retrieved_at, index);

  const normalized = {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `${record.state.trim().toLowerCase()}-${record.category.trim()}`,
    state: record.state.trim().toUpperCase(),
    category: record.category.trim(),
    rule: record.rule.trim(),
    citation: record.citation.trim(),
    sourceUrl,
    sourceName: record.sourceName.trim(),
    applicability:
      typeof record.applicability === "string" && record.applicability.trim()
        ? record.applicability.trim()
        : null,
    severity:
      typeof record.severity === "string" && record.severity.trim()
        ? record.severity.trim().toLowerCase()
        : null,
    effectiveDate: normalizeEffectiveDate(record.effectiveDate ?? record.effective_date),
    supersededDate: normalizeOptionalDate(record.supersededDate ?? record.superseded_date),
    sourcePublicationDate: normalizeOptionalDate(
      record.sourcePublicationDate ?? record.source_publication_date
    ),
    retrievedAt,
    citationSource:
      typeof record.citationSource === "string" && record.citationSource.trim()
        ? record.citationSource.trim()
        : typeof record.citation_source === "string" && record.citation_source.trim()
          ? record.citation_source.trim()
          : record.sourceName.trim(),
    verifiedBy:
      typeof record.verifiedBy === "string" && record.verifiedBy.trim()
        ? record.verifiedBy.trim()
        : typeof record.verified_by === "string" && record.verified_by.trim()
          ? record.verified_by.trim()
          : null,
    notes:
      typeof record.notes === "string" && record.notes.trim()
        ? record.notes.trim()
        : null,
  };

  return normalized;
}

function loadVerifiedRegulationSeedRecords(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Verified regulations seed file must contain a JSON array.");
  }

  return parsed.map((record, index) => normalizeVerifiedRegulationSeedRecord(record, index));
}

function normalizeRequiredIsoDate(value, index) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Verified regulation record ${index + 1} requires retrievedAt or retrieved_at.`);
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.trim())) {
    throw new Error(`Verified regulation record ${index + 1} retrievedAt must be an ISO date.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Verified regulation record ${index + 1} retrievedAt must be an ISO date.`);
  }

  return date;
}

function normalizeEffectiveDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Verified regulation effectiveDate/effective_date must be a valid date.");
  }

  return date;
}

function normalizeOptionalDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Verified regulation optional version date must be a valid date.");
  }

  return date;
}

module.exports = {
  loadVerifiedRegulationSeedRecords,
  normalizeVerifiedRegulationSeedRecord,
};
