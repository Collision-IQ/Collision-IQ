/**
 * EXPORT REDACTION POLICY.
 *
 * Inside the system the full record is intact. Everything that LEAVES the
 * system is redacted here: personal identity, the last 8 of the VIN, and
 * insurance information.
 *
 * A word boundary is useless for finding a VIN in an estimate. CCC prints
 * "VIN:5YJ3E1EA6PF691987Interior Color:WHITE" — the VIN is welded to the next
 * label, so /\b[A-Z0-9]{17}\b/ matches NOTHING and the VIN exports in full.
 * Scan a sliding 17-character window instead and accept on the ISO 3779 check
 * digit, the same rule the identity gate uses.
 */
import { COMMON_INSURERS } from "../ai/extractors/extractEstimateFacts";

const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;
/** Characters of the VIN that survive export. 17 - 8 = 9. */
const VIN_VISIBLE_PREFIX = 9;

const STREET_ADDRESS_PATTERN =
	/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/gi;

const STATE_ZIP_PATTERN = /\b([A-Z]{2}\s+)(\d{5}(?:-\d{4})?)\b/g;

const PLATE_FALLBACK_PATTERN =
	/(\b(?:license\s*plate|plate)\s*(?:number|no\.?|#)?\s*[:#-]?\s*)([A-Z0-9][A-Z0-9 -]{1,10})/gi;

/**
 * A labelled value is only redacted when it has the SHAPE of the datum its
 * label claims. Without this, "…estimates exist for this claim: the shop's
 * estimate at $26,006.59…" matched the claim rule, the value group ate
 * "the shop's estimate at $26" up to the comma INSIDE the dollar figure, and a
 * vehicle owner read "[REDACTED_CLAIM], 006.59" in the sentence stating the
 * gap. The label words here — claim, owner, location, plate — are ordinary
 * English, so "text after the label" is not a value; a shape is.
 *
 * Only the matched span is replaced. Whatever follows it is prose and survives.
 */
type ValueShape = {
	pattern: RegExp;
	/** Extra shape test on the matched span. */
	accept?: (span: string) => boolean;
};

/** A carrier name: capitalised words, no digits. "Insurance"/"Company" stay in
 *  the span so "American Family Insurance" redacts whole. */
const INSURER_SHAPE: ValueShape = {
	pattern: /^[A-Z][A-Za-z&'.-]*(?:\s+[A-Z][A-Za-z&'.-]*){0,4}/,
	accept: (span) => !/\d/.test(span) && !/[$£€]/.test(span),
};

const HAS_DIGIT = /\d/;
const HAS_CURRENCY = /[$£€]/;

/** Claim, policy, plate, ZIP: one alphanumeric token carrying a numeric core.
 *  Never a clause — no spaces, and a bare English word cannot qualify. */
const IDENTIFIER_SHAPE: ValueShape = {
	pattern: /^[A-Za-z0-9][A-Za-z0-9._/-]{2,}/,
	accept: (span) => HAS_DIGIT.test(span) && !HAS_CURRENCY.test(span),
};

/** A person's name: up to four name tokens, no digits, no currency. */
const PERSON_SHAPE: ValueShape = {
	pattern: /^[A-Z][A-Za-z'’.-]*(?:[,]?\s+[A-Za-z][A-Za-z'’.-]*){0,3}/,
	accept: (span) => !HAS_DIGIT.test(span) && !HAS_CURRENCY.test(span),
};

/** A street address begins with a house number. The generic
 *  STREET_ADDRESS_PATTERN below still catches unlabelled ones. */
const ADDRESS_SHAPE: ValueShape = {
	pattern: /^\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}/,
	accept: (span) => !HAS_CURRENCY.test(span),
};

type LabelRule = {
	labels: string[];
	replacementToken: string;
	valueTransformer?: (value: string) => string;
	captureValue?: boolean;
	/** Omit only for rules whose value is transformed rather than replaced. */
	valueShape?: ValueShape;
	/**
	 * Allow "." in the label/value separator. Needed for identifier labels
	 * whose printed form ends in an abbreviation ("Claim No. 0122…"). Off for
	 * prose-shaped values: with the period allowed, the sentence boundary in
	 * "…for the vehicle owner. Final repair decisions should…" parsed as label
	 * "owner" + value "Final repair decisions should", which was then captured
	 * and blanket-replaced with [REDACTED_PERSON] across the whole document.
	 */
	allowPeriodSeparator?: boolean;
};

