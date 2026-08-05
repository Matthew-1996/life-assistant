import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createApiClient } from "./api/client";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Life Console root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App client={createApiClient()} />
  </StrictMode>,
);
