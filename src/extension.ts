// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as buildInfo from './buildinfo';
import * as fs from 'fs';
import path = require('path');
import { isNumber } from 'util';
const { exec,spawn} = require("child_process");


export function activate(context: vscode.ExtensionContext) {
    let diagnosticCollection : vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection("oc-error");
    let outputChannel = vscode.window.createOutputChannel("ios-build");

    let workspaceConfig = vscode.workspace.getConfiguration("ios.build");
    let clang : string|undefined = workspaceConfig.get("clang");
    let workspace : string|undefined = workspaceConfig.get("workspace");
    let scheme : string |undefined = workspaceConfig.get("scheme");
    let configuration : string |undefined = workspaceConfig.get("configuration");
    let sdk : string |undefined = workspaceConfig.get("sdk");
    let arch : string |undefined = workspaceConfig.get("arch");
    let derivedDataPath : string |undefined = workspaceConfig.get("derivedDataPath");
    let podCachePath : string |undefined = workspaceConfig.get("podCachePath");
    let podPid : number = -1;
    
	let disposable = vscode.commands.registerCommand('ios-build.Run', async () => {
        diagnosticCollection.clear();
        outputChannel.clear();
        await stopBuild();
        await stopRun();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            buildApp("build",workspaceFolder,clang,workspace,scheme,configuration,sdk,arch,derivedDataPath,diagnosticCollection,outputChannel);
        }
    });
    let stopDisposable = vscode.commands.registerCommand('ios-build.Stop', async () => {
        await stopBuild();
        await stopRun();
    });
    
    let cleanDisposable = vscode.commands.registerCommand('ios-build.Clean', async () => {
        outputChannel.clear();
        diagnosticCollection.clear();
        await stopBuild();
        await stopRun();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            buildApp("clean",workspaceFolder,clang,workspace,scheme,configuration,sdk,arch,derivedDataPath,diagnosticCollection,outputChannel);
        }
    });
    let runDisposable = vscode.commands.registerCommand('ios-build.RunWithoutBuild', async () => {
        outputChannel.clear();
        await stopRun();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            runApp(workspaceFolder,scheme,configuration,sdk,derivedDataPath,outputChannel);
        }
    });
    let podInstallDisposable = vscode.commands.registerCommand('ios-build.PodInstall', async () => {
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            let pid :number | undefined = podInstall(workspaceFolder,workspace, outputChannel);
            if(pid !== undefined) {
                podPid = pid;
            }
        }
    });

    let podCleanDisposable = vscode.commands.registerCommand('ios-build.PodClean', async () => {
        podClean(podCachePath);
    });
    
    let podStopDisposable = vscode.commands.registerCommand('ios-build.PodStop', async () => {
        podStop(podPid);
        podPid = -1;
    });
    context.subscriptions.push(disposable);
    context.subscriptions.push(stopDisposable);
    context.subscriptions.push(cleanDisposable);
    context.subscriptions.push(runDisposable);
    context.subscriptions.push(podInstallDisposable);
    context.subscriptions.push(podCleanDisposable);
    context.subscriptions.push(podStopDisposable);
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

function sleep(ms: number | undefined) : Promise<string> {
    return new Promise(resolve=>setTimeout(resolve, ms));
};

async function stopBuild() {
    let output : string = await execShell("killall xcodebuild");
    // console.log(output);
}
async function stopRun() {
    let output : string = await execShell("killall ios-deploy");
    // console.log(output);
}

function podStop(podPid : number) {
    if(podPid !== -1) {
        process.kill(-podPid);
        vscode.window.showInformationMessage("Pod Install Interrupted");
    } else {
        vscode.window.showInformationMessage("Pod Install Not Process");
    }
    // console.log(output);
}

async function podClean(podCachePath:string | undefined) {
    if(podCachePath === undefined) {
        vscode.window.showErrorMessage("Pod Cache Path Not Config");
        return;
    }
    let output : string = await execShell(`rm -rf ${podCachePath}`);
    vscode.window.showInformationMessage("Pod Clean Compeleted");
    // console.log(output);
}

