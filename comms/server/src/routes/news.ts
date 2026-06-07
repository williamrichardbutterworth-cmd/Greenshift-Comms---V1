import type { FastifyInstance } from 'fastify';
import { getNews } from '../providers/news';
import {
  listFeeds, addFeed, setFeedEnabled, removeFeed,
  listArticles, saveArticle, removeArticle,
  listHeadlines, addHeadline, removeHeadline,
  type ArticleInput,
} from '../services/newsStore';
import { NEWS_TOPICS } from '../providers/news/classify';

export async function newsRoutes(app: FastifyInstance): Promise<void> {
  // Live feed — now topic-tagged, sourced from the enabled feeds.
  app.get('/api/news', async (req, reply) => {
    const limit = Number((req.query as { limit?: string })?.limit ?? 12);
    reply.header('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
    return getNews(Number.isFinite(limit) ? limit : 12);
  });

  app.get('/api/news/topics', async () => NEWS_TOPICS);

  // ── Feeds (selectable sources) ──
  app.get('/api/news/feeds', async () => listFeeds());
  app.post('/api/news/feeds', async (req, reply) => {
    try { return await addFeed((req.body ?? {}) as { name?: string; url?: string }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  app.patch('/api/news/feeds/:id', async (req, reply) => {
    const enabled = Boolean((req.body as { enabled?: boolean })?.enabled);
    const f = await setFeedEnabled((req.params as { id: string }).id, enabled);
    if (!f) return reply.code(404).send({ error: 'Feed not found.' });
    return f;
  });
  app.delete('/api/news/feeds/:id', async (req, reply) => {
    const ok = await removeFeed((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'Feed not found.' });
    return { ok: true };
  });

  // ── Saved-article library ──
  app.get('/api/news/articles', async () => listArticles());
  app.post('/api/news/articles', async (req, reply) => {
    try { return await saveArticle((req.body ?? {}) as ArticleInput); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  app.delete('/api/news/articles/:id', async (req, reply) => {
    const ok = await removeArticle((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'Article not found.' });
    return { ok: true };
  });

  // ── Persisted Headlines ──
  app.get('/api/news/headlines', async () => listHeadlines());
  app.post('/api/news/headlines', async (req, reply) => {
    try { return await addHeadline((req.body ?? {}) as ArticleInput & { priority?: number }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  app.delete('/api/news/headlines/:id', async (req, reply) => {
    const ok = await removeHeadline((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'Headline not found.' });
    return { ok: true };
  });
}
