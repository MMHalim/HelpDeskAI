import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { ArticleDto } from '@helpdesk/shared';
import { ARTICLE_CATEGORIES, ARTICLE_PRIORITIES } from '@helpdesk/shared';
import { api, ApiError } from '../lib/api';
import { Button, Card, CardHeader, Field, Input, Select, Spinner, Textarea, Toggle } from '../components/ui';

interface FormState {
  title: string;
  category: string;
  issueDescription: string;
  symptoms: string;
  troubleshootingSteps: string;
  expectedResult: string;
  failureResult: string;
  nextStep: string;
  escalationInstructions: string;
  tags: string;
  keywords: string;
  priority: string;
  isActive: boolean;
  notes: string;
}

const EMPTY: FormState = {
  title: '',
  category: 'Other',
  issueDescription: '',
  symptoms: '',
  troubleshootingSteps: '',
  expectedResult: '',
  failureResult: '',
  nextStep: '',
  escalationInstructions: '',
  tags: '',
  keywords: '',
  priority: 'normal',
  isActive: true,
  notes: '',
};

function toForm(article: ArticleDto): FormState {
  return {
    title: article.title,
    category: article.category,
    issueDescription: article.issueDescription,
    symptoms: article.symptoms.join('\n'),
    troubleshootingSteps: article.troubleshootingSteps,
    expectedResult: article.expectedResult,
    failureResult: article.failureResult,
    nextStep: article.nextStep,
    escalationInstructions: article.escalationInstructions,
    tags: article.tags.join(', '),
    keywords: article.keywords.join(', '),
    priority: article.priority,
    isActive: article.isActive,
    notes: article.notes,
  };
}

const splitLines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const splitCommas = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function ArticleEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['article', id],
    queryFn: () => api.get<{ article: ArticleDto }>(`/api/articles/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (data?.article) setForm(toForm(data.article));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isNew ? api.post('/api/articles', payload) : api.patch(`/api/articles/${id}`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['articles'] });
      navigate('/articles');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to save the article'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/articles/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['articles'] });
      navigate('/articles');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to delete the article'),
  });

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    saveMutation.mutate({
      title: form.title.trim(),
      category: form.category,
      issueDescription: form.issueDescription,
      symptoms: splitLines(form.symptoms),
      troubleshootingSteps: form.troubleshootingSteps,
      expectedResult: form.expectedResult,
      failureResult: form.failureResult,
      nextStep: form.nextStep,
      escalationInstructions: form.escalationInstructions,
      tags: splitCommas(form.tags),
      keywords: splitCommas(form.keywords),
      priority: form.priority,
      isActive: form.isActive,
      notes: form.notes,
    });
  };

  if (id && isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/articles" className="text-xs text-indigo-400 hover:text-indigo-300">
            ← Back to knowledge base
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-100">{isNew ? 'New article' : 'Edit article'}</h1>
        </div>
        <div className="flex items-center gap-2">
          {!isNew ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (window.confirm('Delete this article? This cannot be undone.')) deleteMutation.mutate();
              }}
              loading={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : null}
          <Button type="submit" loading={saveMutation.isPending}>
            {isNew ? 'Create article' : 'Save changes'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      ) : null}

      <Card>
        <CardHeader title="Overview" />
        <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label="Title">
              <Input value={form.title} onChange={(event) => update('title', event.target.value)} required minLength={3} />
            </Field>
          </div>
          <Field label="Category">
            <Select value={form.category} onChange={(event) => update('category', event.target.value)}>
              {ARTICLE_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(event) => update('priority', event.target.value)}>
              {ARTICLE_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Issue description">
              <Textarea
                className="font-sans"
                value={form.issueDescription}
                onChange={(event) => update('issueDescription', event.target.value)}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Symptoms (one per line)">
              <Textarea className="font-sans" value={form.symptoms} onChange={(event) => update('symptoms', event.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Procedure" />
        <div className="space-y-4 px-5 py-4">
          <Field label="Troubleshooting steps">
            <Textarea
              className="min-h-[180px] font-sans"
              value={form.troubleshootingSteps}
              onChange={(event) => update('troubleshootingSteps', event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Expected result">
              <Textarea className="font-sans" value={form.expectedResult} onChange={(event) => update('expectedResult', event.target.value)} />
            </Field>
            <Field label="Failure result">
              <Textarea className="font-sans" value={form.failureResult} onChange={(event) => update('failureResult', event.target.value)} />
            </Field>
            <Field label="Next step">
              <Textarea className="font-sans" value={form.nextStep} onChange={(event) => update('nextStep', event.target.value)} />
            </Field>
            <Field label="Escalation instructions">
              <Textarea
                className="font-sans"
                value={form.escalationInstructions}
                onChange={(event) => update('escalationInstructions', event.target.value)}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Metadata" />
        <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
          <Field label="Tags (comma separated)">
            <Input value={form.tags} onChange={(event) => update('tags', event.target.value)} />
          </Field>
          <Field label="Keywords (comma separated)">
            <Input value={form.keywords} onChange={(event) => update('keywords', event.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Internal notes">
              <Textarea className="font-sans" value={form.notes} onChange={(event) => update('notes', event.target.value)} />
            </Field>
          </div>
          <div className="flex items-center">
            <Toggle checked={form.isActive} onChange={(next) => update('isActive', next)} label="Active (retrievable by AI)" />
          </div>
        </div>
      </Card>
    </form>
  );
}
