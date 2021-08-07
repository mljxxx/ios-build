export namespace BuildInfo {

    export interface SecondaryLocation {
        startingColumnNumber: number;
        endingColumnNumber: number;
        documentURLString: string;
        endingLineNumber: number;
        startingLineNumber: number;
    }
    export interface Location {
        documentURLString: string;
    }

    export interface Message {
        categoryIdent: string;
        secondaryLocations: SecondaryLocation[];
        location: Location;
        title: string;
    }

    export interface SubSection {
        messages: Message[];
    }

    export interface MainSection {
        subSections: SubSection[];
    }

    export interface BuildMessage {
        mainSection: MainSection;
    }

}