const LABEL_RULES: LabelRule[] = [
	{
		labels: ["owner", "customer", "insured", "claimant", "policyholder", "adjuster", "appraiser"],
		replacementToken: "PERSON",
		captureValue: true,
		valueShape: PERSON_SHAPE,
	},
	{
		labels: ["name"],
		replacementToken: "PERSON",
		captureValue: true,
		valueShape: PERSON_SHAPE,
	},
	{
		labels: ["address", "street", "street address", "mailing address", "location"],
		replacementToken: "ADDRESS",
		valueShape: ADDRESS_SHAPE,
	},
	// The insurer WAS deliberately left in place — a company is not personal
	// data, and the reports are about an insurance dispute. That is reversed by
	// an explicit instruction: insurance information is redacted on export.
	// Redacting it everywhere also removes the inconsistency the old note
	// described, where one PDF showed "[REDACTED_INSURER]" and another showed
	// the carrier.
	{
		labels: ["insurer", "insurance company", "insurance carrier", "carrier", "insurance"],
		replacementToken: "INSURER",
		valueShape: INSURER_SHAPE,
	},
	{
		labels: ["claim", "claim number", "claim no", "claim #", "claim id"],
		replacementToken: "CLAIM",
		valueShape: IDENTIFIER_SHAPE,
		allowPeriodSeparator: true,
	},
	{
		labels: ["policy", "policy number", "policy no", "policy #", "policy id"],
		replacementToken: "POLICY",
		valueShape: IDENTIFIER_SHAPE,
		allowPeriodSeparator: true,
	},
	{
		labels: ["license plate", "plate", "plate number"],
		replacementToken: "PLATE",
		valueShape: IDENTIFIER_SHAPE,
		allowPeriodSeparator: true,
	},
	{
		labels: ["zip", "zip code", "zipcode", "postal", "postal code"],
		replacementToken: "ZIP",
		valueShape: IDENTIFIER_SHAPE,
		allowPeriodSeparator: true,
	},
	{
		labels: ["vin", "vehicle vin"],
		replacementToken: "VIN",
		valueTransformer: (value) => maskVinForExport(value),
		allowPeriodSeparator: true,
	},
];

/**
 * VIN masking for a LABELED context — a value the document itself calls a VIN.
 * Shape-based, not check-digit-based: the check digit protects the prose
 * scanner from mangling part numbers, but here the label already established
 * what the value is, and a VIN that fails validation (an OCR misread, a
 * typo'd record) still identifies the vehicle and must not leave the system
 * intact. The last eight never print; the first nine identify the model year
 * and plant without identifying the vehicle.
 */
export function maskVinForExport(value: string): string {
	return value.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (token) =>
		HAS_DIGIT.test(token) && /[A-HJ-NPR-Z]/.test(token)
			? token.slice(0, VIN_VISIBLE_PREFIX) + "*".repeat(17 - VIN_VISIBLE_PREFIX)
			: token
	);
}

export function redactDownloadContent(text: string): string {
	if (!text) return "";

	let redacted = text;
	const capturedValues = new Set<string>();

	// Label-aware redaction first.
	for (const rule of LABEL_RULES) {
		const result = applyLabelRule(redacted, rule);
		redacted = result.text;
		for (const value of result.capturedValues) {
			capturedValues.add(value);
		}
	}

	redacted = redactCapturedValues(redacted, capturedValues);

	// Generic fallback patterns second.
	redacted = redacted.replace(STREET_ADDRESS_PATTERN, "[REDACTED_ADDRESS]");
	redacted = redacted.replace(STATE_ZIP_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED_ZIP]`);
	redacted = redacted.replace(PLATE_FALLBACK_PATTERN, (_match, prefix: string) => {
		return `${prefix}[REDACTED_PLATE]`;
	});

	// A carrier is named in prose far more often than after an "Insurer:" label
	// ("USAA's estimate at $22,886.68"), so sweep the known-carrier vocabulary
	// too. It is the same list the extractors use — one vocabulary, not two.
	redacted = redactKnownCarriers(redacted);

	// VIN keeps its first 9 characters; the last 8 never leave the system.
	redacted = maskVinInText(redacted);

	return redacted;
}

/** Replace any carrier from the shared vocabulary, longest name first so
 *  "American Family Insurance" is not left as "[REDACTED_INSURER] Insurance". */
export function redactInsurersForExport(input: string): string {
	return redactKnownCarriers(input);
}

function redactKnownCarriers(input: string): string {
	let output = input;
	for (const carrier of [...COMMON_INSURERS].sort((a, b) => b.length - a.length)) {
		output = output.replace(
			new RegExp(`\\b${escapeRegex(carrier)}(?:'s)?(?:\\s+(?:Insurance|Mutual|Group|Company|Co\\.?))?\\b`, "gi"),
			"[REDACTED_INSURER]"
		);
	}
	return output;
}

