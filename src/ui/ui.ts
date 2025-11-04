import * as vscode from "vscode";
import * as fs from "fs";

import { Chunk, SimilarityResult } from "../types/types";

export class SimilarityTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly result: SimilarityResult,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode
      .TreeItemCollapsibleState.Collapsed
  ) {
    super(label, collapsibleState);
    const { chunks, similarity } = result;

    // Set description to show similarity score
    this.description = `${(Number(similarity) * 100).toFixed(2)}%`;

    // Enhanced tooltip with file information
    this.tooltip =
      `Similarity: ${(Number(similarity) * 100).toFixed(2)}%\n` +
      `File 1: ${chunks[0]?.file ?? "Unknown"} (Line ${
        chunks[0]?.start_line ?? "?"
      })\n` +
      `File 2: ${chunks[1]?.file || "Unknown"} (Line ${
        chunks[1]?.start_line ?? "?"
      })`;

    // Add an icon to make it look like a button
    this.iconPath = new vscode.ThemeIcon("compare-changes");

    // Add context value for menu contributions
    this.contextValue = "similarityItem";
  }
}

export class FileLocationItem extends vscode.TreeItem {
  constructor(
    public readonly chunk: Chunk,
    public readonly codePreview: string // Add code preview
  ) {
    super(
      `${chunk.file.split("/").pop()}:${chunk.start_line} - ${chunk.end_line}`,
      vscode.TreeItemCollapsibleState.None
    );

    // Style the item
    this.iconPath = new vscode.ThemeIcon("file-code");

    // Add command to open the file
    this.command = {
      command: "rai.openFile",
      title: "Open File",
      arguments: [chunk],
    };

    // Add code preview to the description
    this.description = codePreview;

    // Optionally, add the full code preview to the tooltip
    this.tooltip = `Click to open ${chunk.file} at line ${chunk.start_line}\n\nCode Preview:\n${codePreview}`;
  }
}

export class SimilarityTreeDataProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined
  > = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> =
    this._onDidChangeTreeData.event;

  private similarities: SimilarityResult[] = [];

  refresh(similarities: SimilarityResult[]): void {
    this.similarities = similarities;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (!element) {
      // Root level: Show all similarities
      return Promise.resolve(
        this.similarities.map(
          (result) => new SimilarityTreeItem(`Similar Code Found`, result)
        )
      );
    } else if (element instanceof SimilarityTreeItem) {
      // Show file locations for this similarity
      const { chunks } = element.result;
      
      const children: vscode.TreeItem[] = [];
      for (const chunk of chunks) {
        if (chunk.file && chunk.start_line) {
          const codePreview = this.getCodePreview(chunk.file, chunk.start_line);
          children.push(new FileLocationItem(chunk, codePreview));
        }
      }

      return Promise.resolve(children);
    }

    return Promise.resolve([]);
  }

  private getCodePreview(file: string, line: number): string {
    try {
      // Read the file content
      const fileContent = fs.readFileSync(file, "utf-8");
      const lines = fileContent.split("\n");

      // Get the code snippet around the specified line
      const start = Math.max(0, line); // Show 1 line before
      const end = Math.min(lines.length, line + 3); // Show 1 line after
      const snippet = lines.slice(start, end).join("\n");

      return snippet;
    } catch (error) {
      console.error(`Error reading file ${file}:`, error);
      return "Code preview unavailable.";
    }
  }
}

export function showOutput(similarityResults: SimilarityResult[]) {
  // Display results
  if (similarityResults.length > 0) {
    const outputChannel = vscode.window.createOutputChannel(
      "Code Similarity Results"
    );
    outputChannel.show();
    similarityResults.forEach((result, index) => {
      outputChannel.appendLine(
        `Similarity ${index + 1}: ${Number(result.similarity).toFixed(2)}`
      );
      outputChannel.appendLine(`Chunk 1:\n${result.chunks[0]?.chunk ?? 'No chunk available'}`);
      outputChannel.appendLine(`Chunk 2:\n${result.chunks[1]?.chunk ?? 'No chunk available'}`);
      outputChannel.appendLine("---");
    });
  } else {
    vscode.window.showInformationMessage(
      "No similar code chunks found (similarity > 0.90)."
    );
  }
}

// Track active decoration types per file
const fileDecorations = new Map<string, vscode.TextEditorDecorationType>();

export async function highlightSimilarLines(chunk: Chunk) {
  try {
    const document = await openFile(chunk.file);
    const editor = await showFile(document);
    const range = highlightLines(chunk);
    // Clean up previous decoration for this file if it exists
    if (fileDecorations.has(chunk.file)) {
      const oldDecoration = fileDecorations.get(chunk.file)!;
      setDecorations(editor, oldDecoration, []);
      oldDecoration.dispose();
    }

    // Create new decoration type
    const decorationType = getDecorationType();
    fileDecorations.set(chunk.file, decorationType);

    // Apply decoration
    setDecorations(editor, decorationType, [range]);
    goToLine(editor, chunk);
  } catch (error) {
    vscode.window.showErrorMessage("Failed to highlight similar code.");
    console.error("Highlight error:", error);
  }
}

// Add this cleanup function to call when your extension deactivates
export function cleanupAllDecorations() {
  fileDecorations.forEach((decoration) => decoration.dispose());
  fileDecorations.clear();
}

// Keep your existing helper functions unchanged:
const getDecorationType = () => {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(207, 210, 22, 0.3)",
    border: "2px solid rgba(255, 0, 0, 0.5)",
    overviewRulerColor: "rgba(255,200,0,0.8)",
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
};

const highlightLines = (chunk: Chunk) => {
  return new vscode.Range(
    new vscode.Position(chunk.start_line - 1, 0),
    new vscode.Position(chunk.end_line - 1, Number.MAX_SAFE_INTEGER)
  );
};

const openFile = async (fileUri: string) => {
  return await vscode.workspace.openTextDocument(vscode.Uri.file(fileUri));
};

const setDecorations = (
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType,
  decorations: vscode.Range[]
) => {
  return editor.setDecorations(decorationType, decorations);
};

const showFile = async (document: vscode.TextDocument) => {
  return await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: true,
  });
};

const goToLine = (editor: vscode.TextEditor, chunk: Chunk) => {
  const position = new vscode.Position(chunk.start_line, 0);
  editor.selection = new vscode.Selection(position, position);

  // Scroll to the line
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter
  );
};
