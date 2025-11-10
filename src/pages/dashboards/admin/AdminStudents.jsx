// Admin-only list of students with their enrolled classes.
// Uses server-driven pagination & filters via /api/students-with-classes.

import { useContext, useEffect, useMemo, useState } from "react";
import { UserContext } from "@/contexts/UserContext.jsx";
import { useLocation, Link } from "wouter";
import { useAuth } from "@clerk/clerk-react";
import { IoPersonOutline } from "react-icons/io5";
import { getLevels } from "@/wrappers/level-wrapper";
import { getStudentsForExport, getStudentsWithClasses } from "@/wrappers/user-wrapper.js";
import Unauthorized from "@/pages/Unauthorized";
import Dropdown from "@/components/Dropdown/Dropdown";
import Button from "@/components/Button/Button";
import SearchBar from "@/components/SearchBar";
import UserItem from "@/components/UserItem";
import SkeletonUser from "@/components/Skeletons/SkeletonUser";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import useDelayedSkeleton from "@/hooks/useDelayedSkeleton";
import ExcelExport from "export-xlsx";
import { SETTINGS_FOR_EXPORT } from "@/assets/excel_export_settings";
import Pagination from "@/components/Pagination/Pagination.jsx";

const PAGE_SIZE = 100; // capped by backend at 200

// Extract a usable value from a level item:
//  - numbers: 1, 2, ...
//  - strings like "Level 3" -> 3
//  - objects like { level: 3 } or { level: "Level 3" } -> 3
function normalizeLevelValue(lv) {
  const raw = typeof lv === "object" && lv !== null ? lv.level : lv;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const m = raw.match(/\d+/); // first integer inside the string
    return m ? Number(m[0]) : raw; // fall back to string if no number present
  }
  return raw ?? "";
}