function applyLabelRule(input: string, rule: LabelRule): { text: string; capturedValues: string[] } {
	// Longest label first: alternation is first-match-wins, so an unsorted list
	// lets "claim" win over "claim no" and the separator match then fails against
	// "Claim No. 0122…" — which never redacted at all.
	const escapedLabels = [...rule.labels]
		.sort((a, b) => b.length - a.length)
		.map(escapeRegex)
		.join("|");
	const capturedValues: string[] = [];
	// Separators come in runs and include the period of "No." — "Claim #:" is two
	// characters, and taking only one leaves the value starting at ":". The
	// period is opt-in per rule; see LabelRule.allowPeriodSeparator.
	const separator = rule.allowPeriodSeparator ? "\\s*[:#.-]{1,3}\\s*" : "\\s*[:#-]{1,3}\\s*";
	const linePattern = new RegExp(`(^|\\n)(\\s*(?:${escapedLabels})${separator})([^\\n]+)`, "gi");
	const inlinePattern = new RegExp(`(\\b(?:${escapedLabels})${separator})([^\\n,;|]+)`, "gi");

	let output = input.replace(linePattern, (match, lineStart: string, prefix: string, value: string) => {
		return replaceLabeledValue(match, lineStart, prefix, value, rule, capturedValues);
	});

	output = output.replace(
		inlinePattern,
		(match, prefix: string, value: string, offset: number, source: string) => {
			if (offset > 0) {
				const precedingChar = source[offset - 1];
				if (precedingChar && !/\s|[([{;,]/.test(precedingChar)) {
					return match;
				}
			}

			const suffixIndex = offset + match.length;
			const suffixChar = source[suffixIndex];
			if (suffixChar === "-") {
				return match;
			}

			return replaceLabeledValue(match, "", prefix, value, rule, capturedValues);
		}
	);

	return { text: output, capturedValues };
}

function maskVinInText(input: string): string {
	let output = "";
	let index = 0;
	while (index < input.length) {
		const window = input.slice(index, index + 17);
		const upper = window.toUpperCase();
		if (window.length === 17 && VIN_ALPHABET.test(upper) && isExportVin(upper)) {
			output += window.slice(0, VIN_VISIBLE_PREFIX) + "*".repeat(17 - VIN_VISIBLE_PREFIX);
			index += 17;
			continue;
		}
		output += input[index];
		index += 1;
	}
	return output;
}

const VIN_TRANSLITERATION: Record<string, number> = {
	A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
	J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
	S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** ISO 3779 check digit. Without it a sliding window would mangle any 17
 *  characters that happen to sit together — part numbers, hashes, ids. */
function isExportVin(vin: string): boolean {
	// A run of digits is a claim or policy number, not a VIN — about one in
	// eleven random 17-character windows passes the check digit, and masking the
	// middle of a claim number would corrupt it rather than protect it.
	if ((vin.match(/[A-Z]/g) ?? []).length < 3) return false;
	let sum = 0;
	for (let i = 0; i < 17; i += 1) {
		const char = vin[i];
		const value = /\d/.test(char) ? Number(char) : VIN_TRANSLITERATION[char];
		if (value === undefined) return false;
		sum += value * VIN_WEIGHTS[i];
	}
	const remainder = sum % 11;
	return vin[8] === (remainder === 10 ? "X" : String(remainder));
}

function redactCapturedValues(input: string, values: Set<string>): string {
	const sortedValues = [...values]
		.map((value) => value.trim())
		.filter((value) => value.length >= 3)
		.sort((a, b) => b.length - a.length);

	let output = input;
	for (const value of sortedValues) {
		const pattern = new RegExp(escapeRegex(value), "gi");
		output = output.replace(pattern, "[REDACTED_PERSON]");
	}

	return output;
}

function looksLikeNamedPersonValue(value: string): boolean {
	return /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4}$/.test(value);
}

function replaceLabeledValue(
	match: string,
	lineStart: string,
	prefix: string,
	value: string,
	rule: LabelRule,
	capturedValues: string[]
): string {
	const trimmedValue = value.trim();

	if (!trimmedValue || trimmedValue.startsWith("[REDACTED_")) {
		return match;
	}

	if (rule.valueTransformer) {
		if (rule.captureValue && looksLikeNamedPersonValue(trimmedValue)) {
			capturedValues.push(trimmedValue);
		}
		return `${lineStart}${prefix}${rule.valueTransformer(trimmedValue)}`;
	}

	// Redact only the span that HAS THE SHAPE of the datum. Anything after it is
	// prose and must survive intact — that is the whole defect: "claim: the
	// shop's estimate at $26,006.59" is a sentence, not a claim number.
	const span = rule.valueShape ? sensitiveSpan(trimmedValue, rule.valueShape) : trimmedValue;
	if (!span) {
		return match;
	}

	if (rule.captureValue && looksLikeNamedPersonValue(span)) {
		capturedValues.push(span);
	}

	const tail = trimmedValue.slice(span.length);
	return `${lineStart}${prefix}[REDACTED_${rule.replacementToken}]${tail}`;
}

/** The leading portion of `value` matching `shape`, or null when the value is
 *  not that kind of datum at all. */
function sensitiveSpan(value: string, shape: ValueShape): string | null {
	const matched = shape.pattern.exec(value);
	if (!matched) return null;
	const span = matched[0];
	if (shape.accept && !shape.accept(span)) return null;
	return span;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

