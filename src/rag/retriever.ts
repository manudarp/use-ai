import type { SearchResult } from "../types.js";

export interface VectorSearchTable {
  vectorSearch(vector: number[]): {
    limit(limit: number): {
      toArray(): Promise<any[]>;
    };
  };
}

export async function retrieve(
  table: VectorSearchTable,
  queryVector: number[],
  topK: number
): Promise<SearchResult[]> {
  const rows = await table
    .vectorSearch(queryVector)
    .limit(topK)
    .toArray();

  return rows.map((row, index) => {
    const distance =
      typeof row._distance === "number"
        ? row._distance
        : 0;

    return {
      id: Number(row.id ?? row._id ?? index),
      text: String(row.text ?? ""),
      source: String(row.source ?? ""),
      chunkIndex: Number(row.chunkIndex ?? 0),
      distance,
      score: 1 - distance
    };
  });
}