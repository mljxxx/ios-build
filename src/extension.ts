// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as buildInfo from './buildinfo';
import * as fs from 'fs';
import path = require('path');
const { exec,spawn} = require("child_process");
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    let diagnosticCollection : vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection("oc-error");
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
    
	let disposable = vscode.commands.registerCommand('ios-build.Run', async () => {
        diagnosticCollection.clear();
        await stopBuild();
        await stopRun();
        const workspaceRoot: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceRoot !== undefined) {
            const workPath : string = workspaceRoot.concat("/.vscode");
             const output: string = await execShell("./build.sh",workPath);
            if(output.search("SUCCEEDED") !== -1) {
                vscode.window.showInformationMessage("BUILD SUCCEEDED");
                runApp(workPath);
            } else if(output.search("FAILED") !== -1){
                vscode.window.showInformationMessage("BUILD FAILED");
                sendDiagnostic(diagnosticCollection,workPath);
            } else {
                vscode.window.showInformationMessage(output);
            }
        }
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
    });
    let stopDisposable = vscode.commands.registerCommand('ios-build.Stop', async () => {
        await stopBuild();
        await stopRun();
        vscode.window.showInformationMessage("ALL STOP");
    });

    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }
      
const execShell = (cmd:string,workPath?:string) =>
    new Promise<string>((resolve, reject) => {
        let proc = exec(cmd,{cwd : workPath,detached: true},(err: any, out: string | PromiseLike<string>) => {
            if (err) {
                return resolve(cmd + ' error!');
            }
            return resolve(out);
        });
        proc.unref();
});

async function stopBuild() {
    let output : string = await execShell("killall xcodebuild");
    console.log(output);
}
async function stopRun() {
    let output : string = await execShell("killall ios-deploy-custom");
    console.log(output);
}

function runApp(workPath : String | undefined){
    if(workPath !== undefined) {
        const fileName: string = workPath.concat("/run.sh");
        const cmd:string = fs.readFileSync(fileName, "utf-8");
        const cmdList : string[] = cmd.split(" ");
        if(cmdList.length > 0){
            const execute :string = cmdList[0];
            const args :string[] = cmdList.slice(1);
            let proc = spawn(execute,args,{cwd : workPath,detached: true});
            proc.unref();
            proc.stdout.on('data', (data: Buffer) => {
                const text:string = data.toString("utf-8");
                if(text.search("33333") !== -1) {
                    vscode.commands.executeCommand("workbench.action.debug.start");
                }
                console.log(text);
            });

            proc.stderr.on('data', (data: Buffer) => {
                const text:string = data.toString("utf-8");
                console.log(text);
            });

            proc.on('close', (data: Buffer) => {
                const text:string = data.toString("utf-8");
                console.log(text);
            });
        }
    }

}

function sendDiagnostic(diagnosticCollection : vscode.DiagnosticCollection,workPath : String | undefined) {
    if (workPath !== undefined) {
        const fileName: string = workPath.concat("/xcodebuild.json");
        if (fs.existsSync(fileName)) {
            let entries: [vscode.Uri, readonly vscode.Diagnostic[] | undefined][] = [];
            const buildMessage: buildInfo.BuildInfo.BuildMessage = JSON.parse(fs.readFileSync(fileName, "utf-8"));
            console.log(buildMessage);
            buildMessage.mainSection.subSections.forEach(section => {
                section.messages.forEach(messsage => {
                    let diagnosticArray: vscode.Diagnostic[] = [];
                    let diagnostic: vscode.Diagnostic | undefined = parseDiagnostic(messsage);
                    if (diagnostic !== undefined) {
                        diagnosticArray.push(diagnostic);
                    }
                    let filePath = messsage.location.documentURLString.replace("file://", "");
                    let path: vscode.Uri = vscode.Uri.file(filePath);
                    entries.push([path, diagnosticArray]);
                });
            });
            diagnosticCollection.set(entries);
        }
    }
}

function getDocumentWorkspaceFolder(): string | undefined {
	const fileName = vscode.window.activeTextEditor?.document.fileName;
	return vscode.workspace.workspaceFolders
	  ?.map((folder) => folder.uri.fsPath)
	  .filter((fsPath) => fileName?.startsWith(fsPath))[0];
}

function parseDiagnostic(message: buildInfo.BuildInfo.Message) : vscode.Diagnostic | undefined {
    if(message.categoryIdent !== undefined && message.secondaryLocations.length > 0) {
        let location: buildInfo.BuildInfo.SecondaryLocation = message.secondaryLocations[0];
        let startPosition : vscode.Position = new vscode.Position(location.startingLineNumber,location.startingColumnNumber);
        let endPosition :vscode.Position = new vscode.Position(location.endingLineNumber,location.endingColumnNumber);
        let range : vscode.Range = new vscode.Range(startPosition,endPosition);
        let filePath = location.documentURLString.replace("file://","");
        let path : vscode.Uri = vscode.Uri.file(filePath);
        let infoLacation : vscode.Location = new vscode.Location(path,range);
        let diagnostic : vscode.Diagnostic = new vscode.Diagnostic(range,message.title);
        // let diagnosticRelatedInformation : vscode.DiagnosticRelatedInformation = new vscode.DiagnosticRelatedInformation(infoLacation,message.categoryIdent);
        // diagnostic.relatedInformation?.push(diagnosticRelatedInformation);
        return diagnostic;
    } 
    return undefined;
}
