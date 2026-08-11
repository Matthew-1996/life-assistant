import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createApiClient } from "./api/client";
import { createSitesApiClient } from "./api/sites-client";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Life Console root element is missing");
}

const sitesMode = import.meta.env.MODE === "sites-200";
const client = sitesMode ? createSitesApiClient() : createApiClient();

createRoot(root).render(
  <StrictMode>
    <App client={client} mode={sitesMode ? "sites" : "local"} />
  </StrictMode>,
);
