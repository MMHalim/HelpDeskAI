import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueCategorizationDto, IssueCategoryDto } from '@helpdesk/shared';
import { api, ApiError } from '../lib/api';
import { Button, Field, Select } from './ui';

/**
 * Administrator override of the category a resolved issue is filed under.
 * The AI files it automatically on resolution; this corrects a wrong choice or
 * categorizes an issue the AI was unsure about.
 */
export function CategorizationEditor({
  sessionId,
  currentSubcategoryId,
}: {
  sessionId: string;
  currentSubcategoryId: string;
}) {
  const queryClient = useQueryClient();
  const [subcategoryId, setSubcategoryId] = useState(currentSubcategoryId);

  const { data } = useQuery({
    queryKey: ['categorization-taxonomy'],
    queryFn: () => api.get<{ categories: IssueCategoryDto[] }>('/api/categorization/taxonomy'),
    staleTime: 300_000,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<{ categorization: IssueCategorizationDto }>(`/api/categorization/sessions/${sessionId}`, {
        subcategoryId,
        rationale: '',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['issue-report'] });
    },
  });

  const categories = data?.categories ?? [];

  return (
    <div className="space-y-2 border-t border-[var(--color-line)] pt-3">
      <Field label="Change category" hint="Overrides the AI choice for reporting.">
        <Select value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)}>
          <option value="">Select a sub-category…</option>
          {categories.map((category) => (
            <optgroup key={category.id} label={category.name}>
              {category.subcategories
                .filter((sub) => sub.isActive)
                .map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name} · {sub.priorityLevel}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      {mutation.isError ? (
        <p className="text-xs text-rose-300">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save the category'}
        </p>
      ) : null}

      <Button
        size="sm"
        variant="secondary"
        loading={mutation.isPending}
        disabled={!subcategoryId || subcategoryId === currentSubcategoryId}
        onClick={() => mutation.mutate()}
      >
        Save category
      </Button>
    </div>
  );
}
