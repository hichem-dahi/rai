// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";

import { highlightSimilarLines, SimilarityTreeDataProvider } from "./ui/ui.js";

import {
  calculateSimilarity,
  deleteEmbeddings,
  getDb,
  getFiles,
  insertEmbeddings,
  migrate,
  upsertFile,
} from "./pglite/pglite.js";
import { showOutput } from "./ui/ui.js";
import { getFileModifiedDate, splitCodeIntoChunks } from "./utils/utils.js";
import { generateEmbeddings } from "./model/model.js";
import { Chunk, File, SimilarityResult } from "./types/types.js";

// Define the path to the database file
const db = getDb();

const similarityTreeDataProvider = new SimilarityTreeDataProvider();

export async function activate(context: vscode.ExtensionContext) {
  await migrate(db);
  vscode.window.registerTreeDataProvider(
    "similarityExplorer",
    similarityTreeDataProvider
  );

  const disposable = vscode.commands.registerCommand(
    "rai.analyzeSimilarity",
    analyzeAllFiles
  );

  vscode.commands.registerCommand("rai.openFile", openFile);

  context.subscriptions.push(disposable);
}

exports.activate = activate;

function deactivate() {}

let filesDb: File[];

export async function analyzeAllFiles() {
  filesDb = await getFiles(db);
  const files = await vscode.workspace.findFiles(
    "**/*.{js,ts,vue}",
    "**/{node_modules,*.d.ts,*.d.tsx}"
  );

  if (files.length === 0) {
    vscode.window.showInformationMessage("No files found to analyze");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing code similarities",
      cancellable: true,
    },
    async (progress, token) => {
      let processed = 0;
      const total = files.length;

      for (const file of files) {
        // 1. Open the document
        const fileBytes = await vscode.workspace.fs.readFile(
          vscode.Uri.file(file.fsPath)
        );

        const code1 = new TextDecoder("utf-8").decode(fileBytes);

        await analyzeFile(code1, file.fsPath);
        console.log(processed);
        processed++;
        progress.report({
          message: `${processed}/${total} files`,
          increment: 50 / 100,
        });
      }
      console.log("Done !");

      const similarities = await getCalculatedSimilarities();
      similarityTreeDataProvider.refresh(similarities);
      showOutput(similarities);
      vscode.window.showInformationMessage(
        `Analysis complete. Processed ${processed}/${total} files`
      );
    }
  );
}

// Main function to analyze code similarity
export async function analyzeCodeSimilarity(
  code: string,
  file: File,
  workspace: string
) {
  try {
    // 4. Process the file
    const chunkSize = 5;
    const chunks = splitCodeIntoChunks(code, chunkSize);

    // 5. Execute as a single transaction
    await db.transaction(async (tx) => {
      await deleteEmbeddings(tx, file.filepath);
      await upsertFile(tx, file);

      const vectors = await generateEmbeddings(
        chunks,
        chunkSize,
        file.filepath
      );
      await insertEmbeddings(tx, vectors, workspace);
    });

    vscode.window.showInformationMessage(
      `Analyzed ${chunks.length} chunks in ${path.basename(file.filepath)}`
    );
    return true; // Successfully processed
  } catch (error) {
    console.error(`Analysis failed for ${file.filepath}:`, error);
    vscode.window.showErrorMessage(
      `Failed to analyze ${path.basename(file.filepath)}`
    );
    return false; // Processing failed
  }
}

async function getCalculatedSimilarities() {
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) {
    throw new Error("No workspace is currently open in VS Code.");
  }

  const workspace = workspaceUri.fsPath;
  const start = Date.now();
  const similarityResults = await calculateSimilarity(db, workspace);
  showDuration(start, Date.now());

  const mergedPairs = mergePairs(similarityResults);

  return mergedPairs;
}

function showDuration(start: number, end: number) {
  const duration = end - start;
  vscode.window.showInformationMessage(
    `Similarity calculation completed in ${duration}ms`,
    { modal: false }
  );
}

async function openFile(chunk: Chunk) {
  await highlightSimilarLines(chunk);
}

async function analyzeFile(code: string, filepath: string) {
  try {
    // 1. if file doesn't exist or modified then analyze
    const cachedFile = isFileCached(filepath);
    const isAnalyze = !cachedFile || isModified(cachedFile);

    if (isAnalyze) {
      const actualModifiedAt = getFileModifiedDate(filepath) || new Date(0);
      const file: File = { filepath, modified_at: actualModifiedAt };
      const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceUri) {
        throw new Error("No workspace is currently open in VS Code.");
      }

      const workspace = workspaceUri.fsPath;
      await analyzeCodeSimilarity(code, file, workspace);
    }
  } catch (error) {
    console.error(`Error analyzing ${filepath}:`, error);
  }
}

function isModified(file: File) {
  // 2. Check file modification status
  const actualModifiedAt = getFileModifiedDate(file.filepath);
  if (!actualModifiedAt) {
    vscode.window.showErrorMessage(
      `Could not determine modification time for ${file.filepath}`
    );
    return undefined;
  }

  const isModified = actualModifiedAt > file.modified_at;

  if (isModified) {
    vscode.window.showInformationMessage(
      `${path.basename(file.filepath)} unchanged. Using cached embeddings.`
    );
    return true; // File was processed (using cache)
  }
}

function mergePairs(pairs: SimilarityResult[]) {
  const clonePairs: SimilarityResult[] = JSON.parse(JSON.stringify(pairs));
  for (let i = 0; i < clonePairs.length; i++) {
    const list = clonePairs[i];
    if (list.chunks.length <= 1) {
      continue;
    }
    //take from pair2 to list
    for (let j = i + 1; j < clonePairs.length; j++) {
      const pair2 = clonePairs[j];
      if (pair2.chunks.length !== 2) {
        continue;
      }
      if (
        pair2.chunks[0]?.id &&
        list.chunks.map((c) => c.id).includes(pair2.chunks[0]?.id)
      ) {
        const chunk = pair2.chunks.pop();
        if (chunk) {
          list.chunks.push(chunk);
        }
      }
      if (
        pair2.chunks[1]?.id &&
        list.chunks.map((c) => c.id).includes(pair2.chunks[1]?.id)
      ) {
        const chunk = pair2.chunks.shift();
        if (chunk) {
          list.chunks.push(chunk);
        }
      }
    }
  }

  return clonePairs.filter((p) => p.chunks.length > 1);
}

function isFileCached(filepath: string): File | undefined {
  const file = filesDb.find((f) => f.filepath === filepath);
  return file;
}
