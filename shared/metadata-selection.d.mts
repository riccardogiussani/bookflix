export type ScrapedMetadata={title?:string;subtitle?:string;publisher?:string;year?:string;language?:string;description?:string;authors?:string[];genres?:string[];pages?:number|null};
export type MetadataCandidate={source:string;data:ScrapedMetadata};
export function cleanText(raw:unknown):string;
export function normalizeMetadata(raw:unknown):ScrapedMetadata;
export function selectMetadata(candidates:MetadataCandidate[],preferred?:MetadataCandidate):{data:ScrapedMetadata;fieldSources:Record<string,string>};
