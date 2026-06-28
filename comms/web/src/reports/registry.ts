import type { ReportTemplate } from './types';
import { costComparisonTemplate } from './templates/costComparison';
import { procureAheadTemplate } from './templates/procureAhead';

// Every report the app can generate. Adding one the user sends over = one module here.
export const REPORT_TEMPLATES: ReportTemplate[] = [costComparisonTemplate, procureAheadTemplate];

export const getReportTemplate = (id: string | undefined): ReportTemplate | null =>
  REPORT_TEMPLATES.find((t) => t.id === id) ?? null;