const AdminStudents = () => {
  const { user } = useContext(UserContext);
  const [, setLocation] = useLocation();
  const { isSignedIn, isLoaded } = useAuth();

  // Data + UI state
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState([]); // current page items from API
  const [total, setTotal] = useState(0);        // total rows matching filters (server)
  const [levels, setLevels] = useState([]);
  const [page, setPage] = useState(1);
  const [currFilter, setCurrFilter] = useState(null); // number | "conversation" | "ielts" | null
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [allowRender, setAllowRender] = useState(false);
  const showSkeleton = useDelayedSkeleton(loading);

  // Debounce search to avoid API spam
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Sort levels numerically if possible (e.g., "Level 0" before "Level 1")
  const sortedLevels = useMemo(() => {
    const list = Array.isArray(levels) ? [...levels] : [];
    return list.sort((a, b) => {
      const va = normalizeLevelValue(a);
      const vb = normalizeLevelValue(b);
      const na = typeof va === "number";
      const nb = typeof vb === "number";
      if (na && nb) return va - vb;
      if (na && !nb) return -1;
      if (!na && nb) return 1;
      return String(va).localeCompare(String(vb));
    });
  }, [levels]);

  // Derived label for header counter
  const headerCount = useMemo(() => `${total} student(s)`, [total]);

  // Redirect if not signed in; else load first page
  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setLocation("/login");
      return;
    }

    (async () => {
      try {
        setLoading(true);
        const lvls = await getLevels();
        setLevels(lvls || []);
        await loadPage(1);
        setAllowRender(true);
      } catch (err) {
        console.error("AdminStudents init error:", err);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, user?._id]);

  // (Re)load when filters or debounced search change
  useEffect(() => {
    if (!allowRender) return;
    // Optimistically reset to page 1 so paginator UI updates immediately
    setPage(1);
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currFilter, debouncedSearch]);

  // Centralized loader (with optimistic page update support)
  async function loadPage(nextPage) {
    try {
      setPage(nextPage);     // optimistic page update
      setLoading(true);

      const { items, total: t } = await getStudentsWithClasses({
        page: nextPage,
        limit: PAGE_SIZE,
        level: currFilter ?? null,
        q: debouncedSearch.trim(),
      });

      setStudents(items || []);
      setTotal(t || 0);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) setLocation("/login");
      else console.error("loadPage error:", err);
    } finally {
      setLoading(false);
    }
  }

  // Guard: only admins can view this page
  if (user && user.privilege !== "admin") {
    return <Unauthorized />;
  }

  // Export as Excel (server returns pre-shaped export data)
  const handleExportStudents = async () => {
    try {
      const data = await getStudentsForExport();
      const excelExport = new ExcelExport();
      excelExport.downloadExcel(SETTINGS_FOR_EXPORT, [data]);
    } catch (error) {
      console.error("Error exporting students:", error);
    }
  };

  return (
    <div className="page-format max-w-[96rem] space-y-10">
      <div className="flex flex-col items-start md:flex-row md:items-center md:justify-between">
        <div className="mb-6 md:m-0">
          <h1 className="font-extrabold mb-2">Students</h1>
          <p>List of all students enrolled in Dillar Classes</p>
        </div>
        <Button label={"Export Students"} onClick={handleExportStudents} />
      </div>

      <div className="w-full inline-flex gap-x-4">
        <SearchBar
          input={searchInput}
          setInput={setSearchInput}
          placeholder={"Search by name, email, instructor, or age group"}
        />

        <Dropdown
          label={
            <div className="flex items-center justify-center gap-x-1">
              <span className="whitespace-nowrap">
                {currFilter ? `Level ${currFilter}` : "All Levels"}
              </span>
            </div>
          }
          buttonClassName="text-black min-w-fit border border-gray-400 px-5 py-3 gap-1 rounded-sm bg-white"
        >
          <button
            key="all"
            className={`w-full text-left px-4 py-2 text-base font-normal text-black hover:bg-gray-100 ${
              currFilter === null ? "text-blue-500 bg-gray-50" : "text-gray-700"
            }`}
            onClick={() => setCurrFilter(null)}
          >
            All Levels
          </button>

          {/* Numeric levels (sorted) */}
          {sortedLevels.map((lv) => {
            const val = normalizeLevelValue(lv);
            const isNumber = typeof val === "number";
            const label = isNumber ? `Level ${val}` : String(val);
            return (
              <button
                key={`lvl-${label}`}
                className={`w-full text-left px-4 py-2 text-base font-normal text-black hover:bg-gray-100 ${
                  currFilter === val ? "text-blue-500 bg-gray-50" : "text-gray-700"
                }`}
                onClick={() => setCurrFilter(val)}
              >
                {label}
              </button>
            );
          })}

          {/* Supplemental classes */}
          <button
            key="conversation"
            className={`w-full text-left px-4 py-2 text-base font-normal text-black hover:bg-gray-100 ${
              currFilter === "conversation" ? "text-blue-500 bg-gray-50" : "text-gray-700"
            }`}
            onClick={() => setCurrFilter("conversation")}
          >
            Conversation
          </button>
          <button
            key="ielts"
            className={`w-full text-left px-4 py-2 text-base font-normal text-black hover:bg-gray-100 ${
              currFilter === "ielts" ? "text-blue-500 bg-gray-50" : "text-gray-700"
            }`}
            onClick={() => setCurrFilter("ielts")}
          >
            IELTS
          </button>
        </Dropdown>
      </div>

      <div className="text-indigo-900 inline-flex items-center gap-x-2">
        <IoPersonOutline />
        <p className="flex">
          {allowRender ? headerCount : showSkeleton && <Skeleton width={"6rem"} />}
        </p>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-14 gap-y-3">
        {!allowRender || loading ? (
          <SkeletonUser count={12} />
        ) : (
          students.map((u) => (
            <Link key={u._id} to={`/admin/user/${encodeURIComponent(u._id)}`}>
              <UserItem key={u._id} privilege="admin" userData={u} isShowClass />
            </Link>
          ))
        )}
      </div>

      {allowRender && total > 0 && (
        <div className="pt-6">
          {/* disable buttons while fetching */}
          <Pagination
            page={page}
            total={total}
            limit={PAGE_SIZE}
            busy={loading}
            onChange={(p) => {
              if (p !== page) loadPage(p);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default AdminStudents;