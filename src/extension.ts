// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import * as vscode from 'vscode';
import { CancellationToken, DebugAdapterTracker, DebugAdapterTrackerFactory, Diagnostic, DiagnosticCollection, HoverProvider, InlineValuesProvider, Progress, ProgressLocation, Uri} from 'vscode';
const {exec,spawn} = require("child_process");
let firstErrorMessagePosition : ErrorMessagePosition | undefined = undefined;
let xcodebuildPid : number = -1;
let iOSdeployPid : number = -1;
let currentFrameId : number = -1;
let manualEvaluate : Boolean = false;

export function activate(context: vscode.ExtensionContext) {
    vscode.debug.registerDebugAdapterTrackerFactory("*",new CustomDebugAdapterTrackerFactory());
    vscode.languages.registerInlineValuesProvider("*", new CustomInlineValuesProvider());
    let diagnosticCollection : vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection("oc-error");
    let outputChannel = vscode.window.createOutputChannel("ios-build");

    let workspaceConfig = vscode.workspace.getConfiguration("ios.build");
    let clang : string|undefined = workspaceConfig.get("clang","/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang");
    let sysroot : string|undefined = workspaceConfig.get("sysroot","/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk");
    let workspace : string|undefined = workspaceConfig.get("workspace");
    let scheme : string |undefined = workspaceConfig.get("scheme");
    let configuration : string |undefined = workspaceConfig.get("configuration","Debug");
    let sdk : string |undefined = workspaceConfig.get("sdk");
    let arch : string |undefined = workspaceConfig.get("arch");
    let derivedDataPath : string |undefined = workspaceConfig.get("derivedDataPath");
    let useModernBuildSystem : string | undefined = workspaceConfig.get("useModernBuildSystem","YES");
    
	let buildDisposable = vscode.commands.registerCommand('ios-build.build', async () => {
        diagnosticCollection.clear();
        outputChannel.clear();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            buildApp(false,"build",workspaceFolder,clang,sysroot,workspace,scheme,configuration,sdk,arch,derivedDataPath,useModernBuildSystem,diagnosticCollection,outputChannel);
        }
    });

	let buildAndRunDisposable = vscode.commands.registerCommand('ios-build.buildAndRun', async () => {
        diagnosticCollection.clear();
        outputChannel.clear();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            buildApp(true,"build",workspaceFolder,clang,sysroot,workspace,scheme,configuration,sdk,arch,derivedDataPath,useModernBuildSystem,diagnosticCollection,outputChannel);
        }
    });
    
    let installAndRunDisposable = vscode.commands.registerCommand('ios-build.installAndRun', async () => {
        outputChannel.clear();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            runApp(true,workspaceFolder,scheme,configuration,sdk,derivedDataPath,outputChannel);
        }
    });
    
    let runWithoutInstallDisposable = vscode.commands.registerCommand('ios-build.runWithoutInstall', async () => {
        outputChannel.clear();
        const workspaceFolder: string | undefined = getDocumentWorkspaceFolder();
        if(workspaceFolder !== undefined) {
            runApp(false,workspaceFolder,scheme,configuration,sdk,derivedDataPath,outputChannel);
        }
    });

    
    let evaluateDisposable = vscode.commands.registerCommand('ios-build.evaluate', async () => {
        evaluateSelectedText();
    });

    let quickPickDisposable = vscode.commands.registerCommand('ios-build.quickPick', async () => {
        showQuickPick();
    });

    context.subscriptions.push(buildDisposable);
    context.subscriptions.push(buildAndRunDisposable);
    context.subscriptions.push(installAndRunDisposable);
    context.subscriptions.push(runWithoutInstallDisposable);
    context.subscriptions.push(evaluateDisposable);
    context.subscriptions.push(quickPickDisposable);
}

// this method is called when your extension is deactivated
export async function deactivate() { 
    await stopBuild();
    await stopRun();
}

