import { APP_CONFIG } from "@/lib/config";
import { formatDuration, getDashboardData } from "@/lib/bets";

function formatDateTime(value: Date): string {
  return value.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCountdown(targetDate: Date): string {
  const diff = targetDate.getTime() - Date.now();
  const isPast = diff < 0;
  const pretty = formatDuration(diff);
  return isPast ? `${pretty} overdue` : `${pretty} remaining`;
}

export default async function Home() {
  const data = await getDashboardData();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 text-zinc-900">
      <header className="space-y-2 rounded-2xl bg-gradient-to-r from-pink-100 via-purple-100 to-blue-100 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-600">
          Baby Larson betting pool
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Due Date Dashboard</h1>
        <p className="text-sm text-zinc-700">
          Due date target: <span className="font-semibold">{formatDateTime(data.dueDate)}</span>
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Entrants</p>
          <p className="mt-2 text-2xl font-semibold">{data.totalEntrants}</p>
        </article>
        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Paid</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{data.paidCount}</p>
        </article>
        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Unpaid</p>
          <p className="mt-2 text-2xl font-semibold text-rose-700">{data.unpaidCount}</p>
        </article>
        <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Pool total</p>
          <p className="mt-2 text-2xl font-semibold">${data.potUsd}</p>
          <p className="mt-1 text-xs text-zinc-500">${APP_CONFIG.entryFeeUsd} per paid entry</p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Countdown and winner</h2>
          <div className="mt-3 space-y-2 text-sm">
            <p>
              <span className="font-medium text-zinc-500">Status:</span>{" "}
              {data.isActualResult ? "Baby has arrived" : "Waiting for arrival"}
            </p>
            <p>
              <span className="font-medium text-zinc-500">
                {data.isActualResult ? "Actual birth:" : "Countdown:"}
              </span>{" "}
              {data.isActualResult && data.actualBirthDate
                ? formatDateTime(data.actualBirthDate)
                : formatCountdown(data.dueDate)}
            </p>
            <p>
              <span className="font-medium text-zinc-500">
                {data.isActualResult ? "Winning bet:" : "Projected closest:"}
              </span>{" "}
              {data.winner
                ? `${data.winner.name} (${formatDuration(data.winner.deltaMs)} away)`
                : "No bets available"}
            </p>
          </div>
        </article>

        <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Odds by guessed date</h2>
          <ul className="mt-3 space-y-3">
            {data.oddsByDate.map((item) => (
              <li key={item.dateKey}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{item.displayDate}</span>
                  <span className="font-medium">
                    {item.count} bets ({item.percent.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-2 rounded bg-zinc-100">
                  <div
                    className="h-2 rounded bg-purple-500"
                    style={{ width: `${item.percent}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Leaderboard</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Ranked by closest guess to{" "}
            {data.isActualResult ? "actual birth" : "configured due date"}.
          </p>
          <ol className="mt-3 space-y-2">
            {data.leaderboard.map((entry, index) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-zinc-100 p-3"
              >
                <div>
                  <p className="font-medium">
                    #{index + 1} {entry.name}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {entry.dateGuess} at {entry.timeGuess}
                  </p>
                </div>
                <p className="text-sm font-semibold">{formatDuration(entry.deltaMs)}</p>
              </li>
            ))}
          </ol>
        </article>

        <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Timeline</h2>
          <ol className="mt-3 space-y-2">
            {data.bets.map((bet) => (
              <li
                key={bet.id}
                className="flex items-center justify-between rounded-lg border border-zinc-100 p-3"
              >
                <div>
                  <p className="font-medium">{bet.name}</p>
                  <p className="text-xs text-zinc-500">
                    {formatDateTime(bet.guessDateTime)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    bet.paymentSent
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
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
  );
}
