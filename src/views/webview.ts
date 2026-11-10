import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

/** HTML shell for a sidebar webview: strict CSP, VS Code theme variables, codicons, one script. */
export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  script: string,
  title: string,
): string {
  const nonce = randomBytes(16).toString('base64');
  const uri = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...p));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${uri('dist', 'codicons', 'codicon.css')}" rel="stylesheet">
<link href="${uri('media', 'sidebar.css')}" rel="stylesheet">
<title>${title}</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${uri('media', script)}"></script>
</body>
</html>`;
}

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, 'media'),
      vscode.Uri.joinPath(extensionUri, 'dist', 'codicons'),
    ],
  };
}
