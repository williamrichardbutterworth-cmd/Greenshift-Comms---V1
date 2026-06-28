import type { FastifyInstance } from 'fastify';
import { analyzeBill } from '../services/billAnalysis';

export async function billRoutes(app: FastifyInstance): Promise<void> {
  // Run the bill-analysis swarm over an uploaded bill (text and/or image). Never 500s.
  app.post('/api/bill/analyze', async (req) => {
    const body = req.body as { text?: string; image?: { base64: string; mime?: string } };
    return analyzeBill({ text: body.text, image: body.image });
  });
}
