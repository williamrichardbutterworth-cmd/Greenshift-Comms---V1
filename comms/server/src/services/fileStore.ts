import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

// Uploaded files / media for reports (§8B Batch 2). Bytes go to Supabase Storage
// (bucket `report-files`) in production or server/data/uploads/ locally; metadata
// + mined text live in the client_files table (or client-files.json locally).

const BUCKET = 'report-files';
const MAX_EXTRACT = 24_000; // cap text fed back as report context
const MAX_BYTES = 6 * 1024 * 1024;

export interface ClientFile {
  id: string;
  clientProfileId: string | null;
  projectId: string | null;
  name: string;
  mime: string;
  size: number;
  storagePath: string;
  extractedText: string;
  createdAt: string;
}
export interface NewFile {
  name: string;
  mime?: string;
  projectId?: string | null;
  clientProfileId?: string | null;
  dataBase64: string;
}

// Coalesce one ExcelJS cell value to plain text. ExcelJS represents non-trivial
// cells as objects whose shape depends on the cell type — rich-text {richText:[…]},
// hyperlink {text,hyperlink}, formula {formula,result}, error {error} — and dates as
// native Date. A naive String(v) yields "[object Object]" for all but hyperlinks and a
// noisy locale string for dates, which is exactly the data (totals, labels, bill dates)
// the bill-analysis swarm needs. Handle each shape explicitly.
function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    if ('text' in o) return String(o.text ?? '');     // hyperlink
    if ('result' in o) return String(o.result ?? '');  // formula → computed value
    if ('error' in o) return String(o.error ?? '');    // error cell (#DIV/0! etc.)
    return '';
  }
  return String(v);
}

async function extractText(buffer: Buffer, mime: string, name: string): Promise<string> {
  const lower = name.toLowerCase();
  try {
    if (mime.includes('pdf') || lower.endsWith('.pdf')) {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdfText(pdf, { mergePages: true });
      return (Array.isArray(text) ? text.join('\n') : text).slice(0, MAX_EXTRACT);
    }
    if (mime.includes('wordprocessingml') || lower.endsWith('.docx')) {
      return ((await mammoth.extractRawText({ buffer })).value || '').slice(0, MAX_EXTRACT);
    }
    if (mime.includes('spreadsheetml') || /\.(xlsx|xlsm)$/.test(lower)) {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      let out = '';
      wb.eachSheet((sheet) => {
        out += `# ${sheet.name}\n`;
        sheet.eachRow((row) => { out += (row.values as unknown[]).slice(1).map(cellText).join(' | ') + '\n'; });
      });
      return out.slice(0, MAX_EXTRACT);
    }
    if (mime.startsWith('text/') || /\.(txt|md|csv|log|vtt|json|tsv)$/.test(lower)) {
      return buffer.toString('utf8').slice(0, MAX_EXTRACT);
    }
  } catch {
    /* extraction is best-effort */
  }
  return '';
}

// ── metadata mapping ──
type Row = {
  id: string; client_profile_id: string | null; project_id: string | null; name: string;
  mime: string; size: number; storage_path: string; extracted_text: string; created_at: string;
};
const rowToFile = (r: Row): ClientFile => ({
  id: r.id, clientProfileId: r.client_profile_id, projectId: r.project_id, name: r.name,
  mime: r.mime, size: r.size, storagePath: r.storage_path, extractedText: r.extracted_text ?? '', createdAt: r.created_at,
});

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const META_FILE = join(DATA_DIR, 'client-files.json');
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
let fileCache: ClientFile[] | null = null;

