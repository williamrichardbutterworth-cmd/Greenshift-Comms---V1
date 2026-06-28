import type { ReportProject, NewProject, ProjectPatch, ReportInputs } from '../lib/api';
import type { ReportState } from './types';

// Report instances persist on the existing report-project store: the whole ReportState
// lives on the project's `inputs` jsonb (opaque to the server). These helpers cast at
// that boundary so the rest of the engine stays strongly typed.

export function stateFromProject(p: ReportProject): ReportState | null {
  const s = p.inputs as unknown as ReportState;
  return s && typeof s === 'object' && typeof s.templateId === 'string' && s.values ? s : null;
}

export function newProjectFromState(state: ReportState): NewProject {
  return { name: state.title, inputs: state as unknown as ReportInputs };
}

export function patchFromState(state: ReportState): ProjectPatch {
  return { name: state.title, inputs: state as unknown as ReportInputs };
}
