import type { FastifyInstance } from 'fastify';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

// Sources reconnues (pour filtrage)
const KNOWN_SOURCES = [
  { value: 'blog_post',      label: 'Article de blog' },
  { value: 'product_asset',  label: 'Ressources numériques de produit' },
  { value: 'funnel_page',    label: 'Page tunnel' },
  { value: 'website_page',   label: 'Page site web' },
  { value: 'store_page',     label: 'Page créateur' },
  { value: 'manual',         label: 'Import manuel' },
] as const;

// Types MIME → label convivial
function mimeToType(mime: string): string {
  if (mime.startsWith('image/'))       return 'Image';
  if (mime.startsWith('video/'))       return 'Vidéo';
  if (mime.startsWith('audio/'))       return 'Audio';
  if (mime.includes('pdf'))            return 'PDF';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'Tableur';
  if (mime.includes('word') || mime.includes('document'))     return 'Document';
  if (mime.includes('zip') || mime.includes('compressed'))    return 'Archive';
  return 'Fichier';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 ** 2)   return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default async function filesRoutes(app: FastifyInstance) {

  // ── Types de sources ──────────────────────────────────────
  app.get('/sources', hooks, async () => KNOWN_SOURCES);

  // ── Liste avec recherche et filtres ───────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as {
      search?:   string;
      source?:   string;
      mimeType?: string;  // 'image' | 'video' | 'document' | 'pdf' | ...
      after?:    string;
      limit?:    string;
    };
    const limit = Math.min(Number(q.limit ?? 50), 200);

    let mimeFilter: string | null = null;
    if (q.mimeType) {
      const map: Record<string, string> = {
        image:    'image/%',
        video:    'video/%',
        audio:    'audio/%',
        pdf:      '%pdf%',
        document: '%document%',
        archive:  '%zip%',
      };
      mimeFilter = map[q.mimeType] ?? `${q.mimeType}%`;
    }

    const rows = await sql`
      SELECT * FROM files
      WHERE (${q.search   ?? null} IS NULL OR name   ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.source   ?? null} IS NULL OR source  = ${q.source ?? null})
        AND (${mimeFilter  ?? null} IS NULL OR mime_type ILIKE ${mimeFilter ?? null})
        AND (${q.after    ?? null}::uuid IS NULL OR id > ${q.after ?? null}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((f) => ({
      ...f,
      typeLabel:   mimeToType(f.mime_type),
      sizeFormatted: formatBytes(Number(f.size_bytes)),
      sourceLabel: KNOWN_SOURCES.find((s) => s.value === f.source)?.label ?? f.source ?? 'Inconnu',
    }));
  });

  // ── Uploader un fichier ───────────────────────────────────
  app.post('/upload', hooks, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'no_file' });

    const { source, sourceId } = request.query as { source?: string; sourceId?: string };

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const ext      = data.filename.split('.').pop() ?? 'bin';
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key      = `files/${source ?? 'manual'}/${Date.now()}-${safeName}`;

    const fileUrl = await uploadToStorage(key, buffer, data.mimetype);

    const [file] = await sql`
      INSERT INTO files (name, file_key, file_url, mime_type, size_bytes, source, source_id)
      VALUES (
        ${data.filename},
        ${key},
        ${fileUrl},
        ${data.mimetype},
        ${buffer.length},
        ${source ?? 'manual'},
        ${sourceId ?? null}
      )
      RETURNING *
    `;
    return reply.status(201).send({
      ...file,
      typeLabel:     mimeToType(file.mime_type),
      sizeFormatted: formatBytes(Number(file.size_bytes)),
    });
  });

  // ── Uploader plusieurs fichiers ───────────────────────────
  app.post('/upload-multiple', hooks, async (request, reply) => {
    const parts = request.files();
    const { source, sourceId } = request.query as { source?: string; sourceId?: string };
    const results = [];

    for await (const data of parts) {
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key      = `files/${source ?? 'manual'}/${Date.now()}-${safeName}`;
      const fileUrl  = await uploadToStorage(key, buffer, data.mimetype);

      const [file] = await sql`
        INSERT INTO files (name, file_key, file_url, mime_type, size_bytes, source, source_id)
        VALUES (
          ${data.filename}, ${key}, ${fileUrl}, ${data.mimetype},
          ${buffer.length}, ${source ?? 'manual'}, ${sourceId ?? null}
        )
        RETURNING *
      `;
      results.push(file);
    }

    return reply.status(201).send(results);
  });

  // ── Détail ────────────────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [file] = await sql`SELECT * FROM files WHERE id = ${id}`;
    if (!file) return reply.status(404).send({ error: 'not_found' });
    return {
      ...file,
      typeLabel:     mimeToType(file.mime_type),
      sizeFormatted: formatBytes(Number(file.size_bytes)),
      sourceLabel:   KNOWN_SOURCES.find((s) => s.value === file.source)?.label ?? file.source,
    };
  });

  // ── Renommer ──────────────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = request.body as { name?: string };
    if (!name) return reply.status(400).send({ error: 'name_required' });
    const [updated] = await sql`UPDATE files SET name = ${name} WHERE id = ${id} RETURNING id, name`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [file] = await sql`DELETE FROM files WHERE id = ${id} RETURNING file_key`;
    if (!file) return reply.status(404).send({ error: 'not_found' });
    // Suppression asynchrone du storage (non bloquante)
    deleteFromStorage(file.file_key).catch(() => undefined);
    return reply.status(204).send();
  });

  // ── URL de téléchargement signé (si S3) ───────────────────
  app.get('/:id/download-url', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [file] = await sql`SELECT file_key, name, mime_type FROM files WHERE id = ${id}`;
    if (!file) return reply.status(404).send({ error: 'not_found' });

    const url = await getDownloadUrl(file.file_key, file.name, file.mime_type);
    return { url, filename: file.name };
  });

  // ── Stats ─────────────────────────────────────────────────
  app.get('/stats/overview', hooks, async () => {
    const [stats] = await sql<{
      total: string; total_size: string;
      images: string; documents: string; videos: string;
    }[]>`
      SELECT
        COUNT(*)                                           as total,
        COALESCE(SUM(size_bytes), 0)                       as total_size,
        COUNT(*) FILTER (WHERE mime_type ILIKE 'image/%')  as images,
        COUNT(*) FILTER (WHERE mime_type ILIKE 'video/%')  as videos,
        COUNT(*) FILTER (WHERE mime_type NOT ILIKE 'image/%' AND mime_type NOT ILIKE 'video/%') as documents
      FROM files
    `;
    return {
      total:        Number(stats?.total ?? 0),
      totalSize:    Number(stats?.total_size ?? 0),
      totalSizeFmt: formatBytes(Number(stats?.total_size ?? 0)),
      images:       Number(stats?.images ?? 0),
      videos:       Number(stats?.videos ?? 0),
      documents:    Number(stats?.documents ?? 0),
    };
  });
}

// ── Helpers storage ───────────────────────────────────────────────

async function uploadToStorage(key: string, buffer: Buffer, mimeType: string): Promise<string> {
  const bucket  = process.env.S3_BUCKET;
  const baseUrl = process.env.STORAGE_BASE_URL ?? process.env.S3_ENDPOINT;

  if (bucket && baseUrl) {
    // @ts-ignore — optional S3 dependency
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region:      process.env.S3_REGION ?? 'us-east-1',
      endpoint:    process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId:     process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
    });
    await client.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        buffer,
      ContentType: mimeType,
      ACL:         'public-read' as never,
    }));
    return `${baseUrl}/${bucket}/${key}`;
  }

  const { writeFile, mkdir } = await import('fs/promises');
  const { join, dirname } = await import('path');
  const localPath = join(process.cwd(), 'uploads', key);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, buffer);
  return `/uploads/${key}`;
}

async function deleteFromStorage(key: string): Promise<void> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return;
  try {
    // @ts-ignore — optional S3 dependency
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region:      process.env.S3_REGION ?? 'us-east-1',
      endpoint:    process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId:     process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
    });
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    // silently ignore
  }
}

async function getDownloadUrl(key: string, filename: string, contentType: string): Promise<string> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return `/uploads/${key}`;

  try {
    // @ts-ignore — optional S3 dependency
    const { S3Client } = await import('@aws-sdk/client-s3');
    // @ts-ignore — optional S3 dependency
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    // @ts-ignore — optional S3 dependency
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region:      process.env.S3_REGION ?? 'us-east-1',
      endpoint:    process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId:     process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
    });
    return await getSignedUrl(client, new GetObjectCommand({
      Bucket:                     bucket,
      Key:                        key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
      ResponseContentType:        contentType,
    }), { expiresIn: 3600 });
  } catch {
    return `/uploads/${key}`;
  }
}
