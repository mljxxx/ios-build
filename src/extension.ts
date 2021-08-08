// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as buildInfo from './buildinfo';
import * as fs from 'fs';
import path = require('path');
import { time } from 'console';
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
    let workspaceConfig = vscode.workspace.getConfiguration("ios.build");
    let clang : string|undefined = workspaceConfig.get("clang");
    let workspace : string|undefined = workspaceConfig.get("workspace");
    let scheme : string |undefined = workspaceConfig.get("scheme");
    let configuration : string |undefined = workspaceConfig.get("configuration");
    let sdk : string |undefined = workspaceConfig.get("sdk");
    let arch : string |undefined = workspaceConfig.get("arch");
    let derivedDataPath : string |undefined = workspaceConfig.get("derivedDataPath");
    
	let disposable = vscode.commands.registerCommand('ios-build.Run', async () => {
        diagnosticCollection.clear();
        await stopBuild();
        await stopRun();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            buildApp("build",workspaceFolder,clang,workspace,scheme,configuration,sdk,arch,derivedDataPath,diagnosticCollection);
            // const workPath : string = workspaceRoot.concat("/.vscode");
            
        }
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
    });
    let stopDisposable = vscode.commands.registerCommand('ios-build.Stop', async () => {
        await stopBuild();
        await stopRun();
        // vscode.window.showInformationMessage("ALL STOP");
    });
    
    let cleanDisposable = vscode.commands.registerCommand('ios-build.Clean', async () => {
        diagnosticCollection.clear();
        await stopBuild();
        await stopRun();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            buildApp("clean",workspaceFolder,clang,workspace,scheme,configuration,sdk,arch,derivedDataPath,diagnosticCollection);
        }
    });
    let runDisposable = vscode.commands.registerCommand('ios-build.RunWithoutBuild', async () => {
        await stopRun();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            runApp(workspaceFolder,scheme,configuration,sdk,derivedDataPath);
        }
    });
    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }
      
function execShell(cmd:string,workPath?:string) : Promise<string> {
    return new Promise<string>((resolve) => {
        let proc = exec(cmd,{cwd : workPath,env : process.env,detached: true},(error:Error, stdout : string, stderr : string) => {
            if (error) {
                return resolve(error.message);
            }else {
                return resolve(stderr + stdout);
            }
        });
        proc.unref();
    });
}

async function stopBuild() {
    let output : string = await execShell("killall xcodebuild");
    // console.log(output);
}
async function stopRun() {
    let output : string = await execShell("killall ios-deploy");
    // console.log(output);
}
function sleep(ms: number | undefined) : Promise<string> {
    return new Promise(resolve=>setTimeout(resolve, ms));
};

function runApp(workspaceFolder: string,scheme:string | undefined,configuration : string|undefined,sdk : string|undefined,derivedDataPath : string | undefined) {
    if(scheme === undefined || sdk === undefined || configuration===undefined || derivedDataPath === undefined) {
        vscode.window.showErrorMessage("Build Configuration Error");
        return;
    }
    let workPath : string = workspaceFolder.concat("/.vscode");
    derivedDataPath = derivedDataPath.replace('${workspaceFolder}', workspaceFolder);
    sdk = sdk.replace(new RegExp("[0-9]","g"),'');
    sdk = sdk.replace(new RegExp("\\.","g"),'');
    let executePath : string = `${derivedDataPath}/Build/Products/${configuration}-${sdk}/${scheme}.app`;
    let args : string[] = ["-N","-b",executePath,"-p","33333"];
    let proc = spawn("ios-deploy", args, { cwd: workPath, detached: true });
    proc.unref();
    proc.stdout.on('data', async (data: Buffer) => {
        const text: string = data.toString("utf-8");
        if (text.search("App path") !== -1) {
            let appPath = "";
            let compile:RegExp =  new RegExp("App path: (.*)","g");
            let res = compile.exec(text);
            res?.forEach(value => {
                appPath = value;
            });
            appPath.replace("App path: ","");
            if(appPath !== ""){
                let launchJson = `
                    {
                        "version": "0.2.0",
                        "configurations": [
                            {
                                "type": "lldb",
                                "request": "custom",
                                "name": "Debug",
                                "cwd": "${workspaceFolder}",
                                "initCommands": [
                                    "platform select remote-ios",
                                    "target create \\"${executePath}\\"",
                                    "script lldb.debugger.GetSelectedTarget().modules[0].SetPlatformFileSpec(lldb.SBFileSpec(\\"${appPath}\\"))",
                                ],
                                "processCreateCommands": [
                                    "process connect connect://127.0.0.1:33333",
                                    "run"
                                ]
                            }
                        ]
                    }`;
                fs.writeFileSync(`${workPath}/launch.json`,launchJson);
                await sleep(500);
                vscode.commands.executeCommand("workbench.action.debug.start");
            }
        }
        console.log(text);
    });

    proc.stderr.on('data', (data: Buffer) => {
        console.log(data.toString("utf-8"));
    });

    proc.on('close', (data: Buffer) => {
        console.log(data.toString("utf-8"));
    });
}

