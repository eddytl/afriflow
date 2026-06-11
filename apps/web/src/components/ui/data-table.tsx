import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, X, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Checkbox } from './checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

export interface ColumnDef<T> {
  key: string;
  label: string;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
  render?: (row: T) => React.ReactNode;
}

export interface BulkAction {
  icon: React.ReactNode;
  label: string;
  onClick: (ids: string[]) => void;
  variant?: 'default' | 'destructive';
}

interface DataTableProps<T extends { id: string }> {
  data: T[];
  columns: ColumnDef<T>[];
  isLoading?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
  emptyIcon?: React.ReactNode;
  emptyTitle?: string;
  emptyAction?: React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  bulkActions?: BulkAction[];
  filters?: React.ReactNode;
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  defaultPageSize?: number;
}

const PAGE_SIZES = [10, 20, 50];

export function DataTable<T extends { id: string }>({
  data,
  columns,
  isLoading,
  searchPlaceholder = 'Rechercher...',
  searchKeys = [],
  emptyIcon,
  emptyTitle = 'Aucun élément',
  emptyAction,
  rowActions,
  bulkActions = [],
  filters,
  title,
  subtitle,
  headerAction,
  defaultPageSize = 10,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const lower = search.toLowerCase();
    const keys = searchKeys.length ? searchKeys : Object.keys(data[0] ?? {});
    return data.filter((row) =>
      keys.some((k) => {
        const v = (row as Record<string, unknown>)[k];
        return typeof v === 'string' && v.toLowerCase().includes(lower);
      })
    );
  }, [data, search, searchKeys]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = String((a as Record<string, unknown>)[sortKey] ?? '');
      const bv = String((b as Record<string, unknown>)[sortKey] ?? '');
      const cmp = av.localeCompare(bv, 'fr', { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const allSelected = paged.length > 0 && paged.every((r) => selected.has(r.id));
  const someSelected = !allSelected && paged.some((r) => selected.has(r.id));

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(paged.map((r) => r.id)));

  const pageNums = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '…')[] = [1];
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    if (totalPages > 1) pages.push(totalPages);
    return pages;
  };

  const colSpan = columns.length + (rowActions ? 2 : 1);

  return (
    <div className="space-y-3">
      {(title || headerAction) && (
        <div className="flex items-center justify-between">
          <div>
            {title && <h1 className="text-lg font-semibold">{title}</h1>}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {headerAction}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-56"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        {filters}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 px-3">
                <Checkbox
                  checked={allSelected}
                  data-state={someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked'}
                  onCheckedChange={toggleAll}
                  aria-label="Tout sélectionner"
                />
              </TableHead>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.headerClassName}>
                  {col.sortable ? (
                    <button
                      className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      {sortKey === col.key
                        ? sortDir === 'asc'
                          ? <ChevronUp className="h-3.5 w-3.5" />
                          : <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                      }
                    </button>
                  ) : col.label}
                </TableHead>
              ))}
              {rowActions && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: pageSize < 6 ? pageSize : 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-3"><Skeleton className="h-4 w-4 rounded-sm" /></TableCell>
                    {columns.map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                    {rowActions && <TableCell />}
                  </TableRow>
                ))
              : paged.length === 0
              ? (
                <TableRow>
                  <TableCell colSpan={colSpan} className="h-52 text-center">
                    <div className="flex flex-col items-center gap-3 py-6">
                      {emptyIcon && <div className="text-muted-foreground/40">{emptyIcon}</div>}
                      <p className="text-muted-foreground">{emptyTitle}</p>
                      {emptyAction}
                    </div>
                  </TableCell>
                </TableRow>
              )
              : paged.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(selected.has(row.id) && 'bg-muted/60')}
                >
                  <TableCell className="px-3">
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleRow(row.id)}
                      aria-label="Sélectionner"
                    />
                  </TableCell>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '—')}
                    </TableCell>
                  ))}
                  {rowActions && <TableCell>{rowActions(row)}</TableCell>}
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </div>

      {/* Footer — rows per page + pagination */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{sorted.length} résultat{sorted.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>Lignes par page</span>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-8 w-[4.5rem] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent side="top">
              {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-muted-foreground mr-2">Page {page} / {totalPages}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage(1)}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {pageNums().map((p, i) =>
            p === '…'
              ? <span key={`e${i}`} className="w-8 text-center text-muted-foreground">…</span>
              : (
                <Button
                  key={p}
                  variant={page === p ? 'default' : 'outline'}
                  size="icon"
                  className="h-8 w-8 text-xs"
                  onClick={() => setPage(p as number)}
                >
                  {p}
                </Button>
              )
          )}
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Bulk action floating bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border bg-background px-4 py-2 shadow-xl">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(new Set())}>
            <X className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium pr-2">
            {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          {bulkActions.length === 0 && (
            <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Supprimer">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {bulkActions.map((action, i) => (
            <Button
              key={i}
              variant={action.variant === 'destructive' ? 'destructive' : 'outline'}
              size="icon"
              className="h-8 w-8"
              title={action.label}
              onClick={() => { action.onClick(Array.from(selected)); setSelected(new Set()); }}
            >
              {action.icon}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
