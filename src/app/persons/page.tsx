'use client';

import { useEffect, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Header } from '@/components/layout/header';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { Plus } from 'lucide-react';
import Link from 'next/link';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  organization?: { id: string; name: string };
  createdAt: string;
}

interface ApiResponse { data: Person[]; total: number; page: number; pageSize: number; }

export default function PersonsPage() {
  const [data, setData] = useState<Person[]>([]);
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
        const response = await fetch(`/api/persons?${params}`);
        const result: ApiResponse = await response.json();
        setData(result.data);
        setTotal(result.total);
      } catch (error) { console.error('Failed to fetch persons:', error); }
      finally { setIsLoading(false); }
    };
    fetchData();
  }, [search, page]);

  const columns: ColumnDef<Person>[] = [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.firstName} {row.original.lastName}</span> },
    { accessorKey: 'email', header: 'Email', cell: ({ row }) => row.original.email || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => row.original.phone ? <span className="tabular-nums">{row.original.phone}</span> : <span className="text-muted-foreground">—</span> },
    { accessorKey: 'organization.name', header: 'Organization', cell: ({ row }) => row.original.organization?.name || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'jobTitle', header: 'Job title', cell: ({ row }) => row.original.jobTitle || <span className="text-muted-foreground">—</span> },
    { accessorKey: 'createdAt', header: 'Added', cell: ({ row }) => <span className="text-muted-foreground tabular-nums">{formatDate(row.original.createdAt)}</span> },
  ];

  return (
    <div className="flex flex-col h-full">
      <Header title="People" description={`${total} people`}>
        <Button asChild size="sm"><Link href="/persons/new" className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />New person</Link></Button>
      </Header>
      <div className="flex-1 p-6 overflow-auto">
        <DataTable columns={columns} data={data} pageCount={Math.ceil(total / PAGE_SIZE)} pageIndex={page} pageSize={PAGE_SIZE} onPageChange={setPage} onSearch={(q) => { setSearch(q); setPage(0); }} searchPlaceholder="Search people..." isLoading={isLoading} getRowHref={(row) => `/persons/${row.id}`} />
      </div>
    </div>
  );
}
