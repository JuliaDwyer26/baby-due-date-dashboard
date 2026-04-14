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

function FaceImage({
  name,
  eliminated,
  sizeClass = "h-12 w-12",
  decorative = false,
}: {
  name: string;
  eliminated: boolean;
  sizeClass?: string;
  decorative?: boolean;
}) {
  const [src, setSrc] = useState(`/faces/${asSlug(name)}.png`);

  return (
    <Image
      src={src}
      alt={`${name} face`}
      width={48}
      height={48}
      className={`${sizeClass} face-diecut object-cover shadow-md ${
        eliminated ? "grayscale contrast-75" : ""
      }`}
      aria-hidden={decorative}
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
  const [introClosing, setIntroClosing] = useState(false);
  const [introLoaded, setIntroLoaded] = useState(false);
  const [soundArmed, setSoundArmed] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const shownConfettiRef = useRef(false);
  const previousEliminatedRef = useRef<Set<string>>(new Set());

  const paidCount = useMemo(() => bets.filter((bet) => bet.paymentSent).length, [bets]);
  const totalEntrants = bets.length;
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

  const scheduleProgress = useMemo(() => {
    const earliest = Math.min(...bets.map((bet) => bet.guessMs));
    const span = Math.max(dueDateMs - earliest, 1);
    const progress = ((nowMs - earliest) / span) * 100;
    return clamp(progress, 0, 100);
  }, [bets, dueDateMs, nowMs]);

  const activeCount = totalEntrants - eliminated.size;

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
    if (!introLoaded || !introVisible) {
      return;
    }

    const holdTimer = window.setTimeout(() => setIntroClosing(true), 2000);
    const closeTimer = window.setTimeout(() => setIntroVisible(false), 2700);

    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(closeTimer);
    };
  }, [introLoaded, introVisible]);

  useEffect(() => {
    // Safety fallback in case image load event never fires.
    if (!introVisible) {
      return;
    }
    const fallbackTimer = window.setTimeout(() => {
      setIntroLoaded(true);
    }, 5000);
    return () => window.clearTimeout(fallbackTimer);
  }, [introVisible]);

  useEffect(() => {
    if (shownConfettiRef.current || nowMs < dueDateMs) {
      return;
    }

    shownConfettiRef.current = true;
    void confetti({
      particleCount: 220,
      spread: 90,
      origin: { y: 0.6 },
      colors: ["#7b61ff", "#a259ff", "#18a0fb", "#0acf83", "#ff7262", "#f24e1e"],
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
      className="min-h-screen bg-white px-2 py-3 text-[#f2f2f2] sm:px-8 sm:py-8"
      onClick={armAudio}
    >
      {introVisible ? (
        <div className={`intro-overlay ${introClosing ? "intro-overlay--closing" : ""}`}>
          <div className="intro-baby">
            <Image
              src="/faces/baby-intro.png"
              alt="Baby face intro"
              className={`intro-baby-face ${introLoaded ? "intro-baby-face--loaded" : ""}`}
              width={700}
              height={700}
              onLoad={() => setIntroLoaded(true)}
              onError={(event) => {
                event.currentTarget.src = "/faces/placeholder-face.svg";
                setIntroLoaded(true);
              }}
              unoptimized
            />
            <p className="mt-4 text-center text-2xl font-semibold tracking-tight text-white drop-shadow-lg sm:text-4xl">
              Welcome! Let&apos;s make some mula!
            </p>
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-[1320px] rounded-[28px] border border-white/10 bg-[#ffffff]/95 p-2 sm:p-3">
        <div className="grid min-h-[760px] gap-2 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
          <aside className="hidden rounded-[22px] border border-[#2e2e39] bg-[#1f1f27] px-4 py-5 text-zinc-100 lg:flex lg:flex-col">
            <div className="mb-8">
              <p className="text-xl font-semibold tracking-tight text-white">baby pool</p>
              <p className="text-xs text-zinc-400">figma mode</p>
            </div>
            <nav className="space-y-2 text-sm">
              {["Overview", "Race Track", "Leaderboard", "Timeline", "Settings"].map((item, index) => (
                <button
                  key={item}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition ${
                    index === 0
                      ? "bg-[linear-gradient(135deg,#f24e1e,#a259ff,#18a0fb)] font-semibold text-white"
                      : "text-zinc-400 hover:bg-[#2a2a34] hover:text-white"
                  }`}
                >
                  <span className="text-xs">{index === 0 ? "●" : "○"}</span>
                  {item}
                </button>
              ))}
            </nav>
            <div className="mt-auto rounded-2xl bg-[#2a2a34] p-3">
              <p className="text-xs text-zinc-400">Sound</p>
              <button
                type="button"
                className={`mt-2 w-full rounded-xl px-3 py-2 text-xs font-semibold ${
                  soundArmed ? "bg-[#7b61ff] text-white" : "bg-[#f2f3f6] text-zinc-800"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  armAudio();
                }}
              >
                {soundArmed ? "Dramatic ON" : "Enable FX"}
              </button>
            </div>
          </aside>

          <section className="rounded-[22px] border border-[#ececf1] bg-white p-4 sm:p-5">
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-[#1e1f26] sm:text-3xl">Hello, ya filthy gamblers!</h1>
                <p className="text-sm text-zinc-900">Track the race progress as we get closer to due date.</p>
              </div>
              <div className="rounded-full border border-[#eceff4] bg-[#f8f8fb] px-3 py-1.5 text-xs font-medium text-zinc-600">
                {formatDateTime(nowMs)}
              </div>
            </header>

            <section className="mb-3 rounded-2xl border border-[#ececf1] bg-white p-3 sm:p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6b5cf6]">Key Dates</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <article className="rounded-xl border border-[#e7e2ff] bg-white px-3 py-2">
                  <p className="text-xs text-zinc-500">Expected due date</p>
                  <p className="text-base font-bold text-zinc-900 sm:text-lg">April 16</p>
                </article>
                <article className="rounded-xl border border-[#cdeeff] bg-white px-3 py-2">
                  <p className="text-xs text-zinc-500">Induction date</p>
                  <p className="text-base font-bold text-zinc-900 sm:text-lg">April 18</p>
                </article>
              </div>
            </section>

            <section className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <article className="overflow-hidden rounded-2xl border-2 border-transparent [background:linear-gradient(#ffffff,#ffffff)_padding-box,linear-gradient(135deg,#f24e1e_0%,#a259ff_45%,#18a0fb_100%)_border-box]">
                <div className="align-middle rounded-[14px] bg-white px-4 py-4 text-zinc-900 sm:px-5">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Total pool</p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight text-zinc-900 sm:text-5xl">${potUsd}</p>
                  <p className="mt-1 text-xs text-zinc-500">${entryFeeUsd} per paid entrant</p>
                </div>
              </article>
              <article className="rounded-2xl border border-[#e7ebf2] bg-[#f8f8fc] px-4 py-4">
                <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Entrants</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">{totalEntrants}</p>
                <p className="mt-2 text-xs text-zinc-500">
                  Active: <span className="font-semibold text-zinc-700">{activeCount}</span>
                </p>
                <p className="text-xs text-zinc-500">
                  Paid: <span className="font-semibold text-zinc-700">{paidCount}</span>
                </p>
              </article>
            </section>

            <section className="mt-3 rounded-2xl border border-[#e7ebf2] bg-gradient-to-b from-[#ffffff] to-[#f8f8fd] p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Face-off race track</h2>
                  <p className="text-xs text-zinc-500">Primary board - this decides who wins.</p>
                </div>
                <span className="rounded-full border border-[#eceff4] bg-white px-3 py-1 text-xs font-medium text-zinc-600">
                  {countdownLabel(dueDateMs, nowMs)}
                </span>
              </div>
              <div className="mb-4 h-2.5 rounded-full bg-[#eceef4]">
                <div
                  className="h-2.5 rounded-full bg-gradient-to-r from-[#f24e1e] via-[#a259ff] to-[#18a0fb]"
                  style={{ width: `${scheduleProgress}%` }}
                />
              </div>

              <div className="space-y-2 pr-1">
                {raceLanes.map((lane) => (
                  <div
                    key={lane.id}
                    className="relative rounded-xl border border-[#eaedf3] bg-white p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FaceImage name={lane.name} eliminated={lane.isEliminated} sizeClass="h-12 w-12 sm:h-14 sm:w-14" />
                        <p className={`text-sm font-semibold ${lane.isEliminated ? "text-zinc-500" : ""}`}>
                          {lane.name}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          lane.isEliminated ? "bg-zinc-200 text-zinc-600" : "bg-[#efeaff] text-[#6b5cf6]"
                        }`}
                      >
                        {lane.isEliminated ? "Out" : "In"}
                      </span>
                    </div>

                    <div className="relative h-5 rounded-full bg-[repeating-linear-gradient(90deg,#f5f6f9_0px,#f5f6f9_24px,#ffffff_24px,#ffffff_48px)] sm:h-[22px]">
                      <div className="absolute right-2 top-0 h-full w-1 rounded-full bg-[#7b61ff]" />
                      <div
                        className="absolute top-1/2 transition-all duration-1000 ease-out"
                        style={{ left: `${lane.progress}%`, transform: "translate(-50%, -50%)" }}
                      >
                        <FaceImage
                          name={lane.name}
                          eliminated={lane.isEliminated}
                          sizeClass="h-14 w-14 sm:h-16 sm:w-16"
                          decorative
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-3 grid grid-cols-2 gap-2 opacity-85 sm:grid-cols-4">
              {[
                ["Entrants", String(totalEntrants), "+2 today"],
                ["Active", String(activeCount), "- as time passes"],
                ["Paid", String(paidCount), `${Math.round((paidCount / totalEntrants) * 100)}% secured`],
                ["Pool", `$${potUsd}`, "$10 each paid"],
              ].map(([label, value, meta]) => (
                <article key={label} className="rounded-xl border border-[#edf0f4] bg-[#fbfbfc] p-2.5 sm:p-3">
                  <p className="text-[11px] font-medium text-zinc-500">{label}</p>
                  <p className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{value}</p>
                  <p className="mt-1 text-[10px] text-[#6b5cf6]">{meta}</p>
                </article>
              ))}
            </section>

            <section className="mt-4 grid gap-3 opacity-85 xl:grid-cols-2">
              <article className="rounded-2xl border border-[#edf0f4] bg-[#fbfcff] p-3">
                <h3 className="text-sm font-semibold sm:text-base">Leaderboard</h3>
                <ol className="mt-2 space-y-2">
                  {leaderboard.slice(0, 8).map((entry, index) => (
                    <li key={entry.id} className="flex items-center justify-between rounded-xl bg-white p-2 text-sm">
                      <p className="font-medium">
                        #{index + 1} {entry.name}
                      </p>
                      <p className="text-xs font-semibold text-zinc-600">{formatDuration(entry.deltaMs)}</p>
                    </li>
                  ))}
                </ol>
              </article>

              <article className="rounded-2xl border border-[#edf0f4] bg-[#fbfcff] p-3">
                <h3 className="text-sm font-semibold sm:text-base">Date Odds</h3>
                <ul className="mt-2 space-y-2">
                  {oddsByDate.map((item) => (
                    <li key={item.dateKey} className="rounded-xl bg-white p-2">
                      <div className="mb-1 flex justify-between text-xs">
                        <span>{item.displayDate}</span>
                        <span className="font-semibold">{item.percent.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#edf0f6]">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-[#f24e1e] via-[#a259ff] to-[#18a0fb]"
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            </section>
          </section>

          <aside className="rounded-[22px] border border-[#e8ebf0] bg-[#fdfdff] p-4 sm:p-5">
            <article className="rounded-2xl border border-[#edf0f4] bg-[#fbfcff] p-4 text-center">
              <FaceImage name="The Mother (Katherine)" eliminated={false} sizeClass="mx-auto h-16 w-16 sm:h-20 sm:w-20" />
              <p className="mt-2 text-base font-semibold">Mama HQ</p>
              <p className="text-xs text-zinc-500">{isActualResult ? "Baby arrived" : "Waiting for arrival"}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white p-2">
                  <p className="text-zinc-500">Favorite</p>
                  <p className="font-semibold">{winner?.name ?? "TBD"}</p>
                </div>
                <div className="rounded-lg bg-white p-2">
                  <p className="text-zinc-500">Pool</p>
                  <p className="font-semibold">${potUsd}</p>
                </div>
              </div>
            </article>

            <article className="mt-4 rounded-2xl border border-[#edf0f4] bg-[#fbfcff] p-3">
              <h3 className="text-sm font-semibold">Activity</h3>
              <div className="mt-2 space-y-2">
                {leaderboard.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 rounded-xl bg-white p-2">
                    <FaceImage name={entry.name} eliminated={eliminated.has(entry.id)} sizeClass="h-7 w-7" decorative />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{entry.name}</p>
                      <p className="text-[11px] text-zinc-500">{formatDuration(entry.deltaMs)} from target</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="mt-4 rounded-2xl border border-[#e7e2ff] bg-[#f4f2ff] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#6b5cf6]">Audio + FX</p>
              <button
                type="button"
                className={`mt-2 w-full rounded-xl px-3 py-2 text-sm font-semibold ${
                  soundArmed ? "bg-[#7b61ff] text-white" : "bg-white text-zinc-700"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  armAudio();
                }}
              >
                {soundArmed ? "Dramatic sound enabled" : "Enable dramatic sound"}
              </button>
            </article>
          </aside>
        </div>
      </main>
    </div>
  );
}
