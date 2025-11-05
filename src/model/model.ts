import type { Chunk } from "../types/types.js";

type FeatureExtractionPipeline =
  import("@xenova/transformers").FeatureExtractionPipeline;

let pipelineInstance: FeatureExtractionPipeline | null = null;
let hg: any = null; // Cache the imported module too

export async function getFeatureExtractionPipeline() {
  if (!hg) {
    // Dynamically import Hugging Face transformers
    hg = await import("@xenova/transformers");
  }

  if (!pipelineInstance) {
    pipelineInstance = (await hg.pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    )) as FeatureExtractionPipeline;
  }

  return pipelineInstance;
}

export async function featureExtraction(texts: string[]) {
  try {
    const pipe = await getFeatureExtractionPipeline();

    // Process all texts efficiently in parallel
    const results = await Promise.all(
      texts.map((text) =>
        pipe(text, {
          pooling: "mean",
          normalize: true, // 💡 helps produce more stable embeddings
        })
      )
    );

    return results.map((r) => r.data);
  } catch (error) {
    console.error("❌ Error in featureExtraction:", error);
    throw error;
  }
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
