const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

const INSURANCE_COMPANY_PATTERN =
	/\b(?:State\s*Farm|Allstate|GEICO|Progressive|Liberty\s*Mutual|USAA|Farmers|Nationwide|Travelers|The\s*Hartford|American\s*Family|Erie|[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,4}\s+(?:Insurance|Assurance|Indemnity|Mutual|Casualty|County\s+Mutual|Underwriters|National|General))\b(?!-)/gi;

const STREET_ADDRESS_PATTERN =
	/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/gi;

const STATE_ZIP_PATTERN = /\b([A-Z]{2}\s+)(\d{5}(?:-\d{4})?)\b/g;

const PLATE_FALLBACK_PATTERN =
	/(\b(?:license\s*plate|plate)\s*(?:number|no\.?|#)?\s*[:#-]?\s*)([A-Z0-9][A-Z0-9 -]{1,10})/gi;

type LabelRule = {
	labels: string[];
	replacementToken: string;
	valueTransformer?: (value: string) => string;
	captureValue?: boolean;
};

const LABEL_RULES: LabelRule[] = [
	{
		labels: ["owner", "customer", "insured", "claimant", "policyholder", "adjuster", "appraiser"],
		replacementToken: "PERSON",
		captureValue: true,
	},
	{
		labels: ["name"],
		replacementToken: "PERSON",
		captureValue: true,
	},
	{
		labels: ["address", "street", "street address", "mailing address", "location"],
		replacementToken: "ADDRESS",
	},
	{
		labels: ["insurance company", "insurer"],
		replacementToken: "INSURER",
	},
	{
		labels: ["claim", "claim number", "claim no", "claim #", "claim id"],
		replacementToken: "CLAIM",
	},
	{
		labels: ["policy", "policy number", "policy no", "policy #", "policy id"],
		replacementToken: "POLICY",
	},
	{
		labels: ["license plate", "plate", "plate number"],
		replacementToken: "PLATE",
	},
	{
		labels: ["zip", "zip code", "zipcode", "postal", "postal code"],
		replacementToken: "ZIP",
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
	redacted = redacted.replace(INSURANCE_COMPANY_PATTERN, "[REDACTED_INSURER]");
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
	const escapedLabels = rule.labels.map(escapeRegex).join("|");
	const capturedValues: string[] = [];
	const linePattern = new RegExp(`(^|\\n)(\\s*(?:${escapedLabels})\\s*[:#-]\\s*)([^\\n]+)`, "gi");
	const inlinePattern = new RegExp(`(\\b(?:${escapedLabels})\\s*[:#-]\\s*)([^\\n,;|]+)`, "gi");

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

	if (rule.captureValue && looksLikeNamedPersonValue(trimmedValue)) {
		capturedValues.push(trimmedValue);
	}

	if (rule.valueTransformer) {
		const transformed = rule.valueTransformer(trimmedValue);
		return `${lineStart}${prefix}${transformed}`;
	}

	return `${lineStart}${prefix}[REDACTED_${rule.replacementToken}]`;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

