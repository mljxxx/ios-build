# ios-build README

## Requirements
```
https://github.com/mljxxx/ios-deploy
https://github.com/xcpretty/xcpretty
```
## Extension Settings
```
 "ios.build": {
        "clang": "",                //clang path
        "workspace": "",            //workspace path
        "scheme": "",               //scheme
        "configuration": "",        //build mode debug/release
        "arch": "",                 //build arch
        "sdk": "",                  //sdk
        "derivedDataPath": "",      //derivedDataPath
        "useModernBuildSystem":"",  //use new build system
}
```
## Command
```
"command": "ios-build.Build"                //Build
"title": "iOS Build"

"command": "ios-build.buildAndRun"          //Build And Run
"title": "iOS Build & Run"

"command": "ios-build.installAndRun"        //Install And Run
"title": "iOS Install & Run"

"command": "ios-build.runWithoutInstall"    //Run Without Install
"title": "iOS Run"

"command": "ios-build.evaluate",           //Send 'po ${selected text}'
"title": "iOS Evaluate"                    

"command": "ios-build.quickPick",          //show qickpick panel with above command
"title": "iOS QuickPick"
```
**Enjoy!**
