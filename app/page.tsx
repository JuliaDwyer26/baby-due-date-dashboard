import { APP_CONFIG } from "@/lib/config";
import { getDashboardData } from "@/lib/bets";
import { DashboardClient } from "@/components/dashboard-client";

export default async function Home() {
  const data = await getDashboardData();

  return (
    <DashboardClient
      entryFeeUsd={APP_CONFIG.entryFeeUsd}
      dueDateMs={data.dueDate.getTime()}
      actualBirthMs={data.actualBirthDate ? data.actualBirthDate.getTime() : null}
      bets={data.bets.map((bet) => ({
        id: bet.id,
        name: bet.name,
        dateGuess: bet.dateGuess,
        timeGuess: bet.timeGuess,
        paymentSent: bet.paymentSent,
        guessMs: bet.guessDateTime.getTime(),
      }))}
      oddsByDate={data.oddsByDate}
    />
  );
}
