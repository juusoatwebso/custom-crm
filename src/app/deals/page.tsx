'use client';

import { useEffect, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Header } from '@/components/layout/header';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatCurrency } from '@/lib/utils';
import { DEAL_STATUSES } from '@/lib/constants';
import { Plus } from 'lucide-react';
import Link from 'next/link';

interface Deal {
  id: string;
  title: string;
  value?: number;
  currency?: string;
  status: string;
  isLead: boolean;
  organization?: { id: string; name: string };
  person?: { id: string; firstName: string; lastName: string };
  stage?: { name: string };
  pipeline?: { name: string };
  owner?: { name: string };
  createdAt: string;
}

interface ApiResponse {
  data: Deal[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUSES = [
  { label: 'All', value: null },
  { label: 'Open', value: 'open' },
  { label: 'Won', value: 'won' },
  { label: 'Lost', value: 'lost' },
];

export default function DealsPage() {
  const [data, setData] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const PAGE_SIZE = 25;

  const debouncedSearch = useCallback((query: string) => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const cleanup = debouncedSearch(search);
    return cleanup;
  }, [search, debouncedSearch]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          search, page: page.toString(), pageSize: PAGE_SIZE.toString(), isLead: 'false',
        });
        if (statusFilter) params.append('status', statusFilter);
        const response = await fetch(`/api/deals?${params}`);
        const result: ApiResponse = await response.json();
        setData(result.data);
        setTotal(result.total);
      } catch (error) {
        console.error('Failed to fetch deals:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [search, page, statusFilter]);

  const columns: ColumnDef<Deal>[] = [
    {
      accessorKey: 'title',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
    },
    {
      accessorKey: 'value',
      header: 'Value',
      cell: ({ row }) =>
        row.original.value
          ? <span className="font-medium tabular-nums">{formatCurrency(row.original.value, row.original.currency)}</span>
          : <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'WON' ? 'success' : row.original.status === 'LOST' ? 'destructive' : 'info'}>
          {DEAL_STATUSES.find(s => s.value === row.original.status)?.label || row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'organization.name',
      header: 'Organization',
      cell: ({ row }) => row.original.organization?.name || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'person.name',
      header: 'Contact',
      cell: ({ row }) =>
        row.original.person
          ? `${row.original.person.firstName} ${row.original.person.lastName}`
          : <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'stage.name',
      header: 'Stage',
      cell: ({ row }) => row.original.stage?.name || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'owner.name',
      header: 'Owner',
      cell: ({ row }) => row.original.owner?.name || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'createdAt',
      header: 'Added',
      cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{formatDate(row.original.createdAt)}</span>,
    },
  ];

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex flex-col h-full">
      <Header title="Deals" description={`${total} deals`}>
        <Button asChild size="sm">
          <Link href="/deals/new">
            <Plus className="h-3.5 w-3.5" />
            New deal
          </Link>
        </Button>
      </Header>
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex gap-1 mb-4">
          {STATUSES.map((status) => (
            <Button
              key={status.value || 'all'}
              variant={statusFilter === status.value ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setStatusFilter(status.value); setPage(0); }}
            >
              {status.label}
            </Button>
          ))}
        </div>

        <DataTable
          columns={columns}
          data={data}
          pageCount={pageCount}
          pageIndex={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onSearch={(query) => { setSearch(query); setPage(0); }}
          searchPlaceholder="Search deals..."
          isLoading={isLoading}
          getRowHref={(row) => `/deals/${row.id}`}
        />
      </div>
    </div>
  );
}
