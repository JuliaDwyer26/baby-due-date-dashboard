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
      colors: ["#ff8f66", "#ffb391", "#ffd2be", "#ffe8dd"],
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
      className="min-h-screen bg-[radial-gradient(circle_at_top,_#f9f9fb_0%,_#f2f3f7_45%,_#eceff4_100%)] px-2 py-3 text-zinc-900 sm:px-8 sm:py-8"
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

      <main className="mx-auto w-full max-w-[1320px] rounded-[28px] border border-white/60 bg-[#f5f6f8]/95 p-2 shadow-[0_30px_70px_rgba(26,33,52,0.18)] sm:p-3">
        <div className="grid min-h-[760px] gap-2 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
          <aside className="hidden rounded-[22px] border border-[#e8ebf0] bg-white px-4 py-5 lg:flex lg:flex-col">
            <div className="mb-8">
              <p className="text-xl font-semibold tracking-tight text-[#212327]">picnic pool</p>
              <p className="text-xs text-zinc-500">race dashboard</p>
            </div>
            <nav className="space-y-2 text-sm">
              {["Overview", "Race Track", "Leaderboard", "Timeline", "Settings"].map((item, index) => (
                <button
                  key={item}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition ${
                    index === 0
                      ? "bg-[#fff0e8] font-semibold text-[#ba5831]"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                  }`}
                >
                  <span className="text-xs">{index === 0 ? "●" : "○"}</span>
                  {item}
                </button>
              ))}
            </nav>
            <div className="mt-auto rounded-2xl bg-[#f8f9fb] p-3">
              <p className="text-xs text-zinc-500">Sound</p>
              <button
                type="button"
                className={`mt-2 w-full rounded-xl px-3 py-2 text-xs font-semibold ${
                  soundArmed ? "bg-[#ff8f66] text-white" : "bg-white text-zinc-700"
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

          <section className="rounded-[22px] border border-[#e8ebf0] bg-white p-4 sm:p-5">
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hello, Margaret</h1>
                <p className="text-sm text-zinc-500">Track the race progress as we get closer to due date.</p>
              </div>
              <div className="rounded-full border border-[#eceff4] bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-zinc-600">
                {formatDateTime(nowMs)}
              </div>
            </header>

            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Entrants", String(totalEntrants), "+2 today"],
                ["Active", String(activeCount), "- as time passes"],
                ["Paid", String(paidCount), `${Math.round((paidCount / totalEntrants) * 100)}% secured`],
                ["Pool", `$${potUsd}`, "$10 each paid"],
              ].map(([label, value, meta]) => (
                <article key={label} className="rounded-2xl border border-[#edf0f4] bg-[#fbfbfc] p-3">
                  <p className="text-xs font-medium text-zinc-500">{label}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
                  <p className="mt-1 text-[11px] text-[#d7683f]">{meta}</p>
                </article>
              ))}
            </section>

            <section className="mt-4 rounded-2xl border border-[#eceff4] bg-[#fbfcff] p-3 sm:p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold sm:text-lg">Face-off race track</h2>
                <span className="text-xs text-zinc-500">{countdownLabel(dueDateMs, nowMs)}</span>
              </div>
              <div className="mb-4 h-2 rounded-full bg-[#f1f3f7]">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-[#ffb08e] to-[#ff7d4f]"
                  style={{ width: `${scheduleProgress}%` }}
                />
              </div>

              <div className="max-h-[300px] space-y-2 overflow-auto pr-1 sm:max-h-[370px]">
                {raceLanes.map((lane) => (
                  <div
                    key={lane.id}
                    className="relative rounded-xl border border-[#edf0f4] bg-white p-2.5 shadow-[0_4px_12px_rgba(33,35,39,0.05)]"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FaceImage name={lane.name} eliminated={lane.isEliminated} sizeClass="h-8 w-8" />
                        <p className={`text-xs font-semibold sm:text-sm ${lane.isEliminated ? "text-zinc-500" : ""}`}>
                          {lane.name}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          lane.isEliminated ? "bg-zinc-200 text-zinc-600" : "bg-[#fff0e8] text-[#ba5831]"
                        }`}
                      >
                        {lane.isEliminated ? "Out" : "In"}
                      </span>
                    </div>

                    <div className="relative h-9 rounded-full bg-[repeating-linear-gradient(90deg,#f5f6f9_0px,#f5f6f9_24px,#ffffff_24px,#ffffff_48px)]">
                      <div className="absolute right-2 top-0 h-full w-1 rounded-full bg-[#ff8d62]" />
                      <div
                        className="absolute top-1/2 transition-all duration-1000 ease-out"
                        style={{ left: `${lane.progress}%`, transform: "translate(-50%, -50%)" }}
                      >
                        <FaceImage
                          name={lane.name}
                          eliminated={lane.isEliminated}
                          sizeClass="h-9 w-9 sm:h-10 sm:w-10"
                          decorative
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-4 grid gap-3 xl:grid-cols-2">
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
                      <div className="h-2 rounded-full bg-[#f2f4f8]">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-[#ffb08e] to-[#ff7d4f]"
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            </section>
          </section>

          <aside className="rounded-[22px] border border-[#e8ebf0] bg-white p-4 sm:p-5">
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

            <article className="mt-4 rounded-2xl border border-[#edf0f4] bg-[#fff4ee] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#ba5831]">Audio + FX</p>
              <button
                type="button"
                className={`mt-2 w-full rounded-xl px-3 py-2 text-sm font-semibold ${
                  soundArmed ? "bg-[#ff8f66] text-white" : "bg-white text-zinc-700"
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
