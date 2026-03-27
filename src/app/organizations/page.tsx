'use client';

import { useEffect, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Header } from '@/components/layout/header';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { Plus } from 'lucide-react';
import Link from 'next/link';

interface Organization {
  id: string;
  name: string;
  ytunnus: string;
  website?: string;
  _count: { persons: number; deals: number };
  owner?: { name: string };
  createdAt: string;
}

interface ApiResponse { data: Organization[]; total: number; page: number; pageSize: number; }

export default function OrganizationsPage() {
  const [data, setData] = useState<Organization[]>([]);
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
        const params = new URLSearchParams({ search, page: page.toString(), pageSize: PAGE_SIZE.toString() });
        const response = await fetch(`/api/organizations?${params}`);
        const result: ApiResponse = await response.json();
        setData(result.data);
        setTotal(result.total);
      } catch (error) { console.error('Failed to fetch organizations:', error); }
      finally { setIsLoading(false); }
    };
    fetchData();
  }, [search, page]);

  const columns: ColumnDef<Organization>[] = [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'ytunnus', header: 'Business ID', cell: ({ row }) => row.original.ytunnus ? <span className="font-mono text-xs tabular-nums">{row.original.ytunnus}</span> : <span className="text-muted-foreground">—</span> },
    { accessorKey: '_count.persons', header: 'People', cell: ({ row }) => <span className="tabular-nums">{row.original._count.persons}</span> },
    { accessorKey: '_count.deals', header: 'Deals', cell: ({ row }) => <span className="tabular-nums">{row.original._count.deals}</span> },
    { accessorKey: 'owner.name', header: 'Owner', cell: ({ row }) => row.original.owner?.name || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'createdAt', header: 'Added', cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{formatDate(row.original.createdAt)}</span> },
  ];

  return (
    <div className="flex flex-col h-full">
      <Header title="Organizations" description={`${total} organizations`}>
        <Button asChild size="sm"><Link href="/organizations/new"><Plus className="h-3.5 w-3.5" />New organization</Link></Button>
      </Header>
      <div className="flex-1 p-6 overflow-auto">
        <DataTable columns={columns} data={data} pageCount={Math.ceil(total / PAGE_SIZE)} pageIndex={page} pageSize={PAGE_SIZE} onPageChange={setPage} onSearch={(q) => { setSearch(q); setPage(0); }} searchPlaceholder="Search organizations..." isLoading={isLoading} getRowHref={(row) => `/organizations/${row.id}`} />
      </div>
    </div>
  );
}
