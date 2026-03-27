'use client';

import { useEffect, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Header } from '@/components/layout/header';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { formatDate, formatCurrency } from '@/lib/utils';
import { Plus } from 'lucide-react';
import Link from 'next/link';

interface Lead {
  id: string;
  title: string;
  value?: number;
  currency?: string;
  origin?: string;
  organization?: { id: string; name: string };
  person?: { id: string; firstName: string; lastName: string };
  owner?: { name: string };
  createdAt: string;
}

interface ApiResponse { data: Lead[]; total: number; page: number; pageSize: number; }

export default function LeadsPage() {
  const [data, setData] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 25;

  const debouncedSearch = useCallback((query: string) => {
    const timer = setTimeout(() => { setSearch(query); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => { const cleanup = debouncedSearch(search); return cleanup; }, [search, debouncedSearch]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ search, page: page.toString(), pageSize: PAGE_SIZE.toString(), isLead: 'true' });
        const response = await fetch(`/api/deals?${params}`);
        const result: ApiResponse = await response.json();
        setData(result.data);
        setTotal(result.total);
      } catch (error) { console.error('Failed to fetch leads:', error); }
      finally { setIsLoading(false); }
    };
    fetchData();
  }, [search, page]);

  const columns: ColumnDef<Lead>[] = [
    { accessorKey: 'title', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.title}</span> },
    { accessorKey: 'value', header: 'Value', cell: ({ row }) => row.original.value ? <span className="font-medium tabular-nums">{formatCurrency(row.original.value, row.original.currency)}</span> : <span className="text-muted-foreground">—</span> },
    { accessorKey: 'organization.name', header: 'Organization', cell: ({ row }) => row.original.organization?.name || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'person.name', header: 'Contact', cell: ({ row }) => row.original.person ? `${row.original.person.firstName} ${row.original.person.lastName}` : <span className="text-muted-foreground">—</span> },
    { accessorKey: 'origin', header: 'Source', cell: ({ row }) => row.original.origin || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'owner.name', header: 'Owner', cell: ({ row }) => row.original.owner?.name || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'createdAt', header: 'Added', cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{formatDate(row.original.createdAt)}</span> },
  ];

  return (
    <div className="flex flex-col h-full">
      <Header title="Leads" description={`${total} leads`}>
        <Button asChild size="sm"><Link href="/leads/new"><Plus className="h-3.5 w-3.5" />New lead</Link></Button>
      </Header>
      <div className="flex-1 p-6 overflow-auto">
        <DataTable columns={columns} data={data} pageCount={Math.ceil(total / PAGE_SIZE)} pageIndex={page} pageSize={PAGE_SIZE} onPageChange={setPage} onSearch={(q) => { setSearch(q); setPage(0); }} searchPlaceholder="Search leads..." isLoading={isLoading} getRowHref={(row) => `/deals/${row.id}`} />
      </div>
    </div>
  );
}
