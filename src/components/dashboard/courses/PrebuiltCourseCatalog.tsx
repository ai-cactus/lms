'use client';

import { useMemo, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { BookOpen, Search } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { addPrebuiltCourseToOrg, type PrebuiltCourseRow } from '@/app/actions/course';
import { cn } from '@/lib/utils';

interface PrebuiltCourseCatalogProps {
  courses: PrebuiltCourseRow[];
}

const headCls =
  'h-10 px-2 text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] md:px-[18px] md:text-[15.5px]';
const cellCls =
  'h-[71px] px-2 text-[15px] font-medium tracking-[0.35px] text-[#0d0d12] md:px-[18px]';

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * Platform prebuilt catalog, presented as a course-creation entry path. Adopting
 * a course deep-copies it into the caller's organization as an editable draft,
 * so the user lands on their own new course rather than the shared catalog entry.
 */
export default function PrebuiltCourseCatalog({ courses }: PrebuiltCourseCatalogProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filteredCourses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return courses;
    return courses.filter((course) => course.title.toLowerCase().includes(query));
  }, [courses, searchQuery]);

  const handleAdd = (course: PrebuiltCourseRow) => {
    setAddingId(course.id);
    setError(null);
    startTransition(async () => {
      try {
        const fork = await addPrebuiltCourseToOrg(course.id);
        router.push(`/dashboard/training/courses/${fork.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add this course.');
        setAddingId(null);
      }
    });
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-body">
      <header className="flex h-[72px] w-full shrink-0 items-stretch border-b border-black/10 bg-background md:h-[106px]">
        <div className="flex w-[140px] shrink-0 items-center justify-center border-r border-black/10 px-2 md:w-[218px]">
          <Logo variant="blue" size="md" />
        </div>
        <div className="flex flex-1 items-center justify-between gap-4 pr-5 pl-4 md:pr-[60px] md:pl-[30px]">
          <span className="truncate text-sm font-medium tracking-[0.38px] text-[#3e3e3e] md:text-[19px]">
            Course creation process
          </span>
          <Button
            variant="ghost"
            onClick={() => router.push('/dashboard/courses')}
            className="h-auto px-2 py-1 text-base font-bold tracking-[0.4px] text-[#0d0d12] md:text-[20px]"
          >
            Exit
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-8 px-5 py-10 md:py-14">
        <div className="flex flex-col gap-2">
          <h1 className="text-[26px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] md:text-[33.5px]">
            Choose a Prebuilt Course on Theraptly
          </h1>
          <p className="text-sm leading-tight font-medium text-[#a0aec0]">
            Add a ready-made course to your organization, then edit it like any other draft.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {courses.length === 0 ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-[17px] border border-[#dfe1e6] bg-white px-4 py-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-accent text-text-secondary">
              <BookOpen className="size-7" aria-hidden="true" />
            </div>
            <p className="text-[20px] leading-[1.32] font-semibold text-[#11181c]">
              No prebuilt courses available yet
            </p>
            <p className="max-w-[440px] text-[15px] leading-[1.45] text-[#475367]">
              Theraptly&apos;s course catalog is still being prepared. In the meantime you can build
              a course from your own policy or compliance document.
            </p>
            <Button
              className="h-12 rounded-[12px] px-6 text-[15.5px] font-semibold"
              onClick={() => router.push('/dashboard/courses/create')}
            >
              Create a course instead
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:px-[21px] md:pt-[21px] md:pb-4">
            <div className="flex justify-end">
              <div className="w-full sm:w-[470px]">
                <Input
                  className="h-[38px] rounded-[8.5px] border-[#dfe1e6] pl-9 text-[15px] placeholder:text-[#a4abb8]"
                  placeholder="Search prebuilt courses..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search prebuilt courses"
                  startIcon={<Search aria-hidden="true" />}
                />
              </div>
            </div>

            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead className={cn(headCls, 'rounded-l-[9px] md:w-[32%]')}>
                    Course Name
                  </TableHead>
                  <TableHead className={cn(headCls, 'hidden md:table-cell md:w-[38%]')}>
                    Description
                  </TableHead>
                  <TableHead className={cn(headCls, 'hidden lg:table-cell lg:w-[14%]')}>
                    Time App.
                  </TableHead>
                  <TableHead className={cn(headCls, 'w-[110px] rounded-r-[9px] md:w-[16%]')}>
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCourses.length > 0 ? (
                  filteredCourses.map((course) => (
                    <TableRow key={course.id}>
                      <TableCell className={cellCls}>
                        <div className="flex items-center gap-3 sm:gap-[18px]">
                          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f1f5f9]">
                            <Image
                              src="/images/icon-course-blue.svg"
                              alt=""
                              width={40}
                              height={40}
                              aria-hidden="true"
                              className="object-cover"
                            />
                          </div>
                          <span className="truncate font-semibold">{course.title}</span>
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          cellCls,
                          'hidden md:table-cell md:text-[15px] md:font-normal',
                        )}
                      >
                        <span className="line-clamp-2 text-[#475367]">
                          {course.description || 'No description provided.'}
                        </span>
                      </TableCell>
                      <TableCell className={cn(cellCls, 'hidden whitespace-nowrap lg:table-cell')}>
                        {formatDuration(course.duration)}
                      </TableCell>
                      <TableCell className={cellCls}>
                        <Button
                          variant="outline"
                          className="h-10 rounded-[10px] border-[#d4d4d4] px-4 text-[14px] font-semibold text-primary hover:text-primary"
                          loading={addingId === course.id}
                          disabled={addingId !== null}
                          onClick={() => handleAdd(course)}
                        >
                          Add course
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <EmptyTableState
                    message="No prebuilt courses match your search."
                    subMessage="Try a different course title."
                    colSpan={4}
                    asTableRow
                  />
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
