import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createApiClient } from "./api/client";
import { createSitesApiClient } from "./api/sites-client";
import { syntheticDashboard } from "./data/dashboard";
import { SupabaseAuthGate } from "./features/auth/SupabaseAuthGate";
import { createSupabaseAuthService } from "./supabase/auth";
import {
  createLifeConsoleSupabaseClient,
  resolveSupabaseConfig,
} from "./supabase/client";
import { DailyCheckinRepository } from "./supabase/daily-checkins";
import { GoalRepository } from "./supabase/goals";
import { JournalRepository } from "./supabase/journals";
import { ReviewRepository } from "./supabase/reviews";
import { createSupabaseDashboardClient } from "./supabase/dashboard";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Life Console root element is missing");
}

const sitesMode = import.meta.env.MODE === "sites-200";
const stageAPocEnabled = import.meta.env.MODE === "stage-a-candidate";
const supabaseCandidateMode = import.meta.env.MODE === "supabase-candidate";
const candidateMode = ["candidate-preview", "stage-a-candidate"].includes(
  import.meta.env.MODE,
);
const client = candidateMode || supabaseCandidateMode
  ? undefined
  : sitesMode ? createSitesApiClient() : createApiClient();

function shanghaiDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

if (supabaseCandidateMode) {
  const config = resolveSupabaseConfig(import.meta.env);
  if (!config) {
    throw new Error("Supabase candidate configuration is missing");
  }
  const supabase = createLifeConsoleSupabaseClient(config);
  const dailyCheckins = new DailyCheckinRepository(supabase);
  const goals = new GoalRepository(supabase);
  const journals = new JournalRepository(supabase);
  const reviews = new ReviewRepository(supabase);
  const auth = createSupabaseAuthService(supabase.auth);
  const dashboardClient = createSupabaseDashboardClient({
    dateProvider: shanghaiDate,
    dailyCheckins,
    goals,
    journals,
  });
  createRoot(root).render(
    <StrictMode>
      <SupabaseAuthGate
        auth={auth}
        deliveryMode="magic-link"
      >
        {({ session, signOut }) => (
          <App
            client={dashboardClient}
            key={session.userId}
            mode="supabase-candidate"
            supabase={{
              dailyCheckins,
              goals,
              journals,
              reviews,
              session,
              signOut,
            }}
          />
        )}
      </SupabaseAuthGate>
    </StrictMode>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <App
        client={client}
        initialDashboard={candidateMode ? syntheticDashboard : undefined}
        mode={candidateMode ? "candidate-preview" : sitesMode ? "sites" : "local"}
        stageAPocEnabled={stageAPocEnabled}
      />
    </StrictMode>,
  );
}
