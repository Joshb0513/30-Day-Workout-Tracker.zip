import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Dumbbell,
  Flame,
  HeartPulse,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

type SetLog = { id: string; reps: string; weight: string; complete: boolean };
type Exercise = {
  id: string;
  name: string;
  target: string;
  notes: string;
  sets: SetLog[];
  complete: boolean;
};
type WorkoutDay = {
  index: number;
  date: string;
  weekday: string;
  focus: string;
  exercises: Exercise[];
  complete: boolean;
};
type Plan = { name: string; startDate: string; days: WorkoutDay[] };
type ImportedExercise = { name: string; sets: number; reps: string };
type ImportedDay = { focus: string; exercises: ImportedExercise[] };

const STORAGE_KEY = 'steady-thirty-plan-v1';
const queryClient = new QueryClient();
GlobalWorkerOptions.workerSrc = pdfWorker;

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const formatDay = (date: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
const longDate = (date: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
const dayName = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${date}T12:00:00`));

function blankSets(count = 3): SetLog[] {
  return Array.from({ length: count }, (_, index) => ({
    id: uid('set'),
    reps: index === 0 ? '8' : '8',
    weight: '',
    complete: false,
  }));
}

function sampleExercise(name: string, target: string, sets = 3): Exercise {
  return { id: uid('exercise'), name, target, notes: '', sets: blankSets(sets), complete: false };
}

function makePlan(name: string, startDate: string): Plan {
  const start = new Date(`${startDate}T12:00:00`);
  const focuses = ['Foundation', 'Lower body', 'Recovery', 'Upper body', 'Conditioning', 'Mobility', 'Open day'];
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const day: WorkoutDay = {
      index: index + 1,
      date: isoDate(date),
      weekday: dayName(isoDate(date)),
      focus: focuses[index % focuses.length],
      exercises: [],
      complete: false,
    };
    if (index === 0) day.exercises = [sampleExercise('Goblet squat', 'Lower body'), sampleExercise('Incline push-up', 'Upper body')];
    if (index === 1) day.exercises = [sampleExercise('Romanian deadlift', 'Posterior chain'), sampleExercise('Dead bug', 'Core', 2)];
    if (index === 2) day.focus = 'Restore';
    return day;
  });
  return { name: name.trim() || 'My steady month', startDate, days };
}

function buildImportedPlan(name: string, startDate: string, importedDays: ImportedDay[]): Plan {
  const base = makePlan(name, startDate);
  return {
    ...base,
    days: base.days.map((day, index) => {
      const imported = importedDays[index];
      if (!imported) return { ...day, exercises: [] };
      return {
        ...day,
        focus: imported.focus || 'Imported workout',
        exercises: imported.exercises.map((exercise) => {
          const movement = sampleExercise(exercise.name, '', Math.max(1, exercise.sets));
          return {
            ...movement,
            sets: movement.sets.map((set) => ({ ...set, reps: exercise.reps })),
          };
        }),
      };
    }),
  };
}

function cleanPdfLine(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^[•*]\s*/, '').trim();
}

function parseImportedExercise(line: string): ImportedExercise | null {
  const cleaned = cleanPdfLine(line).replace(/^\d+[.)]\s*/, '');
  if (
    !cleaned ||
    cleaned.length < 2 ||
    /^(workout|training|exercise|movement|sets?|reps?|weight|load|notes?|warm[- ]?up|cool[- ]?down|rest|repeat|day|week)\b/i.test(cleaned) ||
    /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)?\s*\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/i.test(cleaned) ||
    /^[\d\s./:|–—-]+$/.test(cleaned)
  ) {
    return null;
  }

  const setMatch =
    cleaned.match(/(\d+)\s*(?:sets?\s*(?:x|×|by)\s*|x|×)\s*(\d+)(?:\s*reps?)?/i) ??
    cleaned.match(/(\d+)\s*sets?(?:\s*(?:of|x|×|by|\|)\s*|\s+)(\d+)\s*reps?/i) ??
    cleaned.match(/sets?\s*[:=-]?\s*(\d+).*?reps?\s*[:=-]?\s*(\d+)/i);
  const name = cleaned
    .replace(setMatch?.[0] ?? '', '')
    .replace(/\s*[-:|]\s*$/, '')
    .trim();
  if (!name) return null;

  return {
    name,
    sets: setMatch ? Number(setMatch[1]) : 3,
    reps: setMatch?.[2] ?? '8',
  };
}

async function extractPdfLines(file: File) {
  const bytes = await file.arrayBuffer();
  const document = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[][] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map<number, string[]>();
    for (const item of content.items) {
      if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      rows.set(y, [...(rows.get(y) ?? []), item.str]);
    }
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, values]) => cleanPdfLine(values.join(' '))).filter(Boolean));
  }
  return pages;
}

async function parseWorkoutPdf(file: File): Promise<ImportedDay[]> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Choose a PDF file to import.');
  }

  const pages = await extractPdfLines(file);
  const days: ImportedDay[] = Array.from({ length: 30 }, () => ({ focus: '', exercises: [] }));
  let currentDay = -1;
  let foundDayHeading = false;

  pages.forEach((lines, pageIndex) => {
    for (const rawLine of lines) {
      const line = cleanPdfLine(rawLine);
      const heading = line.match(/^(?:day|session|workout)\s*(\d{1,2})(?:\s*[:.)\-–—]\s*|\s+)?(.*)$/i);
      if (heading) {
        const dayNumber = Number(heading[1]);
        if (dayNumber >= 1 && dayNumber <= 30) {
          currentDay = dayNumber - 1;
          foundDayHeading = true;
          days[currentDay].focus = cleanPdfLine(heading[2] || '') || 'Imported workout';
          continue;
        }
      }

      if (currentDay < 0) currentDay = foundDayHeading ? 0 : Math.min(pageIndex, 29);
      const workoutLabel = line.match(/^(?:workout|focus|theme)\s*[:=-]\s*(.+)$/i);
      if (workoutLabel) {
        days[currentDay].focus = cleanPdfLine(workoutLabel[1]);
        continue;
      }
      const exercise = parseImportedExercise(line);
      if (exercise) days[currentDay].exercises.push(exercise);
    }
  });

  const populated = days.filter((day) => day.exercises.length > 0);
  if (!populated.length) {
    throw new Error('No workout movements were found. Try a text-based PDF with day headings and exercise names.');
  }
  return days;
}

function loadPlan(): Plan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Plan) : null;
  } catch {
    return null;
  }
}

function PdfImportPicker({
  onParsed,
  compact = false,
}: {
  onParsed: (days: ImportedDay[], fileName: string) => void;
  compact?: boolean;
}) {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setParsing(true);
    setError('');
    try {
      onParsed(await parseWorkoutPdf(file), file.name);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'That PDF could not be read.');
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className={compact ? 'flex flex-col gap-2' : 'mt-8'}>
      <label className={`group flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/35 transition hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/5 ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]">
          {parsing ? <LoaderCircle size={18} className="animate-spin" /> : <Upload size={18} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{parsing ? 'Reading your PDF…' : 'Import a workout PDF'}</span>
          <span className="mt-0.5 block text-xs leading-5 text-[hsl(var(--muted-foreground))]">Recognizes Day 1–30 and sets × reps</span>
        </span>
        <span className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary))]">Choose file</span>
        <input type="file" accept=".pdf,application/pdf" className="sr-only" data-testid="input-workout-pdf" onChange={chooseFile} disabled={parsing} />
      </label>
      {error && (
        <p className="flex items-start gap-2 text-xs leading-5 text-[hsl(var(--accent))]" role="alert">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

function ImportReview({
  fileName,
  importedDays,
  onApply,
  onCancel,
}: {
  fileName: string;
  importedDays: ImportedDay[];
  onApply: () => void;
  onCancel: () => void;
}) {
  const importedDayCount = importedDays.filter((day) => day.exercises.length > 0).length;
  const movementCount = importedDays.reduce((total, day) => total + day.exercises.length, 0);
  return (
    <div className="mt-4 rounded-2xl border border-[hsl(var(--accent))]/45 bg-[hsl(var(--accent))]/[.06] p-4" data-testid="panel-pdf-review">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><FileText size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{fileName}</p>
          <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Found {movementCount} movement{movementCount === 1 ? '' : 's'} across {importedDayCount} day{importedDayCount === 1 ? '' : 's'}.</p>
        </div>
        <button type="button" aria-label="Remove imported PDF" onClick={onCancel} className="rounded-lg p-1 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--card))] hover:text-[hsl(var(--foreground))]"><X size={16} /></button>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">You can edit every movement after importing.</p>
        <button type="button" onClick={onApply} className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-0.5" data-testid="button-apply-pdf-import">Use this plan</button>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  className = '',
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={`button-${label.toLowerCase().replaceAll(' ', '-')}`}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-xl transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function Setup() {
  const [name, setName] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const [importedDays, setImportedDays] = useState<ImportedDay[] | null>(null);
  const [importedFileName, setImportedFileName] = useState('');
  const [, setLocation] = useLocation();

  const begin = () => {
    const plan = importedDays ? buildImportedPlan(name, date, importedDays) : makePlan(name, date);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    setLocation('/');
    window.location.reload();
  };

  return (
    <main className="app-shell flex min-h-[100dvh] items-center justify-center px-5 py-10">
      <div className="texture" />
      <section className="page-enter relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[var(--shadow-soft)] lg:grid-cols-[1.1fr_.9fr]">
        <div className="relative overflow-hidden bg-[hsl(var(--sidebar))] px-7 py-10 text-[hsl(var(--sidebar-foreground))] sm:px-12 sm:py-14">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border-[40px] border-[hsl(var(--accent))]/20" />
          <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full border-[55px] border-[hsl(var(--primary))]/30" />
          <div className="relative">
            <div className="mb-20 flex items-center gap-3 text-sm font-semibold tracking-wide">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Activity size={19} /></span>
              steady / thirty
            </div>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[.24em] text-[hsl(var(--accent))]">a month of showing up</p>
            <h1 className="max-w-md font-display text-5xl leading-[.96] tracking-[-.045em] sm:text-7xl">
              Build a rhythm you can return to.
            </h1>
            <p className="mt-7 max-w-sm text-base leading-7 text-[hsl(var(--sidebar-foreground))]/70">
              Thirty small invitations to move, get stronger, and notice what your body is telling you.
            </p>
            <div className="mt-14 flex items-center gap-3 text-sm text-[hsl(var(--sidebar-foreground))]/70">
              <span className="h-2 w-2 rounded-full bg-[hsl(var(--accent))]" />
              Your plan stays on this device
            </div>
          </div>
        </div>
        <div className="px-7 py-10 sm:px-12 sm:py-14">
          <div className="mb-10 flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
            <Sparkles size={17} className="text-[hsl(var(--accent))]" />
            <span className="text-sm font-medium">Set up your month</span>
          </div>
          <h2 className="font-display text-4xl leading-tight tracking-[-.03em]">Start where you are.</h2>
          <p className="mt-3 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            Name this chapter, choose day one, and let the plan take shape as you do.
          </p>
          <div className="mt-10 space-y-5">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">What are you calling this month?</span>
              <input
                data-testid="input-plan-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Spring strength"
                className="h-13 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent))]/10"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Day one</span>
              <input
                data-testid="input-start-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-13 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 text-[hsl(var(--foreground))] outline-none transition focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent))]/10"
              />
            </label>
          </div>
          <PdfImportPicker onParsed={(days, fileName) => { setImportedDays(days); setImportedFileName(fileName); }} />
          {importedDays && (
            <ImportReview fileName={importedFileName} importedDays={importedDays} onApply={begin} onCancel={() => { setImportedDays(null); setImportedFileName(''); }} />
          )}
          <button
            type="button"
            data-testid="button-begin-month"
            onClick={begin}
            className="mt-10 flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[hsl(var(--primary))] font-semibold text-[hsl(var(--primary-foreground))] shadow-lg shadow-[hsl(var(--primary))]/20 transition hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0"
          >
            {importedDays ? 'Import and begin my 30 days' : 'Begin my 30 days'} <ArrowRight size={18} />
          </button>
          <p className="mt-5 text-center text-xs text-[hsl(var(--muted-foreground))]">{importedDays ? 'Your PDF movements will be ready to edit on each day.' : 'A few starter movements are waiting on day one.'}</p>
        </div>
      </section>
    </main>
  );
}

function ProgressMark({ complete, number }: { complete: boolean; number: number }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all duration-300 ${complete ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]'}`}>
      {complete ? <Check size={15} strokeWidth={3} /> : number}
    </span>
  );
}

function DayCell({ day, selected, onClick }: { day: WorkoutDay; selected: boolean; onClick: () => void }) {
  const hasExercises = day.exercises.length > 0;
  return (
    <button
      type="button"
      data-testid={`button-day-${day.index}`}
      onClick={onClick}
      className={`group min-w-[72px] rounded-2xl border px-2 py-3 text-center transition-all duration-200 hover:-translate-y-1 sm:min-w-0 ${selected ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-lg shadow-[hsl(var(--primary))]/15' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--accent))]/60'}`}
    >
      <span className={`block text-[10px] font-bold uppercase tracking-[.12em] ${selected ? 'text-[hsl(var(--primary-foreground))]/65' : 'text-[hsl(var(--muted-foreground))]'}`}>{day.weekday}</span>
      <span className="my-1 block font-display text-xl">{day.index}</span>
      <span className={`mx-auto flex h-1.5 w-1.5 rounded-full ${day.complete ? 'bg-[hsl(var(--accent))]' : hasExercises ? (selected ? 'bg-[hsl(var(--primary-foreground))]/50' : 'bg-[hsl(var(--primary))]/40') : 'bg-[hsl(var(--border))]'}`} />
    </button>
  );
}

function ExerciseCard({
  exercise,
  dayIndex,
  onUpdate,
  onDelete,
}: {
  exercise: Exercise;
  dayIndex: number;
  onUpdate: (next: Exercise) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(exercise);
  useEffect(() => setDraft(exercise), [exercise]);
  const completedSets = exercise.sets.filter((set) => set.complete).length;

  const updateSet = (setId: string, field: 'weight' | 'reps', value: string) => {
    onUpdate({ ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, [field]: value } : set) });
  };
  const toggleSet = (setId: string) => {
    onUpdate({ ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, complete: !set.complete } : set) });
  };

  return (
    <article className={`pop-enter rounded-2xl border bg-[hsl(var(--card))] p-4 shadow-[0_6px_24px_rgba(29,61,60,.04)] transition-all duration-300 sm:p-5 ${exercise.complete ? 'border-[hsl(var(--accent))]/50' : 'border-[hsl(var(--border))]'}`} data-testid={`card-exercise-${exercise.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            data-testid={`button-complete-exercise-${exercise.id}`}
            aria-label={`Mark ${exercise.name} complete`}
            onClick={() => onUpdate({ ...exercise, complete: !exercise.complete })}
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 ${exercise.complete ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] text-transparent hover:border-[hsl(var(--accent))]'}`}
          >
            <Check size={15} strokeWidth={3} />
          </button>
          <div className="min-w-0">
            {editing ? (
              <input value={draft.name} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="h-9 w-full min-w-0 rounded-lg border border-[hsl(var(--accent))] bg-[hsl(var(--background))] px-2 font-semibold outline-none" data-testid={`input-exercise-name-${exercise.id}`} />
            ) : (
              <h3 className={`truncate text-base font-bold ${exercise.complete ? 'text-[hsl(var(--muted-foreground))] line-through' : ''}`} data-testid={`text-exercise-name-${exercise.id}`}>{exercise.name}</h3>
            )}
            {editing ? (
              <input value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} className="mt-1 h-7 w-full rounded-md bg-[hsl(var(--muted))] px-2 text-xs outline-none" placeholder="Muscle group or intention" data-testid={`input-exercise-target-${exercise.id}`} />
            ) : <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{exercise.target || 'Move with intention'}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 hidden text-xs text-[hsl(var(--muted-foreground))] sm:inline">{completedSets}/{exercise.sets.length} sets</span>
          {editing ? (
            <>
              <IconButton label="save exercise" onClick={() => { onUpdate({ ...draft, name: draft.name.trim() || 'Untitled movement' }); setEditing(false); }} className="h-8 w-8 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"><Save size={16} /></IconButton>
              <IconButton label="cancel edit" onClick={() => { setDraft(exercise); setEditing(false); }} className="h-8 w-8 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={16} /></IconButton>
            </>
          ) : (
            <>
              <IconButton label={`edit ${exercise.name}`} onClick={() => setEditing(true)} className="h-8 w-8 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><Pencil size={15} /></IconButton>
              <IconButton label={`delete ${exercise.name}`} onClick={onDelete} className="h-8 w-8 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/10 hover:text-[hsl(var(--accent))]"><Trash2 size={15} /></IconButton>
            </>
          )}
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-[hsl(var(--border))]">
        <div className="grid grid-cols-[34px_1fr_1fr_38px] items-center gap-2 bg-[hsl(var(--muted))]/60 px-3 py-2 text-[10px] font-bold uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]">
          <span>#</span><span>Reps</span><span>Load</span><span />
        </div>
        {exercise.sets.map((set, index) => (
          <div key={set.id} className={`grid grid-cols-[34px_1fr_1fr_38px] items-center gap-2 border-t border-[hsl(var(--border))] px-3 py-2.5 transition-colors ${set.complete ? 'bg-[hsl(var(--accent))]/[.07]' : ''}`}>
            <span className={`font-mono text-xs ${set.complete ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{String(index + 1).padStart(2, '0')}</span>
            <input aria-label={`Reps set ${index + 1}`} data-testid={`input-reps-${exercise.id}-${index}`} value={set.reps} onChange={(event) => updateSet(set.id, 'reps', event.target.value)} className="h-8 w-full rounded-lg bg-[hsl(var(--background))] px-2 text-sm outline-none ring-1 ring-transparent transition focus:ring-[hsl(var(--accent))]" />
            <div className="flex items-center gap-1">
              <input aria-label={`Weight set ${index + 1}`} data-testid={`input-weight-${exercise.id}-${index}`} value={set.weight} onChange={(event) => updateSet(set.id, 'weight', event.target.value)} placeholder="—" className="h-8 w-full rounded-lg bg-[hsl(var(--background))] px-2 text-sm outline-none ring-1 ring-transparent transition focus:ring-[hsl(var(--accent))]" />
              <span className="hidden text-[10px] text-[hsl(var(--muted-foreground))] sm:inline">kg</span>
            </div>
            <button type="button" data-testid={`button-complete-set-${exercise.id}-${index}`} aria-label={`Complete set ${index + 1}`} onClick={() => toggleSet(set.id)} className={`ml-auto flex h-7 w-7 items-center justify-center rounded-full border transition-all ${set.complete ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] text-transparent hover:border-[hsl(var(--accent))]'}`}><Check size={13} strokeWidth={3} /></button>
          </div>
        ))}
      </div>
      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" data-testid={`button-add-set-${exercise.id}`} onClick={() => setDraft({ ...draft, sets: [...draft.sets, { id: uid('set'), reps: '8', weight: '', complete: false }] })} className="text-xs font-bold text-[hsl(var(--primary))] hover:underline">+ add set</button>
          {draft.sets.length > 1 && <button type="button" data-testid={`button-remove-set-${exercise.id}`} onClick={() => setDraft({ ...draft, sets: draft.sets.slice(0, -1) })} className="text-xs text-[hsl(var(--muted-foreground))] hover:underline">remove last</button>}
        </div>
      )}
      <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">Day {dayIndex} · record what you did, not what you meant to do.</p>
    </article>
  );
}

