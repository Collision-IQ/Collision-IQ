export type ChatBudgetDocument = {
  id?: string | null;
  filename: string;
  mime?: string | null;
  text?: string | null;
  imageDataUrl?: string | null;
  pageCount?: number | null;
};

export type ChatAttachmentBudgetOmission = {
  id: string | null;
  filename: string;
  mimeType: string;
  reason: string;
  textLength: number;
  hasImageDataUrl: boolean;
};

export type ChatAttachmentBudgetDecision<TDocument extends ChatBudgetDocument> = {
  included: TDocument[];
  retryIncluded: TDocument[];
  omitted: ChatAttachmentBudgetOmission[];
  largeMultimodalRequest: boolean;
  imageCount: number;
  includedImageCount: number;
  reasons: string[];
};

const LARGE_TURN_ATTACHMENT_THRESHOLD = 25;
const LARGE_TURN_IMAGE_THRESHOLD = 12;
const DEFAULT_IMAGE_CAP = 6;
const PHOTO_REVIEW_IMAGE_CAP = 24;
const TEXT_DOCUMENT_CAP = 32;
const SMALL_SUPPORT_TEXT_LIMIT = 18000;

export function budgetChatAttachments<TDocument extends ChatBudgetDocument>(params: {
  documents: TDocument[];
  userMessage: string;
  isImageDocument: (document: TDocument) => boolean;
  isVideoDocument: (document: TDocument) => boolean;
}): ChatAttachmentBudgetDecision<TDocument> {
  const documents = params.documents.filter((document) => !params.isVideoDocument(document));
  const imageDocuments = documents.filter(params.isImageDocument);
  const nonImageDocuments = documents.filter((document) => !params.isImageDocument(document));
  const explicitPhotoReview = isExplicitPhotoReview(params.userMessage);
  const imageCap = explicitPhotoReview ? PHOTO_REVIEW_IMAGE_CAP : DEFAULT_IMAGE_CAP;
  const largeMultimodalRequest =
    documents.length > LARGE_TURN_ATTACHMENT_THRESHOLD ||
    imageDocuments.length > LARGE_TURN_IMAGE_THRESHOLD;
  const reasons = [
    documents.length > LARGE_TURN_ATTACHMENT_THRESHOLD
      ? `turn_attachment_count_${documents.length}_exceeds_${LARGE_TURN_ATTACHMENT_THRESHOLD}`
      : "",
    imageDocuments.length > LARGE_TURN_IMAGE_THRESHOLD
      ? `turn_image_count_${imageDocuments.length}_exceeds_${LARGE_TURN_IMAGE_THRESHOLD}`
      : "",
  ].filter(Boolean);

  if (!largeMultimodalRequest) {
    return {
      included: documents,
      retryIncluded: documents.filter((document) => !params.isImageDocument(document)),
      omitted: params.documents
        .filter(params.isVideoDocument)
        .map((document) => buildOmission(document, "documentation_only_video_not_sent_to_model")),
      largeMultimodalRequest: false,
      imageCount: imageDocuments.length,
      includedImageCount: imageDocuments.length,
      reasons,
    };
  }

  const included = new Map<TDocument, string>();
  const omitted = new Map<TDocument, string>();

  for (const document of rankTextDocuments(nonImageDocuments)) {
    if (included.size >= TEXT_DOCUMENT_CAP && !isEstimateDocument(document)) {
      omitted.set(document, "large_batch_text_document_cap_preserved_estimates_first");
      continue;
    }
    if (isEstimateDocument(document) || isRelevantSmallSupportDocument(document, params.userMessage)) {
      included.set(document, reasonForIncludedText(document));
      continue;
    }
    omitted.set(document, "large_batch_noncritical_text_document_omitted_from_first_pass");
  }

  for (const document of rankImageDocuments(imageDocuments)) {
    const includedImageCount = [...included.keys()].filter(params.isImageDocument).length;
    if (includedImageCount < imageCap) {
      included.set(document, explicitPhotoReview ? "explicit_photo_review_representative_image" : "representative_image_cap");
      continue;
    }
    omitted.set(
      document,
      isGenericPhotoFilename(document.filename)
        ? "large_batch_generic_or_repetitive_photo_omitted_from_first_pass"
        : "large_batch_image_cap_omitted_from_first_pass"
    );
  }

  for (const document of params.documents.filter(params.isVideoDocument)) {
    omitted.set(document, "documentation_only_video_not_sent_to_model");
  }

  const includedDocuments = documents.filter((document) => included.has(document));
  const retryIncluded = includedDocuments.filter((document) => !params.isImageDocument(document));

  return {
    included: includedDocuments,
    retryIncluded,
    omitted: [...omitted.entries()].map(([document, reason]) => buildOmission(document, reason)),
    largeMultimodalRequest,
    imageCount: imageDocuments.length,
    includedImageCount: includedDocuments.filter(params.isImageDocument).length,
    reasons,
  };
}

