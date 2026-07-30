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