function podInstall(workspaceFolder: string,workspace : string|undefined,outputChannel : vscode.OutputChannel):number|undefined {
    if(workspace === undefined) {
        vscode.window.showErrorMessage("Build Configuration Error");
        return;
    }
    outputChannel.clear();
    workspace = workspace.replace('${workspaceFolder}', workspaceFolder);
    let workSpaceDir : string =  path.dirname(workspace);
    let args : string[] = ["exec","pod","install"];
    outputChannel.show();
    let proc = spawn("bundle", args, { cwd: workSpaceDir, detached: true });
    proc.unref();
    proc.stdout.on('data', async (data: Buffer) => {
        const text: string = data.toString("utf-8");
        outputChannel.append(text);
    });

    proc.stderr.on('data', (data: Buffer) => {
        console.log(data.toString("utf-8"));
        outputChannel.append(data.toString("utf-8"));
    });

    proc.on('close', (data: Buffer) => {
        console.log(data.toString("utf-8"));
        vscode.window.showInformationMessage("Pod Install Compeleted");
    });
    return proc.pid;
}

function runApp(workspaceFolder: string,scheme:string | undefined,configuration : string|undefined,sdk : string|undefined,derivedDataPath : string | undefined,outputChannel : vscode.OutputChannel) {
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
    outputChannel.show();
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
                                    "command script import ${workPath}/fhlldb.py",                                    
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
        outputChannel.append(text);
    });

    proc.stderr.on('data', (data: Buffer) => {
        console.log(data.toString("utf-8"));
        outputChannel.append(data.toString("utf-8"));
    });

    proc.on('close', (data: Buffer) => {
        console.log(data.toString("utf-8"));
        outputChannel.append(data.toString("utf-8"));
    });
}

async function buildApp(buildAction:string,workspaceFolder: string,clang : string|undefined,workspace : string|undefined,
    scheme : string|undefined,configuration : string|undefined,sdk : string|undefined,arch : string|undefined,
    derivedDataPath : string|undefined,diagnosticCollection : vscode.DiagnosticCollection,outputChannel : vscode.OutputChannel) {
    if(workspace===undefined || scheme===undefined || configuration===undefined || sdk===undefined || arch===undefined ||derivedDataPath===undefined) {
        vscode.window.showErrorMessage("Build Configuration Error");
        return;
    }
    if(clang !== undefined) {
        process.env.CC = clang;
    }
    workspace = workspace.replace('${workspaceFolder}', workspaceFolder);
    derivedDataPath = derivedDataPath.replace('${workspaceFolder}', workspaceFolder);
    let shellCommand :string = `xcodebuild ${buildAction}` + ` -workspace ${workspace}` + ` -scheme ${scheme}` 
    + ` -configuration ${configuration}`+ ` -sdk ${sdk}`+ ` -arch ${arch}`+ ` -derivedDataPath ${derivedDataPath}`
    + ` COMPILER_INDEX_STORE_ENABLE=NO CLANG_INDEX_STORE_ENABLE=NO GCC_WARN_INHIBIT_ALL_WARNINGS=YES`
    + ` | tee xcodebuild.txt | xcpretty`;
    let workPath : string = workspaceFolder.concat("/.vscode");
    let proc = spawn("sh", ["-c",shellCommand], { cwd: workPath, detached: true });
    let isBuildFailed : Boolean = false;
    proc.unref();
    outputChannel.show();
    proc.stdout.on('data', (data: Buffer) => {
        const output: string = data.toString("utf-8");
        outputChannel.append(output);
    });
    proc.stderr.on('data',(data: Buffer) => {
        const output: string = data.toString("utf-8");
        outputChannel.append(output);
        if (output.search("BUILD INTERRUPTED") !== -1) {
            vscode.window.showInformationMessage("BUILD INTERRUPTED");
        } else if (output.search("BUILD FAILED") !== -1) {
            isBuildFailed = true;
        }
    });

    proc.on('exit', async (data: Buffer) => {
        let output : string = await execShell("tail -n 2 xcodebuild.txt",workPath);
        if (output.search("CLEAN SUCCEEDED") !== -1) {
            vscode.window.showInformationMessage("CLEAN SUCCEEDED");
        } else if (output.search("BUILD SUCCEEDED") !== -1) {
            vscode.window.showInformationMessage("BUILD SUCCEEDED");
            runApp(workspaceFolder, scheme, configuration, sdk, derivedDataPath, outputChannel);
        }  else if (output.search("BUILD INTERRUPTED") !== -1) {
            vscode.window.showInformationMessage("BUILD INTERRUPTED");
        } else if (output.search("BUILD FAILED") !== -1) {
            isBuildFailed = true;
        }
        
        if(isBuildFailed) {
            vscode.window.showInformationMessage("BUILD FAILED");
            let fileFindCommand: string = `ls -dt ${derivedDataPath}/Logs/Build/*.xcactivitylog | head -n 1`;
            let file: string = await execShell(fileFindCommand);
            if (file.search("no matches found") !== -1) {
                vscode.window.showErrorMessage("Build Log Not Exists");
            } else {
                file = file.trimEnd();
                let rmFileCommand: string = "rm -f xcodebuild.json";
                let rmFileLog: string = await execShell(rmFileCommand, workPath);
                let parseCommand: string = `xclogparser dump --file  ${file} --output xcodebuild.json`;
                let parseLog: string = await execShell(parseCommand, workPath);
                outputChannel.append(parseLog);
                sendDiagnostic(diagnosticCollection, workPath, outputChannel);
            }
        }
    });
}

