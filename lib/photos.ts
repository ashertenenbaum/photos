import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type Photo = {
  url: string;
  key: string;
  size: number;
  uploadedAt: string;
};

export type PostPhoto = {
  key: string;
  size: number;
  uploadedAt: string;
};

export type Post = {
  id: string;
  date: string;
  photos: PostPhoto[];
};

export type ResolvedPost = {
  id: string;
  date: string;
  photos: Photo[];
};

const PHOTO_PREFIX = 'photos/';

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    throw new Error(
      'Missing R2 env vars. Need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
        'R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL.'
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

function getClient() {
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

// Build a same-origin proxy URL for a photo. The browser will fetch this from
// our own Vercel deployment, which streams from R2 — sidestepping all the
// iOS Safari cross-origin caching and connection-limit issues.
function proxyUrl(key: string): string {
  return `/api/photo?key=${encodeURIComponent(key)}`;
}

export async function listPhotos(): Promise<Photo[]> {
  try {
    const { bucket } = getR2Config();
    const client = getClient();

    const all: Photo[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: PHOTO_PREFIX,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        all.push({
          url: proxyUrl(obj.Key),
          key: obj.Key,
          size: obj.Size ?? 0,
          uploadedAt: obj.LastModified?.toISOString() ?? new Date().toISOString(),
        });
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return all.sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  } catch (err) {
    console.error('Failed to list photos:', err);
    return [];
  }
}

export async function createUploadUrl(
  filename: string,
  contentType: string
): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
  const { bucket } = getR2Config();
  const client = getClient();

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${PHOTO_PREFIX}${ts}-${rand}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  // The upload itself still goes browser-direct to R2 (presigned URL).
  // After upload, the photo will be served through the same-origin proxy.
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });

  return {
    uploadUrl,
    key,
    publicUrl: proxyUrl(key),
  };
}

const POSTS_META_KEY = '_meta/posts.json';

async function getPostsMetadata(): Promise<Post[]> {
  try {
    const { bucket } = getR2Config();
    const client = getClient();
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: POSTS_META_KEY }));
    const body = await res.Body?.transformToString();
    if (!body) return [];
    return JSON.parse(body) as Post[];
  } catch {
    return [];
  }
}

async function savePostsMetadata(posts: Post[]): Promise<void> {
  const { bucket } = getR2Config();
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: POSTS_META_KEY,
    Body: JSON.stringify(posts),
    ContentType: 'application/json',
  }));
}

export async function listPosts(): Promise<ResolvedPost[]> {
  const posts = await getPostsMetadata();
  return posts.map((post) => ({
    ...post,
    photos: post.photos.map((p) => ({
      ...p,
      url: proxyUrl(p.key),
    })),
  }));
}

export async function createPost(date: string): Promise<Post> {
  const posts = await getPostsMetadata();
  const newPost: Post = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    photos: [],
  };
  posts.unshift(newPost);
  await savePostsMetadata(posts);
  return newPost;
}

export async function addPhotoToPost(postId: string, photo: PostPhoto): Promise<void> {
  const posts = await getPostsMetadata();
  const post = posts.find((p) => p.id === postId);
  if (!post) throw new Error(`Post not found: ${postId}`);
  post.photos.push(photo);
  await savePostsMetadata(posts);
}

export async function removePhotosFromPost(postId: string, keys: string[]): Promise<void> {
  const posts = await getPostsMetadata();
  const post = posts.find((p) => p.id === postId);
  if (!post) return;
  const keySet = new Set(keys);
  post.photos = post.photos.filter((p) => !keySet.has(p.key));
  await savePostsMetadata(posts);
}

export async function deletePhotos(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { bucket } = getR2Config();
  const client = getClient();

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      })
    );
  }
}
