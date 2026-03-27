'use client';

import { useEffect, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Header } from '@/components/layout/header';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ActivityEditModal, type ActivityForEdit } from '@/components/ui/activity-edit-modal';
import { formatDate } from '@/lib/utils';
import { ACTIVITY_TYPES } from '@/lib/constants';
import { Plus } from 'lucide-react';
import Link from 'next/link';

interface Activity {
  id: string;
  subject: string;
  type: string;
  done: boolean;
  note?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  organization?: { name: string };
  person?: { id: string; firstName: string };
  deal?: { id: string; title: string };
  assignee?: { name: string };
}

interface ApiResponse { data: Activity[]; total: number; page: number; pageSize: number; }

const STATUS_FILTER = [
  { label: 'All', value: null },
  { label: 'Pending', value: false },
  { label: 'Done', value: true },
];

export default function ActivitiesPage() {
  const [data, setData] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [doneFilter, setDoneFilter] = useState<boolean | null>(null);
  const [editingActivity, setEditingActivity] = useState<ActivityForEdit | null>(null);
  const PAGE_SIZE = 25;

  const debouncedSearch = useCallback((query: string) => {
    const timer = setTimeout(() => { setSearch(query); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => { const cleanup = debouncedSearch(search); return cleanup; }, [search, debouncedSearch]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ search, page: page.toString(), pageSize: PAGE_SIZE.toString() });
      if (doneFilter !== null) params.append('done', doneFilter.toString());
      const response = await fetch(`/api/activities?${params}`);
      const result: ApiResponse = await response.json();
      setData(result.data);
      setTotal(result.total);
    } catch (error) { console.error('Failed to fetch activities:', error); }
    finally { setIsLoading(false); }
  }, [search, page, doneFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: ColumnDef<Activity>[] = [
    { accessorKey: 'subject', header: 'Subject', cell: ({ row }) => <span className="font-medium">{row.original.subject}</span> },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => <Badge variant="secondary">{ACTIVITY_TYPES.find(t => t.value === row.original.type)?.label || row.original.type}</Badge> },
    { accessorKey: 'done', header: 'Status', cell: ({ row }) => <Badge variant={row.original.done ? 'success' : 'warning'}>{row.original.done ? 'Done' : 'Pending'}</Badge> },
    { accessorKey: 'dueDate', header: 'Due date', cell: ({ row }) => row.original.dueDate ? <span className="tabular-nums">{formatDate(row.original.dueDate)}</span> : <span className="text-muted-foreground">—</span> },
    { accessorKey: 'organization.name', header: 'Organization', cell: ({ row }) => row.original.organization?.name || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'deal.title', header: 'Deal', cell: ({ row }) => row.original.deal?.title || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'assignee.name', header: 'Assignee', cell: ({ row }) => row.original.assignee?.name || <span className="text-muted-foreground">—</span> },
  ];

  return (
    <div className="flex flex-col h-full">
      <Header title="Activities" description={`${total} activities`}>
        <Button asChild size="sm"><Link href="/activities/new"><Plus className="h-3.5 w-3.5" />New activity</Link></Button>
      </Header>
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex gap-1 mb-4">
          {STATUS_FILTER.map((status) => (
            <Button key={String(status.value)} variant={doneFilter === status.value ? 'default' : 'ghost'} size="sm" onClick={() => { setDoneFilter(status.value); setPage(0); }}>
              {status.label}
            </Button>
          ))}
        </div>
        <DataTable
          columns={columns}
          data={data}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          pageIndex={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onSearch={(q) => { setSearch(q); setPage(0); }}
          searchPlaceholder="Search activities..."
          isLoading={isLoading}
          onRowClick={(row) => setEditingActivity({
            id: row.id,
            subject: row.subject,
            type: row.type,
            done: row.done,
            note: row.note,
            dueDate: row.dueDate,
            dueTime: row.dueTime,
          })}
        />
      </div>

      {editingActivity && (
        <ActivityEditModal
          activity={editingActivity}
          onClose={() => setEditingActivity(null)}
          onSaved={() => { setEditingActivity(null); fetchData(); }}
        />
      )}
    </div>
  );
}
