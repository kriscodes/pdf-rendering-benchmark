
export interface PdfDocumentProfile {
  id: string;
  pageCount: number;
  contentType:
    | "text"
    | "scanned"
    | "image-heavy"
    | "vector-heavy"
    | "mixed"
    | "complex-first-page";
  linearized: boolean;
}

export function describeProfile(
  profile: PdfDocumentProfile
): string {
  return `${profile.id}: ${profile.pageCount} pages`;
}
