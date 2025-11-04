import * as fs from "fs";

// Function to split code into overlapping chunks
export function splitCodeIntoChunks(code: string, chunkSize: number): string[] {
  const lines = code.split("\n");
  const chunks: string[] = [];
  for (let i = 0; i <= lines.length - chunkSize; i++) {
    const chunk = lines.slice(i, i + chunkSize).join("\n");
    const normalizedChunk = normalizeChunk(chunk);

    chunks.push(normalizedChunk);
  }
  return chunks;
}

function normalizeChunk(chunk: string): string {
  return chunk
    .replace(/\s+/g, " ") // Collapse multiple whitespace to single space
    .replace(/(?<=\>)\s+(?=\<)/g, "") // Remove spaces between HTML tags
    .trim();
}

export function memoryUsage() {
  // Log memory usage
  const memoryUsage = process.memoryUsage();
  console.log(`RSS (Resident Set Size): ${memoryUsage.rss / 1024 / 1024} MB`);
  console.log(`Heap Total: ${memoryUsage.heapTotal / 1024 / 1024} MB`);
  console.log(`Heap Used: ${memoryUsage.heapUsed / 1024 / 1024} MB`);
  console.log(`External: ${memoryUsage.external / 1024 / 1024} MB`);
}

export function getFileModifiedDate(filePath: string): Date | null {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtime; // Returns the last modified date
  } catch (error) {
    console.error(`Error getting file stats for ${filePath}:`, error);
    return null;
  }
}
