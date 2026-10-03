import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionStatus } from '@helpdesk/shared';
import { SESSION_STATUSES } from '@helpdesk/shared';
import { api, ApiError } from '../lib/api';
import { Button, Modal, Select, Textarea } from './ui';
import { humanize } from '../lib/utils';

/**
 * Admin control for changing a ticket's status. Posts the new status — plus an
 * optional message — back into the Slack thread so the reporter is kept in the
 * loop (the API handles the Slack notification).
 */
export function StatusChangeModal({
  open,
  onClose,
  sessionId,
  currentStatus,
  sessionLabel,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  currentStatus: SessionStatus;
  sessionLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>(currentStatus);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus(currentStatus);
      setNote('');
      setError(null);
    }
  }, [open, currentStatus]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/api/sessions/${sessionId}/actions`, {
        action: 'set_status',
        status,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not update status'),
  });

  const unchanged = status === currentStatus && note.trim().length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change ticket status"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} disabled={unchanged} onClick={() => mutation.mutate()}>
            Update status
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {sessionLabel ? <p className="truncate text-xs text-slate-500">{sessionLabel}</p> : null}
        <label className="block space-y-1.5">
          <span className="text-xs uppercase tracking-wide text-slate-500">Status</span>
          <Select value={status} onChange={(event) => setStatus(event.target.value as SessionStatus)}>
            {SESSION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs uppercase tracking-wide text-slate-500">Message to reporter (optional)</span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Posted to the Slack thread together with the new status…"
          />
        </label>
        <p className="text-xs text-slate-500">The reporter is notified in the original Slack thread.</p>
        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      </div>
    </Modal>
  );
}
