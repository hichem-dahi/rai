const hg = require("@huggingface/transformers");
import { FeatureExtractionPipeline } from "@huggingface/transformers";
import { Chunk } from "../types/types";

// Create a singleton model instance outside your functions
let pipelineInstance: FeatureExtractionPipeline | null = null;

// Function to get or create the pipeline
export async function getFeatureExtractionPipeline() {
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

    // Process all texts in parallel
    const embeddingPromises = texts.map((text) =>
      pipe(text, {
        pooling: "mean",
      })
    );

    const results = await Promise.all(embeddingPromises);
    return results.map((r) => r.data);
  } catch (error) {
    console.error("Error in featureExtraction:", error);
    throw error;
  }
}

export async function generateEmbeddings(
  chunks: string[],
  chunkSize: number,
  file: string
) {
  try {
    // Get embeddings for all chunks at once (more efficient)
    const embeddings = await featureExtraction(chunks);

    // Create vector objects for each chunk
    const vectors: Chunk[] = chunks.map((chunk, index) => {
      // Calculate line numbers (adjust based on your actual line tracking)
      const startLine = index + 1;
      const endLine = startLine + chunkSize - 1;

      return {
        start_line: startLine,
        end_line: endLine,
        chunk: chunk,
        file: file,
        embedding: new Float32Array(embeddings[index]), // Convert to Float32Array
      };
    });

    return vectors;
  } catch (error) {
    console.error("Error in generateEmbeddings:", error);
    throw error;
  }
}

// Add this to your application shutdown logic
export function cleanup() {
  if (pipelineInstance) {
    // If the pipeline has a dispose or cleanup method, call it
    if (typeof pipelineInstance.dispose === "function") {
      pipelineInstance.dispose();
    }
    pipelineInstance = null;
  }
}
