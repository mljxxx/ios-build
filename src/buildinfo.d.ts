// import { Diagnostic } from "vscode";

export namespace BuildInfo {

    export interface Location {
        startingColumnNumber: number;
        endingColumnNumber: number;
        documentURLString: string;
        endingLineNumber: number;
        startingLineNumber: number;
    }
    export interface FileLocation {
        documentURLString: string;
    }
    export interface Message {
        categoryIdent: string;
        location: Location;
        title: string;
        severity : number;
    }

    export interface SubSection {
        messages: Message[];
        text : string;
        location : FileLocation;
    }

    export interface MainSection {
        subSections: SubSection[];
    }

    export interface BuildMessage {
        mainSection: MainSection;
    }

}