function WorkoutMode({
  day,
  onClose,
  onUpdateExercise,
  onCompleteDay,
}: {
  day: WorkoutDay;
  onClose: () => void;
  onUpdateExercise: (exercise: Exercise) => void;
  onCompleteDay: () => void;
}) {
  const [queue] = useState(() => day.exercises.filter((exercise) => !exercise.complete).map((exercise) => exercise.id));
  const [position, setPosition] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [pointerStart, setPointerStart] = useState<number | null>(null);
  const currentId = queue[position];
  const exercise = day.exercises.find((item) => item.id === currentId);
  const completedBefore = day.exercises.filter((item) => item.complete).length;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const updateSet = (setId: string, field: 'weight' | 'reps', value: string) => {
    if (!exercise) return;
    onUpdateExercise({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === setId ? { ...set, [field]: value } : set),
    });
  };

  const toggleSet = (setId: string) => {
    if (!exercise) return;
    onUpdateExercise({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === setId ? { ...set, complete: !set.complete } : set),
    });
  };

  const finishExercise = () => {
    if (!exercise) return;
    onUpdateExercise({
      ...exercise,
      complete: true,
      sets: exercise.sets.map((set) => ({ ...set, complete: true })),
    });
    setDragX(0);
    setPointerStart(null);
    if (position === queue.length - 1) onCompleteDay();
    setPosition((currentPosition) => currentPosition + 1);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setPointerStart(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerStart !== null) setDragX(event.clientX - pointerStart);
  };

  const handlePointerUp = () => {
    if (Math.abs(dragX) > 110) {
      finishExercise();
    } else {
      setDragX(0);
      setPointerStart(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex min-h-[100dvh] flex-col overflow-y-auto bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))]" role="dialog" aria-modal="true" aria-label={`${day.focus} workout`}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground))]/55">Day {day.index} · {day.weekday}</p>
            <h2 className="mt-2 font-display text-3xl tracking-[-.035em]">{day.focus}</h2>
          </div>
          <button type="button" data-testid="button-close-workout-mode" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl border border-[hsl(var(--sidebar-foreground))]/15 text-[hsl(var(--sidebar-foreground))]/65 transition hover:bg-[hsl(var(--sidebar-foreground))]/10 hover:text-[hsl(var(--sidebar-foreground))]" aria-label="Close workout mode"><X size={20} /></button>
        </header>

        <div className="mt-8 flex items-center justify-between text-xs text-[hsl(var(--sidebar-foreground))]/55">
          <span>{exercise ? `Movement ${position + 1} of ${queue.length}` : 'Session complete'}</span>
          <span>{completedBefore + (exercise ? 0 : queue.length)} of {day.exercises.length} movements checked</span>
        </div>

        {day.exercises.length === 0 ? (
          <div className="my-auto py-12 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><HeartPulse size={30} /></span>
            <p className="mt-7 font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--accent))]">Open day</p>
            <h3 className="mt-3 font-display text-5xl leading-none tracking-[-.04em]">Make space to recover.</h3>
            <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[hsl(var(--sidebar-foreground))]/60">There are no movements planned here yet. You can add one from your month view when you know what you need.</p>
            <button type="button" data-testid="button-close-empty-workout" onClick={onClose} className="mt-8 rounded-xl bg-[hsl(var(--accent))] px-5 py-3 text-sm font-bold text-[hsl(var(--accent-foreground))] transition hover:-translate-y-0.5">Return to your month</button>
          </div>
        ) : exercise ? (
          <div
            className="my-auto py-8"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => { setDragX(0); setPointerStart(null); }}
            style={{ touchAction: 'none' }}
          >
            <article
              data-testid={`card-workout-mode-${exercise.id}`}
              className="relative overflow-hidden rounded-[2rem] border border-[hsl(var(--sidebar-foreground))]/12 bg-[hsl(var(--card))] p-6 text-[hsl(var(--foreground))] shadow-2xl sm:p-9"
              style={{ transform: `translate3d(${dragX}px, 0, 0) rotate(${dragX / 22}deg)`, transition: pointerStart === null ? 'transform 220ms ease' : 'none' }}
            >
              <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full border-[34px] border-[hsl(var(--accent))]/10" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--accent))]">Your next movement</p>
                    <h3 className="mt-4 max-w-md font-display text-4xl leading-[.98] tracking-[-.04em] sm:text-6xl">{exercise.name}</h3>
                    <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{exercise.target || 'Move with intention'}</p>
                  </div>
                  <Dumbbell size={23} className="mt-1 shrink-0 text-[hsl(var(--accent))]" />
                </div>

                <div className="mt-8 flex items-center gap-3 rounded-2xl bg-[hsl(var(--secondary))] px-4 py-3">
                  <span className="font-display text-3xl">{exercise.sets.length}</span>
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">sets</span>
                  <span className="h-5 w-px bg-[hsl(var(--border))]" />
                  <span className="font-display text-3xl">{exercise.sets[0]?.reps || '—'}</span>
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">reps each</span>
                </div>

                <div className="mt-6 overflow-hidden rounded-2xl border border-[hsl(var(--border))]">
                  <div className="grid grid-cols-[40px_1fr_1fr_38px] items-center gap-2 bg-[hsl(var(--muted))]/55 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">
                    <span>#</span><span>Reps</span><span>Load</span><span />
                  </div>
                  {exercise.sets.map((set, index) => (
                    <div key={set.id} className={`grid grid-cols-[40px_1fr_1fr_38px] items-center gap-2 border-t border-[hsl(var(--border))] px-4 py-3 ${set.complete ? 'bg-[hsl(var(--accent))]/[.07]' : ''}`}>
                      <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{String(index + 1).padStart(2, '0')}</span>
                      <input aria-label={`Workout mode reps set ${index + 1}`} data-testid={`input-workout-reps-${exercise.id}-${index}`} value={set.reps} onChange={(event) => updateSet(set.id, 'reps', event.target.value)} className="h-9 w-full rounded-lg bg-[hsl(var(--background))] px-2 text-sm outline-none ring-1 ring-transparent focus:ring-[hsl(var(--accent))]" />
                      <div className="flex items-center gap-1">
                        <input aria-label={`Workout mode weight set ${index + 1}`} data-testid={`input-workout-weight-${exercise.id}-${index}`} value={set.weight} onChange={(event) => updateSet(set.id, 'weight', event.target.value)} placeholder="Add load" className="h-9 w-full rounded-lg bg-[hsl(var(--background))] px-2 text-sm outline-none ring-1 ring-transparent focus:ring-[hsl(var(--accent))]" />
                        <span className="hidden text-[10px] text-[hsl(var(--muted-foreground))] sm:inline">kg</span>
                      </div>
                      <button type="button" data-testid={`button-workout-complete-set-${exercise.id}-${index}`} onClick={() => toggleSet(set.id)} className={`ml-auto flex h-7 w-7 items-center justify-center rounded-full border transition ${set.complete ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'border-[hsl(var(--border))] text-transparent hover:border-[hsl(var(--accent))]'}`} aria-label={`Complete workout set ${index + 1}`}><Check size={13} strokeWidth={3} /></button>
                    </div>
                  ))}
                </div>

                <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center justify-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] sm:justify-start"><ChevronLeft size={14} /> Swipe this card when you finish <ChevronRight size={14} /></p>
                  <button type="button" data-testid={`button-finish-workout-exercise-${exercise.id}`} onClick={finishExercise} className="flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-0.5"><Check size={16} /> Done — next movement</button>
                </div>
              </div>
            </article>
          </div>
        ) : (
          <div className="my-auto py-12 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Check size={30} strokeWidth={3} /></span>
            <p className="mt-7 font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--accent))]">Nice work</p>
            <h3 className="mt-3 font-display text-5xl leading-none tracking-[-.04em]">Session complete.</h3>
            <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[hsl(var(--sidebar-foreground))]/60">Every movement is checked off. Your loads and reps are saved with today’s workout.</p>
            <button type="button" data-testid="button-close-complete-workout" onClick={onClose} className="mt-8 rounded-xl bg-[hsl(var(--accent))] px-5 py-3 text-sm font-bold text-[hsl(var(--accent-foreground))] transition hover:-translate-y-0.5">Return to your month</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Dashboard({ initialPlan }: { initialPlan: Plan }) {
  const [plan, setPlan] = useState(initialPlan);
  const [selected, setSelected] = useState(0);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importedDays, setImportedDays] = useState<ImportedDay[] | null>(null);
  const [importedFileName, setImportedFileName] = useState('');
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [saved, setSaved] = useState(false);
  const current = plan.days[selected];
  const completedDays = plan.days.filter((day) => day.complete).length;
  const exercisesDone = plan.days.flatMap((day) => day.exercises).filter((exercise) => exercise.complete).length;
  const totalExercises = plan.days.flatMap((day) => day.exercises).length;
  const progress = Math.round((completedDays / 30) * 100);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    setSaved(true);
    const timeout = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [plan]);

  const updateDay = (index: number, update: (day: WorkoutDay) => WorkoutDay) => {
    setPlan((previous) => ({ ...previous, days: previous.days.map((day, dayIndex) => dayIndex === index ? update(day) : day) }));
  };
  const setExercise = (exercise: Exercise) => updateDay(selected, (day) => ({ ...day, exercises: day.exercises.map((item) => item.id === exercise.id ? exercise : item) }));
  const removeExercise = (id: string) => {
    if (!window.confirm('Remove this movement from the day?')) return;
    updateDay(selected, (day) => ({ ...day, exercises: day.exercises.filter((exercise) => exercise.id !== id) }));
  };
  const addExercise = () => {
    if (!newName.trim()) return;
    updateDay(selected, (day) => ({ ...day, exercises: [...day.exercises, sampleExercise(newName, newTarget)] }));
    setNewName('');
    setNewTarget('');
    setAdding(false);
  };
  const toggleDay = () => updateDay(selected, (day) => ({ ...day, complete: !day.complete }));
  const completeDay = () => updateDay(selected, (day) => ({ ...day, complete: true }));
  const reset = () => {
    if (window.confirm('Start over? This clears this month from this device.')) {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    }
  };
  const applyImportedPlan = () => {
    if (!importedDays) return;
    setPlan(buildImportedPlan(plan.name, plan.startDate, importedDays));
    setImportedDays(null);
    setImportedFileName('');
    setSelected(0);
  };

  return (
    <div className="app-shell min-h-[100dvh]">
      <div className="texture" />
      <aside className="relative z-10 hidden min-h-[100dvh] w-[250px] shrink-0 flex-col bg-[hsl(var(--sidebar))] px-6 py-7 text-[hsl(var(--sidebar-foreground))] lg:flex">
        <div className="flex items-center gap-3 text-sm font-semibold tracking-wide"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Activity size={18} /></span>steady / thirty</div>
        <div className="mt-20">
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground))]/45">Your month</p>
          <h2 className="mt-3 font-display text-3xl leading-tight">{plan.name}</h2>
          <p className="mt-2 text-sm text-[hsl(var(--sidebar-foreground))]/55">{formatDay(plan.startDate)} — {formatDay(plan.days[29].date)}</p>
        </div>
        <div className="mt-auto rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent))]/45 p-4">
          <div className="flex items-center justify-between text-xs"><span className="text-[hsl(var(--sidebar-foreground))]/60">Month progress</span><span className="font-mono text-[hsl(var(--accent))]">{progress}%</span></div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--sidebar-foreground))]/10"><div className="h-full rounded-full bg-[hsl(var(--accent))] transition-all duration-500" style={{ width: `${progress}%` }} /></div>
          <p className="mt-3 text-xs leading-5 text-[hsl(var(--sidebar-foreground))]/55">{completedDays === 0 ? 'Your first check-in is waiting.' : `${completedDays} days in the books. Keep the thread.`}</p>
        </div>
        <button type="button" data-testid="button-reset-month" onClick={reset} className="mt-5 flex items-center gap-2 px-1 text-xs text-[hsl(var(--sidebar-foreground))]/45 transition hover:text-[hsl(var(--sidebar-foreground))]"><RotateCcw size={13} /> Reset month</button>
      </aside>
      <main className="relative z-10 min-w-0 flex-1">
        <header className="flex items-center justify-between px-5 py-5 sm:px-8 lg:px-12 lg:py-8">
          <div className="flex items-center gap-3 lg:hidden"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"><Activity size={18} /></span><span className="text-sm font-semibold tracking-wide">steady / thirty</span></div>
          <div className="hidden lg:block"><p className="font-mono text-[10px] uppercase tracking-[.22em] text-[hsl(var(--muted-foreground))]">30-day training companion</p><h1 className="mt-2 font-display text-3xl tracking-[-.03em]">Make space for the work.</h1></div>
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><span className={`h-2 w-2 rounded-full ${saved ? 'bg-[hsl(var(--accent))] pulse-soft' : 'bg-[hsl(var(--primary))]'}`} />{saved ? 'Saved just now' : 'Saved on this device'}</div>
        </header>
        <div className="mx-auto max-w-[1380px] px-5 pb-10 sm:px-8 lg:px-12">
          <div className="page-enter rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/70 p-4 shadow-[var(--shadow-soft)] sm:p-5">
            <div className="mb-4 flex items-center justify-between px-1">
              <div className="flex items-center gap-2"><CalendarDays size={16} className="text-[hsl(var(--accent))]" /><span className="text-sm font-bold">Your 30 days</span></div>
              <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">{completedDays} / 30 complete</span>
            </div>
            <div className="mobile-scroll scrollbar-thin grid grid-cols-[repeat(30,minmax(72px,1fr))] gap-2 pb-1 lg:grid-cols-[repeat(15,minmax(0,1fr))] xl:grid-cols-[repeat(30,minmax(0,1fr))]">
              {plan.days.map((day, index) => <DayCell key={day.index} day={day} selected={selected === index} onClick={() => { setSelected(index); setWorkoutOpen(true); }} />)}
            </div>
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <FileText size={16} className="text-[hsl(var(--accent))]" />
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Have a plan already? Import the next month from a PDF.</p>
              </div>
              <PdfImportPicker compact onParsed={(days, fileName) => { setImportedDays(days); setImportedFileName(fileName); }} />
            </div>
            {importedDays && (
              <ImportReview fileName={importedFileName} importedDays={importedDays} onApply={applyImportedPlan} onCancel={() => { setImportedDays(null); setImportedFileName(''); }} />
            )}
          </div>

          <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,.65fr)]">
            <section className="page-enter stagger-1">
              <div className="mb-6 flex items-end justify-between gap-4">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]"><span>Day {current.index}</span><span className="h-1 w-1 rounded-full bg-[hsl(var(--border))]" /><span>{current.focus}</span></div>
                  <h2 className="font-display text-4xl tracking-[-.04em] sm:text-5xl">{longDate(current.date)}</h2>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" data-testid="button-start-workout" onClick={() => setWorkoutOpen(true)} className="mr-1 hidden items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-0.5 sm:flex"><Dumbbell size={14} /> Start session</button>
                  <IconButton label="previous day" onClick={() => setSelected(Math.max(0, selected - 1))} disabled={selected === 0} className="h-10 w-10 border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--accent))]"><ChevronLeft size={18} /></IconButton>
                  <IconButton label="next day" onClick={() => setSelected(Math.min(29, selected + 1))} disabled={selected === 29} className="h-10 w-10 border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--accent))]"><ChevronRight size={18} /></IconButton>
                </div>
              </div>
              <div className="mb-5 flex items-center justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-4 py-3">
                <div className="flex items-center gap-3"><HeartPulse size={17} className="text-[hsl(var(--accent))]" /><p className="text-sm text-[hsl(var(--muted-foreground))]">{current.exercises.length ? `${current.exercises.length} movement${current.exercises.length === 1 ? '' : 's'} planned` : 'An open day can still be a strong day.'}</p></div>
                <button type="button" data-testid="button-complete-day" onClick={toggleDay} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${current.complete ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'bg-[hsl(var(--card))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))]'}`}><Check size={14} /> {current.complete ? 'Day complete' : 'Complete day'}</button>
              </div>
              <div className="space-y-4">
                {current.exercises.length === 0 && !adding && (
                  <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))]/55 px-6 py-12 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Layers3 size={24} /></div>
                    <h3 className="mt-5 font-display text-2xl">A clean page for today.</h3>
                    <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[hsl(var(--muted-foreground))]">Add a movement when you know what you need. Rest and recovery count too.</p>
                    <button type="button" data-testid="button-add-first-exercise" onClick={() => setAdding(true)} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-0.5"><Plus size={17} /> Add first movement</button>
                  </div>
                )}
                {current.exercises.map((exercise) => <ExerciseCard key={exercise.id} exercise={exercise} dayIndex={current.index} onUpdate={setExercise} onDelete={() => removeExercise(exercise.id)} />)}
                {adding && (
                  <div className="pop-enter rounded-2xl border border-[hsl(var(--accent))]/45 bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-soft)]">
                    <div className="flex items-center justify-between"><h3 className="font-display text-2xl">Add a movement</h3><IconButton label="close add movement" onClick={() => setAdding(false)} className="h-8 w-8 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={17} /></IconButton></div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <input autoFocus data-testid="input-new-exercise-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Movement name" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]" />
                      <input data-testid="input-new-exercise-target" value={newTarget} onChange={(event) => setNewTarget(event.target.value)} placeholder="Focus (optional)" className="h-11 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]" />
                    </div>
                    <div className="mt-4 flex justify-end gap-2"><button type="button" data-testid="button-cancel-add" onClick={() => setAdding(false)} className="rounded-lg px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">Cancel</button><button type="button" data-testid="button-save-new-exercise" onClick={addExercise} className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-40" disabled={!newName.trim()}>Save movement</button></div>
                  </div>
                )}
                {current.exercises.length > 0 && !adding && <button type="button" data-testid="button-add-exercise" onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[hsl(var(--border))] py-4 text-sm font-bold text-[hsl(var(--primary))] transition hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/5"><Plus size={17} /> Add another movement</button>}
              </div>
            </section>

            <aside className="page-enter stagger-2 space-y-4">
              <div className="relative overflow-hidden rounded-3xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))]">
                <div className="absolute -right-14 -top-14 h-44 w-44 rounded-full border-[26px] border-[hsl(var(--primary-foreground))]/[.07]" />
                <div className="relative">
                  <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--primary-foreground))]/60">Month pulse</p><Flame size={18} className="text-[hsl(var(--accent))]" /></div>
                  <div className="mt-7 flex items-end gap-3"><span className="font-display text-6xl leading-none">{progress}</span><span className="mb-1 font-mono text-sm text-[hsl(var(--primary-foreground))]/60">%</span></div>
                  <p className="mt-3 text-sm leading-6 text-[hsl(var(--primary-foreground))]/65">{completedDays ? 'Consistency is a practice, not a personality trait.' : 'Every month starts with one honest check-in.'}</p>
                  <div className="mt-6 h-2 overflow-hidden rounded-full bg-[hsl(var(--primary-foreground))]/10"><div className="h-full rounded-full bg-[hsl(var(--accent))] transition-all duration-500" style={{ width: `${Math.max(progress, 2)}%` }} /></div>
                </div>
              </div>
              <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
                <p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">A little context</p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-[hsl(var(--muted))]/55 p-4"><Dumbbell size={16} className="text-[hsl(var(--accent))]" /><strong className="mt-3 block font-display text-3xl">{totalExercises}</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">movements planned</span></div>
                  <div className="rounded-2xl bg-[hsl(var(--muted))]/55 p-4"><Check size={16} className="text-[hsl(var(--primary))]" /><strong className="mt-3 block font-display text-3xl">{exercisesDone}</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">movements done</span></div>
                </div>
                <div className="mt-5 flex items-start gap-3 border-t border-[hsl(var(--border))] pt-5"><Sparkles size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">There is no perfect pace. The useful thing is noticing, then choosing the next small action.</p></div>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/50 p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]"><span className="font-bold text-[hsl(var(--foreground))]">Current day:</span> {formatDay(current.date)} · {current.focus}. Use the arrows or tap any day above to move through your month.</div>
              <button type="button" data-testid="button-reset-month-mobile" onClick={reset} className="flex items-center gap-2 px-1 text-xs text-[hsl(var(--muted-foreground))] lg:hidden"><RotateCcw size={13} /> Reset month</button>
            </aside>
          </div>
        </div>
      </main>
      {workoutOpen && (
        <WorkoutMode
          day={current}
          onClose={() => setWorkoutOpen(false)}
          onUpdateExercise={setExercise}
          onCompleteDay={completeDay}
        />
      )}
    </div>
  );
}

function Home() {
  const [plan] = useState<Plan | null>(() => loadPlan());
  return plan ? <Dashboard initialPlan={plan} /> : <Setup />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;