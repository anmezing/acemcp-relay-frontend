export type IndexPhaseTranslationKey =
  | "indexPhaseWaitingForClient"
  | "indexPhaseUploading"
  | "indexPhaseIndexing"
  | "indexPhasePublishing"
  | "indexPhaseFinalizing"
  | "indexPhaseUnknown";

export function isIndexJobWaitingForClient(phase?: string | null): boolean {
  return phase?.trim().toLowerCase() === "created";
}

export function resolveIndexPhaseTranslationKey(phase?: string | null): IndexPhaseTranslationKey {
  switch (phase?.trim().toLowerCase()) {
    case "created":
      return "indexPhaseWaitingForClient";
    case "uploading":
    case "scanning":
      return "indexPhaseUploading";
    case "indexing":
      return "indexPhaseIndexing";
    case "publishing":
      return "indexPhasePublishing";
    case "finalizing":
    case "completing":
      return "indexPhaseFinalizing";
    default:
      return "indexPhaseUnknown";
  }
}
