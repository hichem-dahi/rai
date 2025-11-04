import { PGlite, Transaction } from "@electric-sql/pglite";
import { NodeFS } from "@electric-sql/pglite/nodefs";
import { vector } from "@electric-sql/pglite/vector";
import { Chunk, File, SimilarityResultQuery } from "../types/types";

// Initialize PG Lite

export function getDb() {
  const db = new PGlite({
    fs: new NodeFS("./database/"),
    extensions: { vector },
  });

  return db;
}

// Create a table to store embeddings
export async function migrate(db: PGlite) {
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await db.exec("DROP TABLE IF EXISTS code_chunks;");
  await db.exec("DROP TABLE IF EXISTS files;");
  await db.query(`
    CREATE TABLE IF NOT EXISTS files (
      filepath TEXT PRIMARY KEY,
      modified_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS code_chunks (
      id SERIAL PRIMARY KEY,
      start_line INT,
      end_line INT,
      chunk TEXT,
      file TEXT REFERENCES files(filepath), -- Foreign key to the file table
      workspace TEXT,
      embedding vector(384) -- Adjust the dimension based on your embeddings
    );
  `);
}

export async function insertEmbeddings(
  db: PGlite | Transaction,
  vectors: Chunk[],
  workspace: string
) {
  if (vectors.length === 0) {
    return;
  }

  try {
    // Prepare the values for the INSERT query
    const values = vectors
      .map(
        (vector) =>
          `(${vector.start_line}, 
          ${vector.end_line}, 
          '${vector.chunk.replace(/'/g, "''")}', 
          '${vector.file.replace(/'/g, "''")}', 
          '${workspace.replace(/'/g, "''")}',
          ARRAY[${vector.embedding.join(", ")}]::vector)`
      )
      .join(",");

    // Execute the INSERT query
    await db.query(`
      INSERT INTO code_chunks (start_line, end_line, chunk, file, workspace, embedding)
      VALUES ${values};
    `);
  } catch (error) {
    console.error("Error inserting embeddings:", error);
    throw error;
  }
}

export async function calculateSimilarity(
  db: PGlite | Transaction,
  workspace: string
) {
  try {
    const result = await db.query<SimilarityResultQuery>(
      `
      WITH potential_pairs AS (
        SELECT
          a.id AS id1,
          b.id AS id2
        FROM code_chunks a
        JOIN code_chunks b ON 
          a.id < b.id
          AND a.workspace = b.workspace
          AND a.workspace = $1
          AND (a.embedding <=> b.embedding) < 0.20
        LIMIT 100000  -- Safety cap
      ),
      filtered_pairs AS MATERIALIZED (
        SELECT
          a.id AS id1,
          a.start_line AS start_line1,
          a.end_line AS end_line1,
          a.chunk AS chunk1,
          a.file AS file1,
          b.id AS id2,
          b.start_line AS start_line2,
          b.end_line AS end_line2,
          b.chunk AS chunk2,
          b.file AS file2,
          1 - (a.embedding <=> b.embedding) AS similarity_raw
        FROM potential_pairs pp
        JOIN code_chunks a ON pp.id1 = a.id
        JOIN code_chunks b ON pp.id2 = b.id
        WHERE 
          (a.file != b.file OR ABS(a.start_line - b.start_line) > 5)
      ),
      ranked_results AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY
              LEAST(file1, file2) || '|' || GREATEST(file1, file2),
              (LEAST(start_line1, start_line2) / 5) * 5
            ORDER BY similarity_raw DESC
          ) AS match_rank
        FROM filtered_pairs
        WHERE similarity_raw > 0.80
      )
      SELECT json_build_object(
        'chunks', json_build_array(
          json_build_object(
            'id', id1,
            'start_line', start_line1,
            'end_line', end_line1,
            'chunk', chunk1,
            'file', file1
          ),
          json_build_object(
            'id', id2,
            'start_line', start_line2,
            'end_line', end_line2,
            'chunk', chunk2,
            'file', file2
          )
        ),
        'similarity', similarity_raw
      ) AS result
      FROM ranked_results
      WHERE match_rank = 1
      ORDER BY similarity_raw DESC
      LIMIT 50;
      `,
      [workspace]
    );

    return result.rows.map((r) => r.result);
  } catch (error: any) {
    console.error("Error in calculateSimilarity:", error);
    throw new Error(`Similarity calculation failed: ${error.message}`);
  }
}

export async function getFiles(db: PGlite, filepath?: string) {
  try {
    let query = `SELECT * FROM files`;
    const params: any[] = [];

    if (filepath) {
      query += ` WHERE filepath = $1`;
      params.push(filepath);
    }

    const result = await db.query<File>(query, params);
    return result.rows;
  } catch (error) {
    console.error("Error in getFiles:", error);
    throw error;
  }
}

export async function deleteEmbeddings(db: PGlite | Transaction, file: string) {
  const query = `
    DELETE FROM code_chunks
    WHERE file = $1
  `;

  await db.query(query, [file]);
}

export async function upsertFile(db: PGlite | Transaction, fileData: File) {
  const query = `
    INSERT INTO files (filepath, modified_at)
    VALUES ($1, $2)
    ON CONFLICT (filepath) 
    DO UPDATE SET modified_at = EXCLUDED.modified_at
  `;

  await db.query(query, [
    fileData.filepath,
    fileData.modified_at.toISOString(), // Convert Date to ISO string for PostgreSQL
  ]);
}
