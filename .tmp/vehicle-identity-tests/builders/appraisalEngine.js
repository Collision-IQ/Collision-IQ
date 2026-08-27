"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectAppraisalOpportunity = detectAppraisalOpportunity;
function detectAppraisalOpportunity(result) {
    const highSeverity = "findings" in result
        ? result.findings.filter((finding) => finding.severity === "high")
        : result.issues.filter((issue) => issue.severity === "high");
    const missingCore = "findings" in result
        ? result.findings.filter((finding) => finding.category === "not_detected" &&
            (finding.title.toLowerCase().includes("calibration") ||
                finding.title.toLowerCase().includes("scan") ||
                finding.title.toLowerCase().includes("structural")))
        : result.issues.filter((issue) => Boolean(issue.missingOperation) &&
            (issue.title.toLowerCase().includes("calibration") ||
                issue.title.toLowerCase().includes("scan") ||
                issue.title.toLowerCase().includes("structural")));
    const reasons = [];
    if (missingCore.length >= 2) {
        reasons.push("Multiple critical repair functions are not clearly represented");
    }
    if (highSeverity.length >= 3) {
        reasons.push("There are multiple high-severity repair gaps affecting outcome or safety");
    }
    const shouldRecommend = reasons.length > 0;
    return {
        shouldRecommend,
        reasons,
        confidence: reasons.length >= 2 ? "high" : reasons.length === 1 ? "medium" : "low",
    };
}