export function buildChatAttachmentOmissionNotice(
  omitted: ChatAttachmentBudgetOmission[],
  maxItems = 20
): string {
  const imageOmissions = omitted.filter((item) => item.mimeType.startsWith("image/") || item.hasImageDataUrl);
  if (imageOmissions.length === 0) return "";

  const listed = imageOmissions
    .slice(0, maxItems)
    .map((item) => `- ${item.filename}: ${item.reason}`)
    .join("\n");
  const remaining = imageOmissions.length > maxItems
    ? `\n- ${imageOmissions.length - maxItems} additional image/photo attachment(s) omitted from the first-pass model request.`
    : "";

  return [
    "First-pass image/photo budgeting:",
    "The files listed below remain in the file ledger, but their image contents were not reviewed in this first-pass model request. Do not claim these omitted photos were reviewed; refer to them only as omitted/ledger-only unless a targeted photo review is run.",
    listed + remaining,
  ].join("\n");
}

function rankTextDocuments<TDocument extends ChatBudgetDocument>(documents: TDocument[]) {
  return [...documents].sort((a, b) => scoreTextDocument(b) - scoreTextDocument(a));
}

function rankImageDocuments<TDocument extends ChatBudgetDocument>(documents: TDocument[]) {
  return [...documents].sort((a, b) => scoreImageDocument(b) - scoreImageDocument(a));
}

function scoreTextDocument(document: ChatBudgetDocument) {
  let score = 0;
  if (isEstimateDocument(document)) score += 1000;
  if (isCarrierOrShopEstimate(document)) score += 200;
  if (isRelevantSmallSupportDocument(document, "")) score += 100;
  if ((document.text?.length ?? 0) > 0) score += 20;
  if ((document.text?.length ?? 0) <= SMALL_SUPPORT_TEXT_LIMIT) score += 10;
  return score;
}

function scoreImageDocument(document: ChatBudgetDocument) {
  let score = 0;
  if (!isGenericPhotoFilename(document.filename)) score += 50;
  if (/invoice|scan|calib|measure|frame|structural|teardown|supp|estimate|carrier|shop/i.test(document.filename)) {
    score += 25;
  }
  if ((document.text?.trim().length ?? 0) > 0) score += 10;
  return score;
}

function reasonForIncludedText(document: ChatBudgetDocument) {
  if (isCarrierOrShopEstimate(document)) return "primary_carrier_or_shop_estimate_preserved";
  if (isEstimateDocument(document)) return "primary_estimate_preserved";
  return "small_relevant_support_document_preserved";
}

function isEstimateDocument(document: ChatBudgetDocument) {
  const name = document.filename || "";
  const mime = document.mime || "";
  const haystack = `${name}\n${document.text ?? ""}`;
  return (
    /pdf/i.test(mime) &&
    /\b(estimate|supp(?:lement)?|sor\d*|carrier|shop|appraisal|repair\s*order|workfile)\b/i.test(haystack)
  );
}

function isCarrierOrShopEstimate(document: ChatBudgetDocument) {
  return /\b(carrier|shop|insurer|supp(?:lement)?|sor\d*)\b/i.test(`${document.filename}\n${document.text ?? ""}`) &&
    isEstimateDocument(document);
}

function isRelevantSmallSupportDocument(document: ChatBudgetDocument, userMessage: string) {
  const textLength = document.text?.length ?? 0;
  if (textLength > SMALL_SUPPORT_TEXT_LIMIT) return false;
  const haystack = `${document.filename}\n${document.text ?? ""}\n${userMessage}`;
  return /\b(invoice|support|scan|calib(?:ration)?|measure(?:ment)?|frame|structural|alignment|adas|teardown|receipt|procedure|oem)\b/i.test(haystack);
}

function isExplicitPhotoReview(userMessage: string) {
  return /\b(photo|photos|image|images|picture|pictures|visible damage|damage photo|review photos|look at)\b/i.test(userMessage);
}

function isGenericPhotoFilename(filename: string) {
  return /^(?:photo|image|img|picture|pxl|dsc|screenshot)[-_ ]?\d+|\bphoto\s*\d+\b/i.test(filename.trim());
}

function buildOmission(document: ChatBudgetDocument, reason: string): ChatAttachmentBudgetOmission {
  return {
    id: document.id ?? null,
    filename: document.filename,
    mimeType: document.mime || "unknown",
    reason,
    textLength: document.text?.length ?? 0,
    hasImageDataUrl: Boolean(document.imageDataUrl),
  };
}
