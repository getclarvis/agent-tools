import { ToolError } from "../errors.js";
import { readRawFile } from "../lib/files.js";
import { sniffImageMime } from "../lib/image.js";
import { resolvePath } from "../lib/paths.js";
import { imagePart } from "./content.js";
import type { ToolDef } from "./types.js";

export const readImage: ToolDef = {
  name: "read_image",
  description:
    "Read an image file and return it so a vision-capable model can view it. Supports PNG, JPEG, " +
    "GIF, and WebP. Rejects files that are not one of those formats, and files larger than the " +
    "image size limit. Use read_file for text; use this only for images. If you do not know the " +
    "path, use glob or list_dir first.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Image file to read. Relative to workspace root or absolute (~ is not expanded).",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async handler(args, config) {
    const relPath = args.path as string;
    const target = resolvePath(relPath, config.workspaceRoot, config.confineToWorkspace);
    const buf = await readRawFile(target, relPath, config.maxImageBytes, "MAX_IMAGE_BYTES");
    const mimeType = sniffImageMime(buf);
    if (mimeType === null) {
      throw new ToolError(
        "not_an_image",
        `Not a supported image (expected png, jpeg, gif, or webp): ${relPath}`,
        { path: relPath },
      );
    }
    return { content: [imagePart(buf.toString("base64"), mimeType)] };
  },
};
