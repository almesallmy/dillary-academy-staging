// src/pages/dashboards/admin/AdminInstructors.jsx
// Admin-only list of instructors with server-side pagination via /api/users.

import { useContext, useEffect, useMemo, useState } from "react";
import { UserContext } from '@/contexts/UserContext.jsx';
import { useLocation, Link } from 'wouter';
import { useAuth } from '@clerk/clerk-react';
import { getUsersPaginated } from '@/wrappers/user-wrapper.js';
import { IoPersonOutline } from "react-icons/io5";
import UserItem from '@/components/UserItem';
import SearchBar from '@/components/SearchBar';
import SkeletonUser from '@/components/Skeletons/SkeletonUser';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import useDelayedSkeleton from '@/hooks/useDelayedSkeleton';
import Unauthorized from "@/pages/Unauthorized";

const PAGE_SIZE = 24;

const AdminInstructors = () => {
  const { user } = useContext(UserContext);
  const [, setLocation] = useLocation();
  const { isSignedIn, isLoaded } = useAuth();

  const [allowRender, setAllowRender] = useState(false);
  const [instructors, setInstructors] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const showSkeleton = useDelayedSkeleton(!allowRender);

  // Fetch one page from server
  const fetchPage = async (pageNum, q) => {
    const { items, total: t } = await getUsersPaginated({
      privilege: 'instructor',
      page: pageNum,
      limit: PAGE_SIZE,
      q,
    });
    setInstructors(items || []);
    setTotal(t || 0);
    setPage(pageNum);
    setAllowRender(true);
  };

  // Initial load / auth transitions
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLocation("/login");
      return;
    }
    fetchPage(1, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, user?._id]);

  // Refetch when search text changes (reset to page 1)
  useEffect(() => {
    if (!allowRender) return;
    const handle = setTimeout(() => fetchPage(1, searchInput.trim()), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  if (user && user.privilege !== "admin") {
    return <Unauthorized />;
  }

  return (
    <div className="page-format max-w-[96rem] space-y-10">
      <div>
        <h1 className="font-extrabold mb-2">Instructors</h1>
        <p>List of all instructors teaching Dillar Classes</p>
      </div>

      <SearchBar
        input={searchInput}
        setInput={setSearchInput}
        placeholder={"Search for instructor by name or email"}
      />

      <div className="text-indigo-900 inline-flex items-center gap-x-2">
        <IoPersonOutline />
        <p className="flex">
          {allowRender ? `${total} instructor(s)` : showSkeleton && <Skeleton width={"6rem"} />}
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-x-1 gap-y-3">
        {allowRender
          ? instructors.map((u) => (
              <Link key={u._id} href={`/admin/user/${encodeURIComponent(u._id)}`}>
                <UserItem userData={u} privilege="admin" />
              </Link>
            ))
          : showSkeleton && <SkeletonUser count={9} />}
      </div>

      {/* Pager */}
      {allowRender && pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-4">
          <button
            className="px-3 py-2 border rounded disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => fetchPage(page - 1, searchInput.trim())}
            type="button"
          >
            Prev
          </button>

          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className={`px-3 py-2 border rounded ${n === page ? 'bg-gray-200 font-semibold' : ''}`}
              onClick={() => fetchPage(n, searchInput.trim())}
              type="button"
            >
              {n}
            </button>
          ))}

          <button
            className="px-3 py-2 border rounded disabled:opacity-50"
            disabled={page >= pageCount}
            onClick={() => fetchPage(page + 1, searchInput.trim())}
            type="button"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminInstructors;