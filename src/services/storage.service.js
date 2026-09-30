import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export class LocalStorageService {
  constructor(root = process.env.UPLOAD_DIR ?? "./uploads") {
    this.root = resolve(root);
  }

  async put(uploadId, assetId, file) {
    const key = join(uploadId, `${assetId}${extname(file.originalname).toLowerCase()}`);
    const fullPath = resolve(this.root, key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.buffer, { flag: "wx", mode: 0o600 });
    return { key: key.split("\\").join("/"), uri: `file://${fullPath}` };
  }

  async get(key) {
    return readFile(resolve(this.root, key));
  }

  async delete(key) {
    await rm(resolve(this.root, key), { force: true });
  }
}

export class S3StorageService {
  constructor({ bucket, client }) {
    this.bucket = bucket;
    this.client = client;
  }

  async put(uploadId, assetId, file) {
    const key = `${uploadId}/${assetId}${extname(file.originalname).toLowerCase()}`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype || "application/octet-stream",
    }));
    return { key, uri: `s3://${this.bucket}/${key}` };
  }

  async get(key) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createStorageService(env = process.env) {
  if (env.STORAGE_BACKEND !== "s3") return new LocalStorageService(env.UPLOAD_DIR);
  const required = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`S3 storage is missing configuration: ${missing.join(", ")}`);
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  return new S3StorageService({ bucket: env.S3_BUCKET, client });
}
