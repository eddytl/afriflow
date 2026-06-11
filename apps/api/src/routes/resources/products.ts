import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';

const hooks = { preHandler: [authMiddleware, tenantMiddleware] };

const optionSchema = z.object({
  name:   z.string().min(1),
  values: z.array(z.string()).min(1),
});

const productSchema = z.object({
  name:            z.string().min(1),
  description:     z.string().optional(),
  sku:             z.string().optional(),
  taxRate:         z.number().min(0).max(100).optional().default(0),
  taxMode:         z.enum(['exclusive', 'inclusive']).optional().default('exclusive'),
  currency:        z.string().length(3).optional().default('EUR'),
  price:           z.number().min(0).optional().default(0),
  weightGrams:     z.number().int().min(0).optional(),
  hasStockLimit:   z.boolean().optional().default(false),
  stockLimit:      z.number().int().min(0).optional(),
  disableShipping: z.boolean().optional().default(false),
  hasOptions:      z.boolean().optional().default(false),
  options:         z.array(optionSchema).optional().default([]),
});

export default async function productsRoutes(app: FastifyInstance) {

  // ── Liste ─────────────────────────────────────────────────
  app.get('/', hooks, async (request) => {
    const q = request.query as { status?: string; search?: string; after?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return sql`
      SELECT * FROM products
      WHERE (${q.status ?? null} IS NULL OR status = ${q.status ?? null})
        AND (${q.search ?? null} IS NULL OR name ILIKE ${'%' + (q.search ?? '') + '%'})
        AND (${q.after  ?? null}::uuid IS NULL OR id > ${q.after ?? null}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  });

  // ── Créer ─────────────────────────────────────────────────
  app.post('/', hooks, async (request, reply) => {
    const body = productSchema.parse(request.body);
    const [product] = await sql`
      INSERT INTO products (
        name, description, sku, tax_rate, tax_mode, currency, price,
        weight_grams, has_stock_limit, stock_limit, disable_shipping,
        has_options, options
      ) VALUES (
        ${body.name},
        ${body.description ?? null},
        ${body.sku ?? null},
        ${body.taxRate},
        ${body.taxMode},
        ${body.currency},
        ${body.price},
        ${body.weightGrams ?? null},
        ${body.hasStockLimit},
        ${body.stockLimit ?? null},
        ${body.disableShipping},
        ${body.hasOptions},
        ${JSON.stringify(body.options)}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(product);
  });

  // ── Détail ────────────────────────────────────────────────
  app.get('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [product] = await sql`SELECT * FROM products WHERE id = ${id}`;
    if (!product) return reply.status(404).send({ error: 'not_found' });
    return product;
  });

  // ── Modifier ──────────────────────────────────────────────
  app.patch('/:id', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = productSchema.partial().parse(request.body);
    const cols: Record<string, unknown> = { updated_at: new Date() };
    if (body.name            !== undefined) cols.name             = body.name;
    if (body.description     !== undefined) cols.description      = body.description;
    if (body.sku             !== undefined) cols.sku              = body.sku;
    if (body.taxRate         !== undefined) cols.tax_rate         = body.taxRate;
    if (body.taxMode         !== undefined) cols.tax_mode         = body.taxMode;
    if (body.currency        !== undefined) cols.currency         = body.currency;
    if (body.price           !== undefined) cols.price            = body.price;
    if (body.weightGrams     !== undefined) cols.weight_grams     = body.weightGrams;
    if (body.hasStockLimit   !== undefined) cols.has_stock_limit  = body.hasStockLimit;
    if (body.stockLimit      !== undefined) cols.stock_limit      = body.stockLimit;
    if (body.disableShipping !== undefined) cols.disable_shipping = body.disableShipping;
    if (body.hasOptions      !== undefined) cols.has_options      = body.hasOptions;
    if (body.options         !== undefined) cols.options          = JSON.stringify(body.options);
    const [updated] = await sql`UPDATE products SET ${sql(cols)} WHERE id = ${id} RETURNING *`;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Archiver / Activer ────────────────────────────────────
  app.post('/:id/toggle', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await sql`
      UPDATE products
      SET status = CASE WHEN status = 'active' THEN 'archived' ELSE 'active' END,
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, status
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  // ── Supprimer ─────────────────────────────────────────────
  app.delete('/:id', hooks, async (request, reply) => {
    await sql`DELETE FROM products WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Image produit ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.post('/:id/image', { ...hooks, config: { rawBody: true } as any }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'no_file' });

    // Stocker en mémoire tampon et construire une URL via le storage configuré
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const ext  = data.filename.split('.').pop() ?? 'bin';
    const key  = `products/${id}/image-${Date.now()}.${ext}`;

    const storageUrl = await uploadToStorage(key, buffer, data.mimetype);

    const [updated] = await sql`
      UPDATE products SET image_url = ${storageUrl}, updated_at = now()
      WHERE id = ${id} RETURNING id, image_url
    `;
    if (!updated) return reply.status(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/:id/image', hooks, async (request, reply) => {
    await sql`UPDATE products SET image_url = NULL, updated_at = now() WHERE id = ${(request.params as { id: string }).id}`;
    return reply.status(204).send();
  });

  // ── Dupliquer ─────────────────────────────────────────────
  app.post('/:id/duplicate', hooks, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [orig] = await sql`SELECT * FROM products WHERE id = ${id}`;
    if (!orig) return reply.status(404).send({ error: 'not_found' });
    const [copy] = await sql`
      INSERT INTO products (
        name, description, sku, tax_rate, tax_mode, currency, price,
        weight_grams, has_stock_limit, stock_limit, disable_shipping,
        has_options, options
      ) VALUES (
        ${`${orig.name} (copie)`},
        ${orig.description ?? null}, ${orig.sku ?? null},
        ${orig.tax_rate}, ${orig.tax_mode}, ${orig.currency}, ${orig.price},
        ${orig.weight_grams ?? null}, ${orig.has_stock_limit}, ${orig.stock_limit ?? null},
        ${orig.disable_shipping}, ${orig.has_options},
        ${JSON.stringify(orig.options)}::jsonb
      )
      RETURNING *
    `;
    return reply.status(201).send(copy);
  });
}

// Abstraction storage — S3 ou local selon ENV
async function uploadToStorage(key: string, buffer: Buffer, mimeType: string): Promise<string> {
  const bucket  = process.env.S3_BUCKET;
  const baseUrl = process.env.STORAGE_BASE_URL ?? process.env.S3_ENDPOINT;

  if (bucket && baseUrl) {
    // @ts-ignore — optional S3 dependency
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region:   process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
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

  // Fallback : stockage local (dev uniquement)
  const { writeFile, mkdir } = await import('fs/promises');
  const { join, dirname } = await import('path');
  const localPath = join(process.cwd(), 'uploads', key);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, buffer);
  return `/uploads/${key}`;
}
