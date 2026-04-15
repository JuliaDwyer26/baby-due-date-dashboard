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

const WELCOME_SEEN_KEY = "baby-dashboard-welcome-seen-v1";

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

function formatVote(dateGuess: string, timeGuess: string): string {
  return `${dateGuess} at ${timeGuess}`;
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
  const [nowMs, setNowMs] = useState(() => dueDateMs);
  const [clockReady, setClockReady] = useState(false);
  const [introVisible, setIntroVisible] = useState(false);
  const [introClosing, setIntroClosing] = useState(false);
  const [introLoaded, setIntroLoaded] = useState(false);
  const [winnerVisible, setWinnerVisible] = useState(false);
  const [winnerClosing, setWinnerClosing] = useState(false);
  const [winnerLoaded, setWinnerLoaded] = useState(false);
  const [winnerImageSrc, setWinnerImageSrc] = useState("/faces/placeholder-face.svg");
  const [soundArmed, setSoundArmed] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previousEliminatedRef = useRef<Set<string>>(new Set());

  const paidCount = useMemo(() => bets.filter((bet) => bet.paymentSent).length, [bets]);
  const totalEntrants = bets.length;
  const potUsd = totalEntrants * entryFeeUsd;
  const comparisonMs = dueDateMs;
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
  const winnerDeclared = clockReady && nowMs >= dueDateMs;

  const eliminated = useMemo(() => {
    const result = new Set<string>();
    if (winnerDeclared && winner) {
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
  }, [bets, nowMs, winner, winnerDeclared]);

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
  const fallenSoldiers = useMemo(
    () => leaderboard.filter((entry) => eliminated.has(entry.id)),
    [eliminated, leaderboard],
  );
  const expectedDueMs = dueDateMs - 2 * 24 * 60 * 60 * 1000;
  const expectedDueCountdown = countdownLabel(expectedDueMs, nowMs);
  const inductionCountdown = countdownLabel(dueDateMs, nowMs);

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
    // Set the live clock only after mount to avoid SSR hydration mismatches.
    setNowMs(Date.now());
    setClockReady(true);
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const hasSeenWelcome = window.localStorage.getItem(WELCOME_SEEN_KEY) === "1";
    if (hasSeenWelcome) {
      return;
    }
    window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
    setIntroVisible(true);
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
    if (!winnerDeclared || !winner) {
      return;
    }

    const winnerSeenKey = `baby-dashboard-winner-seen-${dueDateMs}-${winner.id}`;
    const hasSeenWinner = window.localStorage.getItem(winnerSeenKey) === "1";
    if (hasSeenWinner) {
      return;
    }

    window.localStorage.setItem(winnerSeenKey, "1");
    setWinnerImageSrc(`/faces/${asSlug(winner.name)}.png`);
    setWinnerLoaded(false);
    setWinnerClosing(false);
    setWinnerVisible(true);
  }, [dueDateMs, winner, winnerDeclared]);

  useEffect(() => {
    if (!winnerLoaded || !winnerVisible) {
      return;
    }

    const holdTimer = window.setTimeout(() => setWinnerClosing(true), 2500);
    const closeTimer = window.setTimeout(() => setWinnerVisible(false), 3300);
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(closeTimer);
    };
  }, [winnerLoaded, winnerVisible]);

  useEffect(() => {
    if (!winnerVisible) {
      return;
    }
    const fallbackTimer = window.setTimeout(() => {
      setWinnerLoaded(true);
    }, 4500);
    return () => window.clearTimeout(fallbackTimer);
  }, [winnerVisible]);

  useEffect(() => {
    if (!winnerVisible || !winnerLoaded) {
      return;
    }

    void confetti({
      particleCount: 280,
      spread: 110,
      origin: { y: 0.55 },
      colors: ["#7b61ff", "#a259ff", "#18a0fb", "#0acf83", "#ff7262", "#f24e1e"],
    });
  }, [winnerLoaded, winnerVisible]);

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
      className="min-h-screen bg-white px-2 py-3 text-zinc-900 sm:px-8 sm:py-8"
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
            <p className="mt-4 rounded-xl bg-white/80 px-4 py-2 text-center text-2xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
              Place your bets on Baby Larson!
            </p>
          </div>
        </div>
      ) : null}

      {winnerVisible && winner ? (
        <div className={`intro-overlay ${winnerClosing ? "intro-overlay--closing" : ""}`}>
          <div className="intro-baby">
            <Image
              src={winnerImageSrc}
              alt={`${winner.name} winner portrait`}
              className={`intro-baby-face ${winnerLoaded ? "intro-baby-face--loaded" : ""}`}
              width={900}
              height={900}
              onLoad={() => setWinnerLoaded(true)}
              onError={() => {
                setWinnerImageSrc("/faces/placeholder-face.svg");
                setWinnerLoaded(true);
              }}
              unoptimized
            />
            <p className="mt-4 rounded-xl bg-white/80 px-4 py-2 text-center text-2xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
              Winner: {winner.name}
            </p>
            <p className="mt-2 rounded-xl bg-white/70 px-4 py-2 text-center text-sm font-medium text-zinc-700 sm:text-base">
              Closest to the due date ({formatVote(winner.dateGuess, winner.timeGuess)})
            </p>
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-[1320px] rounded-[28px] border border-white/10 bg-[#ffffff]/95 p-2 sm:p-3">
        <div className="grid min-h-[760px] gap-2 lg:grid-cols-[minmax(0,1fr)_300px]">

          <section className="rounded-[22px] border border-[#ececf1] bg-white p-4 sm:p-5">
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="bg-gradient-to-r from-[#1e1f26] via-[#3a3f55] to-[#6b5cf6] bg-clip-text text-2xl font-extrabold tracking-tight text-transparent sm:text-3xl">
                  Baby betting dashboard
                </h1>
              </div>
            </header>

            <section className="mb-3 rounded-2xl border border-[#ececf1] bg-white p-3 sm:p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6b5cf6]">Key Dates</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <article className="min-w-0 rounded-xl border border-[#e7e2ff] bg-white px-3 py-2">
                  <p className="text-xs text-zinc-500">Due date</p>
                  <p className="text-base font-bold text-zinc-900 sm:text-lg">April 16</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">{expectedDueCountdown}</p>
                </article>
                <article className="min-w-0 rounded-xl border border-[#ececf1] bg-white px-3 py-2">
                  <p className="text-xs text-zinc-500">Induction date</p>
                  <p className="text-base font-bold text-zinc-900 sm:text-lg">April 18</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">{inductionCountdown}</p>
                </article>
              </div>
            </section>

            <section className="mt-2">
              <article className="overflow-hidden rounded-2xl border-2 border-transparent [background:linear-gradient(#ffffff,#ffffff)_padding-box,linear-gradient(135deg,#f24e1e_0%,#a259ff_45%,#18a0fb_100%)_border-box]">
                <div className="align-middle rounded-[14px] bg-white px-4 py-4 text-zinc-900 sm:px-5">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Total pool</p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight text-zinc-900 sm:text-5xl">${potUsd}</p>
                  <p className="mt-1 text-xs text-zinc-500">${entryFeeUsd} per paid entrant</p>
                </div>
              </article>
            </section>

            <section className="mt-3 rounded-2xl border border-[#e7ebf2] bg-gradient-to-b from-[#ffffff] to-[#f8f8fd] p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Leaderboard</h2>
                </div>
                <span className="rounded-full border border-green-300/70 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 ring-[0.5px] ring-green-400/45 [animation:pulse_2.8s_cubic-bezier(0.4,0,0.6,1)_infinite]">
                  {countdownLabel(dueDateMs, nowMs)}
                </span>
              </div>
              <div className="mb-4 h-2 rounded-full bg-[#eceef4] sm:h-2.5">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-[#f24e1e] via-[#a259ff] to-[#18a0fb] sm:h-2.5"
                  style={{ width: `${scheduleProgress}%` }}
                />
              </div>

              <div className="space-y-2 pr-1">
                {raceLanes.map((lane) => (
                  <div
                    key={lane.id}
                    className="relative rounded-xl border border-[#eaedf3] bg-white p-3"
                  >
                    <div className="mb-2 flex items-center">
                      <div className="flex min-w-0 items-center gap-2">
                        <FaceImage name={lane.name} eliminated={lane.isEliminated} sizeClass="h-14 w-14 sm:h-14 sm:w-14" />
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-semibold ${lane.isEliminated ? "text-zinc-500" : ""}`}>{lane.name}</p>
                          <p className="text-xs font-medium text-zinc-600">Voted: {formatVote(lane.dateGuess, lane.timeGuess)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="relative h-[5px] rounded-full bg-[#dfe3ea] sm:h-[7px]">
                      <div
                        className="absolute top-1/2 transition-all duration-1000 ease-out"
                        style={{ left: `${lane.progress}%`, transform: "translate(-50%, -50%)" }}
                      >
                        <div className="h-3 w-3 rounded-full bg-[#22c55e] sm:hidden" />
                        <div className="hidden sm:block">
                          <FaceImage
                            name={lane.name}
                            eliminated={lane.isEliminated}
                            sizeClass="h-16 w-16"
                            decorative
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-zinc-900 sm:p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold tracking-tight sm:text-lg">Fallen Soldiers</h3>
                <span className="rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
                  {fallenSoldiers.length} out
                </span>
              </div>

              {fallenSoldiers.length === 0 ? (
                <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                  No one has fallen yet.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {fallenSoldiers.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <FaceImage name={entry.name} eliminated sizeClass="h-9 w-9" decorative />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-900">{entry.name}</p>
                          <p className="truncate text-xs text-zinc-600">
                            Voted: {formatVote(entry.dateGuess, entry.timeGuess)}
                          </p>
                          <p className="text-[11px] text-zinc-500">{formatDuration(entry.deltaMs)} from target</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
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

            <section className="mt-4 grid gap-3 xl:grid-cols-2">
              <article className="rounded-2xl border border-[#edf0f4] bg-[#fbfcff] p-3">
                <h3 className="text-sm font-semibold sm:text-base">Leaderboard</h3>
                <ol className="mt-2 space-y-2">
                  {leaderboard.slice(0, 8).map((entry, index) => (
                    <li key={entry.id} className="flex items-center justify-between rounded-xl bg-white p-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          #{index + 1} {entry.name}
                        </p>
                        <p className="truncate text-xs font-medium text-zinc-600">Voted: {formatVote(entry.dateGuess, entry.timeGuess)}</p>
                      </div>
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
                  {winner ? <p className="mt-0.5 text-xs font-medium text-zinc-600">Voted: {formatVote(winner.dateGuess, winner.timeGuess)}</p> : null}
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
                      <p className="truncate text-xs font-medium text-zinc-600">Voted: {formatVote(entry.dateGuess, entry.timeGuess)}</p>
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
