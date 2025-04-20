import path from 'path';
import fs from 'fs';
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// 注册一个命令，用于测试 WebView
	const disposable = vscode.commands.registerCommand('wysiwyg.openWysiwygEditor', (uri: vscode.Uri, content: string, panelCatch) => {
		if (uri) {
			openWysiwygEditor(context, uri, content, panelCatch);
		}
	});

	context.subscriptions.push(disposable);

	const panelCatch: { [key: string]: vscode.WebviewPanel } = {};


	// 监听 Markdown 文件打开事件
	vscode.workspace.onDidOpenTextDocument((document) => {
		console.log(document.languageId);

		if (document.languageId === 'markdown') {
			// vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			vscode.commands.executeCommand('wysiwyg.openWysiwygEditor', document.uri, document.getText(), panelCatch);
		}
	});
	vscode.workspace.onDidCloseTextDocument((document) => {
		const panel = panelCatch[document.uri.fsPath];
		if (panel) {
			panel.dispose(); // 关闭面板
			delete panelCatch[document.uri.fsPath]; // 从缓存中删除对应的面板信息
		}
	});
	vscode.workspace.onDidSaveTextDocument((document) => {
		if (document.languageId === 'markdown') {
			const panel = panelCatch[document.uri.fsPath];
			if (panel && !panel.active) {
				// 在 Markdown 文档内容被保存时执行的操作
				console.log('Markdown 文档内容被保存了');
				panel.webview.postMessage({ command: 'setContent', content: document.getText() });
			}
		}
	});
}

function openWysiwygEditor(context: vscode.ExtensionContext, uri: vscode.Uri, content: string, panelCatch: { [key: string]: vscode.WebviewPanel }) {
	let panel = panelCatch[uri.fsPath];
	if (!panel) {
		panel = vscode.window.createWebviewPanel(
			'wysiwygEditor',           // 内部标识符
			`WYSIWYG Editor: ${uri.fsPath.split('/').pop()}`, // WebView 的标题
			vscode.ViewColumn.Active,     // 显示在编辑器的哪个分栏
			{
				enableScripts: true,   // 允许 WebView 使用 JavaScript
				retainContextWhenHidden: true, // 保留状态，避免重新加载
				localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media', 'out'))]
			},
		);

		// 监听保存指令
		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'saveMarkdown') {
				const fileContent = new TextEncoder().encode(message.content);
				vscode.workspace.fs.writeFile(uri, fileContent);
			} else if (message.command === 'requestMarkdown') {
				panel.webview.postMessage({ command: 'setContent', content });
			} else if (message.command === 'setApiKey') {
				await context.globalState.update('wysiwyg.apiKey', message.content);
			} else if (message.command === 'requestApiKey') {
				const apiKey = context.globalState.get('wysiwyg.apiKey');
				if (apiKey) {
					panel.webview.postMessage({
						command: 'apiKeyChanged',
						content: apiKey
					});
				}
			}
		});
		// WebView 的 HTML 内容
		panel.webview.html = getHTML(context, panel.webview);
		panelCatch[uri.fsPath] = panel;
	}

}

// This method is called when your extension is deactivated
export function deactivate() { }

function getHTML(context: vscode.ExtensionContext, webview: vscode.Webview) {
	const basePath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'out'));
	const indexPath = path.join(basePath.fsPath, 'vscode', 'index.html');
	const baseUri = webview.asWebviewUri(basePath);
	const scriptContent = `
<script>
  (function() {
    const base = "${baseUri}"

    const targetAttributes = { SCRIPT: 'src', LINK: 'href', IMG: 'src' };

    const originalAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function(el) {
      const attr = targetAttributes[el.tagName];
      if (attr && el[attr]) {
	  	if(el[attr].startsWith('/')) {
			el[attr] = base + el[attr];
	  	}else if(el[attr].startsWith('vscode-webview://')) {
			const splitString = '/_next';
			const arr = el[attr].split(splitString);
			if(arr[1]) {
				el[attr] = base + splitString + arr[1];
				console.log(base + splitString + arr[1]);
			}
		}
      }
      return originalAppendChild.call(this, el);
    };
  })();
  (function preserveVSCodeStyle() {
  const htmlElement = document.documentElement;
  const initialStyle = htmlElement.getAttribute("style"); // 读取原始的 style

  // 监听 DOM 变化，确保 style 仍然存在
  const observer = new MutationObserver(() => {
    if (!htmlElement.getAttribute("style")) {
      htmlElement.setAttribute("style", initialStyle);
    }
  });

  observer.observe(htmlElement, { attributes: true, attributeFilter: ["style"] });
})();
</script>
`;
	const html = fs.readFileSync(indexPath, 'utf8')
		.replace(
			'<head>',
			`<head>${scriptContent}`
		);
	return html.replace(
		/(href|src)="\/(.*?)"/g,
		(match, attr, resourcePath) => {
			const resourceUri = vscode.Uri.file(path.join(basePath.fsPath, resourcePath));
			const newUri = webview.asWebviewUri(resourceUri);

			return `${attr}="${newUri}"`;
		}
	);
}

const updateDocumentWithoutSaving = async (uri: vscode.Uri, content: string) => {
	let document = await vscode.workspace.openTextDocument(uri);
	let editor = await vscode.window.showTextDocument(document);

	// 使用编辑器编辑文档
	await editor.edit(editBuilder => {
		// 替换整个文档内容
		const firstLine = document.lineAt(0);
		const lastLine = document.lineAt(document.lineCount - 1);
		const textRange = new vscode.Range(firstLine.range.start, lastLine.range.end);

		editBuilder.replace(textRange, content);
	});
};