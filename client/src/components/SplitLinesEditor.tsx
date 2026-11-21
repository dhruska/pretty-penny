import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { amountFromFields, centsToInput } from '@/lib/money';
import { spreadRemainder } from '@/lib/splits';
import { CategorySelect } from './CategorySelect';
import { Money } from './Money';

export interface SplitLineFields {
  key: number;
  categoryId: number | null;
  memo: string;
  outflow: string;
  inflow: string;
}

/** Converts an amount into the outflow and inflow fields of a line. */
export function amountToFields(cents: number) {
  return {
    outflow: cents < 0 ? centsToInput(cents) : '',
    inflow: cents > 0 ? centsToInput(cents) : '',
  };
}

/** A line's signed amount, treating a blank line as zero, or null if it isn't valid. */
export function lineCents(line: SplitLineFields): number | null {
  if (line.outflow.trim() === '' && line.inflow.trim() === '') return 0;
  const result = amountFromFields(line.outflow, line.inflow);
  return result.error === undefined ? result.cents : null;
}

let nextKey = 1;
export const newLineKey = () => nextKey++;

interface SplitLinesEditorProps {
  lines: SplitLineFields[];
  /** The transaction's amount, or null while it isn't valid. */
  totalCents: number | null;
  onChange: (lines: SplitLineFields[]) => void;
}

export function SplitLinesEditor({ lines, totalCents, onChange }: SplitLinesEditorProps) {
  const amounts = lines.map(lineCents);
  const allValid = amounts.every((amount) => amount !== null);
  const remainingCents =
    totalCents === null || !allValid
      ? null
      : totalCents - amounts.reduce<number>((sum, amount) => sum + amount!, 0);

  function update(index: number, changes: Partial<SplitLineFields>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  }

  function spread() {
    if (remainingCents === null) return;
    const spreadAmounts = spreadRemainder(amounts as number[], remainingCents);
    onChange(lines.map((line, i) => ({ ...line, ...amountToFields(spreadAmounts[i]!) })));
  }

  return (
    <section aria-label="Split lines" className="space-y-2 rounded-md border bg-muted/40 p-2">
      {lines.map((line, index) => {
        const label = `Line ${index + 1}`;
        return (
          <div
            key={line.key}
            // On phones each line is a card: category and Remove, then memo, then amounts.
            className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-md border bg-card p-2 md:grid-cols-[1.3fr_1fr_6rem_6rem_auto] md:border-0 md:bg-transparent md:p-0"
          >
            <div className="col-span-2 max-md:row-start-1 md:col-span-1">
              <CategorySelect
                id={`split-${line.key}-category`}
                aria-label={`${label} category`}
                value={line.categoryId}
                onChange={(categoryId) => update(index, { categoryId })}
              />
            </div>
            <Input
              aria-label={`${label} memo`}
              placeholder="Memo"
              maxLength={500}
              className="col-span-3 md:col-span-1"
              value={line.memo}
              onChange={(event) => update(index, { memo: event.target.value })}
            />
            <Input
              aria-label={`${label} outflow`}
              placeholder="Outflow"
              inputMode="decimal"
              value={line.outflow}
              onChange={(event) => update(index, { outflow: event.target.value })}
            />
            <Input
              aria-label={`${label} inflow`}
              placeholder="Inflow"
              inputMode="decimal"
              className="max-md:col-span-2"
              value={line.inflow}
              onChange={(event) => update(index, { inflow: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${label.toLowerCase()}`}
              className="max-md:col-start-3 max-md:row-start-1"
              disabled={lines.length <= 2}
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([
              ...lines,
              { key: newLineKey(), categoryId: null, memo: '', outflow: '', inflow: '' },
            ])
          }
        >
          Add line
        </Button>
        <div className="flex items-center gap-2 text-sm">
          <span aria-label="Remaining" role="status">
            Remaining{' '}
            {remainingCents === null ? (
              <span className="text-muted-foreground">–</span>
            ) : (
              <Money
                cents={remainingCents}
                className={remainingCents === 0 ? 'text-positive' : undefined}
              />
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={remainingCents === null || remainingCents === 0}
            onClick={spread}
          >
            Spread remaining
          </Button>
        </div>
      </div>
    </section>
  );
}
