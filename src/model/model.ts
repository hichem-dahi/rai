import * as vscode from "vscode";
import type {
  DataArray,
  FeatureExtractionPipeline,
} from "@xenova/transformers";
import type { Chunk } from "../types/types.js";
import { getContext } from "../extension.js";

let pipelineInstance: FeatureExtractionPipeline | null = null;
let hg: typeof import("@xenova/transformers"); // Cache the imported module too

export async function getFeatureExtractionPipeline() {
  if (!hg) {
    // Dynamically import Hugging Face transformers
    hg = await import("@xenova/transformers");
  }

  if (!pipelineInstance) {
    pipelineInstance = await hg.pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      {
        cache_dir: vscode.Uri.joinPath(getContext().globalStorageUri, "models")
          .fsPath,
      }
    );
  }

  return pipelineInstance;
}

export async function featureExtraction(
  texts: string[],
  batchSize: number = 10
): Promise<DataArray> {
  const pipe = await getFeatureExtractionPipeline();
  const results: DataArray = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    // Process small batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (text) => {
        const output = await pipe(text, { pooling: "mean", normalize: true });
        return output.data;
      })
    );

    results.push(...batchResults);
  }

  return results;
}

export async function generateEmbeddings(
  chunks: string[],
  chunkSize: number,
  file: string
) {
  try {
    const embeddings = await featureExtraction(chunks);
    const vectors: Chunk[] = chunks.map((chunk, index) => {
      const startLine = index + 1;
      const endLine = startLine + chunkSize - 1;

      return {
        start_line: startLine,
        end_line: endLine,
        chunk,
        file,
        embedding: embeddings[index],
      };
    });

    return vectors;
  } catch (error) {
    console.error("❌ Error in generateEmbeddings:", error);
    throw error;
  }
}

export function cleanup() {
  if (
    pipelineInstance &&
    typeof (pipelineInstance as any).dispose === "function"
  ) {
    try {
      (pipelineInstance as any).dispose();
    } catch (e) {
      console.warn("⚠️ Cleanup failed:", e);
    }
  }
  pipelineInstance = null;
}
