export const CONTENT_POLICY = {
  documents: {
    allowAnalysis: true,
    allowDiscussion: true,
    allowUniqueSummary: true,
    allowExportedSummary: true,
    allowVerbatimDocumentSharing: false,
    allowRawDocumentReturn: false,
    allowAttachmentDownloadInResponses: false,
  },
  openSourceWeb: {
    allowSharing: true,
    allowQuotation: true,
    allowSummary: true,
    allowExportedUse: true,
  },
  guidance: {
    documentRule:
      "Documents may be analyzed, discussed, and summarized in original wording, but raw documents, full extracted text, screenshots, or verbatim document passages must not be returned to the user.",
    openSourceRule:
      "Information found from public/open-source websites may be discussed, summarized, quoted when appropriate, and included in chatbot responses and exported reports.",
    exportRule:
      "Any compliant summary or analysis produced by the chatbot may also be included in exported reports, so long as it does not reproduce the actual uploaded/private document itself.",
  },
} as const;
