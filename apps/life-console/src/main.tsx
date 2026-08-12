import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createApiClient } from "./api/client";
import { createSitesApiClient } from "./api/sites-client";
import { syntheticDashboard } from "./data/dashboard";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Life Console root element is missing");
}

const sitesMode = import.meta.env.MODE === "sites-200";
const stageAPocEnabled = import.meta.env.MODE === "stage-a-candidate";
const candidateMode = ["candidate-preview", "stage-a-candidate"].includes(
  import.meta.env.MODE,
);
const client = candidateMode
  ? undefined
  : sitesMode ? createSitesApiClient() : createApiClient();

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
