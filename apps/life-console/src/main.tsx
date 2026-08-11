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
const candidateMode = import.meta.env.MODE === "candidate-preview";
const client = candidateMode
  ? undefined
  : sitesMode ? createSitesApiClient() : createApiClient();

createRoot(root).render(
  <StrictMode>
    <App
      client={client}
      initialDashboard={candidateMode ? syntheticDashboard : undefined}
      mode={candidateMode ? "candidate-preview" : sitesMode ? "sites" : "local"}
    />
  </StrictMode>,
);
