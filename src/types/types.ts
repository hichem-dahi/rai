import { DataArray } from "@xenova/transformers";

export interface SimilarityResult {
  similarity: number; // Average similarity across all pairs
  chunks: Chunk[]; // All chunks in the group
}

export interface Chunk {
  id?: number;
  start_line: number;
  end_line: number;
  chunk: string;
  embedding: number[] | DataArray | Float32Array;
  file: string;
}

export interface File {
  filepath: string;
  modified_at: Date;
}

export interface SimilarityResultQuery {
  result: SimilarityResult;
}
