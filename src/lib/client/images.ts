const MAX_DIMENSION = 2048;
const KEEP_BYTES = 4 * 1024 * 1024;

/**
 * Normalises an attached image to PNG or JPEG, at most 2048px on the long side,
 * so it is accepted as input_image and keeps the request small.
 */
export async function prepareImage(file: File): Promise<File> {
  const source = await decode(file);
  const { width, height } = source;
  const supported = file.type === "image/png" || file.type === "image/jpeg";
  if (supported && file.size <= KEEP_BYTES && Math.max(width, height) <= MAX_DIMENSION) {
    close(source);
    return file;
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  // Screenshots and diagrams stay PNG; photos and large images become JPEG.
  const png = file.type === "image/png" && w * h <= 1_500_000;
  if (!png) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(source.image, 0, 0, w, h);
  close(source);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, png ? "image/png" : "image/jpeg", 0.9));
  if (!blob) throw new Error("Could not encode the image");
  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${stem}.${png ? "png" : "jpg"}`, { type: blob.type, lastModified: file.lastModified });
}

type Decoded = { image: CanvasImageSource; width: number; height: number; release?: () => void };

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // fall back to an <img> element below
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function close(decoded: Decoded) {
  decoded.release?.();
}
