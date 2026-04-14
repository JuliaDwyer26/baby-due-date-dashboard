"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";

type BetView = {
  id: string;
  name: string;
  dateGuess: string;
  timeGuess: string;
  paymentSent: boolean;
  guessMs: number;
};

type OddsView = {
  dateKey: string;
  displayDate: string;
  count: number;
  percent: number;
};

type DashboardClientProps = {
  entryFeeUsd: number;
  dueDateMs: number;
  actualBirthMs: number | null;
  bets: BetView[];
  oddsByDate: OddsView[];
};

type RankedBet = BetView & {
  deltaMs: number;
};

function formatDuration(deltaMs: number): string {
  const abs = Math.abs(deltaMs);
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(abs / dayMs);
  const hours = Math.floor((abs % dayMs) / (60 * 60 * 1000));
  const minutes = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
  return `${days}d ${hours}h ${minutes}m`;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function asSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function countdownLabel(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const pretty = formatDuration(diff);
  if (diff < 0) {
    return `${pretty} past due`;
  }
  return `${pretty} remaining`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function FaceImage({ name, eliminated }: { name: string; eliminated: boolean }) {
  const [src, setSrc] = useState(`/faces/${asSlug(name)}.png`);

  return (
    <Image
      src={src}
      alt={`${name} face`}
      width={48}
      height={48}
      className={`h-12 w-12 rounded-full border border-white/80 object-cover shadow ${
        eliminated ? "grayscale contrast-75" : ""
      }`}
      onError={() => setSrc("/faces/placeholder-face.svg")}
      unoptimized
    />
  );
}

export function DashboardClient({
  entryFeeUsd,
  dueDateMs,
  actualBirthMs,
  bets,
  oddsByDate,
}: DashboardClientProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [introVisible, setIntroVisible] = useState(true);
  const [soundArmed, setSoundArmed] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const shownConfettiRef = useRef(false);
  const previousEliminatedRef = useRef<Set<string>>(new Set());

  const paidCount = useMemo(() => bets.filter((bet) => bet.paymentSent).length, [bets]);
  const totalEntrants = bets.length;
  const unpaidCount = totalEntrants - paidCount;
  const potUsd = paidCount * entryFeeUsd;
  const comparisonMs = actualBirthMs ?? dueDateMs;
  const isActualResult = actualBirthMs !== null;

  const leaderboard = useMemo<RankedBet[]>(() => {
    return [...bets]
      .map((bet) => ({
        ...bet,
        deltaMs: Math.abs(bet.guessMs - comparisonMs),
      }))
      .sort((a, b) => a.deltaMs - b.deltaMs);
  }, [bets, comparisonMs]);

  const winner = leaderboard[0] ?? null;

  const eliminated = useMemo(() => {
    const result = new Set<string>();
    if (isActualResult && winner) {
      for (const bet of bets) {
        if (bet.id !== winner.id) {
          result.add(bet.id);
        }
      }
      return result;
    }

    for (const bet of bets) {
      if (nowMs > bet.guessMs) {
        result.add(bet.id);
      }
    }
    return result;
  }, [bets, isActualResult, nowMs, winner]);

  const raceLanes = useMemo(() => {
    const minGuessMs = Math.min(...bets.map((bet) => bet.guessMs));
    const maxGuessMs = Math.max(...bets.map((bet) => bet.guessMs));
    const rangeMs = Math.max(maxGuessMs - minGuessMs, 6 * 60 * 60 * 1000);

    return bets
      .map((bet) => {
        let progress = 10;
        if (isActualResult) {
          const rank = leaderboard.findIndex((entry) => entry.id === bet.id);
          progress = clamp(96 - rank * 4.2, 10, 96);
        } else {
          const proximity = 1 - Math.abs(bet.guessMs - nowMs) / rangeMs;
          progress = clamp(8 + clamp(proximity, 0, 1) * 84, 8, 94);
        }
        return {
          ...bet,
          progress,
          isEliminated: eliminated.has(bet.id),
        };
      })
      .sort((a, b) => b.progress - a.progress);
  }, [bets, eliminated, isActualResult, leaderboard, nowMs]);

  const armAudio = () => {
    if (audioCtxRef.current) {
      return;
    }
    audioCtxRef.current = new window.AudioContext();
    setSoundArmed(true);
  };

  const playKnockoutSound = () => {
    if (!audioCtxRef.current) {
      return;
    }
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.55);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.62);
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroVisible(false), 15000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (shownConfettiRef.current || nowMs < dueDateMs) {
      return;
    }

    shownConfettiRef.current = true;
    void confetti({
      particleCount: 220,
      spread: 90,
      origin: { y: 0.6 },
      colors: ["#7ecfa8", "#9ddfb8", "#d9f7e7", "#f8f4e9"],
    });
  }, [dueDateMs, nowMs]);

  useEffect(() => {
    const previous = previousEliminatedRef.current;
    const newlyEliminated = [...eliminated].filter((id) => !previous.has(id));
    if (newlyEliminated.length > 0 && soundArmed) {
      playKnockoutSound();
    }
    previousEliminatedRef.current = new Set(eliminated);
  }, [eliminated, soundArmed]);

  return (
    <div
      className="min-h-screen bg-[radial-gradient(circle_at_top,_#eefcf1_0%,_#f9faf7_46%,_#ffffff_100%)] px-3 py-4 pb-12 text-zinc-900 sm:px-8 sm:py-6"
      onClick={armAudio}
    >
      {introVisible ? (
        <div className="intro-overlay">
          <div className="intro-baby">
            <Image
              src="/faces/baby-intro.png"
              alt="Baby face intro"
              className="intro-baby-face"
              width={700}
              height={700}
              onError={(event) => {
                event.currentTarget.src = "/faces/placeholder-face.svg";
              }}
              unoptimized
            />
            <p className="mt-4 text-center text-2xl font-semibold tracking-tight text-white drop-shadow-lg sm:text-4xl">
              Welcome! Let&apos;s make some mula!
            </p>
          </div>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:gap-6">
        <header className="rounded-[22px] border border-[#dbeadd] bg-white/90 p-4 shadow-[0_10px_30px_rgba(26,45,34,0.08)] sm:rounded-[28px] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5f8f72]">
                Baby Pool
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:mt-2 sm:text-4xl">
                Picnic Derby Dashboard
              </h1>
              <p className="mt-1 text-xs text-zinc-600 sm:mt-2 sm:text-sm">
                Due date: {formatDateTime(dueDateMs)}
              </p>
            </div>
            <button
              type="button"
              className={`w-full rounded-full px-5 py-2.5 text-sm font-semibold transition sm:w-auto ${
                soundArmed
                  ? "bg-[#7ecfa8] text-[#174a2e]"
                  : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                armAudio();
              }}
            >
              {soundArmed ? "Dramatic sound: ON" : "Tap to enable dramatic sound"}
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {[
            ["Entrants", String(totalEntrants)],
            ["Paid", String(paidCount)],
            ["Unpaid", String(unpaidCount)],
            ["Pool", `$${potUsd}`],
          ].map(([label, value]) => (
            <article
              key={label}
              className="rounded-[18px] border border-[#dfebe2] bg-white/95 p-3 shadow-[0_8px_25px_rgba(26,45,34,0.06)] sm:rounded-[22px] sm:p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight sm:mt-2 sm:text-3xl">{value}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-[20px] border border-[#dfece3] bg-white p-4 shadow-[0_8px_24px_rgba(26,45,34,0.06)] sm:rounded-[24px] sm:p-5">
            <h2 className="text-lg font-semibold sm:text-xl">Countdown and race status</h2>
            <div className="mt-3 space-y-2 text-sm text-zinc-700 sm:mt-4">
              <p>
                <span className="font-semibold text-zinc-500">Status:</span>{" "}
                {isActualResult ? "Official results unlocked" : "Live derby in progress"}
              </p>
              <p>
                <span className="font-semibold text-zinc-500">
                  {isActualResult ? "Birth time:" : "Countdown:"}
                </span>{" "}
                {isActualResult && actualBirthMs
                  ? formatDateTime(actualBirthMs)
                  : countdownLabel(dueDateMs, nowMs)}
              </p>
              <p>
                <span className="font-semibold text-zinc-500">
                  {isActualResult ? "Winner:" : "Current favorite:"}
                </span>{" "}
                {winner ? `${winner.name} (${formatDuration(winner.deltaMs)} away)` : "TBD"}
              </p>
            </div>
          </article>

          <article className="rounded-[20px] border border-[#dfece3] bg-white p-4 shadow-[0_8px_24px_rgba(26,45,34,0.06)] sm:rounded-[24px] sm:p-5">
            <h2 className="text-lg font-semibold sm:text-xl">Odds by guessed date</h2>
            <ul className="mt-3 space-y-3 sm:mt-4">
              {oddsByDate.map((item) => (
                <li key={item.dateKey}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{item.displayDate}</span>
                    <span className="font-medium">
                      {item.count} ({item.percent.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-[#e7f2eb]">
                    <div
                      className="h-2.5 rounded-full bg-gradient-to-r from-[#7fcfa8] to-[#5fbf90]"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="rounded-[22px] border border-[#dfece3] bg-white p-4 shadow-[0_10px_26px_rgba(26,45,34,0.06)] sm:rounded-[26px] sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold sm:text-xl">Carnival horse race</h2>
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 sm:text-xs">
              Live knockout mode
            </p>
          </div>

          <div className="space-y-3">
            {raceLanes.map((lane) => (
              <div
                key={lane.id}
                className="relative overflow-hidden rounded-xl border border-[#e7efe9] bg-[#fbfdfb] p-2.5 sm:rounded-2xl sm:p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FaceImage name={lane.name} eliminated={lane.isEliminated} />
                    <div>
                      <p className={`text-sm font-semibold sm:text-base ${lane.isEliminated ? "text-zinc-500" : ""}`}>
                        {lane.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {lane.dateGuess} at {lane.timeGuess}
                      </p>
                    </div>
                  </div>
                  <p
                    className={`hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline-flex ${
                      lane.isEliminated ? "bg-zinc-200 text-zinc-600" : "bg-[#ddf4e7] text-[#1e5d3b]"
                    }`}
                  >
                    {lane.isEliminated ? "Eliminated" : "Still in race"}
                  </p>
                </div>

                <div className="relative h-7 rounded-full bg-[repeating-linear-gradient(90deg,#edf5ef_0px,#edf5ef_28px,#f9fcfa_28px,#f9fcfa_56px)] sm:h-8">
                  <div className="absolute right-2 top-0 h-full w-1 rounded-full bg-[#6ec79d]" />
                  <div
                    className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1 transition-all duration-1000 ease-out"
                    style={{ left: `${lane.progress}%`, transform: "translate(-50%, -50%)" }}
                  >
                    <span className={`text-xl sm:text-2xl ${lane.isEliminated ? "grayscale" : ""}`}>🐎</span>
                    <span className={`text-lg sm:text-xl ${lane.isEliminated ? "grayscale" : ""}`}>🎠</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-[20px] border border-[#dfece3] bg-white p-4 shadow-[0_8px_24px_rgba(26,45,34,0.06)] sm:rounded-[24px] sm:p-5">
            <h2 className="text-lg font-semibold sm:text-xl">Leaderboard</h2>
            <ol className="mt-3 space-y-2 sm:mt-4">
              {leaderboard.map((entry, index) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-xl border border-[#edf3ee] p-3"
                >
                  <p className="text-sm font-medium sm:text-base">
                    #{index + 1} {entry.name}
                  </p>
                  <p className="text-sm font-semibold text-zinc-700">{formatDuration(entry.deltaMs)}</p>
                </li>
              ))}
            </ol>
          </article>

          <article className="rounded-[20px] border border-[#dfece3] bg-white p-4 shadow-[0_8px_24px_rgba(26,45,34,0.06)] sm:rounded-[24px] sm:p-5">
            <h2 className="text-lg font-semibold sm:text-xl">Timeline</h2>
            <ol className="mt-3 space-y-2 sm:mt-4">
              {[...bets]
                .sort((a, b) => a.guessMs - b.guessMs)
                .map((bet) => (
                  <li
                    key={bet.id}
                    className="flex items-center justify-between rounded-xl border border-[#edf3ee] p-3"
                  >
                    <div>
                      <p className="text-sm font-medium sm:text-base">{bet.name}</p>
                      <p className="text-xs text-zinc-500">{formatDateTime(bet.guessMs)}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        bet.paymentSent ? "bg-[#ddf4e7] text-[#1e5d3b]" : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {bet.paymentSent ? "Paid" : "Unpaid"}
                    </span>
                  </li>
                ))}
            </ol>
          </article>
        </section>
      </main>
    </div>
  );
}
