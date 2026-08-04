const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

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
	// NOTE: the insurer/carrier name is deliberately NOT redacted — it is a
	// corporation, not personal data, and the claim reports are about an
	// insurance dispute. Redacting it produced "[REDACTED_INSURER]" in the
	// repair-intelligence PDF while the customer report showed the carrier.
	{
		labels: ["claim", "claim number", "claim no", "claim #", "claim id"],
		replacementToken: "CLAIM",
		valueShape: IDENTIFIER_SHAPE,
	},
	{
		labels: ["policy", "policy number", "policy no", "policy #", "policy id"],
		replacementToken: "POLICY",
		valueShape: IDENTIFIER_SHAPE,
	},
	{
		labels: ["license plate", "plate", "plate number"],
		replacementToken: "PLATE",
		valueShape: IDENTIFIER_SHAPE,
	},
	{
		labels: ["zip", "zip code", "zipcode", "postal", "postal code"],
		replacementToken: "ZIP",
		valueShape: IDENTIFIER_SHAPE,
	},
	{
		labels: ["vin", "vehicle vin"],
		replacementToken: "VIN",
		valueTransformer: (value) => maskVinInText(value),
	},
];

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

	// VIN is masked instead of fully removed.
	redacted = maskVinInText(redacted);

	return redacted;
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
	// characters, and taking only one leaves the value starting at ":".
	const separator = "\\s*[:#.-]{1,3}\\s*";
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
	return input.replace(VIN_PATTERN, (vin) => `${vin.slice(0, 11)}******`);
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