async function showQuickPick (){
    let items: CustomQuickPickItem[] =
        [
            {
                "command": "ios-build.buildAndRun",
                "label": "iOS Build & Run"
            },
            {
                "command": "ios-build.runWithoutInstall",
                "label": "iOS Run"
            },
            {
                "command": "ios-build.installAndRun",
                "label": "iOS Install & Run"
            },
            {
                "command": "ios-build.build",
                "label": "iOS Build"
            },
            {
                "command": "ios-build.evaluate",
                "label": "iOS Evaluate"
            },
        ];
    let quickPick: vscode.QuickPick<CustomQuickPickItem> = vscode.window.createQuickPick();
    quickPick.title = "iOS";
    quickPick.items = items;
    quickPick.onDidAccept(() => {
        let item = quickPick.selectedItems[0];
        vscode.commands.executeCommand(item.command);
    });
    quickPick.onDidHide(() => {
        quickPick.dispose();
    });
    quickPick.show();
}
      
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
    if(xcodebuildPid !== -1) {
        await process.kill(-xcodebuildPid,"SIGKILL");
        xcodebuildPid = -1;
    }
}
async function stopRun() {
    vscode.commands.executeCommand("workbench.debug.panel.action.clearReplAction");
    if(iOSdeployPid !== -1) {
        await process.kill(-iOSdeployPid,"SIGKILL");
        iOSdeployPid = -1;
    }
}

