import type { EstimateComparisonRow } from "@/types/workspaceTypes";
import {
  dedupeEstimateComparisonRationales,
  formatEstimateComparisonDelta,
  formatEstimateComparisonValue,
  getTopEstimateComparisonHighlights,
} from "./estimateComparisonPresentation";

type Props = {
  rows: EstimateComparisonRow[];
};

export function EstimateComparisonTable({ rows }: Props) {
  if (rows.length === 0) {
    return null;
  }

  const displayRows = dedupeEstimateComparisonRationales(rows);
  const topDifferences = getTopEstimateComparisonHighlights(displayRows);

  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-white/40">
        Estimate Comparison
      </div>

      {topDifferences.length > 0 && (
        <div className="mb-3 rounded-xl bg-white/[0.045] p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-white/40">
            Top Differences
          </div>

          <div className="space-y-1 text-[12px] leading-5 text-white/85">
            {topDifferences.map((difference) => (
              <div key={difference} className="flex gap-2">
                <span className="pt-[2px] text-[#C65A2A]">&bull;</span>
                <span>{difference}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <table className="w-full overflow-hidden rounded-xl border border-white/8 text-xs">
        <thead className="bg-white/[0.045] text-white/52">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Category</th>
            <th className="px-3 py-2 text-left font-medium">Shop</th>
            <th className="px-3 py-2 text-left font-medium">Carrier</th>
            <th className="px-3 py-2 text-left font-medium">Delta</th>
          </tr>
        </thead>

        <tbody>
          {displayRows.map((row) => (
            <tr key={row.id} className="border-t border-white/8 bg-black/[0.14] align-top">
              <td className="px-3 py-2.5 text-white/76">
                <div>{row.category || "Comparison"}</div>
                {(row.operation || row.partName) && (
                  <div className="mt-0.5 text-[11px] leading-4 text-white/43">
                    {[row.operation, row.partName].filter(Boolean).join(" - ")}
                  </div>
                )}
                {row.notes?.[0] && (
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-white/43">
                    {row.notes[0]}
                  </div>
                )}
              </td>

              <td className="px-3 py-2.5 text-green-300/92">
                {formatEstimateComparisonValue(row.lhsValue)}
              </td>

              <td className="px-3 py-2.5 text-red-300/90">
                {formatEstimateComparisonValue(row.rhsValue)}
              </td>

              <td className="px-3 py-2.5 text-white/66">
                {formatEstimateComparisonDelta(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
