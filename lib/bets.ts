import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_CONFIG } from "@/lib/config";

type CsvBetRow = {
  timestamp: string;
  name: string;
  dateGuess: string;
  timeGuess: string;
  paymentSent: string;
};

export type Bet = {
  id: string;
  timestamp: string;
  name: string;
  dateGuess: string;
  timeGuess: string;
  paymentSent: boolean;
  guessDateTime: Date;
  guessDateKey: string;
};

type LeaderboardEntry = Bet & {
  deltaMs: number;
};

type OddsEntry = {
  dateKey: string;
  displayDate: string;
  count: number;
  percent: number;
};

export type DashboardData = {
  bets: Bet[];
  leaderboard: LeaderboardEntry[];
  oddsByDate: OddsEntry[];
  totalEntrants: number;
  paidCount: number;
  unpaidCount: number;
  potUsd: number;
  dueDate: Date;
  actualBirthDate: Date | null;
  comparisonDate: Date;
  winner: LeaderboardEntry | null;
  isActualResult: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateTime(dateGuess: string, timeGuess: string): Date | null {
  const dateMatch = dateGuess.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) {
    return null;
  }

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);

  const timeMatch = timeGuess
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/);

  if (!timeMatch) {
    return null;
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const meridiem = timeMatch[3];

  if (hour === 12) {
    hour = 0;
  }

  if (meridiem === "PM") {
    hour += 12;
  }

  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function parseCsvLine(line: string): string[] {
  // CSV is simple in this dataset (no escaped commas), so split is enough.
  return line.split(",").map((value) => value.trim());
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseRows(csvText: string): Bet[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const dataLines = lines.slice(1);

  const rows: CsvBetRow[] = dataLines.map((line) => {
    const [timestamp = "", name = "", dateGuess = "", timeGuess = "", paymentSent = ""] =
      parseCsvLine(line);
    return { timestamp, name, dateGuess, timeGuess, paymentSent };
  });

  return rows
    .map((row, index) => {
      const guessDateTime = parseDateTime(row.dateGuess, row.timeGuess);
      if (!guessDateTime || !row.name) {
        return null;
      }

      return {
        id: `${index + 1}-${row.name.toLowerCase().replace(/\s+/g, "-")}`,
        timestamp: row.timestamp,
        name: row.name,
        dateGuess: row.dateGuess,
        timeGuess: row.timeGuess,
        paymentSent: row.paymentSent.toLowerCase() === "yes",
        guessDateTime,
        guessDateKey: formatDateKey(guessDateTime),
      } satisfies Bet;
    })
    .filter((row): row is Bet => row !== null);
}

function parseConfigDate(isoValue: string): Date | null {
  if (!isoValue) {
    return null;
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function buildOddsByDate(bets: Bet[]): OddsEntry[] {
  const grouped = new Map<string, number>();

  for (const bet of bets) {
    grouped.set(bet.guessDateKey, (grouped.get(bet.guessDateKey) ?? 0) + 1);
  }

  return Array.from(grouped.entries())
    .map(([dateKey, count]) => {
      const date = new Date(`${dateKey}T00:00:00`);
      const displayDate = date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      return {
        dateKey,
        displayDate,
        count,
        percent: (count / bets.length) * 100,
      };
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function formatDuration(deltaMs: number): string {
  const abs = Math.abs(deltaMs);
  const days = Math.floor(abs / DAY_MS);
  const hours = Math.floor((abs % DAY_MS) / (60 * 60 * 1000));
  const minutes = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
  return `${days}d ${hours}h ${minutes}m`;
}

export async function getDashboardData(): Promise<DashboardData> {
  const csvPath = join(process.cwd(), "data", "bets.csv");
  const csvText = await readFile(csvPath, "utf8");
  const bets = parseRows(csvText).sort(
    (a, b) => a.guessDateTime.getTime() - b.guessDateTime.getTime(),
  );

  const dueDate = parseConfigDate(APP_CONFIG.dueDateIso);
  if (!dueDate) {
    throw new Error("Invalid dueDateIso in APP_CONFIG.");
  }

  const actualBirthDate = parseConfigDate(APP_CONFIG.actualBirthIso);
  const comparisonDate = actualBirthDate ?? dueDate;
  const isActualResult = actualBirthDate !== null;

  const leaderboard = [...bets]
    .map((bet) => ({
      ...bet,
      deltaMs: Math.abs(bet.guessDateTime.getTime() - comparisonDate.getTime()),
    }))
    .sort((a, b) => a.deltaMs - b.deltaMs);

  const paidCount = bets.filter((bet) => bet.paymentSent).length;
  const totalEntrants = bets.length;
  const unpaidCount = totalEntrants - paidCount;
  const potUsd = paidCount * APP_CONFIG.entryFeeUsd;
  const oddsByDate = buildOddsByDate(bets);

  return {
    bets,
    leaderboard,
    oddsByDate,
    totalEntrants,
    paidCount,
    unpaidCount,
    potUsd,
    dueDate,
    actualBirthDate,
    comparisonDate,
    winner: leaderboard[0] ?? null,
    isActualResult,
  };
}