async function runApp(install:Boolean,workspaceFolder: string,scheme:string | undefined,configuration : string|undefined,sdk : string|undefined,derivedDataPath : string | undefined,outputChannel : vscode.OutputChannel) {
    if(scheme === undefined || sdk === undefined || configuration===undefined || derivedDataPath === undefined) {
        vscode.window.showErrorMessage("Build Configuration Error");
        return;
    }
    let workPath : string = workspaceFolder.concat("/.vscode");
    derivedDataPath = derivedDataPath.replace('${workspaceFolder}', workspaceFolder);
    sdk = sdk.replace(new RegExp(/[0-9]*\.?[0-9]*/,"g"),'');
    let executePath : string = `${derivedDataPath}/Build/Products/${configuration}-${sdk}/${scheme}.app`;
    let installArg = install ? '' : '-m';
    let shellCommand :string = `ios-deploy-custom -N -W ${installArg} -b ${executePath} -P ${workPath}`;
    outputChannel.show();
    outputChannel.clear();
    let proc = spawn("sh", ["-c",shellCommand], { cwd: workPath, detached: true });
    proc.unref();
    iOSdeployPid = proc.pid;
    vscode.window.withProgress({location: ProgressLocation.Notification,title: "INSTALLING APP",cancellable: true}, (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => {
        token.onCancellationRequested(async () => {
            await stopRun();
        });
        const p = new Promise<void>(resolve => {
            let progressNum: Number = 0;
            proc.stdout.on('data', async (data: Buffer) => {
                const text: string = data.toString("utf-8");
                if (text.search("Launch JSON Write Completed") !== -1) {
                    resolve();
                    await sleep(1000);
                    
                    vscode.commands.executeCommand("workbench.action.debug.start");
                }
                let pattern = RegExp(/\[\s*(\d+)%\]/, "g");
                let progressStr: RegExpExecArray | null = null;
                while (progressStr = pattern.exec(text)) {
                    let currentprogressNum = Number(progressStr[1]);
                    progress.report({ increment: currentprogressNum - progressNum.valueOf()});
                    progressNum = currentprogressNum;
                }
                let disconnectPattern = RegExp(/Disconnected\s.*?\sfrom USB/,"g");
                if(disconnectPattern.test(text)){
                    stopRun();    
                }
            });
            proc.stderr.on('data', (data: Buffer) => {
                outputChannel.append(data.toString("utf-8"));
                resolve();
            });
            proc.on('close', () => {
                resolve();
            });
        });
        return p;
    });
}

async function buildApp(run:Boolean,buildAction:string,workspaceFolder: string,clang : string|undefined,sysroot : string|undefined,workspace : string|undefined,
    scheme : string|undefined,configuration : string|undefined,sdk : string|undefined,arch : string|undefined,
    derivedDataPath : string|undefined,useModernBuildSystem : string | undefined,diagnosticCollection : vscode.DiagnosticCollection,outputChannel : vscode.OutputChannel) {
    if(workspace===undefined || scheme===undefined || configuration===undefined || sdk===undefined || arch===undefined ||derivedDataPath===undefined) {
        vscode.window.showErrorMessage("Build Configuration Error");
        return;
    }
    firstErrorMessagePosition = undefined;
    process.env.CC = clang ;
    process.env.SDKROOT = sysroot;
    workspace = workspace.replace('${workspaceFolder}', workspaceFolder);
    derivedDataPath = derivedDataPath.replace('${workspaceFolder}', workspaceFolder);
    let shellCommand :string = `xcodebuild ${buildAction}` + ` -workspace ${workspace}` + ` -scheme ${scheme}` 
    + ` -configuration ${configuration}`+ ` -sdk ${sdk}`+ ` -arch ${arch}`+ ` -derivedDataPath ${derivedDataPath} -UseModernBuildSystem=${useModernBuildSystem}`
    + ` diagnostic_message_length=0 COMPILER_INDEX_STORE_ENABLE=NO CLANG_INDEX_STORE_ENABLE=NO GCC_WARN_INHIBIT_ALL_WARNINGS=YES CLANG_DEBUG_MODULES=NO `
    + ` | tee xcodebuild.txt | xcpretty --no-utf --report json-compilation-database --output compile_commands_update.json`;
    let workPath : string = workspaceFolder.concat("/.vscode");
    let proc = spawn("sh", ["-c",shellCommand], { cwd: workPath, detached: true });
    proc.unref();
    xcodebuildPid = proc.pid;
    outputChannel.show();
    outputChannel.appendLine("** BUILD START **");
    proc.stdout.on('data', (data: Buffer) => {
        const output: string = data.toString("utf-8");
        postBuildMessage(output,outputChannel);
        postErrorMessage(diagnosticCollection, output);
    });
    let isBuildFailed = false;
    proc.stderr.on('data',(data: Buffer) => {
        const output: string = data.toString("utf-8");
        if (output.search("BUILD FAILED") !== -1) {
            isBuildFailed = true;
        }
        if(output.search("xcodebuild: error:") !== -1) {
            outputChannel.append(output);
        }
    });

    vscode.window.withProgress({location: ProgressLocation.Notification,title: "BUILDING APP",cancellable: true}, (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => {
        token.onCancellationRequested(async () => {
            await stopBuild();
        });
        const p = new Promise<void>(resolve => {
            proc.on('exit', async () => {
                let output: string = await execShell("tail -n 2 xcodebuild.txt", workPath);
                if (output.search("BUILD SUCCEEDED") !== -1) {
                    outputChannel.appendLine("** BUILD SUCCEEDED **");
                    vscode.window.showInformationMessage("BUILD SUCCEEDED");
                    if (run) {
                        runApp(true, workspaceFolder, scheme, configuration, sdk, derivedDataPath, outputChannel);
                    }
                } else {
                    if (isBuildFailed) {
                        outputChannel.appendLine("** BUILD FAILED **");
                        vscode.window.showInformationMessage("BUILD FAILED");
                        if (firstErrorMessagePosition !== undefined) {
                            vscode.window.showTextDocument(firstErrorMessagePosition.uri, { selection: firstErrorMessagePosition.range });
                        }
                    } else {
                        outputChannel.appendLine("** BUILD INTERRUPTED **");
                        vscode.window.showInformationMessage("BUILD INTERRUPTED");
                    }
                }
                resolve();
                await sleep(1000);
                produceCompileCommand(workPath);
            });
        });
        return p;
    });
}

function postBuildMessage(text:string,outputChannel : vscode.OutputChannel) {
    let buildMessagePattern = new RegExp(/>\s(.*?)\n/,"g");
    let buildMessage : RegExpExecArray | null = null;
    while(buildMessage = buildMessagePattern.exec(text)) {
        outputChannel.append(buildMessage[0]);
    }
    let errorMessagePattern = new RegExp(/\[x\]\s(.*?)\n/,"g");
    let errorMessage : RegExpExecArray | null = null;
    while(errorMessage = errorMessagePattern.exec(text)) {
        outputChannel.append(errorMessage[0]);
    }
}

function postErrorMessage(diagnosticCollection : vscode.DiagnosticCollection,text:string) {
    let errorMessagePattern = new RegExp(/\[x\]\s(.*?):(\d+):(\d+):\s(.*?)\n/,"g");
    let errorMessage : RegExpExecArray | null = null;
    while(errorMessage = errorMessagePattern.exec(text)) {
        let filePath : string = errorMessage[1];
        let lineNumber : string = errorMessage[2];
        let columnNumber : string = errorMessage[3];
        let errorInfo : string = errorMessage[4];
        let startPosition: vscode.Position = new vscode.Position(Number(lineNumber) - 1, Number(columnNumber) - 1);
        let endPosition: vscode.Position = new vscode.Position(Number(lineNumber) - 1, Number(columnNumber) - 1);
        let range: vscode.Range = new vscode.Range(startPosition, endPosition);
        let path: vscode.Uri = vscode.Uri.file(fs.realpathSync(filePath));
        let diagnostic: vscode.Diagnostic = new vscode.Diagnostic(range, errorInfo);
        diagnosticCollection.set(path,[diagnostic]);
        if(firstErrorMessagePosition === undefined) {
            firstErrorMessagePosition = {uri: path,range:range};
        }
    }
    return undefined;
}

function produceCompileCommand(workPath:string){
    let compileCommandArray : CommandModel[] = [];
    let compileCommandUpdatePath : string = workPath.concat("/compile_commands_update.json");
    if(fs.existsSync(compileCommandUpdatePath)) {
        let updateCompileCommand : CommandModel[] = JSON.parse(fs.readFileSync(compileCommandUpdatePath,"utf-8"));
        compileCommandArray = compileCommandArray.concat(updateCompileCommand);  
        fs.unlink(compileCommandUpdatePath,(err: NodeJS.ErrnoException | null) => {});
    }
    let compileCommandPath : string = workPath.concat("/compile_commands.json");
    if(fs.existsSync(compileCommandPath)) {
        let updateCompileCommand : CommandModel[] = JSON.parse(fs.readFileSync(compileCommandPath,"utf-8"));
        compileCommandArray = compileCommandArray.concat(updateCompileCommand);  
    }
    let compileCommand : CommandModel[] = [];
    let modelMap = new Map();
    compileCommandArray.forEach(model => {
        if(fs.existsSync(model.file) && !modelMap.has(model.file)) {
            modelMap.set(model.file,1);
            compileCommand.push(model);
        }
    });
    let compileCommandJSON : string = JSON.stringify(compileCommand);
    fs.writeFile(compileCommandPath,compileCommandJSON,"utf-8",(err: NodeJS.ErrnoException | null) => {});
}

async function evaluateSelectedText() {
    let editor : vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    let selection : vscode.Selection | undefined = editor?.selection;
    let selectedText = editor?.document.getText(selection);
    if(selectedText !== undefined && currentFrameId !== -1 && vscode.debug.activeDebugSession !== undefined) {
        manualEvaluate = true;
        vscode.debug.activeDebugConsole.appendLine(`po ${selectedText}`);
        vscode.debug.activeDebugSession.customRequest("evaluate", { context: 'repl', expression: `po ${selectedText}`, frameId: currentFrameId });
    }
}

function getDocumentWorkspaceFolder(): string | undefined {
    let folders : readonly vscode.WorkspaceFolder[] | undefined =  vscode.workspace.workspaceFolders;
    if(folders !== undefined) {
        let folder:vscode.WorkspaceFolder = folders[0];
        return folder.uri.fsPath;
    } else {
        return undefined;
    }
}

interface ErrorMessagePosition {
    uri:Uri;
    range:vscode.Range;
}
interface CommandModel {
    command: string;
    file: string;
    directory: string;
}

class CustomDebugAdapterTracker implements DebugAdapterTracker {
    async onWillReceiveMessage(message: any): Promise<void> {
        if(message.type === 'request' && message.command === 'disconnect') {
            await stopRun();
        }
        console.log(message);
    }
    onDidSendMessage(message: any): void {
        if(message.type === 'event' && message.event === 'stopped' && message.body.reason === 'breakpoint' && message.body.allThreadsStopped === true) {
            vscode.commands.executeCommand("workbench.debug.panel.action.clearReplAction");
        }
        if(manualEvaluate) {
            manualEvaluate = false;
            if(message.type === 'response' && message.success === false) {
                vscode.debug.activeDebugConsole.append(message.message + '\n');
            }
            // console.log(message);
        }
    }
}

class CustomDebugAdapterTrackerFactory implements DebugAdapterTrackerFactory {
    createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return new CustomDebugAdapterTracker();
    }
}

class CustomInlineValuesProvider implements InlineValuesProvider {
    provideInlineValues(document: vscode.TextDocument, viewPort: vscode.Range, context: vscode.InlineValueContext, token: CancellationToken): vscode.ProviderResult<vscode.InlineValue[]> {
        currentFrameId = context.frameId;
        return undefined;
    }
}

class CustomQuickPickItem implements vscode.QuickPickItem {
    label: string;
    command : string;
    constructor(label:string,command:string) {
        this.label = label;
        this.command = command;
    }
}