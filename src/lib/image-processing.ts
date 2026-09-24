import sharp from "sharp";

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Center-crops and resizes generated PNG data to an exact publishing size. */
export async function resizeGeneratedImageBase64(imageBase64: string, dimensions: ImageDimensions): Promise<string> {
  const output = await sharp(Buffer.from(imageBase64, "base64"))
    .resize(dimensions.width, dimensions.height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return output.toString("base64");
}
