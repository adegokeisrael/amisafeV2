// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — Cloudflare R2 upload service
// ═══════════════════════════════════════════════════════════════
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

let _client = null;

function getClient() {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

/**
 * Upload a Buffer to R2.
 * @param {string} key         Object key (path within the bucket)
 * @param {Buffer} buffer      File data
 * @param {string} contentType MIME type
 * @returns {Promise<string>}  The full public URL
 */
export async function uploadToR2(key, buffer, contentType) {
  await getClient().send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
    // Objects are private by default — accessed via signed URLs or API
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/**
 * Delete an object from R2 (used to clean up orphaned uploads
 * if the DB insert fails after the R2 upload succeeded).
 */
export async function deleteFromR2(key) {
  await getClient().send(new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key:    key,
  }));
}
