"use client";

// Simplified "Lifegroup" analytics module (P8).
// Same interaction pattern as the Events module: a year view (one point per
// month) and a month view (one point per day/activity) with click-to-open
// details, plus filters that cascade from all lifegroups down to a single
// member. Shows the most attended activities and most active members on the
// side, and reuses the shared member attendance ranking table.

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { CategoryBarsPanel } from "@/components/attendance-charts";
import { MemberRankingTable, type MemberRankingRow } from "@/components/analytics/member-ranking-table";
import {
  fetchLifegroupAnalyticsData,
  formatDayLabel,
  formatMonthKey,
  isPresentAttendance,
  lifegroupActivityDate,
  lifegroupAttendanceDate,
  profileDisplayName,
  rowString,
  toDateKey,
  type LifegroupActivityRow,
  type LifegroupAnalyticsData,
  type LifegroupMemberRow
} from "@/lib/analytics-data";
import { hasSupabaseEnv } from "@/lib/supabase";
import { activeChartLabel } from "@/components/analytics/chart-click";

// Distinct line colors. The first eight are the per-lifegroup palette; the
// extras keep per-member lines (which are uncapped) distinguishable for
// larger groups before the palette cycles.
const SERIES_COLORS = [
  "#2563eb",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#0891b2",
  "#e11d48",
  "#65a30d",
  "#f472b6",
  "#a3e635",
  "#fb923c",
  "#6366f1"
];
const MEMBER_LINE_COLOR = "#0f766e";
const MAX_GROUP_LINES = 8;
const TOP_LIST_SIZE = 5;

type PresentRecord = {
  lifegroupId: string;
  userId: string;
  activityId: string | null;
  date: string;
};

type SeriesDef = {
  key: string;
  name: string;
  color: string;
  matches: (record: PresentRecord) => boolean;
};

type ChartRow = {
  label: string;
  fullLabel: string;
  dateKey: string | null;
  values: Record<string, number>;
};

function activityLabel(activity: LifegroupActivityRow | undefined, fallbackId: string | null): string {
  if (!activity) return fallbackId ? `Activity ${fallbackId.slice(0, 8)}` : "Lifegroup activity";
  return rowString(activity, ["title", "name", "activity_name"]) ?? "Lifegroup activity";
}

