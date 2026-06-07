import type { FastifyInstance } from 'fastify';
import {
  listProjects, getProject, createProject, updateProject, removeProject,
  type NewProject, type ProjectPatch,
} from '../services/reportProjectsStore';

// Saved, versioned report projects (§8B). The store handles Supabase-or-file
// persistence; these routes stay thin and mirror the ideas routes' shape.
export async function reportProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/report/projects', async () => listProjects());

  app.post('/api/report/projects', async (req, reply) => {
    try {
      return await createProject((req.body ?? {}) as NewProject);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/report/projects/:id', async (req, reply) => {
    const project = await getProject((req.params as { id: string }).id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    return project;
  });

  app.patch('/api/report/projects/:id', async (req, reply) => {
    try {
      const project = await updateProject((req.params as { id: string }).id, (req.body ?? {}) as ProjectPatch);
      if (!project) return reply.code(404).send({ error: 'Project not found.' });
      return project;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/api/report/projects/:id', async (req, reply) => {
    const ok = await removeProject((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'Project not found.' });
    return { ok: true };
  });
}
