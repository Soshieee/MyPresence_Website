"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { hasSupabaseEnv, supabase, supabaseEnvIssue } from "@/lib/supabase";

type MemberRow = {
  id: string;
  student_id: string;
  full_name: string;
  age: number | null;
  gender: "Male" | "Female" | "Other" | null;
  newcomer: boolean;
  created_at: string;
};

type MemberHistoryRow = {
  id: string;
  attended_date: string;
  attended_at: string;
  attendance_context: string | null;
  attendance_group: string | null;
  event_id: string | null;
};

type EventLookup = {
  id: string;
  title: string;
};

function isMissingColumnError(message: string) {
  return /column\s+users\.(age|gender|newcomer)\s+does not exist/i.test(message);
}

function toCsvValue(input: string) {
  if (input.includes(",") || input.includes("\"") || input.includes("\n")) {
    return `"${input.replaceAll("\"", "\"\"")}"`;
  }
  return input;
}

export default function MembersPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Manage member records: search, edit, delete, and export.");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formAge, setFormAge] = useState("");
  const [formGender, setFormGender] = useState<"Male" | "Female" | "Other">("Male");
  const [formNewcomer, setFormNewcomer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [historyMember, setHistoryMember] = useState<MemberRow | null>(null);
  const [historyRows, setHistoryRows] = useState<MemberHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [eventLookup, setEventLookup] = useState<Record<string, string>>({});

  const loadMembers = async () => {
    if (!hasSupabaseEnv) {
      setStatus(supabaseEnvIssue ?? "Missing Supabase config.");
      return;
    }

    setLoading(true);

    const result = await supabase
      .from("users")
      .select("id, student_id, full_name, age, gender, newcomer, created_at")
      .order("created_at", { ascending: false });

    if (result.error) {
      if (isMissingColumnError(result.error.message)) {
        const fallback = await supabase
          .from("users")
          .select("id, student_id, full_name, created_at")
          .order("created_at", { ascending: false });

        if (fallback.error) {
          setStatus(`Failed to load members: ${fallback.error.message}`);
          setLoading(false);
          return;
        }

        const rows = ((fallback.data ?? []) as Array<Omit<MemberRow, "age" | "gender" | "newcomer">>).map((row) => ({
          ...row,
          age: null,
          gender: null,
          newcomer: false
        }));
        setMembers(rows);
        setStatus("Users schema is outdated. Run supabase/schema.sql to manage age, gender, and newcomer fields.");
        setLoading(false);
        return;
      }

      setStatus(`Failed to load members: ${result.error.message}`);
      setLoading(false);
      return;
    }

    setMembers((result.data ?? []) as MemberRow[]);
    setLoading(false);
  };

  const loadEventLookup = async () => {
    const { data, error } = await supabase.from("events").select("id, title");
    if (error) return;

    const map: Record<string, string> = {};
    for (const row of (data ?? []) as EventLookup[]) {
      map[row.id] = row.title;
    }
    setEventLookup(map);
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadMembers();
      if (hasSupabaseEnv) {
        void loadEventLookup();
      }
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  const filteredMembers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;

    return members.filter(
      (member) =>
        member.full_name.toLowerCase().includes(needle) ||
        member.student_id.toLowerCase().includes(needle)
    );
  }, [members, query]);

  const allFilteredSelected = filteredMembers.length > 0 && filteredMembers.every((m) => selectedIds.includes(m.id));

  const toggleSelectMember = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredIdSet = new Set(filteredMembers.map((m) => m.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredIdSet.has(id)));
      return;
    }

    const merged = new Set([...selectedIds, ...filteredMembers.map((m) => m.id)]);
    setSelectedIds(Array.from(merged));
  };

  const startEdit = (member: MemberRow) => {
    setEditingId(member.id);
    setFormName(member.full_name);
    setFormAge(member.age === null ? "" : String(member.age));
    setFormGender(member.gender ?? "Male");
    setFormNewcomer(member.newcomer);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormName("");
    setFormAge("");
    setFormGender("Male");
    setFormNewcomer(false);
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId) return;

    const trimmedName = formName.trim();
    if (!trimmedName) {
      setStatus("Name is required.");
      return;
    }

    const parsedAge = formAge.trim() === "" ? null : Number(formAge);
    if (parsedAge !== null && (!Number.isFinite(parsedAge) || parsedAge < 1 || parsedAge > 120)) {
      setStatus("Age must be blank or between 1 and 120.");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("users")
      .update({
        full_name: trimmedName,
        age: parsedAge,
        gender: formGender,
        newcomer: formNewcomer
      })
      .eq("id", editingId);

    setSaving(false);

    if (error) {
      setStatus(`Failed to save member: ${error.message}`);
      return;
    }

    setStatus("Member updated.");
    cancelEdit();
    await loadMembers();
  };

  const deleteByIds = async (ids: string[]) => {
    if (ids.length === 0) return;

    const affectedMembers = members.filter((member) => ids.includes(member.id));
    const studentIds = affectedMembers.map((member) => member.student_id);

    if (studentIds.length > 0) {
      const attendanceDelete = await supabase
        .from("attendance")
        .delete()
        .in("student_id", studentIds);

      if (attendanceDelete.error) {
        setStatus(`Failed to remove attendance logs: ${attendanceDelete.error.message}`);
        return;
      }
    }

    const userDelete = await supabase
      .from("users")
      .delete()
      .in("id", ids);

    if (userDelete.error) {
      setStatus(`Failed to delete members: ${userDelete.error.message}`);
      return;
    }

    setStatus(ids.length === 1 ? "Member deleted." : `${ids.length} members deleted.`);
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));

    if (editingId && ids.includes(editingId)) {
      cancelEdit();
    }

    if (historyMember && ids.includes(historyMember.id)) {
      setHistoryMember(null);
      setHistoryRows([]);
    }

    await loadMembers();
  };

  const deleteMember = async (member: MemberRow) => {
    if (!confirm(`Delete ${member.full_name}? This also removes this member's attendance logs.`)) {
      return;
    }

    await deleteByIds([member.id]);
  };

  const bulkDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete ${selectedIds.length} selected members? This also removes their attendance logs.`)) {
      return;
    }

    await deleteByIds(selectedIds);
  };

  const exportFilteredCsv = () => {
    const header = ["student_id", "full_name", "age", "gender", "newcomer", "created_at"];
    const rows = filteredMembers.map((member) => [
      member.student_id,
      member.full_name,
      member.age === null ? "" : String(member.age),
      member.gender ?? "",
      member.newcomer ? "true" : "false",
      member.created_at
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((value) => toCsvValue(value)).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `members_export_${new Date().toISOString().slice(0, 10)}.csv`);
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${filteredMembers.length} member rows to CSV.`);
  };

  const openHistory = async (member: MemberRow) => {
    setHistoryMember(member);
    setHistoryRows([]);
    setHistoryLoading(true);

    const { data, error } = await supabase
      .from("attendance")
      .select("id, attended_date, attended_at, attendance_context, attendance_group, event_id")
      .eq("student_id", member.student_id)
      .order("attended_at", { ascending: false })
      .limit(30);

    setHistoryLoading(false);

    if (error) {
      setStatus(`Failed to load member history: ${error.message}`);
      return;
    }

    setHistoryRows((data ?? []) as MemberHistoryRow[]);
  };

  return (
    <div className="space-y-6 reveal">
      <section>
        <h1 className="page-title font-[var(--font-heading)]">Member Management</h1>
        <p className="page-subtitle">View, edit, delete, export, and inspect attendance history.</p>
      </section>

      <section className="analytics-strip">
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Total Members</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{members.length}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Filtered</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{filteredMembers.length}</p>
        </article>
        <article className="analytics-card">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Selected</p>
          <p className="mt-2 font-[var(--font-heading)] text-2xl text-[#22322d]">{selectedIds.length}</p>
        </article>
      </section>

      <div className="card">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="w-full md:max-w-sm">
            <label className="field-label">Search Members</label>
            <input
              className="field-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or member ID"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => void loadMembers()}>
              Refresh
            </button>
            <button type="button" className="btn-ghost" onClick={exportFilteredCsv} disabled={filteredMembers.length === 0}>
              Export CSV
            </button>
            <button
              type="button"
              className="rounded-full border border-[#d9b6ba] px-4 py-2 text-sm font-semibold text-[#8a3f46] transition hover:bg-[#fff3f4] disabled:opacity-50"
              onClick={() => void bulkDeleteSelected()}
              disabled={selectedIds.length === 0}
            >
              Delete Selected
            </button>
          </div>
        </div>
        <div className="status-info mt-4">{loading ? "Loading members..." : status}</div>
      </div>

      {editingId ? (
        <section className="analytics-panel">
          <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">Edit Member</h2>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={saveEdit}>
            <div>
              <label className="field-label">Full Name</label>
              <input className="field-input" value={formName} onChange={(event) => setFormName(event.target.value)} required />
            </div>
            <div>
              <label className="field-label">Age</label>
              <input className="field-input" value={formAge} onChange={(event) => setFormAge(event.target.value)} type="number" min={1} max={120} />
            </div>
            <div>
              <label className="field-label">Gender</label>
              <select className="field-input" value={formGender} onChange={(event) => setFormGender(event.target.value as "Male" | "Female" | "Other")}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input id="newcomer-toggle" type="checkbox" checked={formNewcomer} onChange={(event) => setFormNewcomer(event.target.checked)} />
              <label htmlFor="newcomer-toggle" className="text-sm font-semibold text-[#35564a]">Mark as newcomer</label>
            </div>
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
              <button type="button" className="btn-ghost" onClick={cancelEdit}>Cancel</button>
            </div>
          </form>
        </section>
      ) : null}

      {historyMember ? (
        <section className="analytics-panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-[var(--font-heading)] text-xl text-[#22332d]">Attendance History: {historyMember.full_name}</h2>
            <button type="button" className="btn-ghost" onClick={() => setHistoryMember(null)}>Close</button>
          </div>
          <div className="mt-3 space-y-2">
            {historyLoading ? (
              <p className="text-sm text-[#4f675e]">Loading history...</p>
            ) : historyRows.length === 0 ? (
              <p className="text-sm text-[#4f675e]">No attendance history found.</p>
            ) : (
              historyRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-[#c7d5cf] bg-white/85 px-3 py-2 text-sm text-[#2f4d43]">
                  <p className="font-semibold">{row.attended_date} • {new Date(row.attended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                  <p className="text-xs text-[#5e766c]">
                    {row.attendance_context ?? "-"} • {row.attendance_group ?? "-"}
                    {row.event_id ? ` • ${eventLookup[row.event_id] ?? "Linked Event"}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      <section className="card overflow-x-auto">
        {filteredMembers.length === 0 ? (
          <p className="text-sm text-[#4f675e]">No members found.</p>
        ) : (
          <table className="min-w-full border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-[#4f675e]">
                <th className="px-3 py-2 font-semibold">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAllFiltered} />
                </th>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">Age</th>
                <th className="px-3 py-2 font-semibold">Gender</th>
                <th className="px-3 py-2 font-semibold">Newcomer</th>
                <th className="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => (
                <tr key={member.id} className="rounded-xl bg-white/85 text-[#30463f] shadow-[0_6px_16px_rgba(56,91,79,0.08)]">
                  <td className="rounded-l-xl px-3 py-2.5">
                    <input type="checkbox" checked={selectedIds.includes(member.id)} onChange={() => toggleSelectMember(member.id)} />
                  </td>
                  <td className="px-3 py-2.5 font-semibold">{member.full_name}</td>
                  <td className="px-3 py-2.5">{member.student_id}</td>
                  <td className="px-3 py-2.5">{member.age ?? "-"}</td>
                  <td className="px-3 py-2.5">{member.gender ?? "-"}</td>
                  <td className="px-3 py-2.5">{member.newcomer ? "Yes" : "No"}</td>
                  <td className="rounded-r-xl px-3 py-2.5">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => startEdit(member)}>Edit</button>
                      <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void openHistory(member)}>History</button>
                      <button
                        type="button"
                        className="rounded-full border border-[#d9b6ba] px-3 py-1.5 text-xs font-semibold text-[#8a3f46] transition hover:bg-[#fff3f4]"
                        onClick={() => void deleteMember(member)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