export function LifegroupAnalyticsModule() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [data, setData] = useState<LifegroupAnalyticsData | null>(null);

  const [year, setYear] = useState("");
  const [month, setMonth] = useState("all");
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [selectedMemberId, setSelectedMemberId] = useState("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!hasSupabaseEnv) {
        if (active) {
          setStatus("error");
          setErrorText("Supabase is not configured. Set the NEXT_PUBLIC environment variables first.");
        }
        return;
      }

      try {
        const result = await fetchLifegroupAnalyticsData();
        if (!active) return;
        setData(result);
        setStatus("ready");
      } catch (err: unknown) {
        if (!active) return;
        console.error(err);
        setErrorText(err instanceof Error ? err.message : "Unknown error");
        setStatus("error");
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const groupById = useMemo(() => {
    const map = new Map<string, LifegroupAnalyticsData["lifegroups"][number]>();
    for (const group of data?.lifegroups ?? []) map.set(group.id, group);
    return map;
  }, [data]);

  const activityById = useMemo(() => {
    const map = new Map<string, LifegroupActivityRow>();
    for (const activity of data?.activities ?? []) map.set(activity.id, activity);
    return map;
  }, [data]);

  const profileById = useMemo(() => {
    const map = new Map<string, { id: string; first_name?: string | null; last_name?: string | null }>();
    for (const profile of data?.profiles ?? []) map.set(profile.id, profile);
    return map;
  }, [data]);

  const memberName = useMemo(() => {
    return (userId: string) => profileDisplayName(profileById.get(userId), `Member ${userId.slice(0, 6)}`);
  }, [profileById]);

  const memberships = useMemo(() => {
    const map = new Map<string, LifegroupMemberRow[]>();
    const seen = new Set<string>();
    for (const row of data?.members ?? []) {
      const key = `${row.lifegroup_id}|${row.user_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = map.get(row.lifegroup_id) ?? [];
      list.push(row);
      map.set(row.lifegroup_id, list);
    }
    return map;
  }, [data]);

  const presentRecords = useMemo(() => {
    const records: PresentRecord[] = [];
    const seen = new Set<string>();
    for (const row of data?.attendance ?? []) {
      if (!isPresentAttendance(row)) continue;
      const activity = row.activity_id ? activityById.get(row.activity_id) : undefined;
      const lifegroupId = row.lifegroup_id ?? activity?.lifegroup_id ?? null;
      const date = lifegroupAttendanceDate(row, activityById);
      if (!lifegroupId || !date) continue;
      const key = row.activity_id
        ? `${row.activity_id}|${row.user_id}`
        : `${lifegroupId}|${row.user_id}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({ lifegroupId, userId: row.user_id, activityId: row.activity_id ?? null, date });
    }
    return records;
  }, [activityById, data]);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const activity of data?.activities ?? []) {
      const date = lifegroupActivityDate(activity);
      if (date) years.add(date.slice(0, 4));
    }
    for (const record of presentRecords) years.add(record.date.slice(0, 4));
    return Array.from(years).sort().reverse();
  }, [data, presentRecords]);

  // Derived selection: fall back to the latest year with data until the user picks one.
  const effectiveYear = useMemo(
    () => (year && yearOptions.includes(year) ? year : yearOptions[0] ?? ""),
    [year, yearOptions]
  );

  const monthOptions = useMemo(() => {
    if (!effectiveYear) return [] as string[];
    const months = new Set<string>();
    for (const activity of data?.activities ?? []) {
      const date = lifegroupActivityDate(activity);
      if (date?.startsWith(effectiveYear)) months.add(date.slice(5, 7));
    }
    for (const record of presentRecords) {
      if (record.date.startsWith(effectiveYear)) months.add(record.date.slice(5, 7));
    }
    return Array.from(months).sort();
  }, [data, presentRecords, effectiveYear]);

  const groupOptions = useMemo(() => {
    return [...(data?.lifegroups ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const memberOptions = useMemo(() => {
    const rows = selectedGroupId === "all"
      ? (data?.members ?? [])
      : (memberships.get(selectedGroupId) ?? []);
    const ids = new Set(rows.map((row) => row.user_id));
    return Array.from(ids)
      .map((userId) => ({ userId, name: memberName(userId) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, memberName, memberships, selectedGroupId]);

  // Derived selection: fall back to "all members" when the current choice is not in scope.
  const effectiveMemberId = useMemo(
    () =>
      selectedMemberId !== "all" && memberOptions.some((option) => option.userId === selectedMemberId)
        ? selectedMemberId
        : "all",
    [memberOptions, selectedMemberId]
  );

  const periodRecords = useMemo(() => {
    if (!effectiveYear) return [] as PresentRecord[];
    const prefix = month === "all" ? effectiveYear : `${effectiveYear}-${month}`;
    return presentRecords.filter((record) => record.date.startsWith(prefix));
  }, [effectiveYear, month, presentRecords]);

  const scopedRecords = useMemo(() => {
    let records = periodRecords;
    if (selectedGroupId !== "all") records = records.filter((record) => record.lifegroupId === selectedGroupId);
    if (effectiveMemberId !== "all") records = records.filter((record) => record.userId === effectiveMemberId);
    return records;
  }, [effectiveMemberId, periodRecords, selectedGroupId]);

  const series = useMemo((): SeriesDef[] => {
    if (effectiveMemberId !== "all") {
      return [
        {
          key: "member",
          name: memberName(effectiveMemberId),
          color: MEMBER_LINE_COLOR,
          matches: (record) => record.userId === effectiveMemberId
        }
      ];
    }

    if (selectedGroupId !== "all") {
      // One comparable line per member of the selected lifegroup (uncapped),
      // ordered by name so the legend reads predictably.
      const members = (memberships.get(selectedGroupId) ?? [])
        .map((membership) => ({ userId: membership.user_id, name: memberName(membership.user_id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (members.length > 0) {
        return members.map((member, index) => ({
          key: member.userId,
          name: member.name,
          color: SERIES_COLORS[index % SERIES_COLORS.length],
          matches: (record: PresentRecord) => record.userId === member.userId
        }));
      }
      const group = groupById.get(selectedGroupId);
      return [
        {
          key: "group",
          name: group?.name ?? "Selected lifegroup",
          color: MEMBER_LINE_COLOR,
          matches: (record) => record.lifegroupId === selectedGroupId
        }
      ];
    }

    const groupsWithData = groupOptions.filter((group) =>
      periodRecords.some((record) => record.lifegroupId === group.id)
    );
    return groupsWithData.slice(0, MAX_GROUP_LINES).map((group, index) => ({
      key: group.id,
      name: group.name,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      matches: (record: PresentRecord) => record.lifegroupId === group.id
    }));
  }, [effectiveMemberId, groupById, groupOptions, memberName, memberships, periodRecords, selectedGroupId]);

  const chartBuild = useMemo(() => {
    if (!effectiveYear) return { rows: [] as ChartRow[], monthView: false };
    if (month === "all") {
      const rows: ChartRow[] = Array.from({ length: 12 }, (_, index) => {
        const monthNumber = `${index + 1}`.padStart(2, "0");
        const key = `${effectiveYear}-${monthNumber}`;
        const values: Record<string, number> = {};
        for (const item of series) {
          values[item.key] = scopedRecords.filter(
            (record) => record.date.startsWith(key) && item.matches(record)
          ).length;
        }
        return {
          label: new Date(Number(effectiveYear), index, 1).toLocaleDateString(undefined, { month: "short" }),
          fullLabel: formatMonthKey(key),
          dateKey: key,
          values
        };
      });
      return { rows, monthView: false };
    }

    const monthPrefix = `${effectiveYear}-${month}`;
    const days = new Set<string>();
    for (const record of scopedRecords) {
      if (record.date.startsWith(monthPrefix)) days.add(record.date);
    }
    for (const activity of data?.activities ?? []) {
      if (selectedGroupId !== "all" && activity.lifegroup_id !== selectedGroupId) continue;
      const date = lifegroupActivityDate(activity);
      if (date?.startsWith(monthPrefix)) days.add(date);
    }

    const rows: ChartRow[] = Array.from(days)
      .sort()
      .map((date) => {
        const values: Record<string, number> = {};
        for (const item of series) {
          values[item.key] = scopedRecords.filter((record) => record.date === date && item.matches(record)).length;
        }
        return {
          label: String(Number(date.slice(8, 10))),
          fullLabel: formatDayLabel(date),
          dateKey: date,
          values
        };
      });
    return { rows, monthView: true };
  }, [data, month, scopedRecords, series, effectiveYear, selectedGroupId]);

  // Clicked points are resolved through the x-axis label — the same lookup the
  // tooltip uses — because recharts 3 no longer exposes `activePayload`.
  const rowByLabel = useMemo(
    () => new Map(chartBuild.rows.map((row) => [row.label, row])),
    [chartBuild.rows]
  );

  const mostAttendedActivities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of scopedRecords) {
      const key = record.activityId ?? `${record.lifegroupId}|${record.date}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_LIST_SIZE)
      .map(([key, value]) => ({
        label: key.includes("|")
          ? `${formatDayLabel(key.split("|")[1] ?? null)} — ${groupById.get(key.split("|")[0])?.name ?? "Lifegroup"}`
          : activityLabel(activityById.get(key), key),
        value
      }));
  }, [activityById, groupById, scopedRecords]);

  const mostActiveMembers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of scopedRecords) {
      counts.set(record.userId, (counts.get(record.userId) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_LIST_SIZE)
      .map(([userId, value]) => ({ label: memberName(userId), value }));
  }, [memberName, scopedRecords]);

  const rankingRows = useMemo((): MemberRankingRow[] => {
    if (selectedGroupId === "all" || !effectiveYear) return [];

    const periodPrefix = month === "all" ? effectiveYear : `${effectiveYear}-${month}`;
    const groupMembers = memberships.get(selectedGroupId) ?? [];
    if (groupMembers.length === 0) return [];

    const occasionDates = new Set<string>();
    for (const activity of data?.activities ?? []) {
      if (activity.lifegroup_id !== selectedGroupId) continue;
      const date = lifegroupActivityDate(activity);
      if (date?.startsWith(periodPrefix)) occasionDates.add(date);
    }
    for (const record of presentRecords) {
      if (record.lifegroupId === selectedGroupId && record.date.startsWith(periodPrefix)) {
        occasionDates.add(record.date);
      }
    }
    const occasions = Array.from(occasionDates).sort();

    return groupMembers
      .map((membership) => {
        const joinedDate = toDateKey(membership.joined_at ?? membership.created_at ?? null);
        const attendedDates = new Set(
          presentRecords
            .filter(
              (record) =>
                record.lifegroupId === selectedGroupId &&
                record.userId === membership.user_id &&
                record.date.startsWith(periodPrefix)
            )
            .map((record) => record.date)
        );
        const eligible = occasions.filter((date) => (joinedDate ? date >= joinedDate : true)).length;
        const attended = attendedDates.size;
        const sortedDates = Array.from(attendedDates).sort();
        return {
          userId: membership.user_id,
          name: memberName(membership.user_id),
          meta: [membership.role ?? "member", membership.status ?? "active"].filter(Boolean).join(" • "),
          attended,
          eligible,
          percent: eligible > 0 ? Math.round((attended / eligible) * 1000) / 10 : null,
          lastAttended: sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null,
          joinUnknown: joinedDate === null
        };
      })
      .sort((a, b) => {
        const percentA = a.percent ?? -1;
        const percentB = b.percent ?? -1;
        if (percentB !== percentA) return percentB - percentA;
        if (b.attended !== a.attended) return b.attended - a.attended;
        return a.name.localeCompare(b.name);
      });
  }, [data, effectiveYear, memberName, memberships, month, presentRecords, selectedGroupId]);

  const selectedMemberActivities = useMemo(() => {
    if (selectedGroupId === "all" || effectiveMemberId === "all" || !effectiveYear) return [];
    const periodPrefix = month === "all" ? effectiveYear : `${effectiveYear}-${month}`;
    const records = presentRecords
      .filter(
        (record) =>
          record.lifegroupId === selectedGroupId &&
          record.userId === effectiveMemberId &&
          record.date.startsWith(periodPrefix)
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    const seen = new Set<string>();
    const rows: Array<{ date: string; label: string }> = [];
    for (const record of records) {
      const key = record.activityId ?? `${record.lifegroupId}|${record.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ date: record.date, label: activityLabel(activityById.get(key), record.activityId) });
    }
    return rows;
  }, [activityById, effectiveMemberId, effectiveYear, month, presentRecords, selectedGroupId]);

  const dayDetails = useMemo(() => {
    if (!selectedDay) return null;
    const dayActivities = (data?.activities ?? []).filter(
      (activity) =>
        lifegroupActivityDate(activity) === selectedDay &&
        (selectedGroupId === "all" || activity.lifegroup_id === selectedGroupId)
    );
    // Attendees follow the lifegroup scope: with a specific lifegroup selected,
    // only that group's members appear (the activities below are scoped the same).
    const dayRecords = presentRecords.filter(
      (record) => record.date === selectedDay && (selectedGroupId === "all" || record.lifegroupId === selectedGroupId)
    );
    const attendeeIds = new Set(dayRecords.map((record) => record.userId));
    return {
      date: selectedDay,
      activities: dayActivities,
      attendees: Array.from(attendeeIds)
        .map((userId) => memberName(userId))
        .sort((a, b) => a.localeCompare(b))
    };
  }, [data, memberName, presentRecords, selectedDay, selectedGroupId]);

  if (status === "loading") {
    return (
      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Lifegroup</h2>
        <p className="mt-3 status-info">Loading lifegroup analytics...</p>
      </section>
    );
  }

  if (status === "error" || !data) {
    return (
      <section className="analytics-panel">
        <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">Lifegroup</h2>
        <p className="mt-3 status-error">The lifegroup analytics could not be loaded. {errorText}</p>
      </section>
    );
  }

  const seriesHasData = series.some((item) => chartBuild.rows.some((row) => (row.values[item.key] ?? 0) > 0));
  const selectedGroupName = selectedGroupId === "all" ? "" : groupById.get(selectedGroupId)?.name ?? "";
  const periodLabel = month === "all" ? effectiveYear : formatMonthKey(`${effectiveYear}-${month}`);

  return (
    <div className="space-y-4">
      {data.errors.length > 0 ? (
        <p className="status-info">Some lifegroup data was unavailable: {data.errors.join(" ")}</p>
      ) : null}

      <section className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="lifegroup-year">Year</label>
          <select
            id="lifegroup-year"
            className="field-input max-w-[140px]"
            value={effectiveYear}
            onChange={(event) => {
              setYear(event.target.value);
              setMonth("all");
              setSelectedDay(null);
            }}
          >
            {yearOptions.length === 0 ? <option value="">No years with data</option> : null}
            {yearOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="lifegroup-month">Month</label>
          <select
            id="lifegroup-month"
            className="field-input max-w-[200px]"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setSelectedDay(null);
            }}
          >
            <option value="all">Whole year (monthly view)</option>
            {monthOptions.map((option) => (
              <option key={option} value={option}>{formatMonthKey(`${effectiveYear}-${option}`)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="lifegroup-group">Lifegroup</label>
          <select
            id="lifegroup-group"
            className="field-input max-w-[220px]"
            value={selectedGroupId}
            onChange={(event) => {
              setSelectedGroupId(event.target.value);
              setSelectedMemberId("all");
              setSelectedDay(null);
            }}
          >
            <option value="all">All lifegroups</option>
            {groupOptions.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="lifegroup-member">Member</label>
          <select
            id="lifegroup-member"
            className="field-input max-w-[220px] disabled:cursor-not-allowed disabled:bg-[#eef3f1] disabled:text-[#8a9a93]"
            value={effectiveMemberId}
            onChange={(event) => setSelectedMemberId(event.target.value)}
            disabled={selectedGroupId === "all" || memberOptions.length === 0}
          >
            <option value="all">All members</option>
            {selectedGroupId !== "all"
              ? memberOptions.map((option) => (
                  <option key={option.userId} value={option.userId}>{option.name}</option>
                ))
              : null}
          </select>
        </div>
      </section>

      <section className="analytics-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">
            Lifegroup activity — {month === "all" ? effectiveYear : periodLabel}
          </h3>
          <p className="text-[11px] text-[#5d736a]">
            {month === "all" ? "Monthly totals per line. Pick a month for day-level points." : "Click a point to see the activity details."}
          </p>
        </div>

        {!seriesHasData ? (
          <p className="mt-3 text-sm text-[#5d736a]">No lifegroup attendance to plot for this period.</p>
        ) : (
          <>
            <div className="mt-3 h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartBuild.rows}
                  margin={{ top: 16, right: 18, bottom: 4, left: -14 }}
                  onClick={(state) => {
                    const label = activeChartLabel(state);
                    const row = label ? rowByLabel.get(label) : undefined;
                    if (!row?.dateKey) return;
                    if (chartBuild.monthView) {
                      setSelectedDay((previous) => (previous === row.dateKey ? null : row.dateKey));
                    } else {
                      setMonth(row.dateKey.slice(5, 7));
                      setSelectedDay(null);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid stroke="#d5dfdb" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#5d736a", fontSize: 11 }} tickMargin={8} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fill: "#5d736a", fontSize: 11 }} />
                  <Tooltip
                    content={(props) => {
                      if (!props.active || !props.payload || props.payload.length === 0) return null;
                      const row = props.payload[0]?.payload as ChartRow | undefined;
                      if (!row) return null;
                      return (
                        <div className="max-w-[260px] rounded-xl border border-[#c3d0cb] bg-white/95 px-3 py-2 text-xs shadow-[0_10px_24px_rgba(56,91,79,0.18)]">
                          <p className="font-semibold text-[#315349]">{row.fullLabel}</p>
                          {series.map((item) => (
                            <p key={item.key} className="mt-0.5 text-[#4f675e]">
                              {item.name}: <span className="font-semibold text-[#315349]">{row.values[item.key] ?? 0}</span>
                            </p>
                          ))}
                          <p className="mt-1 text-[10px] text-[#7c918a]">
                            {chartBuild.monthView ? "Click for details" : "Click to view this month"}
                          </p>
                        </div>
                      );
                    }}
                    cursor={{ stroke: "#98b6aa", strokeWidth: 1 }}
                  />
                  {series.map((item) => (
                    <Line
                      key={item.key}
                      type="monotone"
                      dataKey={`values.${item.key}`}
                      name={item.name}
                      stroke={item.color}
                      strokeWidth={2.5}
                      dot={{ r: 3, strokeWidth: 0, fill: item.color }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#4f675e]">
              {series.map((item) => (
                <span key={item.key} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.name}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {dayDetails ? (
        <section className="rounded-2xl border border-[#9dbfb1] bg-[#eef4f1] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-[var(--font-heading)] text-lg text-[#25493e]">
              {new Date(`${dayDetails.date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
              })}
            </h3>
            <p className="text-xs font-semibold text-[#35564a]">{dayDetails.attendees.length} attendees</p>
          </div>

          {dayDetails.activities.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {dayDetails.activities.map((activity) => (
                <div key={activity.id} className="rounded-xl bg-white/85 px-3 py-2">
                  <p className="font-semibold text-[#315349]">
                    {activityLabel(activity, activity.id)}
                    {activity.status ? ` • ${activity.status}` : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#5d736a]">
                    {groupById.get(activity.lifegroup_id)?.name ?? "Lifegroup"}
                    {activity.location ? ` • ${activity.location}` : ""}
                  </p>
                  {activity.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-[#4f675e]">{activity.description}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-[#5d736a]">No scheduled activity on this day — attendance was recorded without one.</p>
          )}

          {dayDetails.attendees.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#527064]">Who attended</p>
              <p className="mt-1 text-sm text-[#35564a]">{dayDetails.attendees.join(", ")}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryBarsPanel
          title="Most Attended Activities"
          items={mostAttendedActivities}
          emptyText="No lifegroup attendance in this period."
        />
        <CategoryBarsPanel
          title="Most Active Members"
          items={mostActiveMembers}
          emptyText="No member activity in this period."
        />
      </div>

      {selectedGroupId !== "all" ? (
        <>
          <MemberRankingTable
            title={`Member Attendance Comparison — ${selectedGroupName}`}
            summary={`${rankingRows.length} ${rankingRows.length === 1 ? "member" : "members"} • period ${periodLabel}. Eligible counts only activities on or after the effective join date of each member.`}
            rows={rankingRows}
            showRank
            selectedUserId={effectiveMemberId === "all" ? null : effectiveMemberId}
            onSelectRow={(row) => setSelectedMemberId((previous) => (previous === row.userId ? "all" : row.userId))}
            emptyText="No members belong to this lifegroup yet, so there is nothing to compare."
          />

          {effectiveMemberId !== "all" ? (
            <section className="analytics-panel">
              <h3 className="font-[var(--font-heading)] text-base text-[#23332d]">
                {memberName(effectiveMemberId)} — attended activities ({periodLabel})
              </h3>
              {selectedMemberActivities.length === 0 ? (
                <p className="mt-2 text-sm text-[#5d736a]">No attendance recorded for this member in the period.</p>
              ) : (
                <ul className="mt-2 grid gap-1.5 text-sm text-[#315349]">
                  {selectedMemberActivities.map((entry, index) => (
                    <li key={`${entry.date}-${index}`} className="rounded-lg bg-white/80 px-3 py-1.5">
                      {formatDayLabel(entry.date)} — {entry.label}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
