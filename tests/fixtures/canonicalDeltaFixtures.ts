import type { CanonicalDeltaFixture } from "../../src/lib/reports/canonicalDeltaFixtureRegistry";
import ro21896 from "./ro21896_expected_delta.json";

/**
 * Registry of adjudicated canonical-delta fixtures consumed by the generic
 * resolver in src/lib/reports/canonicalDeltaFixtureRegistry.ts.
 *
 * Universality directive: this file (under tests/fixtures/) is the ONLY place
 * an RO-specific fixture may be referenced outside test code. Each fixture
 * JSON carries its own `binding` block (document-signature patterns,
 * placeholder ids, roles); the src-side resolver contains no RO, claim, or
 * carrier identifiers. To register a new adjudicated dispute: add its fixture
 * JSON with a `binding` block, import it here, append it to the array.
 * Registry order is resolution order; first activated fixture wins.
 */
export const CANONICAL_DELTA_FIXTURES: CanonicalDeltaFixture[] = [
  ro21896 as unknown as CanonicalDeltaFixture,
];
