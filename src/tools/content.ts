export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  data: string;
  mimeType: string;
}

export type ContentPart = TextPart | ImagePart;

export interface ToolResult {
  content: string | ContentPart[];
  meta?: Record<string, unknown>;
}

export function textPart(text: string): TextPart {
  return { type: "text", text };
}

export function imagePart(data: string, mimeType: string): ImagePart {
  return { type: "image", data, mimeType };
}

export function contentText(content: ContentPart[]): string {
  return content.map((p) => (p.type === "text" ? p.text : "")).join("");
}
