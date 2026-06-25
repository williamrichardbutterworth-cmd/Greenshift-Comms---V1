import { useEffect, useState } from 'react';
import { api, type DocumentTemplate, type ReportProject } from '../lib/api';
import { DocumentTypePicker } from './DocumentTypePicker';
import { ClientProfileForm } from './ClientProfileForm';

// A request to start a new document. `templateId` skips the template picker;
// `profileId` pre-selects a client; `seedAngles` folds talk-track angles into the draft.
export interface NewDocRequest { profileId?: string; templateId?: string; seedAngles?: string[] }

// The shared "create a document" flow (template picker → client/setup → project),
// driven by a request object so it can be triggered from anywhere (Clients home,
// client hub, the Documents tab strip). On success it returns the created project.
export function NewDocumentFlow({ request, onCreated, onCancel }: {
  request: NewDocRequest | null;
  onCreated: (p: ReportProject) => void;
  onCancel: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<DocumentTemplate | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!request) { setPicking(false); setCreating(false); setPendingTemplate(null); return; }
    if (request.templateId) {
      // Skip the picker — jump straight to the client/setup step on the given template.
      api.templates.get(request.templateId)
        .then((t) => { if (!cancelled) { setPendingTemplate(t); setPicking(false); setCreating(true); } })
        .catch(() => { if (!cancelled) { setPendingTemplate(null); setPicking(true); setCreating(false); } });
    } else {
      setPendingTemplate(null); setCreating(false); setPicking(true);
    }
    return () => { cancelled = true; };
  }, [request]);

  if (!request) return null;
  return (
    <>
      {picking && (
        <DocumentTypePicker
          onPick={(t) => { setPendingTemplate(t); setPicking(false); setCreating(true); }}
          onCancel={onCancel}
        />
      )}
      {creating && (
        <ClientProfileForm
          template={pendingTemplate}
          initialProfileId={request.profileId}
          seedAngles={request.seedAngles}
          onDone={onCreated}
          onCancel={onCancel}
        />
      )}
    </>
  );
}