async function buildApp(buildAction:string,workspaceFolder: string,clang : string|undefined,workspace : string|undefined,
    scheme : string|undefined,configuration : string|undefined,sdk : string|undefined,arch : string|undefined,
    derivedDataPath : string|undefined,diagnosticCollection : vscode.DiagnosticCollection) {
    if(workspace===undefined || scheme===undefined || configuration===undefined || sdk===undefined || arch===undefined ||derivedDataPath===undefined) {
        vscode.window.showErrorMessage("Build Configuration Error");
        return;
    }
    if(clang !== undefined) {
        process.env.CC = clang;
    }
    workspace = workspace.replace('${workspaceFolder}', workspaceFolder);
    derivedDataPath = derivedDataPath.replace('${workspaceFolder}', workspaceFolder);
    let shellCommand :string = `xcodebuild ${buildAction}` + ` -workspace ${workspace}` + ` -scheme ${scheme}` + ` -configuration ${configuration}`+ ` -sdk ${sdk}`+ ` -arch ${arch}`+ ` -derivedDataPath ${derivedDataPath}` + ` | tee xcodebuild.txt`;
    let workPath : string = workspaceFolder.concat("/.vscode");
    let output: string = await execShell(shellCommand, workPath);
    
    if(output.search("CLEAN SUCCEEDED") !== -1) {
        vscode.window.showInformationMessage("CLEAN SUCCEEDED");
    } else if(output.search("BUILD SUCCEEDED") !== -1) {
        vscode.window.showInformationMessage("BUILD SUCCEEDED");
        runApp(workspaceFolder,scheme,configuration,sdk,derivedDataPath);
    } else if(output.search("BUILD INTERRUPTED") !== -1){
        vscode.window.showInformationMessage("BUILD INTERRUPTED");
    } else {
        vscode.window.showInformationMessage("BUILD FAILED");
        let fileFindCommand: string = `ls -dt ${derivedDataPath}/Logs/Build/*.xcactivitylog | head -n 1`;
        let file: string = await execShell(fileFindCommand);
        if(file.search("no matches found") !== -1) {
            vscode.window.showErrorMessage("Build Log Not Exists");
        } else {
            file = file.trimEnd();
            let rmFileCommand: string = "rm -f xcodebuild.json";
            let rmFileLog: string = await execShell(rmFileCommand, workPath);
            let parseCommand: string = `xclogparser dump --file  ${file} --output xcodebuild.json`;
            let parseLog: string = await execShell(parseCommand, workPath);
            console.log(parseLog);
            sendDiagnostic(diagnosticCollection,workPath);
        }
    }
}

function sendDiagnostic(diagnosticCollection : vscode.DiagnosticCollection,workPath : String) {
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

function parseDiagnostic(message: buildInfo.BuildInfo.Message) : vscode.Diagnostic | undefined {
    if(message.categoryIdent !== undefined && message.secondaryLocations.length > 0) {
        let location: buildInfo.BuildInfo.SecondaryLocation = message.secondaryLocations[0];
        let startPosition : vscode.Position = new vscode.Position(location.startingLineNumber,location.startingColumnNumber);
        let endPosition :vscode.Position = new vscode.Position(location.endingLineNumber,location.endingColumnNumber);
        let range : vscode.Range = new vscode.Range(startPosition,endPosition);
        let filePath = location.documentURLString.replace("file://","");
        let path : vscode.Uri = vscode.Uri.file(filePath);
        let diagnostic : vscode.Diagnostic = new vscode.Diagnostic(range,message.title);
        //let infoLacation : vscode.Location = new vscode.Location(path,range);
        // let diagnosticRelatedInformation : vscode.DiagnosticRelatedInformation = new vscode.DiagnosticRelatedInformation(infoLacation,message.categoryIdent);
        // diagnostic.relatedInformation?.push(diagnosticRelatedInformation);
        return diagnostic;
    } 
    return undefined;
}

function getDocumentWorkspaceFolder(): string | undefined {
	const fileName = vscode.window.activeTextEditor?.document.fileName;
	return vscode.workspace.workspaceFolders
	  ?.map((folder) => folder.uri.fsPath)
	  .filter((fsPath) => fileName?.startsWith(fsPath))[0];
}