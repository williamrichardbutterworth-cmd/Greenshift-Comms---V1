import type { FastifyInstance } from 'fastify';
import { uploadFile, listFiles, getFileBytes, removeFile, type NewFile } from '../services/fileStore';

// Uploaded report files / media (§8B Batch 2). Files are sent as base64 JSON
// (keeps the single-serverless-function inject() flow simple — no multipart).
export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/report/files', async (req) => {
    const q = req.query as { projectId?: string; clientProfileId?: string };
    return listFiles({ projectId: q.projectId, clientProfileId: q.clientProfileId });
  });

  app.post('/api/report/files', async (req, reply) => {
    try {
      return await uploadFile((req.body ?? {}) as NewFile);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/report/files/:id/download', async (req, reply) => {
    const res = await getFileBytes((req.params as { id: string }).id);
    if (!res) return reply.code(404).send({ error: 'File not found.' });
    reply.header('content-type', res.file.mime || 'application/octet-stream');
    reply.header('content-disposition', `inline; filename="${res.file.name.replace(/"/g, '')}"`);
    return reply.send(res.bytes);
  });

  app.delete('/api/report/files/:id', async (req, reply) => {
    const ok = await removeFile((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'File not found.' });
    return { ok: true };
  });
}