async function metaLoad(): Promise<ClientFile[]> {
  if (fileCache) return fileCache;
  try {
    const parsed = JSON.parse(await readFile(META_FILE, 'utf8'));
    fileCache = Array.isArray(parsed) ? (parsed as ClientFile[]) : [];
  } catch {
    fileCache = [];
  }
  return fileCache;
}
async function metaPersist(rows: ClientFile[]): Promise<void> {
  fileCache = rows;
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${META_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await rename(tmp, META_FILE);
}

// ── byte storage (Storage bucket or local dir) ──
async function storeBytes(id: string, name: string, buffer: Buffer, mime: string, sb: SupabaseClient | null): Promise<string> {
  if (sb) {
    const path = `${id}/${name}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, buffer, { contentType: mime || 'application/octet-stream', upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const safe = `${id}-${name.replace(/[^a-z0-9.\-_]+/gi, '_')}`;
  await writeFile(join(UPLOAD_DIR, safe), buffer);
  return safe;
}
async function readBytes(storagePath: string, sb: SupabaseClient | null): Promise<Buffer | null> {
  if (sb) {
    const { data, error } = await sb.storage.from(BUCKET).download(storagePath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  try { return await readFile(join(UPLOAD_DIR, storagePath)); } catch { return null; }
}
async function deleteBytes(storagePath: string, sb: SupabaseClient | null): Promise<void> {
  if (sb) { await sb.storage.from(BUCKET).remove([storagePath]); return; }
  try { await unlink(join(UPLOAD_DIR, storagePath)); } catch { /* gone already */ }
}

// ── public API ──
export async function uploadFile(input: NewFile): Promise<ClientFile> {
  const name = (input.name || 'file').slice(0, 255);
  if (!input.dataBase64) throw new Error('No file data.');
  const buffer = Buffer.from(input.dataBase64, 'base64');
  if (!buffer.length) throw new Error('File is empty.');
  if (buffer.length > MAX_BYTES) throw new Error('File is too large (max ~6 MB).');
  const mime = input.mime || '';
  const id = randomUUID();
  const sb = getSupabase();

  const storagePath = await storeBytes(id, name, buffer, mime, sb);
  const extractedText = await extractText(buffer, mime, name);

  if (sb) {
    const { data, error } = await sb
      .from('client_files')
      .insert({ id, client_profile_id: input.clientProfileId ?? null, project_id: input.projectId ?? null, name, mime, size: buffer.length, storage_path: storagePath, extracted_text: extractedText })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToFile(data as Row);
  }
  const file: ClientFile = {
    id, createdAt: new Date().toISOString(), clientProfileId: input.clientProfileId ?? null,
    projectId: input.projectId ?? null, name, mime, size: buffer.length, storagePath, extractedText,
  };
  await metaPersist([file, ...(await metaLoad())]);
  return file;
}

export async function listFiles(filter: { projectId?: string; clientProfileId?: string }): Promise<ClientFile[]> {
  const sb = getSupabase();
  if (sb) {
    let q = sb.from('client_files').select('*').order('created_at', { ascending: false });
    if (filter.projectId) q = q.eq('project_id', filter.projectId);
    if (filter.clientProfileId) q = q.eq('client_profile_id', filter.clientProfileId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToFile);
  }
  let rows = (await metaLoad()).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (filter.projectId) rows = rows.filter((r) => r.projectId === filter.projectId);
  if (filter.clientProfileId) rows = rows.filter((r) => r.clientProfileId === filter.clientProfileId);
  return rows;
}

async function getFileMeta(id: string): Promise<ClientFile | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('client_files').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToFile(data as Row) : null;
  }
  return (await metaLoad()).find((f) => f.id === id) ?? null;
}

export async function getFileBytes(id: string): Promise<{ file: ClientFile; bytes: Buffer } | null> {
  const file = await getFileMeta(id);
  if (!file) return null;
  const bytes = await readBytes(file.storagePath, getSupabase());
  return bytes ? { file, bytes } : null;
}

export async function removeFile(id: string): Promise<boolean> {
  const meta = await getFileMeta(id);
  if (!meta) return false;
  const sb = getSupabase();
  await deleteBytes(meta.storagePath, sb);
  if (sb) {
    const { error, count } = await sb.from('client_files').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const rows = await metaLoad();
  const next = rows.filter((f) => f.id !== id);
  if (next.length === rows.length) return false;
  await metaPersist(next);
  return true;
}
