import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { resizeGeneratedImageBase64 } from "./image-processing";

describe("resizeGeneratedImageBase64", () => {
  it("produces the exact 1922 x 818 WeChat cover size", async () => {
    const source = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();

    const resized = await resizeGeneratedImageBase64(source.toString("base64"), { width: 1922, height: 818 });
    const metadata = await sharp(Buffer.from(resized, "base64")).metadata();

    expect(metadata.width).toBe(1922);
    expect(metadata.height).toBe(818);
    expect(metadata.format).toBe("png");
  });
});
