import { S3Client } from "@aws-sdk/client-s3";

export function getB2Client(): S3Client {
  const endpoint = process.env.B2_ENDPOINT || "s3.us-west-004.backblazeb2.com";
  return new S3Client({
    endpoint: `https://${endpoint}`,
    region: process.env.B2_REGION || "us-west-004",
    credentials: {
      accessKeyId: process.env.B2_KEY_ID || "",
      secretAccessKey: process.env.B2_APP_KEY || "",
    },
    forcePathStyle: true,
  });
}

export function b2PublicUrl(bucket: string, key: string): string {
  const region = process.env.B2_REGION || "us-west-004";
  const suffix = region.split("-").pop();
  return `https://f${suffix}.backblazeb2.com/file/${bucket}/${key}`;
}

/** Fetch + parse a JSON object from B2. Null when missing/unreachable. */
export async function getB2Json<T>(key: string): Promise<T | null> {
  const bytes = await getB2Bytes(key);
  if (!bytes) return null;
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

/** Raw object bytes from B2 (for hashing). Null when missing/unreachable. */
export async function getB2Bytes(key: string, range?: string): Promise<Uint8Array | null> {
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const bucket = process.env.B2_BUCKET || "";
    const res = await getB2Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range })
    );
    const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) return null;
    return await body.transformToByteArray();
  } catch {
    return null;
  }
}