function sendDiagnostic(diagnosticCollection : vscode.DiagnosticCollection,workPath : String,outputChannel : vscode.OutputChannel) {
    const fileName: string = workPath.concat("/xcodebuild.json");
    if (fs.existsSync(fileName)) {
        let entries: [vscode.Uri, readonly vscode.Diagnostic[] | undefined][] = [];
        const buildMessage: buildInfo.BuildInfo.BuildMessage = JSON.parse(fs.readFileSync(fileName, "utf-8"));
        console.log(buildMessage);
        buildMessage.mainSection.subSections.forEach(section => {
            let diagnosticArray: vscode.Diagnostic[] = [];
            let needLog : Boolean = false;
            section.messages.forEach(messsage => {
                let diagnosticData: DiagnosticData = parseDiagnostic(messsage);
                if(diagnosticData.diagnostic !== undefined){
                    diagnosticArray.push(diagnosticData.diagnostic);
                }
                if(diagnosticData.severity === 2) {
                    needLog = true;
                } 
            });
            if(needLog) {
                if(diagnosticArray.length > 0) {
                    let filePath = section.location.documentURLString.replace("file://", "");
                    let path: vscode.Uri = vscode.Uri.file(filePath);
                    entries.push([path, diagnosticArray]);
                } else {
                    outputChannel.append(section.text);
                    outputChannel.show();
                    console.log(section.text);
                }
            }
        });
        diagnosticCollection.set(entries);
    }
}

function parseDiagnostic(message: buildInfo.BuildInfo.Message) : DiagnosticData {
    let data : DiagnosticData = new DiagnosticData();
    if(message.severity === 2 && message.categoryIdent !== undefined && message.location.documentURLString !== "") {
        let location: buildInfo.BuildInfo.Location = message.location;
        let startPosition: vscode.Position = new vscode.Position(location.startingLineNumber, location.startingColumnNumber);
        let endPosition: vscode.Position = new vscode.Position(location.endingLineNumber, location.endingColumnNumber);
        let range: vscode.Range = new vscode.Range(startPosition, endPosition);
        let filePath = location.documentURLString.replace("file://", "");
        let path: vscode.Uri = vscode.Uri.file(filePath);
        let diagnostic: vscode.Diagnostic = new vscode.Diagnostic(range, message.title);
        //let infoLacation : vscode.Location = new vscode.Location(path,range);
        // let diagnosticRelatedInformation : vscode.DiagnosticRelatedInformation = new vscode.DiagnosticRelatedInformation(infoLacation,message.categoryIdent);
        // diagnostic.relatedInformation?.push(diagnosticRelatedInformation);
        data.diagnostic = diagnostic;
    }
    data.severity = message.severity;
    return data;
}

function getDocumentWorkspaceFolder(): string | undefined {
    let folders : readonly vscode.WorkspaceFolder[] | undefined =  vscode.workspace.workspaceFolders;
    if(folders !== undefined) {
        let folder:vscode.WorkspaceFolder = folders[0];
        return folder.uri.fsPath;
    } else {
        return undefined;
    }
    // const fileName = vscode.window.activeTextEditor?.document.fileName;
    // return vscode.workspace.workspaceFolders
    //     ?.map((folder) => folder.uri.fsPath)
    //     .filter((fsPath) => fileName?.startsWith(fsPath))[0];
}

export class DiagnosticData {
    diagnostic: vscode.Diagnostic | undefined;
    severity: number;
    constructor() {
        this.severity = 0;
        this.diagnostic = undefined;
    }
}